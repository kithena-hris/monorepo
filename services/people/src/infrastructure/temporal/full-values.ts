import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client, Connection, WorkflowIdReusePolicy } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { logger } from '@kithena/telemetry';

import {
  DECISION_WINDOW_MS,
  settleFullValues,
  type FullValuesDeps,
} from '../../application/export/full-values.js';
import { inTenantResult } from '../../application/person/person-access.js';
import type { InTenant } from '../../application/person/service.js';
import {
  decidedSignal,
  fullValuesApproval,
  type FullValuesActivities,
  type FullValuesInput,
} from './full-values.workflow.js';

/**
 * Full-values requests on Temporal (CLAUDE.md: Temporal for long-running
 * human-in-the-loop work). One workflow per request, id
 * `people-full-values-<request id>`, started after the request commits and
 * woken after the decision commits.
 *
 * **With no `TEMPORAL_ADDRESS`** — `just standalone people`, the unit tests —
 * a decision settles in-process straight after it commits, and an undecided
 * request is expired lazily: it reads as expired once its week is up and a
 * late decision is refused, but no `full_values_expired` event is raised
 * until something settles it. That is said at boot.
 */

export const TASK_QUEUE = 'people-full-values';
export const workflowId = (requestId: string): string => `people-full-values-${requestId}`;

export interface FullValuesRunner {
  /** After the request commits. */
  started(tenantId: string, requestId: string, correlationId: string): Promise<void>;
  /** After the decision commits. */
  decided(tenantId: string, requestId: string, correlationId: string): Promise<void>;
  close(): Promise<void>;
}

/** The activity: the application's `settle`, in its tenant's transaction. */
export function activities(inTenant: InTenant, deps: FullValuesDeps): FullValuesActivities {
  return {
    async settle(input: FullValuesInput) {
      const settled = await inTenantResult(inTenant, input.tenantId, (tx) =>
        settleFullValues(tx, deps, input),
      );
      // A refusal here is a request that vanished; retrying will not find it.
      if (!settled.ok) throw new Error(`settle refused: ${settled.error.code}`);
      return settled.value;
    },
  };
}

/** The workflow file, as source under tsx and vitest, as output once built. */
export function workflowsPath(): string {
  const built = fileURLToPath(new URL('./full-values.workflow.js', import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL('./full-values.workflow.ts', import.meta.url));
}

const input = (tenantId: string, requestId: string, correlationId: string): FullValuesInput => ({
  tenantId,
  requestId,
  correlationId,
  windowMs: DECISION_WINDOW_MS,
});

export async function startFullValues(
  env: NodeJS.ProcessEnv,
  inTenant: InTenant,
  deps: FullValuesDeps,
): Promise<FullValuesRunner> {
  const address = env['TEMPORAL_ADDRESS'];
  const namespace = env['TEMPORAL_NAMESPACE'] ?? 'default';
  const acts = activities(inTenant, deps);
  if (!address) {
    logger.warn(
      { module: 'people' },
      'TEMPORAL_ADDRESS is not set; full-values decisions settle in-process and an undecided request expires without an event',
    );
    return {
      started: () => Promise.resolve(),
      async decided(tenantId, requestId, correlationId) {
        await acts.settle(input(tenantId, requestId, correlationId));
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
    logger.error({ module: 'people', err: cause }, 'full-values worker stopped');
  });
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  return {
    async started(tenantId, requestId, correlationId) {
      await client.workflow.start(fullValuesApproval, {
        taskQueue: TASK_QUEUE,
        workflowId: workflowId(requestId),
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        args: [input(tenantId, requestId, correlationId)],
      });
    },
    async decided(_tenantId, requestId) {
      await client.workflow.getHandle(workflowId(requestId)).signal(decidedSignal);
    },
    async close() {
      worker.shutdown();
      await running;
      await connection.close();
    },
  };
}
