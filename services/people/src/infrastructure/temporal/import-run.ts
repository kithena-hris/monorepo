import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  Client,
  Connection,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from '@temporalio/client';
import { Context } from '@temporalio/activity';
import { NativeConnection, Worker } from '@temporalio/worker';
import { logger } from '@kithena/telemetry';

import { stepRun, stopRun, type RunDeps } from '../../application/import/run.js';
import { importRun, type ImportRunActivities, type ImportRunInput } from './import-run.workflow.js';

/**
 * Approved imports on Temporal (CLAUDE.md: Temporal for long-running work).
 * One workflow per run, id `people-import-<run id>`, started once the
 * approval commits, and again for every run still going when People boots:
 * an existing workflow is joined, never doubled, and a run whose workflow is
 * gone gets a new one, which carries on from the run's next chunk.
 *
 * The task queue, `people-imports`, is what the VM's idle stop counts
 * (`deploy/vm/idle-stop.sh`): a running import keeps the VM up.
 *
 * **With no `TEMPORAL_ADDRESS`** — `just standalone people`, the tests — the
 * same steps run in this process, retried with backoff, and a run still
 * going is picked up again at boot. Said at boot.
 */

export const TASK_QUEUE = 'people-imports';
export const workflowId = (runId: string): string => `people-import-${runId}`;

export interface ImportRunner {
  /** After the approval commits; again is harmless. */
  kick(tenantId: string, runId: string): Promise<void>;
  close(): Promise<void>;
}

export function activities(deps: RunDeps): ImportRunActivities {
  return {
    step: (input) => stepRun(deps, input.tenantId, input.runId),
    stop: (input, why) => stopRun(deps, input.tenantId, input.runId, why),
  };
}

/** The workflow file, as source under tsx and vitest, as output once built. */
export function workflowsPath(): string {
  const built = fileURLToPath(new URL('./import-run.workflow.js', import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL('./import-run.workflow.ts', import.meta.url));
}

/** Every run still going, to pick up at boot. */
export type Going = () => Promise<readonly ImportRunInput[]>;

export async function startImportRuns(
  env: NodeJS.ProcessEnv,
  deps: RunDeps,
  going: Going,
  options: { readonly retryMs?: number; readonly attempts?: number } = {},
): Promise<ImportRunner> {
  const address = env['TEMPORAL_ADDRESS'];
  const namespace = env['TEMPORAL_NAMESPACE'] ?? 'default';
  const acts = activities(deps);
  const runner = address ? await temporal(address, namespace, acts) : inProcess(acts, options);
  // Whatever was going when the last process stopped, and then every few
  // minutes whatever an approval could not start (Temporal unreachable at
  // that moment): joining a running workflow is harmless.
  const pickUp = (): void => {
    void going()
      .then(async (runs) => {
        // eslint-disable-next-line no-await-in-loop -- a handful, one at a time
        for (const r of runs) await runner.kick(r.tenantId, r.runId);
      })
      .catch((cause: unknown) => {
        logger.error({ module: 'people', err: cause }, 'imports still going were not picked up');
      });
  };
  pickUp();
  const again = setInterval(pickUp, PICK_UP_MS);
  again.unref();
  return {
    kick: (tenantId, runId) => runner.kick(tenantId, runId),
    async close() {
      clearInterval(again);
      await runner.close();
    },
  };
}

const PICK_UP_MS = 5 * 60_000;

/**
 * A chunk heartbeats while it works, so a worker that dies mid-chunk is
 * noticed in half a minute (`heartbeatTimeout`) and the chunk retried on the
 * next one, however long a chunk of a large file takes.
 */
const HEARTBEAT_MS = 5_000;

function beating(acts: ImportRunActivities): ImportRunActivities {
  return {
    async step(input) {
      const ctx = Context.current();
      const beat = setInterval(() => {
        ctx.heartbeat();
      }, HEARTBEAT_MS);
      try {
        return await acts.step(input);
      } finally {
        clearInterval(beat);
      }
    },
    stop: (input, why) => acts.stop(input, why),
  };
}

async function temporal(
  address: string,
  namespace: string,
  acts: ImportRunActivities,
): Promise<ImportRunner> {
  const worker = await Worker.create({
    connection: await NativeConnection.connect({ address }),
    namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: workflowsPath(),
    activities: beating(acts),
  });
  const running = worker.run();
  running.catch((cause: unknown) => {
    logger.error({ module: 'people', err: cause }, 'import worker stopped');
  });
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  return {
    async kick(tenantId, runId) {
      await client.workflow.start(importRun, {
        taskQueue: TASK_QUEUE,
        workflowId: workflowId(runId),
        // Running: join it. Closed (it stopped the run, or was lost): the row
        // decides, and a new one finds the run over or carries it on.
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        args: [{ tenantId, runId }],
      });
    },
    async close() {
      worker.shutdown();
      await running;
      await connection.close();
    },
  };
}

/** The workflow's loop and retries, in this process. */
function inProcess(
  acts: ImportRunActivities,
  options: { readonly retryMs?: number; readonly attempts?: number },
): ImportRunner {
  logger.warn(
    { module: 'people' },
    'TEMPORAL_ADDRESS is not set; approved imports run in this process and are picked up again at boot',
  );
  const attempts = options.attempts ?? 10;
  const retryMs = options.retryMs ?? 5_000;
  const driving = new Map<string, Promise<void>>();
  let closed = false;
  const drive = async (input: ImportRunInput): Promise<void> => {
    // `closed` is set by `close`, between chunks.
    // eslint-disable-next-line no-unmodified-loop-condition -- see above
    for (let failures = 0; !closed;) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one chunk after another
        if ((await acts.step(input)) === 'done') return;
        failures = 0;
      } catch (cause) {
        failures += 1;
        logger.warn({ module: 'people', err: cause, runId: input.runId }, 'import chunk failed');
        if (failures >= attempts) {
          // eslint-disable-next-line no-await-in-loop -- once, at the end
          await acts.stop(input, 'The import kept failing and was stopped');
          return;
        }
        // eslint-disable-next-line no-await-in-loop -- the backoff is the point
        await new Promise((resolve) => setTimeout(resolve, retryMs * 2 ** (failures - 1)));
      }
    }
  };
  return {
    kick(tenantId, runId) {
      if (!driving.has(runId)) {
        const driven = drive({ tenantId, runId })
          .catch((cause: unknown) => {
            logger.error({ module: 'people', err: cause, runId }, 'import run stopped');
          })
          .finally(() => driving.delete(runId));
        driving.set(runId, driven);
      }
      return Promise.resolve();
    },
    async close() {
      closed = true;
      await Promise.all(driving.values());
    },
  };
}
