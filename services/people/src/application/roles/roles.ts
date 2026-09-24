import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import { TenantId, type Actor } from '@kithena/contracts';

import {
  decideGrant,
  decideRevoke,
  TENANT_ROLES,
  type Holdings,
  type TenantRole,
} from '../../domain/access/roles.js';
import type { Viewer } from '../person/ports.js';

/**
 * Tenant roles through People's application layer (PEO-112; PRD §6.6).
 *
 * Every grant and revocation is a row in `people.role_grant` and a
 * `people.role.granted`/`revoked` event in the same transaction, under the
 * tenant's role lock; OpenFGA's tuples follow from the event
 * (`OpenFga.syncRoles`), never beside it. The rules are
 * `domain/access/roles.ts`'s, asked of the rows as they stand under the
 * lock — not of the caller's roles as OpenFGA answered them at the start of
 * the request, which may lag a change made a moment before.
 *
 * Idempotent: granting a role already held, or revoking one not held,
 * writes nothing and raises nothing.
 */

type Tx = PostgresJsDatabase;

export interface RoleHolder {
  readonly accountId: string;
  readonly roles: readonly TenantRole[];
}

/** Somebody who could hold a role: a person with an account who has not left. */
export interface RoleCandidate {
  readonly accountId: string;
  readonly personId: string;
  readonly name: string | null;
  readonly workEmail: string | null;
}

export interface RoleStore {
  /** Serialise every role change in the tenant until this transaction ends. */
  lock(tx: Tx, tenantId: string): Promise<void>;
  holdings(tx: Tx, tenantId: string): Promise<Holdings>;
  grant(
    tx: Tx,
    tenantId: string,
    accountId: string,
    role: TenantRole,
    by: string | null,
  ): Promise<void>;
  revoke(tx: Tx, tenantId: string, accountId: string, role: TenantRole): Promise<void>;
  candidates(tx: Tx, tenantId: string): Promise<readonly RoleCandidate[]>;
  publish(tx: Tx, events: readonly PendingEvent[]): Promise<void>;
}

type Asked<T = object> = {
  readonly tenantId: string;
  readonly viewer: Viewer;
  readonly correlationId: string;
} & T;

type Change = Asked<{
  readonly accountId: string;
  readonly role: TenantRole;
  readonly reason: string;
}>;

/** What the back office's naming of an administrator carries. */
export interface Named {
  readonly tenantId: string;
  readonly accountId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export interface TenantRoles {
  /** Everybody holding a role, and who could; `people_admin` or `hr` only. */
  list(
    tx: Tx,
    asking: Asked,
  ): Promise<
    Result<{
      readonly holders: readonly RoleHolder[];
      readonly candidates: readonly RoleCandidate[];
    }>
  >;
  /** One account's roles, as the rows hold them; for a write's answer. */
  of(tx: Tx, tenantId: string, accountId: string): Promise<RoleHolder>;
  grant(tx: Tx, change: Change): Promise<Result<RoleHolder>>;
  revoke(tx: Tx, change: Change): Promise<Result<RoleHolder>>;
  /**
   * `identity.tenant.administrator_named` for People: the account becomes
   * `people_admin` and `hr`, the two the first administrator has always
   * needed to set People up. Nobody's role is checked — the back office is
   * the authority here, and the event says so with `via: back_office`.
   */
  administratorNamed(tx: Tx, named: Named): Promise<'applied' | 'unchanged'>;
}

const NotAllowedToList = failure(
  'FORBIDDEN',
  'Only HR and People administrators see who holds a role',
);
const NoSuchAccount = failure('NOT_FOUND', 'Nobody at this company signs in with that account', [
  'accountId',
]);

const PROCESS = 'people.roles';

export function tenantRoles(deps: {
  readonly store: RoleStore;
  readonly clock: Clock;
  readonly newId: () => string;
}): TenantRoles {
  const { store } = deps;

  const holderOf = (held: Holdings, accountId: string): RoleHolder => ({
    accountId,
    roles: TENANT_ROLES.filter((r) => held.get(accountId)?.has(r) === true),
  });

  const event = (
    name: 'people.role.granted' | 'people.role.revoked',
    at: { tenantId: string; correlationId: string; causationId: string | null; actor: Actor },
    payload: {
      accountId: string;
      role: TenantRole;
      by: string | null;
      via: 'people' | 'back_office';
      reason: string;
    },
  ): PendingEvent => ({
    eventId: deps.newId(),
    eventName: name,
    eventVersion: 1,
    tenantId: TenantId.parse(at.tenantId),
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    // Per account, so one account's changes reach the consumer in order.
    aggregate: { type: 'TenantRole', id: payload.accountId, version: 1 },
    actor: at.actor,
    correlationId: at.correlationId,
    causationId: at.causationId,
    payload,
  });

  const change = async (
    tx: Tx,
    asked: Change,
    kind: 'grant' | 'revoke',
  ): Promise<Result<RoleHolder>> => {
    await store.lock(tx, asked.tenantId);
    const held = await store.holdings(tx, asked.tenantId);
    const decided = (kind === 'grant' ? decideGrant : decideRevoke)(held, {
      actor: asked.viewer.accountId,
      target: asked.accountId,
      role: asked.role,
      reason: asked.reason,
    });
    if (!decided.ok) return decided;
    if (decided.value === 'unchanged') return ok(holderOf(held, asked.accountId));

    if (kind === 'grant') {
      // Only somebody who signs in here: a role on an account People does
      // not know would be a role nobody could see or take back.
      const candidates = await store.candidates(tx, asked.tenantId);
      if (!candidates.some((c) => c.accountId === asked.accountId)) return err(NoSuchAccount);
      await store.grant(tx, asked.tenantId, asked.accountId, asked.role, asked.viewer.accountId);
    } else {
      await store.revoke(tx, asked.tenantId, asked.accountId, asked.role);
    }
    await store.publish(tx, [
      event(
        kind === 'grant' ? 'people.role.granted' : 'people.role.revoked',
        {
          tenantId: asked.tenantId,
          correlationId: asked.correlationId,
          causationId: null,
          actor: { kind: 'user', userId: asked.viewer.accountId },
        },
        {
          accountId: asked.accountId,
          role: asked.role,
          by: asked.viewer.accountId,
          via: 'people',
          reason: asked.reason.trim(),
        },
      ),
    ]);
    return ok(holderOf(await store.holdings(tx, asked.tenantId), asked.accountId));
  };

  return {
    async list(tx, asking) {
      const held = await store.holdings(tx, asking.tenantId);
      const mine = held.get(asking.viewer.accountId);
      if (mine?.has('people_admin') !== true && mine?.has('hr') !== true) {
        return err(NotAllowedToList);
      }
      return ok({
        holders: [...held.keys()].toSorted().map((account) => holderOf(held, account)),
        candidates: await store.candidates(tx, asking.tenantId),
      });
    },

    async of(tx, tenantId, accountId) {
      return holderOf(await store.holdings(tx, tenantId), accountId);
    },

    grant: (tx, asked) => change(tx, asked, 'grant'),
    revoke: (tx, asked) => change(tx, asked, 'revoke'),

    async administratorNamed(tx, named) {
      await store.lock(tx, named.tenantId);
      const held = await store.holdings(tx, named.tenantId);
      const events: PendingEvent[] = [];
      for (const role of ['people_admin', 'hr'] as const) {
        if (held.get(named.accountId)?.has(role) === true) continue;
        await store.grant(tx, named.tenantId, named.accountId, role, null);
        events.push(
          event(
            'people.role.granted',
            {
              tenantId: named.tenantId,
              correlationId: named.correlationId,
              causationId: named.causationId,
              actor: { kind: 'system', process: PROCESS },
            },
            {
              accountId: named.accountId,
              role,
              by: null,
              via: 'back_office',
              reason: 'Named the People administrator in the back office',
            },
          ),
        );
      }
      if (events.length === 0) return 'unchanged';
      await store.publish(tx, events);
      return 'applied';
    },
  };
}
