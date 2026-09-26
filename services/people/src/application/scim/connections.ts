import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import { TenantId, type AttributeDefinition } from '@kithena/contracts';

import { isMappablePath, extensionKeyOf, type MappingEntry } from '../../domain/scim/resource.js';
import type { Asking } from '../person/person-access.js';
import type { RelationsResolver } from '../person/ports.js';
import { run, type PeopleService } from '../person/service.js';
import { LIFECYCLE_KEYS } from '../person/core.js';
import type { ScimConnection, ScimStore } from './ports.js';
import { hashToken, issueToken } from './token.js';

/**
 * A People administrator connecting an upstream system (PEO-072, PEO-073;
 * PRD §13.5, §13.6): its token, and the approved mapping that is also the
 * declaration of which attributes it is the source of record for.
 *
 * `people_admin`'s, as webhook endpoints are. Every change is a
 * `people.scim.connection_changed` event in the same transaction, with the
 * administrator as the actor: the audit record. The token is returned once
 * and stored only as its hash.
 *
 * The mapping is never drafted automatically (§12.4): a person approves it,
 * because it is applied to every record thereafter.
 */

type Tx = PostgresJsDatabase;
const NOBODY = '00000000-0000-0000-0000-000000000000';
/** How long a rotated-away token still authenticates. */
export const TOKEN_OVERLAP_MS = 24 * 3_600_000;

export interface ConnectionDeps {
  readonly service: PeopleService;
  readonly relations: RelationsResolver;
  readonly store: ScimStore;
  readonly clock: Clock;
  readonly newId: () => string;
}

export interface ConnectionView {
  readonly id: string;
  readonly system: string;
  readonly createdAt: string;
  readonly tokenRotatedAt: string | null;
  readonly revokedAt: string | null;
  readonly linked: number;
  readonly mapping: readonly MappingEntry[];
}

/** Why an attribute cannot be owned by an upstream system; null when it can. */
export function unmappable(definition: AttributeDefinition | undefined): string | null {
  if (definition === undefined) return 'is not in the published schema';
  if (definition.deprecatedAt !== null) return 'is no longer collected';
  if (definition.encrypted) return 'is sealed, and never leaves People through SCIM';
  if (definition.classification.classification === 'special-category') {
    return 'is special-category data, and never leaves People through SCIM';
  }
  // The lifecycle's dates, the reporting line and where somebody works are
  // HR's moves (§8.1, §6.8): they decide employment periods, calendars and
  // who may see whom, so no upstream system writes them.
  if (LIFECYCLE_KEYS.has(definition.key)) return 'changes through the lifecycle';
  if (definition.dataType === 'person_ref') return 'names a person, which HR sets';
  if (definition.key === 'legal_entity_id' || definition.key === 'location_id') {
    return 'is a placement, which HR makes';
  }
  return null;
}

const admin = async (deps: ConnectionDeps, tx: Tx, asking: Asking): Promise<Result<void>> => {
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  return everyone.isAdmin
    ? ok(undefined)
    : err(failure('FORBIDDEN', 'Only a People administrator manages provisioning'));
};

export interface ScimConnections {
  list(asking: Asking): Promise<Result<readonly ConnectionView[]>>;
  create(asking: Asking, input: { readonly system: string }): Promise<Result<IssuedToken>>;
  rotate(asking: Asking, id: string): Promise<Result<IssuedToken>>;
  revoke(asking: Asking, id: string): Promise<Result<{ ok: true }>>;
  setMapping(
    asking: Asking,
    id: string,
    entries: readonly MappingEntry[],
  ): Promise<Result<{ ok: true }>>;
}

/** A connection's token, returned once when it is issued. */
export interface IssuedToken {
  readonly id: string;
  readonly token: string;
}

export function scimConnections(deps: ConnectionDeps): ScimConnections {
  const { store } = deps;

  const changed = (
    asking: Asking,
    connection: { id: string; system: string },
    change: 'created' | 'token_rotated' | 'revoked' | 'mapping_set',
    ownedKeys: readonly string[],
  ): PendingEvent => ({
    eventId: deps.newId(),
    eventName: 'people.scim.connection_changed',
    eventVersion: 1,
    tenantId: TenantId.parse(asking.tenantId),
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'ScimConnection', id: connection.id, version: 1 },
    actor: { kind: 'user', userId: asking.viewer.accountId },
    correlationId: asking.correlationId,
    causationId: null,
    payload: { connectionId: connection.id, change, system: connection.system, ownedKeys },
  });

  /** A live connection of this tenant, or why not. */
  const live = async (tx: Tx, tenantId: string, id: string): Promise<Result<ScimConnection>> => {
    const found = await store.connection(tx, tenantId, id);
    if (found === null) return err(failure('NOT_FOUND', 'No such connection'));
    if (found.revokedAt !== null) {
      return err(failure('SCIM_CONNECTION_REVOKED', `${found.system} was disconnected`));
    }
    return ok(found);
  };

  const as = <T>(asking: Asking, fn: (tx: Tx) => Promise<Result<T>>) =>
    run(deps.service, asking.tenantId, async (tx) => {
      const allowed = await admin(deps, tx, asking);
      return allowed.ok ? fn(tx) : allowed;
    });

  return {
    /** Every connection with its mapping, for the integrations screen. */
    list: (asking: Asking): Promise<Result<readonly ConnectionView[]>> =>
      as(asking, async (tx) => {
        const [connections, mappings] = await Promise.all([
          store.connections(tx, asking.tenantId),
          store.mappings(tx, asking.tenantId),
        ]);
        return ok(
          connections.map((c) => ({
            id: c.id,
            system: c.system,
            createdAt: c.createdAt,
            tokenRotatedAt: c.tokenRotatedAt,
            revokedAt: c.revokedAt,
            linked: c.linked,
            mapping: mappings
              .filter((m) => m.connectionId === c.id)
              .map(({ path, key }) => ({ path, key })),
          })),
        );
      }),

    create: (asking: Asking, input: { readonly system: string }) =>
      as(asking, async (tx): Promise<Result<{ id: string; token: string }>> => {
        const system = input.system.trim();
        if (system === '' || system.length > 80) {
          return err(failure('VALUE_INVALID', 'Name the system in 1 to 80 characters', ['system']));
        }
        const id = deps.newId();
        const token = issueToken(asking.tenantId, id);
        await store.createConnection(tx, asking.tenantId, {
          id,
          system,
          tokenHash: hashToken(token),
          createdAt: deps.clock.instant(),
          createdBy: asking.viewer.accountId,
        });
        await store.publish(tx, [changed(asking, { id, system }, 'created', [])]);
        return ok({ id, token });
      }),

    /** A new token; the old one authenticates for 24 hours more, for the provider to be updated. */
    rotate: (asking: Asking, id: string) =>
      as(asking, async (tx): Promise<Result<{ id: string; token: string }>> => {
        const found = await live(tx, asking.tenantId, id);
        if (!found.ok) return found;
        const token = issueToken(asking.tenantId, id);
        const now = deps.clock.instant();
        await store.rotate(tx, asking.tenantId, id, {
          hash: hashToken(token),
          previousHash: found.value.tokenHash,
          previousValidUntil: new Date(Date.parse(now) + TOKEN_OVERLAP_MS).toISOString(),
          rotatedAt: now,
        });
        const owned = (await store.mappings(tx, asking.tenantId))
          .filter((m) => m.connectionId === id)
          .map((m) => m.key);
        await store.publish(tx, [changed(asking, found.value, 'token_rotated', owned)]);
        return ok({ id, token });
      }),

    /**
     * Disconnected at once: its tokens authenticate nobody, and it owns no
     * attribute any more, so Kithena's own writers may change them again.
     * The people it provisioned stay, with the ids it knew them by.
     */
    revoke: (asking: Asking, id: string) =>
      as(asking, async (tx): Promise<Result<{ ok: true }>> => {
        const found = await store.connection(tx, asking.tenantId, id);
        if (found === null) return err(failure('NOT_FOUND', 'No such connection'));
        if (found.revokedAt !== null) return ok({ ok: true as const });
        await store.lockMappings(tx, asking.tenantId);
        await store.revoke(tx, asking.tenantId, id, deps.clock.instant());
        await store.publish(tx, [changed(asking, found, 'revoked', [])]);
        return ok({ ok: true as const });
      }),

    /**
     * The approved mapping, whole: every attribute it names becomes this
     * system's to write on the records it provisions, and nobody else's.
     * An attribute another connection owns is refused, naming it.
     */
    setMapping: (asking: Asking, id: string, entries: readonly MappingEntry[]) =>
      as(asking, async (tx): Promise<Result<{ ok: true }>> => {
        const found = await live(tx, asking.tenantId, id);
        if (!found.ok) return found;
        const version = await deps.service.schemas.current(tx, asking.tenantId);
        if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
        const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));

        const paths = new Set<string>();
        const keys = new Set<string>();
        for (const { path, key } of entries) {
          if (!isMappablePath(path)) {
            return err(
              failure('VALUE_INVALID', `${path} is not a SCIM attribute People maps`, ['mapping']),
            );
          }
          const extension = extensionKeyOf(path);
          if (extension !== null && extension !== key) {
            return err(
              failure('VALUE_INVALID', `${path} maps to the attribute it names, ${extension}`, [
                'mapping',
              ]),
            );
          }
          const why = unmappable(byKey.get(key));
          if (why !== null) return err(failure('VALUE_INVALID', `${key} ${why}`, ['mapping']));
          if (paths.has(path) || keys.has(key)) {
            return err(
              failure('VALUE_INVALID', `${paths.has(path) ? path : key} is mapped twice`, [
                'mapping',
              ]),
            );
          }
          paths.add(path);
          keys.add(key);
        }

        await store.lockMappings(tx, asking.tenantId);
        const all = await store.mappings(tx, asking.tenantId);
        const others = await store.connections(tx, asking.tenantId);
        for (const m of all) {
          if (m.connectionId === id || !keys.has(m.key)) continue;
          const owner = others.find((c) => c.id === m.connectionId)?.system ?? 'another system';
          return err(
            failure('SOURCE_OF_RECORD_EXTERNAL', `${m.key} is already kept in ${owner}`, [
              'mapping',
            ]),
          );
        }
        await store.setMapping(tx, asking.tenantId, id, entries);
        await store.publish(tx, [changed(asking, found.value, 'mapping_set', [...keys])]);
        return ok({ ok: true as const });
      }),
  };
}
