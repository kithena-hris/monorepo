import { Queue, Worker } from 'bullmq';
import type { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { InterviewEnds } from '../application/ports.js';

/**
 * A timer at each interview's end, in Valkey through BullMQ: one delayed job
 * per interview, named by it, so booking or moving it again replaces the
 * timer and cancelling it removes it. The worker completes the interview the
 * moment the job comes due and asks each interviewer for their scorecard;
 * nothing polls for it.
 */
const QUEUE = 'recruiting-interview-ends';

const jobId = (tenantId: string, interviewId: string): string => `${tenantId}:${interviewId}`;

export function valkeyInterviewEnds(url: string): InterviewEnds & { close(): Promise<void> } {
  const queue = new Queue(QUEUE, { connection: { url, maxRetriesPerRequest: null } });
  return {
    async at(tenantId, interviewId, endsAt) {
      const id = jobId(tenantId, interviewId);
      await queue.remove(id);
      await queue.add(
        'ended',
        { tenantId, interviewId },
        {
          jobId: id,
          delay: Math.max(0, Date.parse(endsAt) - Date.now()),
          removeOnComplete: true,
          removeOnFail: 100,
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    },
    async drop(tenantId, interviewId) {
      await queue.remove(jobId(tenantId, interviewId));
    },
    close: () => queue.close(),
  };
}

/** The worker that hears each interview end. */
export function interviewEndWorker(
  url: string,
  complete: (tenantId: TenantId, interviewId: string) => Promise<boolean>,
): { close(): Promise<void> } {
  const worker = new Worker<{ tenantId: string; interviewId: string }>(
    QUEUE,
    async (job) => complete(job.data.tenantId as TenantId, job.data.interviewId),
    { connection: { url, maxRetriesPerRequest: null }, concurrency: 2 },
  );
  worker.on('failed', (job, cause) => {
    logger.error(
      { module: 'recruiting', interviewId: job?.data.interviewId, err: cause },
      'interview end not handled',
    );
  });
  return { close: () => worker.close() };
}
