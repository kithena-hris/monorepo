import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client, Connection, WorkflowIdReusePolicy } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { escalationTick } from '../../application/approval/escalation.js';
import type { ApprovalTimers, Deps } from '../../application/ports.js';
import { leaveRequestId } from '../../domain/request/leave-request.js';
import {
  closedSignal,
  requestEscalation,
  type EscalationActivities,
} from './escalation.workflow.js';

/**
 * Pending requests' clocks on Temporal (TOF-039; CLAUDE.md: Temporal for
 * long-running human-in-the-loop work), as People runs its held changes. One
 * workflow per request, id `timeoff-escalation-<request id>`, started after
 * the request's transaction commits and woken by a decision.
 *
 * **With no `TEMPORAL_ADDRESS`** nothing reminds and nothing escalates; the
 * request waits in the queue like any other. Said at boot.
 */

export const TASK_QUEUE = 'timeoff-escalation';
export const workflowId = (requestId: string): string => `timeoff-escalation-${requestId}`;

/** The activity: the application's tick, a vanished request read as closed. */
export function activities(deps: Pick<Deps, 'uow' | 'newId' | 'notifier'>): EscalationActivities {
  const tick = escalationTick(deps);
  return {
    async tick(input) {
      const result = await tick(
        TenantId.parse(input.tenantId),
        leaveRequestId(input.requestId),
        input.now,
      );
      if (result.ok) return result.value;
      if (result.error.code === 'NOT_FOUND') return { open: false, sleepMs: 0 };
      throw new Error(`escalation tick refused: ${result.error.code}`);
    },
  };
}

/** The workflow file, as source under tsx and vitest, as output once built. */
export function workflowsPath(): string {
  const built = fileURLToPath(new URL('./escalation.workflow.js', import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL('./escalation.workflow.ts', import.meta.url));
}

export interface EscalationRunner extends ApprovalTimers {
  close(): Promise<void>;
}

export async function startEscalation(
  env: NodeJS.ProcessEnv,
  deps: Pick<Deps, 'uow' | 'newId' | 'notifier'>,
): Promise<EscalationRunner> {
  const address = env['TEMPORAL_ADDRESS'];
  if (!address) {
    logger.warn(
      { module: 'timeoff' },
      'TEMPORAL_ADDRESS is not set; pending requests are not reminded or escalated',
    );
    return {
      started: () => Promise.resolve(),
      closed: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
  }
  const namespace = env['TEMPORAL_NAMESPACE'] ?? 'default';
  const worker = await Worker.create({
    connection: await NativeConnection.connect({ address }),
    namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: workflowsPath(),
    activities: activities(deps),
  });
  const running = worker.run();
  running.catch((cause: unknown) => {
    logger.error({ module: 'timeoff', err: cause }, 'escalation worker stopped');
  });
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  return {
    async started(tenantId, requestId, correlationId) {
      try {
        await client.workflow.start(requestEscalation, {
          taskQueue: TASK_QUEUE,
          workflowId: workflowId(requestId),
          // A request sent back to its approver starts a fresh clock once the last one ended.
          workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
          args: [{ tenantId, requestId, correlationId }],
        });
      } catch (cause) {
        // Still running: the clock already ticks for it.
        if ((cause as { name?: string }).name !== 'WorkflowExecutionAlreadyStartedError')
          throw cause;
      }
    },
    async closed(_tenantId, requestId) {
      try {
        await client.workflow.getHandle(workflowId(requestId)).signal(closedSignal);
      } catch (cause) {
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
