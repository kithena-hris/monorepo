import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { InterviewEnds, MeetEvents } from '../application/ports.js';

/**
 * A timer at each interview's end, in Valkey through BullMQ: one delayed job
 * per interview, named by it, so booking or moving it again replaces the
 * timer and cancelling it removes it. The worker completes the interview the
 * moment the job comes due and asks each interviewer for their scorecard;
 * nothing polls for it.
 */
const QUEUE = 'recruiting-interview-ends';

const jobId = (tenantId: string, interviewId: string): string => `${tenantId}:${interviewId}`;
const watchId = (tenantId: string, interviewId: string): string =>
  `watch:${tenantId}:${interviewId}`;

const once = (delayMs: number) => ({
  delay: Math.max(0, delayMs),
  removeOnComplete: true,
  removeOnFail: 100,
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
});

export function valkeyInterviewEnds(url: string): InterviewEnds & {
  readonly meet: (topic: string) => MeetEvents;
  close(): Promise<void>;
} {
  const queue = new Queue(QUEUE, { connection: { url, maxRetriesPerRequest: null } });
  // Which interview a watched space is: a plain key beside the timers, gone when the watch is.
  const keys = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  return {
    async at(tenantId, interviewId, endsAt) {
      const id = jobId(tenantId, interviewId);
      await queue.remove(id);
      await queue.add(
        'ended',
        { tenantId, interviewId },
        { jobId: id, ...once(Date.parse(endsAt) - Date.now()) },
      );
    },
    async watch(tenantId, interviewId, at) {
      const id = watchId(tenantId, interviewId);
      await queue.remove(id);
      await queue.add(
        'watch',
        { tenantId, interviewId },
        { jobId: id, ...once(Date.parse(at) - Date.now()) },
      );
    },
    async drop(tenantId, interviewId) {
      await queue.remove(jobId(tenantId, interviewId));
      await queue.remove(watchId(tenantId, interviewId));
    },
    /** Which interview a watched Meet space is, in the same Valkey, for as long as it is watched. */
    meet: (topic) => ({
      topic,
      async remember(space, interview, ttlSeconds) {
        await keys.set(`meet-space:${space}`, JSON.stringify(interview), 'EX', ttlSeconds);
      },
      async recall(space) {
        const held = await keys.get(`meet-space:${space}`);
        if (held === null) return null;
        const at = JSON.parse(held) as { tenantId?: unknown; interviewId?: unknown };
        return typeof at.tenantId === 'string' && typeof at.interviewId === 'string'
          ? { tenantId: at.tenantId, interviewId: at.interviewId }
          : null;
      },
    }),
    async close() {
      await queue.close();
      keys.disconnect();
    },
  };
}

/** The worker that hears each interview end, and starts listening to each Meet call. */
export function interviewEndWorker(
  url: string,
  handle: {
    readonly ended: (tenantId: TenantId, interviewId: string) => Promise<boolean>;
    readonly watch: (tenantId: TenantId, interviewId: string) => Promise<boolean>;
  },
): { close(): Promise<void> } {
  const worker = new Worker<{ tenantId: string; interviewId: string }>(
    QUEUE,
    async (job) =>
      (job.name === 'watch' ? handle.watch : handle.ended)(
        job.data.tenantId as TenantId,
        job.data.interviewId,
      ),
    { connection: { url, maxRetriesPerRequest: null }, concurrency: 2 },
  );
  worker.on('failed', (job, cause) => {
    logger.error(
      { module: 'recruiting', job: job?.name, interviewId: job?.data.interviewId, err: cause },
      'interview timer not handled',
    );
  });
  return { close: () => worker.close() };
}
