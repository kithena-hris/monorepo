import { and, eq, isNull, sql } from 'drizzle-orm';
import { publish } from '@kithena/db-kit';
import { AccountsPage, type Actor } from '@kithena/contracts';
import type { Clock, PendingEvent } from '@kithena/domain-kit';

import type {
  AccountDirectory,
  IdentityAccount,
  ProvisionalPeople,
} from '../../application/reconcile.js';
import { outbox, person } from '../tables.js';

/**
 * Identity's side of §8.2, steps 3 and 5.
 *
 * A provisional person holds what the account knew and nothing else: the
 * account, the work email, the time zone and the start date. No requiredness
 * is evaluated — `completeness` stays `not_applicable` — and so no task and no
 * reminder, because nobody has been asked for anything yet.
 *
 * Where the four facts live: the account and the email have columns; the start
 * date is `hire_date`, the planned first day, which `Person.hire` overwrites
 * with the confirmed one; the time zone is `custom.time_zone`, the key §6
 * gives the core attribute.
 */

export interface ProvisionerDeps {
  readonly clock: Clock;
  readonly newEventId: () => string;
}

export function drizzleProvisionalPeople(deps: ProvisionerDeps): ProvisionalPeople {
  return {
    async provision(tx, tenantId, account, ctx) {
      /*
       * Idempotent because of `person_identity_account_key`, not because of a
       * lookup first. Two deliveries of one event racing each other both reach
       * the insert; the index lets one through and the other gets no row back,
       * and no row back means no event.
       */
      const rows = await tx
        .insert(person)
        .values({
          tenantId,
          identityAccountId: account.accountId,
          status: 'provisional',
          workEmail: account.workEmail,
          hireDate: account.employmentStart,
          givenName: account.name?.given ?? null,
          familyName: account.name?.family ?? null,
          preferredName: account.name?.preferred ?? null,
          custom: { time_zone: account.timeZone },
        })
        .onConflictDoNothing({
          target: [person.tenantId, person.identityAccountId],
          where: sql`identity_account_id IS NOT NULL`,
        })
        .returning({ id: person.id });

      const created = rows[0];
      if (!created) return false;

      await publish(tx, outbox, [provisioned(created.id, tenantId, account, ctx, deps)]);
      return true;
    },
  };
}

function provisioned(
  personId: string,
  tenantId: string,
  account: IdentityAccount,
  ctx: { actor: Actor; correlationId: string; causationId: string | null },
  deps: ProvisionerDeps,
): PendingEvent {
  return {
    eventId: deps.newEventId(),
    eventName: 'people.person.provisioned',
    eventVersion: 1,
    tenantId: tenantId as PendingEvent['tenantId'],
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'Person', id: personId, version: 1 },
    actor: ctx.actor,
    correlationId: ctx.correlationId,
    causationId: ctx.causationId,
    payload: {
      personId,
      identityAccountId: account.accountId,
      workEmail: account.workEmail,
      timeZone: account.timeZone,
      employmentStart: account.employmentStart,
    },
  };
}

/**
 * Step 5: the name typed at enrolment, onto the record.
 *
 * Filled, never overwritten. Once a person exists People is the source of
 * record for the name (§5), so a name HR already typed wins over the one
 * identity captured. The time zone is the other way round — identity owns it
 * and People projects it — so it is always taken.
 *
 * No event. `profile_updated` names a schema version and a provisional record
 * has none, and the name is already on identity's stream for anyone who needs
 * it. Returns whether a record was found, so a caller can tell an event that
 * arrived before its account's (and will be covered by reconciliation) from one
 * that did something.
 */
export async function captureProfile(
  tx: Parameters<ProvisionalPeople['provision']>[0],
  tenantId: string,
  accountId: string,
  profile: { name: { given: string; family: string; preferred: string | null }; timeZone: string },
): Promise<boolean> {
  const scoped = and(eq(person.tenantId, tenantId), eq(person.identityAccountId, accountId));

  const touched = await tx
    .update(person)
    .set({
      custom: sql`${person.custom} || jsonb_build_object('time_zone', ${profile.timeZone}::text)`,
      updatedAt: sql`now()`,
    })
    .where(scoped)
    .returning({ id: person.id });

  await tx
    .update(person)
    .set({
      givenName: profile.name.given,
      familyName: profile.name.family,
      preferredName: profile.name.preferred,
    })
    .where(and(scoped, isNull(person.givenName), isNull(person.familyName)));

  return touched.length > 0;
}

/* ------------------------------------------------------------ directory -- */

export interface HttpDirectoryConfig {
  /** Identity's base URL. */
  readonly baseUrl: string;
  /** The same shared secret identity presents to messaging. */
  readonly internalToken: string;
  readonly timeoutMs?: number;
}

/**
 * Identity's accounts, over the wire: `GET /api/internal/tenants/<id>/accounts`,
 * in the shape `AccountsPage` in `@kithena/contracts` fixes for both ends.
 *
 * Throws on anything but a well-formed page. `reconcile` turns that into a
 * failure, and because a run is idempotent the remedy for a half-finished one
 * is to run it again.
 */
export function httpAccountDirectory(config: HttpDirectoryConfig): AccountDirectory {
  return {
    async *accounts(tenantId) {
      let cursor: string | null = null;
      do {
        const url = new URL(`/api/internal/tenants/${tenantId}/accounts`, config.baseUrl);
        if (cursor !== null) url.searchParams.set('cursor', cursor);

        const response = await fetch(url, {
          headers: { 'x-internal-token': config.internalToken },
          signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        });
        if (!response.ok) throw new Error(`identity answered ${String(response.status)}`);

        const page = AccountsPage.parse(await response.json());
        yield* page.accounts;
        cursor = page.nextCursor;
      } while (cursor !== null);
    },
  };
}
