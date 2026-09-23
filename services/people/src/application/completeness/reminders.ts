import type { Clock } from '@kithena/domain-kit';

import type { InTenantTransaction } from '../../infrastructure/unit-of-work.js';
import type { CompletenessStore, Reminder } from './store.js';

/**
 * The reminder email, and the cap on it.
 *
 * **Day 1, then weekly, and never more than one reminder email per person per
 * week, regardless of how many fields are missing.** The product owner settled
 * PEO-084 for the cap over §8.4's old day 1 / 3 / 7 list: the first sweep after
 * the gap opens, then every 168 hours until the profile is complete. When a
 * person is due is `reminderDueBefore`'s question and nobody else's. The
 * banner and the task list are what carry the days in between.
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
  /** How many reminders one transaction claims, and one burst sends. */
  readonly batchSize?: number;
}

const BATCH = 100;

export function sweepReminders(deps: SweepDeps) {
  const limit = deps.batchSize ?? BATCH;
  return async (tenantId: string): Promise<{ sent: number; failed: number }> => {
    const now = deps.clock.now();
    let sent = 0;
    let failed = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- one bounded batch at a time is the point
      const claimed = await deps.inTenant(tenantId, ({ tx }) =>
        deps.store.claimReminders(tx, tenantId, now, limit),
      );
      // eslint-disable-next-line no-await-in-loop -- send this batch before claiming the next
      const outcomes = await Promise.allSettled(
        claimed.map((r) => deps.mailer.send(tenantId, r)),
      );
      const lost = outcomes.filter((o) => o.status === 'rejected').length;
      failed += lost;
      sent += claimed.length - lost;
      if (claimed.length < limit) return { sent, failed };
    }
  };
}
