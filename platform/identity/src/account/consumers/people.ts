import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as z from 'zod';
import { PersonIdentityFactsChanged, type EventEnvelope } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { account } from '../infrastructure/account-tables.js';

/**
 * People correcting identity's copies of a name and a start date (PRD §5).
 *
 * One direction. People publishes, identity consumes, and nothing here reads or
 * writes a People table; `direction.test.ts` holds that. A tenant without the
 * People module never publishes this event, so its accounts keep identity's own
 * values as the only truth, and nothing here asks whether People exists.
 *
 * **What a corrected start date does.** It is written to the cached column and
 * nothing else. An `invited` account is re-gated by it, because `Account.enrol`
 * reads that column: a start moved three weeks later cannot enrol for three
 * weeks. An `active` account keeps its enrolment. The gate is on enrolling, and
 * a person who has been signing in for a month does not become somebody who
 * has not started because HR corrected a typo.
 *
 * **Order and repeats.** One person's events share a partition and arrive in
 * commit order, and each carries whole values rather than a change. That
 * covers ordinary redelivery. It does not cover an old event published again
 * out of band, such as a dead-letter replay, so the update also records the
 * event's `occurredAt` in `people_facts_at` and only applies an event newer
 * than the one already applied. The same event delivered twice is therefore a
 * no-op the second time, which is what makes this idempotent on the event.
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

export type InTenant = <T>(
  tenantId: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>,
) => Promise<T>;

/** `account_name_lengths`. A value past it would fail the update on every retry. */
const NAME_LIMIT = 100;

/** `defineEvent` erases the envelope's type on the way out; this names it again. */
type Facts = EventEnvelope & { payload: z.infer<typeof PersonIdentityFactsChanged.payload> };

export function peopleConsumer(inTenant: InTenant): (raw: unknown) => Promise<Outcome> {
  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;
    if (name !== PersonIdentityFactsChanged.name) return 'ignored';

    const parsed = PersonIdentityFactsChanged.schema.safeParse(raw);
    if (!parsed.success) {
      // Paths, never values: this payload holds a legal name. Skipped rather
      // than thrown, because a malformed event is as malformed on redelivery
      // and throwing would stall the partition behind it.
      logger.warn(
        { eventName: name, paths: parsed.error.issues.map((i) => i.path.join('.')) },
        'event did not match its contract; skipped',
      );
      return 'rejected';
    }

    const event = parsed.data as Facts;
    const set = columnsFor(event);
    if (set === null) return 'unchanged';

    const touched = await inTenant(event.tenantId, (tx) =>
      tx
        .update(account)
        .set({ ...set, peopleFactsAt: event.occurredAt, updatedAt: sql`now()` })
        .where(
          and(
            eq(account.tenantId, event.tenantId),
            eq(account.id, event.payload.identityAccountId),
            or(isNull(account.peopleFactsAt), lt(account.peopleFactsAt, event.occurredAt)),
          ),
        )
        .returning({ id: account.id }),
    );
    // No row: the account was deleted, lives in a tenant this event does not
    // name, or has already taken an event at least this new.
    return touched.length > 0 ? 'applied' : 'unchanged';
  };
}

/** The columns an event corrects, or null when it corrects none. */
function columnsFor(event: Facts): Partial<typeof account.$inferInsert> | null {
  const set: Partial<typeof account.$inferInsert> = {};
  const { name, employmentStart } = event.payload;

  if (employmentStart !== null) set.employmentStart = employmentStart;

  if (name !== null) {
    const parts = [name.given, name.family, name.preferred ?? ''];
    if (parts.every((part) => part.length <= NAME_LIMIT)) {
      set.givenName = name.given;
      set.familyName = name.family;
      set.preferredName = name.preferred === '' ? null : name.preferred;
    } else {
      logger.warn(
        { eventId: event.eventId },
        'a name longer than identity stores; the cached name is left as it was',
      );
    }
  }

  return Object.keys(set).length > 0 ? set : null;
}
