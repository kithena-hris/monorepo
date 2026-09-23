import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as z from 'zod';
import {
  PersonAccessEnded,
  PersonAccessRestored,
  PersonIdentityFactsChanged,
  type EventEnvelope,
} from '@kithena/contracts';
import { systemClock, type Clock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { Account, type AccountStatus, type EventContext } from '../domain/account.js';
import { account } from '../infrastructure/account-tables.js';
import { drizzleAccountRepository } from '../infrastructure/drizzle-account-repository.js';
import { uuidv7 } from '../../shared/uuid.js';

/**
 * People correcting identity's copies of a name and a start date, and ending
 * a leaver's access (PRD §5).
 *
 * One direction. People publishes, identity consumes, and nothing here reads or
 * writes a People table; `direction.test.ts` holds that. A tenant without the
 * People module never publishes these events, so its accounts keep identity's
 * own values and behaviour as the only truth, and nothing here asks whether
 * People exists.
 *
 * **What a corrected start date does.** It is written to the cached column and
 * nothing else. An `invited` account is re-gated by it, because `Account.enrol`
 * reads that column: a start moved three weeks later cannot enrol for three
 * weeks. An `active` account keeps its enrolment. The gate is on enrolling, and
 * a person who has been signing in for a month does not become somebody who
 * has not started because HR corrected a typo.
 *
 * **What an ended employment does (PEO-109).** People decides when — the end
 * of the last working day on the leaver's own calendar, or at once for a
 * dismissal for cause — and identity suspends: no sign-in, every session
 * revoked, every live enrolment link spent. Suspended rather than terminated,
 * and the passkeys are left alone, so a rehire signs in with the one they
 * have. The status it was suspended from is kept (`access_ended_from`), and an
 * account identity had already suspended or terminated keeps its own reason.
 * A rehire's start (`access_restored`, PEO-110) puts it back to that status
 * and lifts nothing identity suspended for its own reasons.
 *
 * **Order and repeats.** One person's events share a partition and arrive in
 * commit order, and each carries whole values rather than a change. That
 * covers ordinary redelivery. It does not cover an old event published again
 * out of band, such as a dead-letter replay, so each update also records the
 * event's `occurredAt` — `people_facts_at` for the cached facts,
 * `people_access_at` for access — and only applies an event newer than the one
 * already applied. The same event delivered twice is therefore a no-op the
 * second time, which is what makes this idempotent on the event.
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

export type InTenant = <T>(
  tenantId: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>,
) => Promise<T>;

export interface ConsumerOptions {
  readonly clock?: Clock;
  readonly newEventId?: () => string;
}

/** `account_name_lengths`. A value past it would fail the update on every retry. */
const NAME_LIMIT = 100;

/** `defineEvent` erases the envelope's type on the way out; this names it again. */
type Facts = EventEnvelope & { payload: z.infer<typeof PersonIdentityFactsChanged.payload> };
type AccessEnded = EventEnvelope & { payload: z.infer<typeof PersonAccessEnded.payload> };
type AccessRestored = EventEnvelope & { payload: z.infer<typeof PersonAccessRestored.payload> };

export function peopleConsumer(
  inTenant: InTenant,
  options: ConsumerOptions = {},
): (raw: unknown) => Promise<Outcome> {
  const accounts = drizzleAccountRepository();
  const clock = options.clock ?? systemClock;
  const newEventId = options.newEventId ?? (() => uuidv7());

  async function correctFacts(event: Facts): Promise<Outcome> {
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
  }

  async function endAccess(event: AccessEnded): Promise<Outcome> {
    const accountId = event.payload.identityAccountId;
    // A leaver with no account: nothing here to end.
    if (accountId === null) return 'ignored';

    return inTenant(event.tenantId, async (tx) => {
      // Claimed first, in the transaction that acts on it, so a replay or a
      // second consumer finds the event already applied.
      const claimed = await tx
        .update(account)
        .set({ peopleAccessAt: event.occurredAt, updatedAt: sql`now()` })
        .where(
          and(
            eq(account.tenantId, event.tenantId),
            eq(account.id, accountId),
            or(isNull(account.peopleAccessAt), lt(account.peopleAccessAt, event.occurredAt)),
          ),
        )
        .returning({ status: account.status });
      const before = claimed[0]?.status as AccountStatus | undefined;
      if (before === undefined) return 'unchanged';

      // Every live link spent, whatever the status: a leaver who never enrolled
      // must not be able to enrol on the way out.
      await tx.execute(sql`
        UPDATE platform.enrolment_token
           SET consumed_at = now()
         WHERE account_id = ${accountId}::uuid
           AND consumed_at IS NULL
      `);

      // Already suspended (an investigation) or terminated: closed, and it
      // keeps identity's own reason, which a rehire must not lift.
      if (before === 'suspended' || before === 'terminated') return 'applied';

      const snapshot = await accounts.load(tx, accountId);
      if (!snapshot) return 'unchanged';
      const aggregate = Account.rehydrate(snapshot);
      const ctx: EventContext = {
        clock,
        newEventId,
        actor: { kind: 'system', process: 'identity-people-consumer' },
        correlationId: event.correlationId,
        causationId: event.eventId,
      };
      if (!aggregate.suspend('employment_ended', ctx).ok) return 'unchanged';
      // Sessions deleted and events drained in this transaction. There is no
      // session cache in front of `platform.session` (see composition), so a
      // deleted row is a refused cookie on the next request.
      await accounts.save(tx, aggregate);
      await tx
        .update(account)
        .set({ accessEndedFrom: before })
        .where(and(eq(account.tenantId, event.tenantId), eq(account.id, accountId)));
      return 'applied';
    });
  }

  /**
   * A rehire's new employment started (PEO-110): lift the suspension People's
   * end of employment put on, back to the status it was taken from. An
   * account identity suspended for its own reason is left for an admin.
   */
  async function restoreAccess(event: AccessRestored): Promise<Outcome> {
    const accountId = event.payload.identityAccountId;
    if (accountId === null) return 'ignored';

    return inTenant(event.tenantId, async (tx) => {
      const claimed = await tx
        .update(account)
        .set({ peopleAccessAt: event.occurredAt, updatedAt: sql`now()` })
        .where(
          and(
            eq(account.tenantId, event.tenantId),
            eq(account.id, accountId),
            or(isNull(account.peopleAccessAt), lt(account.peopleAccessAt, event.occurredAt)),
          ),
        )
        .returning({ status: account.status, from: account.accessEndedFrom });
      const row = claimed[0];
      if (row === undefined) return 'unchanged';
      if (row.status !== 'suspended' || row.from === null) return 'applied';

      const snapshot = await accounts.load(tx, accountId);
      if (!snapshot) return 'unchanged';
      const aggregate = Account.rehydrate(snapshot);
      const ctx: EventContext = {
        clock,
        newEventId,
        actor: { kind: 'system', process: 'identity-people-consumer' },
        correlationId: event.correlationId,
        causationId: event.eventId,
      };
      const to = row.from as 'provisioned' | 'invited' | 'active';
      if (!aggregate.reinstate(ctx, to).ok) return 'unchanged';
      await accounts.save(tx, aggregate);
      await tx
        .update(account)
        .set({ accessEndedFrom: null })
        .where(and(eq(account.tenantId, event.tenantId), eq(account.id, accountId)));
      return 'applied';
    });
  }

  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;
    const contract =
      name === PersonIdentityFactsChanged.name
        ? PersonIdentityFactsChanged
        : name === PersonAccessEnded.name
          ? PersonAccessEnded
          : name === PersonAccessRestored.name
            ? PersonAccessRestored
            : null;
    if (contract === null) return 'ignored';

    const parsed = contract.schema.safeParse(raw);
    if (!parsed.success) {
      // Paths, never values: a payload may hold a legal name. Skipped rather
      // than thrown, because a malformed event is as malformed on redelivery
      // and throwing would stall the partition behind it.
      logger.warn(
        { eventName: name, paths: parsed.error.issues.map((i) => i.path.join('.')) },
        'event did not match its contract; skipped',
      );
      return 'rejected';
    }

    if (contract === PersonAccessEnded) return endAccess(parsed.data as AccessEnded);
    if (contract === PersonAccessRestored) return restoreAccess(parsed.data as AccessRestored);
    return correctFacts(parsed.data as Facts);
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
