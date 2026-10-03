import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';

/**
 * The clock of one pending request (PRD §9.7, TOF-039): reminds at 09:00,
 * escalates after three working days, ends when somebody decides.
 *
 * Thin, because workflow code is replayed and must stay deterministic: it
 * asks `tick` what to do with its own notion of now — Temporal's time, which
 * the test server can skip — and sleeps for as long as the answer says, or
 * until `closed` wakes it. The request row is the truth; this is the alarm.
 *
 * Self-contained on purpose: Temporal bundles this file on its own.
 */

export interface EscalationInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface EscalationActivities {
  tick(input: EscalationInput & { readonly now: string }): Promise<{
    readonly open: boolean;
    readonly sleepMs: number;
  }>;
}

export const closedSignal = defineSignal('closed');

/** Wake-ups per run before the history is started afresh. */
const PER_RUN = 60;

export async function requestEscalation(input: EscalationInput): Promise<'closed'> {
  const { tick } = proxyActivities<EscalationActivities>({
    startToCloseTimeout: '1 minute',
    retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 10 },
  });

  let closed = false;
  setHandler(closedSignal, () => {
    closed = true;
  });

  for (let i = 0; i < PER_RUN; i++) {
    const step = await tick({ ...input, now: new Date().toISOString() });
    if (!step.open) return 'closed';
    if (await condition(() => closed, step.sleepMs)) return 'closed';
  }
  return continueAsNew<typeof requestEscalation>(input);
}
