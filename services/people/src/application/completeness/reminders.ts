import type { Clock } from '@kithena/domain-kit';

import type { InTenantTransaction } from '../../infrastructure/unit-of-work.js';
import type { CompletenessStore, Reminder } from './store.js';

/**
 * The reminder email, and the cap on it.
 *
 * **Never more than one reminder email per person per week, regardless of how
 * many fields are missing.** §8.4 lists a decaying schedule — day 1, day 3,
 * day 7, then weekly — and the cap is the rule that wins where the two
 * disagree: day 1 and day 3 are two emails in one week, so under the cap the
 * schedule collapses to the first sweep after the gap opens and every 168
 * hours after that. The banner and the task list are what carry day 3.
 *
 * Claimed, committed, then sent. The claim is a conditional UPDATE, so two
 * sweeps racing cannot both send; and the send happens after the commit, so a
 * rolled-back claim never becomes an email. The cost is the other direction —
 * a messaging outage after the commit loses that week's reminder rather than
 * sending it twice. At most once is the property the product rule asks for.
 */

export interface ReminderMailer {
  send(tenantId: string, reminder: Reminder): Promise<void>;
}

export interface SweepDeps {
  readonly inTenant: InTenantTransaction;
  readonly store: CompletenessStore;
  readonly mailer: ReminderMailer;
  readonly clock: Clock;
}

export function sweepReminders(deps: SweepDeps) {
  return async (tenantId: string): Promise<{ sent: number; failed: number }> => {
    const claimed = await deps.inTenant(tenantId, ({ tx }) =>
      deps.store.claimReminders(tx, tenantId, deps.clock.now()),
    );

    const outcomes = await Promise.allSettled(claimed.map((r) => deps.mailer.send(tenantId, r)));
    const failed = outcomes.filter((o) => o.status === 'rejected').length;
    return { sent: claimed.length - failed, failed };
  };
}
