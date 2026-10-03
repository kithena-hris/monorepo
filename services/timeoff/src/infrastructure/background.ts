import { Queue, Worker } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { systemClock, type Result } from '@kithena/domain-kit';
import type { TenantId } from '@kithena/contracts';
import { logger, onShutdown } from '@kithena/telemetry';

import {
  balanceWarnings,
  clockOutReminder,
  markTakenDue,
  missedPunchCheck,
  postAccruals,
  yearEnd,
} from '../application/jobs.js';
import { parentalNotices } from '../application/parental/parental.js';
import type { Deps, Notifier, Reach } from '../application/ports.js';
import { calendarHolidays } from '../application/reach/calendar.js';
import { chatStatuses } from '../application/reach/chat.js';
import { knownTenants } from './drizzle-members.js';
import { drizzleUnitOfWork, uuidv7 } from './unit-of-work.js';

/**
 * Everything Time Off does that no request asks for (TOF-043), on BullMQ, as
 * CLAUDE.md says for fire-and-forget work: nothing here waits on a person.
 *
 * Each job is a job scheduler, so one replica runs each tick, and each calls
 * an application function with the injected clock for every tenant, one at a
 * time; one tenant failing is logged and the rest still run. The functions
 * are idempotent, so a retried or doubled tick posts and tells nothing twice.
 *
 * - **accrual**, 00:15 UTC on the 1st: the month's accrual, a new year's grant.
 * - **year-end**, daily: carry-over in, below-zero carried, expiry after use-by.
 * - **warnings**, 08:00 UTC on 1 October and 1 December: "use it or lose it".
 * - **mark-taken**, daily: approved requests whose last day has passed.
 * - **missed-punch**, hourly: the morning check for clock-outs nobody made.
 * - **clock-out-reminder**, every 15 minutes: still in at 20:00, where they are.
 * - **parental-notices**, hourly: a flexible block's notice falling due today.
 * - **calendar-holidays**, 03:00 UTC on the 1st: each member's holidays on their
 *   calendar, where one is connected (TOF-110).
 * - **chat-status**, 05:00 UTC daily: who is away today says so in the chat app,
 *   until their last day ends (TOF-111).
 */

export const QUEUE_NAME = 'timeoff-jobs';

type JobDeps = Pick<Deps, 'uow' | 'clock' | 'newId' | 'notifier' | 'reach'>;

/** Each job by name, with when it runs. */
export function jobs(
  deps: JobDeps,
): Record<
  string,
  { readonly pattern: string; readonly run: (tenantId: TenantId) => Promise<Result<unknown>> }
> {
  return {
    accrual: { pattern: '15 0 1 * *', run: postAccruals(deps) },
    'year-end': { pattern: '30 0 * * *', run: yearEnd(deps) },
    warnings: { pattern: '0 8 1 10,12 *', run: balanceWarnings(deps) },
    'mark-taken': { pattern: '45 0 * * *', run: markTakenDue(deps) },
    'missed-punch': { pattern: '0 * * * *', run: missedPunchCheck(deps) },
    'clock-out-reminder': { pattern: '*/15 * * * *', run: clockOutReminder(deps) },
    'parental-notices': { pattern: '30 * * * *', run: parentalNotices(deps) },
    'calendar-holidays': { pattern: '0 3 1 * *', run: calendarHolidays(deps) },
    'chat-status': { pattern: '0 5 * * *', run: chatStatuses(deps) },
  };
}

/** One job across every tenant. */
export async function runJob(
  table: ReturnType<typeof jobs>,
  name: string,
  tenants: readonly TenantId[],
): Promise<void> {
  const job = table[name];
  if (job === undefined) throw new Error(`No Time Off job called ${name}`);
  for (const tenantId of tenants) {
    try {
      const result = await job.run(tenantId);
      if (!result.ok) logger.warn({ job: name, tenantId, code: result.error.code }, 'job refused');
    } catch (error) {
      logger.error({ err: error, job: name, tenantId }, 'background job failed for a tenant');
    }
  }
}

export interface BackgroundDeps extends JobDeps {
  /** Every tenant with Time Off data. */
  readonly tenants: () => Promise<readonly TenantId[]>;
}

/** The queue, its schedulers and its worker. Null without `VALKEY_URL`. */
export async function startBackground(
  env: NodeJS.ProcessEnv,
  deps: BackgroundDeps,
): Promise<{ stop(): Promise<void> } | null> {
  const url = env['VALKEY_URL'];
  if (!url) {
    logger.info({ module: 'timeoff' }, 'VALKEY_URL unset; no background jobs');
    return null;
  }
  const connection = { url, maxRetriesPerRequest: null };
  const table = jobs(deps);
  const queue = new Queue(QUEUE_NAME, { connection });
  await Promise.all(
    Object.entries(table).map(([name, { pattern }]) =>
      queue.upsertJobScheduler(`timeoff-${name}`, { pattern }, { name }),
    ),
  );
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => runJob(table, job.name, await deps.tenants()),
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, cause) => {
    logger.error({ module: 'timeoff', job: job?.name, err: cause }, 'background job failed');
  });
  return {
    async stop() {
      await worker.close();
      await queue.close();
    },
  };
}

/**
 * What Time Off tells people, until messaging carries it: the log line only,
 * by kind and key, never the notice's figures.
 *
 * ponytail: nobody is told anything yet. Swap for messaging's port when Time
 * Off's notices get their templates.
 */
export const logNotifier: Notifier = {
  notify(tenantId, to, notice, dedupeKey) {
    logger.info({ module: 'timeoff', tenantId, to, kind: notice.kind, dedupeKey }, 'notice');
    return Promise.resolve();
  },
};

/**
 * Called from `main.ts` with Time Off's database: the jobs over the Drizzle
 * unit of work, for every tenant with a member. Without a database there is
 * nothing durable to run them against, and this says so rather than running
 * them over memory.
 */
export function wireBackground(
  env: NodeJS.ProcessEnv,
  db: PostgresJsDatabase | null,
  reach?: Reach,
): void {
  if (db === null) {
    logger.info({ module: 'timeoff' }, 'no Time Off database; no background jobs');
    return;
  }
  const deps: BackgroundDeps = {
    uow: drizzleUnitOfWork(db),
    clock: systemClock,
    newId: uuidv7,
    notifier: logNotifier,
    tenants: () => knownTenants(db),
    ...(reach === undefined ? {} : { reach }),
  };
  const started = startBackground(env, deps);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'timeoff background work failed to start');
    process.exit(1);
  });
  onShutdown('background jobs', async () => (await started)?.stop());
}
