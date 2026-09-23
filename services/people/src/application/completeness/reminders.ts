import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Clock } from '@kithena/domain-kit';

import { inReminderWindow, personZone } from '../../domain/org/calendar.js';
import type { InTenantTransaction } from '../../infrastructure/unit-of-work.js';
import type { Calendars } from '../org/org.js';
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
 *
 * **Working hours, on the person's own clock** (PRD §6.8): a reminder is
 * claimed only between 09:00 and 18:00 in the person's zone, so the hourly
 * sweep reaches each person in their own morning rather than Europe's.
 *
 * **From the company, to the company's own origin.** The email names the
 * company and links to `<slug>.app…/people`, both from People's copy of the
 * tenant (PEO-099). A tenant People has not heard that from yet is skipped
 * whole and retried next sweep.
 */

/**
 * The company a reminder is from, resolved for sending: its name, and the
 * origin its people sign in on (`<slug>.app…`). Null until People has heard
 * both from the back office, or when the slug cannot be a host label — and
 * then nothing is claimed, so the sweep after the company is known sends it.
 * A link to some other origin is never the fallback.
 */
export interface ReminderCompany {
  readonly name: string;
  readonly origin: string;
}

export interface ReminderMailer {
  send(tenantId: string, company: ReminderCompany, reminder: Reminder): Promise<void>;
}

export interface SweepDeps {
  readonly inTenant: InTenantTransaction;
  readonly store: CompletenessStore;
  readonly mailer: ReminderMailer;
  readonly clock: Clock;
  /** Whose clock "working hours" is read on (PRD §6.8). */
  readonly calendars: Calendars;
  readonly company: (tx: PostgresJsDatabase, tenantId: string) => Promise<ReminderCompany | null>;
  /** How many due people one transaction reads, and one burst sends to. */
  readonly batchSize?: number;
}

export interface SweepOutcome {
  readonly sent: number;
  readonly failed: number;
  /** True when the tenant's company is not known yet, so nothing was claimed. */
  readonly waiting: boolean;
}

const BATCH = 100;

export function sweepReminders(deps: SweepDeps) {
  const limit = deps.batchSize ?? BATCH;
  return async (tenantId: string): Promise<SweepOutcome> => {
    const now = deps.clock.now();
    const at = deps.clock.instant();
    let sent = 0;
    let failed = 0;
    let after: string | null = null;

    for (;;) {
      const cursor: string | null = after;
      // One bounded page per transaction: read, keep the ones in working
      // hours on their own clock, claim those.
      const page = await deps.inTenant(tenantId, async ({ tx }) => {
        const company = await deps.company(tx, tenantId);
        if (company === null) return null;
        const calendar = await deps.calendars.load(tx, tenantId);
        const due = await deps.store.dueReminders(tx, tenantId, now, { after: cursor, limit });
        const open = due
          .filter((d) => inReminderWindow(at, personZone(calendar, d.placement, at)))
          .map((d) => d.personId);
        const claimed =
          open.length === 0 ? [] : await deps.store.claimReminders(tx, tenantId, now, open);
        return { company, claimed, last: due.at(-1)?.personId ?? null, full: due.length === limit };
      });
      if (page === null) return { sent, failed, waiting: true };

      // Sent after the page commits, before the next is read.
      const outcomes = await Promise.allSettled(
        page.claimed.map((r) => deps.mailer.send(tenantId, page.company, r)),
      );
      const lost = outcomes.filter((o) => o.status === 'rejected').length;
      failed += lost;
      sent += page.claimed.length - lost;
      if (!page.full || page.last === null) return { sent, failed, waiting: false };
      after = page.last;
    }
  };
}
