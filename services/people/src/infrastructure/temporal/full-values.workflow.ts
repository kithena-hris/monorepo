import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

/**
 * The wait between finance asking and HR answering (PEO-088).
 *
 * Deliberately thin, because workflow code is replayed and must stay
 * deterministic: it holds no state worth trusting and makes no decision. It
 * sleeps until HR's decision wakes it or the window runs out, then asks the
 * one activity, `settle`, to do whatever the row now calls for — record the
 * expiry, issue the file, or nothing. The row is the truth; this is the
 * alarm clock.
 *
 * Self-contained on purpose: Temporal bundles this file on its own, and the
 * only thing it imports from the module is a type.
 */

export type Settled = 'pending' | 'expired' | 'rejected' | 'issued';

export interface FullValuesInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly correlationId: string;
  /** How long HR has, in milliseconds. */
  readonly windowMs: number;
}

export interface FullValuesActivities {
  settle(input: FullValuesInput): Promise<Settled>;
}

export const decidedSignal = defineSignal('decided');

/** A clock-skew margin: the timer may fire a moment before the row's deadline. */
const RECHECK_MS = 60_000;

export async function fullValuesApproval(input: FullValuesInput): Promise<Settled> {
  const { settle } = proxyActivities<FullValuesActivities>({
    startToCloseTimeout: '5 minutes',
    retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 10 },
  });

  let woken = false;
  setHandler(decidedSignal, () => {
    woken = true;
  });

  await condition(() => woken, input.windowMs);
  let settled = await settle(input);
  // Still pending only if the timer beat the deadline by a hair, or a signal
  // arrived before its decision committed. Look again shortly; bounded by the
  // deadline, after which `settle` always answers something final.
  while (settled === 'pending') {
    woken = false;
    await condition(() => woken, RECHECK_MS);
    settled = await settle(input);
  }
  return settled;
}
