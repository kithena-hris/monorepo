import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client, Connection, WorkflowIdReusePolicy } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { ok } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type { ReminderCompany } from '../../application/completeness/reminders.js';
import {
  DECISION_WINDOW_MS,
  settlePendingChange,
  whoToTell,
  type Holding,
  type RoleReads,
} from '../../application/person/pending-changes.js';
import { inTenantResult } from '../../application/person/person-access.js';
import type { PersonReader } from '../../application/person/ports.js';
import type { InTenant } from '../../application/person/service.js';
import type { ApprovalMailer, ApprovalNotice } from '../approval-mailer.js';
import {
  closedSignal,
  pendingChangeApproval,
  type PendingChangeActivities,
  type PendingChangeInput,
  type Settled,
} from './pending-change.workflow.js';

/**
 * Changes held for approval on Temporal (PEO-077; CLAUDE.md: Temporal for
 * long-running human-in-the-loop work). One workflow per change, id
 * `people-pending-change-<change id>`, started when People consumes its own
 * `change_requested` and woken by `change_decided` or `change_withdrawn` —
 * so every writer that holds a value, whatever its transport, starts one
 * without knowing this exists, and only after its transaction committed.
 *
 * **With no `TEMPORAL_ADDRESS`** the same activities run in-process off the
 * same events: approvers are told when it is requested and the requester
 * when it closes, but an undecided change is expired lazily — it reads as
 * expired once its week is up, and a late decision is refused — with no
 * `change_expired` and no email until something settles it. Said at boot.
 */

export const TASK_QUEUE = 'people-pending-change';
export const workflowId = (changeId: string): string => `people-pending-change-${changeId}`;

export interface PendingChangeRunner {
  /** On `change_requested`. Idempotent: a redelivered event starts nothing twice. */
  started(tenantId: string, changeId: string, correlationId: string): Promise<void>;
  /** On `change_decided` or `change_withdrawn`. */
  closed(tenantId: string, changeId: string, correlationId: string): Promise<void>;
  close(): Promise<void>;
}

export interface PendingChangeWorkDeps {
  readonly holding: Holding;
  readonly reader: PersonReader;
  readonly roles: RoleReads;
  /** The company's name and origin, or null when it cannot be linked to. */
  readonly companyOf: (
    tx: Parameters<Holding['publish']>[0],
    tenantId: string,
  ) => Promise<ReminderCompany | null>;
  /** Absent, nothing is emailed; the events stand. */
  readonly mailer?: ApprovalMailer;
}

/** The activities: who to tell, read in the tenant's transaction; the emails after it. */
export function activities(
  inTenant: InTenant,
  deps: PendingChangeWorkDeps,
): PendingChangeActivities {
  const mail = async (
    tenantId: string,
    company: ReminderCompany | null,
    to: readonly { readonly email: string; readonly key: string }[],
    notice: ApprovalNotice,
  ) => {
    const { mailer } = deps;
    if (!mailer || company === null) {
      if (to.length > 0)
        logger.info({ tenantId, kind: notice.kind }, 'approval notice not emailed');
      return;
    }
    // One at a time: a handful of HR members; a refusal throws and the
    // activity retries, and each dedupe key makes the retry one email.
    for (const { email, key } of to) await mailer.send(tenantId, company, email, notice, key);
  };

  return {
    async announce(input) {
      const told = await inTenant(input.tenantId, async ({ tx }) => {
        const change = await deps.holding.store.find(tx, input.tenantId, input.changeId);
        if (change?.approval.state !== 'pending') return null;
        return {
          who: await whoToTell(tx, deps, change),
          company: await deps.companyOf(tx, input.tenantId),
        };
      });
      if (told === null) return;
      await mail(
        input.tenantId,
        told.company,
        told.who.approvers.map((a) => ({
          email: a.email,
          key: `approval/${input.changeId}/requested/${a.accountId}`,
        })),
        { kind: 'approval_requested' },
      );
    },

    async settle(input): Promise<Settled> {
      type Told = {
        readonly state: Settled;
        readonly requester: string | null;
        readonly company: ReminderCompany | null;
      };
      const settled = await inTenantResult<Told>(inTenant, input.tenantId, async (tx) => {
        const done = await settlePendingChange(tx, deps.holding, input);
        if (!done.ok) return done;
        const { state, change } = done.value;
        if (state === 'pending' || state === 'withdrawn') {
          return ok({ state, requester: null, company: null });
        }
        return ok({
          state,
          requester: (await whoToTell(tx, deps, change)).requester,
          company: await deps.companyOf(tx, input.tenantId),
        });
      });
      // A refusal here is a change that vanished; retrying will not find it.
      if (!settled.ok) throw new Error(`settle refused: ${settled.error.code}`);
      const { state, requester, company } = settled.value;
      if (requester !== null && (state === 'approved' || state === 'rejected')) {
        await mail(
          input.tenantId,
          company,
          [{ email: requester, key: `approval/${input.changeId}/decided` }],
          { kind: 'approval_decided', decision: state },
        );
      } else if (requester !== null && state === 'expired') {
        await mail(
          input.tenantId,
          company,
          [{ email: requester, key: `approval/${input.changeId}/expired` }],
          { kind: 'approval_expired' },
        );
      }
      return state;
    },
  };
}

/** The workflow file, as source under tsx and vitest, as output once built. */
export function workflowsPath(): string {
  const built = fileURLToPath(new URL('./pending-change.workflow.js', import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL('./pending-change.workflow.ts', import.meta.url));
}

const input = (tenantId: string, changeId: string, correlationId: string): PendingChangeInput => ({
  tenantId,
  changeId,
  correlationId,
  windowMs: DECISION_WINDOW_MS,
});

export async function startPendingChanges(
  env: NodeJS.ProcessEnv,
  inTenant: InTenant,
  deps: PendingChangeWorkDeps,
): Promise<PendingChangeRunner> {
  const address = env['TEMPORAL_ADDRESS'];
  const namespace = env['TEMPORAL_NAMESPACE'] ?? 'default';
  const acts = activities(inTenant, deps);
  if (!address) {
    logger.warn(
      { module: 'people' },
      'TEMPORAL_ADDRESS is not set; pending changes are announced and settled in-process, and an undecided one expires without an event',
    );
    return {
      started: (tenantId, changeId, correlationId) =>
        acts.announce(input(tenantId, changeId, correlationId)),
      async closed(tenantId, changeId, correlationId) {
        await acts.settle(input(tenantId, changeId, correlationId));
      },
      close: () => Promise.resolve(),
    };
  }

  const worker = await Worker.create({
    connection: await NativeConnection.connect({ address }),
    namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: workflowsPath(),
    activities: acts,
  });
  const running = worker.run();
  running.catch((cause: unknown) => {
    logger.error({ module: 'people', err: cause }, 'pending-change worker stopped');
  });
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  return {
    async started(tenantId, changeId, correlationId) {
      try {
        await client.workflow.start(pendingChangeApproval, {
          taskQueue: TASK_QUEUE,
          workflowId: workflowId(changeId),
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          args: [input(tenantId, changeId, correlationId)],
        });
      } catch (cause) {
        // A redelivered `change_requested`: the workflow is already there.
        if ((cause as { name?: string }).name !== 'WorkflowExecutionAlreadyStartedError')
          throw cause;
      }
    },
    async closed(_tenantId, changeId) {
      try {
        await client.workflow.getHandle(workflowId(changeId)).signal(closedSignal);
      } catch (cause) {
        // Already finished — it expired first, or this is a redelivery.
        if ((cause as { name?: string }).name !== 'WorkflowNotFoundError') throw cause;
      }
    },
    async close() {
      worker.shutdown();
      await running;
      await connection.close();
    },
  };
}
