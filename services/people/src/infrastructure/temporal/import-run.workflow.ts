import { proxyActivities } from '@temporalio/workflow';

/**
 * An approved import, run to the end (docs/ai-settings.md, "Approve and
 * run").
 *
 * Deliberately thin, as `full-values.workflow.ts` is: the run's row is the
 * truth, and each `step` reads it, does the run's next chunk and says whether
 * there is another. A worker that dies mid-chunk had its chunk rolled back;
 * Temporal retries the activity on the next worker, which reads the row and
 * does that chunk again. A chunk that keeps failing past the retries stops
 * the run with its reason, keeping what the finished chunks wrote.
 *
 * Self-contained on purpose: Temporal bundles this file on its own, and the
 * only thing it imports from the module is a type.
 *
 * `ponytail: one history for the whole run, ~6 events a chunk; 50,000 rows
 * is ~3,000 chunks, inside Temporal's 50k-event limit. continueAsNew is the
 * step if the batch shrinks or the row limit grows.`
 */

export interface ImportRunInput {
  readonly tenantId: string;
  readonly runId: string;
}

export interface ImportRunActivities {
  step(input: ImportRunInput): Promise<'more' | 'done'>;
  stop(input: ImportRunInput, why: string): Promise<void>;
}

export async function importRun(input: ImportRunInput): Promise<void> {
  const { step } = proxyActivities<ImportRunActivities>({
    startToCloseTimeout: '15 minutes',
    // A restart, a deploy or the database waking: minutes of retrying, then stop.
    retry: {
      initialInterval: '5 seconds',
      backoffCoefficient: 2,
      maximumInterval: '2 minutes',
      maximumAttempts: 10,
    },
  });
  const { stop } = proxyActivities<ImportRunActivities>({
    startToCloseTimeout: '1 minute',
    retry: { initialInterval: '5 seconds', maximumInterval: '1 minute', maximumAttempts: 30 },
  });
  try {
    while ((await step(input)) === 'more') {
      // Each step is one chunk; the row says what the next one is.
    }
  } catch {
    await stop(input, 'The import kept failing and was stopped');
  }
}
