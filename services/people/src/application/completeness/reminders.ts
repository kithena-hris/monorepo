import type { Clock } from '@kithena/domain-kit';

import { inReminderWindow, personZone } from '../../domain/org/calendar.js';
import type { InTenantTransaction } from '../../infrastructure/unit-of-work.js';
import type { Calendars } from '../org/org.js';
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
 *
 * **Working hours, on the person's own clock** (PRD §6.8): a reminder is
 * claimed only between 09:00 and 18:00 in the person's zone, so the hourly
 * sweep reaches each person in their own morning rather than Europe's.
 */

export interface ReminderMailer {
  send(tenantId: string, reminder: Reminder): Promise<void>;
}

export interface SweepDeps {
  readonly inTenant: InTenantTransaction;
  readonly store: CompletenessStore;
  readonly mailer: ReminderMailer;
  readonly clock: Clock;
  /** Whose clock "working hours" is read on (PRD §6.8). */
  readonly calendars: Calendars;
}

export function sweepReminders(deps: SweepDeps) {
  return async (tenantId: string): Promise<{ sent: number; failed: number }> => {
    const claimed = await deps.inTenant(tenantId, async ({ tx }) => {
      // Only people for whom it is working hours now, on their own clock.
      const now = deps.clock.now();
      const at = deps.clock.instant();
      const calendar = await deps.calendars.load(tx, tenantId);
      const open = (await deps.store.dueReminders(tx, tenantId, now))
        .filter((d) => inReminderWindow(at, personZone(calendar, d.placement, at)))
        .map((d) => d.personId);
      return open.length === 0 ? [] : deps.store.claimReminders(tx, tenantId, now, open);
    });

    const outcomes = await Promise.allSettled(claimed.map((r) => deps.mailer.send(tenantId, r)));
    const failed = outcomes.filter((o) => o.status === 'rejected').length;
    return { sent: claimed.length - failed, failed };
  };
}
