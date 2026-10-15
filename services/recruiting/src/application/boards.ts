import { ok } from '@kithena/domain-kit';

import type { JobBoard } from './ports.js';

/**
 * The two boards that need no account (PRD §26.1). Google reads the
 * `JobPosting` structured data on Kithena Jobs' page, and aggregators read the
 * company's XML feed, so publishing is saying where; closing is the page and
 * the feed dropping the job, which the projection already does.
 */
export function ownBoards(jobsOrigin: string): readonly JobBoard[] {
  return [
    {
      target: 'google_for_jobs',
      publish: (job) => Promise.resolve(ok({ url: job.url })),
      close: () => Promise.resolve(),
    },
    {
      target: 'xml_feed',
      publish: (job) => Promise.resolve(ok({ url: `${jobsOrigin}/feeds/${job.company}.xml` })),
      close: () => Promise.resolve(),
    },
  ];
}
