import { randomBytes } from 'node:crypto';

import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { systemClock, type Clock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type { ExportJobDeps } from '../application/export/job.js';
import {
  localObjectStore,
  sealedObjectStore,
  type ObjectStore,
} from '../application/export/object-store.js';
import {
  purgeBefore,
  runQueuedExport,
  type ExportQueue,
  type QueuedExport,
} from '../application/export/queue.js';
import { inTenantResult } from '../application/person/person-access.js';
import type { InTenant } from '../application/person/service.js';
import { s3Blobs } from './s3-blobs.js';

/**
 * Where exports are stored and how the big ones run (PRD §15.1).
 *
 * **BullMQ on Valkey** for the queue, as CLAUDE.md says for fire-and-forget
 * work: an export has no human step in the middle, only a requester who
 * comes back for the link. The job id is the export id, so enqueuing the same
 * export twice is one job, and the ledger makes a retried job that already
 * completed a no-op. Five attempts, backing off exponentially from five
 * seconds; a refusal (a field refused, a reason missing) is not retried,
 * because it would be refused again.
 *
 * **The sweep** deletes files older than a link's lifetime, at most
 * `SWEEP_LIMIT` per run, once an hour. On BullMQ it is a job scheduler, so
 * one replica runs it, not every one.
 *
 * **With nothing configured** — no bucket, no `VALKEY_URL`, which is `just
 * standalone people` and every unit test — both fall back to in-process
 * versions and say so in the log. The module boots and exports work; they do
 * not survive a restart.
 */

export const QUEUE_NAME = 'people-exports';
const SWEEP_EVERY_MS = 60 * 60 * 1000;
export const SWEEP_LIMIT = 1000;
const ATTEMPTS = 5;
const BACKOFF_MS = 5000;

/** 32 bytes, base64; or a fresh one with a warning when unset. */
function key(env: NodeJS.ProcessEnv, name: string, required: boolean): Buffer {
  const value = env[name];
  if (value) {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
    return bytes;
  }
  if (required) throw new Error(`${name} is required when an export bucket is configured`);
  logger.warn({ module: 'people', key: name }, `${name} is not set; using a key for this process only`);
  return randomBytes(32);
}

export function exportStoreFrom(env: NodeJS.ProcessEnv, clock: Clock = systemClock): ObjectStore {
  const bucket = env['PEOPLE_EXPORT_BUCKET'];
  const sealing = {
    encryptionKey: key(env, 'PEOPLE_EXPORT_ENCRYPTION_KEY', Boolean(bucket)),
    signingKey: key(env, 'PEOPLE_EXPORT_SIGNING_KEY', Boolean(bucket)),
    clock,
    baseUrl: env['PEOPLE_EXPORT_LINK_BASE'] ?? 'http://localhost:4001/v1/exports/files',
  };
  if (!bucket) {
    logger.warn(
      { module: 'people' },
      'PEOPLE_EXPORT_BUCKET is not set; export files are kept in memory and lost on restart',
    );
    return localObjectStore(sealing);
  }
  return sealedObjectStore(
    sealing,
    s3Blobs({
      bucket,
      region: env['PEOPLE_EXPORT_S3_REGION'] ?? 'us-east-1',
      ...(env['PEOPLE_EXPORT_S3_ENDPOINT'] ? { endpoint: env['PEOPLE_EXPORT_S3_ENDPOINT'] } : {}),
      accessKeyId: env['PEOPLE_EXPORT_S3_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: env['PEOPLE_EXPORT_S3_SECRET_ACCESS_KEY'] ?? '',
    }),
  );
}

export interface ExportRunner extends ExportQueue {
  close(): Promise<void>;
}

/** Run one queued job in its tenant. A refusal is final; a throw is retried. */
async function runOne(
  inTenant: InTenant,
  deps: ExportJobDeps,
  job: QueuedExport,
): Promise<void> {
  const result = await inTenantResult(inTenant, job.request.tenantId, (tx) =>
    runQueuedExport(tx, deps, job),
  );
  if (!result.ok) {
    logger.warn(
      { module: 'people', exportId: job.exportId, code: result.error.code },
      'queued export refused',
    );
    throw new UnrecoverableError(result.error.code);
  }
}

async function sweep(store: ObjectStore, clock: Clock): Promise<void> {
  const deleted = await store.purge(purgeBefore(clock.instant()), SWEEP_LIMIT);
  if (deleted > 0) logger.info({ module: 'people', deleted }, 'expired export files deleted');
}

export async function startExportRunner(
  env: NodeJS.ProcessEnv,
  inTenant: InTenant,
  deps: ExportJobDeps,
): Promise<ExportRunner> {
  const url = env['VALKEY_URL'];
  if (!url) {
    logger.warn(
      { module: 'people' },
      'VALKEY_URL is not set; large exports run in this process and a restart drops them',
    );
    return inProcessRunner(inTenant, deps);
  }

  const connection = { url, maxRetriesPerRequest: null };
  const queue = new Queue<QueuedExport>(QUEUE_NAME, { connection });
  const worker = new Worker<QueuedExport>(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'sweep') await sweep(deps.store, deps.clock);
      else await runOne(inTenant, deps, job.data);
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, cause) => {
    logger.error({ module: 'people', exportId: job?.id, err: cause }, 'export job attempt failed');
  });
  await queue.upsertJobScheduler('people-exports-sweep', { every: SWEEP_EVERY_MS }, { name: 'sweep' });

  return {
    async enqueue(job) {
      await queue.add('export', job, {
        jobId: job.exportId,
        attempts: ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_MS },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

/**
 * ponytail: one attempt, in this process, and a timer for the sweep. Enough
 * for a laptop and a standalone boot; `VALKEY_URL` is the upgrade.
 */
export function inProcessRunner(inTenant: InTenant, deps: ExportJobDeps): ExportRunner {
  const seen = new Set<string>();
  const timer = setInterval(() => {
    void sweep(deps.store, deps.clock).catch((cause: unknown) => {
      logger.error({ module: 'people', err: cause }, 'export sweep failed');
    });
  }, SWEEP_EVERY_MS).unref();
  return {
    enqueue(job) {
      if (seen.has(job.exportId)) return Promise.resolve();
      seen.add(job.exportId);
      setImmediate(() => {
        void runOne(inTenant, deps, job).catch((cause: unknown) => {
          logger.error({ module: 'people', exportId: job.exportId, err: cause }, 'export failed');
        });
      });
      return Promise.resolve();
    },
    close() {
      clearInterval(timer);
      return Promise.resolve();
    },
  };
}
