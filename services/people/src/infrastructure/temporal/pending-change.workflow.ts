import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

/**
 * The wait on a change held for approval (PEO-077), modelled on the
 * full-values workflow and as thin, because workflow code is replayed and
 * must stay deterministic.
 *
 * It tells the approvers once (`announce`), then sleeps until the change is
 * closed — decided or withdrawn, which wakes it — or the week runs out, and
 * asks `settle` to do whatever the row now calls for: record the expiry, and
 * tell the requester how it ended. The decision itself, and the value it
 * applies, are the application's, in the request that made it; this holds
 * nothing and decides nothing. The row is the truth; this is the alarm clock.
 *
 * Self-contained on purpose: Temporal bundles this file on its own.
 */

export type Settled = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired';

export interface PendingChangeInput {
  readonly tenantId: string;
  readonly changeId: string;
  readonly correlationId: string;
  /** How long HR has, in milliseconds. */
  readonly windowMs: number;
}

export interface PendingChangeActivities {
  announce(input: PendingChangeInput): Promise<void>;
  settle(input: PendingChangeInput): Promise<Settled>;
}

export const closedSignal = defineSignal('closed');

/** A clock-skew margin: the timer may fire a moment before the row's deadline. */
const RECHECK_MS = 60_000;

export async function pendingChangeApproval(input: PendingChangeInput): Promise<Settled> {
  const { announce, settle } = proxyActivities<PendingChangeActivities>({
    startToCloseTimeout: '5 minutes',
    retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 10 },
  });

  let woken = false;
  setHandler(closedSignal, () => {
    woken = true;
  });

  await announce(input);
  await condition(() => woken, input.windowMs);
  let settled = await settle(input);
  // Still pending only if the timer beat the deadline by a hair, or a signal
  // arrived before its close committed. Bounded by the deadline, after which
  // `settle` always answers something final.
  while (settled === 'pending') {
    woken = false;
    await condition(() => woken, RECHECK_MS);
    settled = await settle(input);
  }
  return settled;
}
