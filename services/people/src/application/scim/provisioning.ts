import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import type { ExternalSource } from '../../domain/access/field-access.js';
import { matches, parseFilter, type Filter } from '../../domain/scim/filter.js';
import { applyPatch, parsePatch } from '../../domain/scim/patch.js';
import { getCI, isObject, splitSchema, type Json } from '../../domain/scim/paths.js';
import {
  CORE_GROUP,
  KITHENA_USER,
  changesFor,
  extensionKeyOf,
  userResource,
  valuesOf,
  type MappingEntry,
} from '../../domain/scim/resource.js';
import { asIntegration, type Asking, type PersonView } from '../person/person-access.js';
import { run, type PeopleService } from '../person/service.js';
import type { ScimGroup, ScimLink, ScimStore } from './ports.js';
import { tokenClaims, tokenMatches } from './token.js';

/**
 * SCIM 2.0 `/Users` and `/Groups` (PEO-072; PRD §13.5, RFC 7643 and 7644),
 * for a connection whose bearer token checked out.
 *
 * **One write path.** A User's values reach a record only through the
 * approved mapping and only through `PersonAccess` — `create` and
 * `syncExternal` — as an integration, so the identifier checks, uniqueness,
 * validation, history and events are the ones every other writer gets, and
 * the connection can write nothing it does not own (PEO-073). Writes are
 * effective now. A value the provider sends that it already holds is not a
 * change: Okta pushes a whole profile on every update, and history records
 * what changed, not what was said again.
 *
 * **What it reads back is what it owns.** A User is the link (`id`,
 * `userName`, `externalId`, `active`) and the mapped attributes, read
 * through `PersonAccess.read` as the integration, which sees only those and
 * never a sealed or special-category value.
 *
 * **`active: false` and DELETE end nothing.** Whether somebody's employment
 * ends is HR's decision (§8.1). Deactivation is recorded on the link and
 * raises `synced_from_external` naming `active`; DELETE unlinks the person,
 * so the system stops mirroring them and their attributes are Kithena's
 * again. Neither terminates, anonymises or deletes a record.
 *
 * **Groups carry no authorization.** They are kept and answered so a
 * provider pushing groups works, and nothing in People reads them.
 */

type Tx = PostgresJsDatabase;

export const LIST_RESPONSE = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const MAX_COUNT = 200;
const LINK_FIELDS = new Set(['id', 'username', 'externalid', 'active', 'meta']);

export interface ScimDeps {
  readonly service: PeopleService;
  readonly store: ScimStore;
  readonly clock: Clock;
  readonly newId: () => string;
  /** Where SCIM is served publicly, for `meta.location`: `https://api…/scim/v2`. */
  readonly baseUrl: string;
  /** The modules the company bought, as People keeps them; null when none is recorded. */
  readonly entitlements: (tenantId: string) => Promise<readonly string[] | null>;
  /** The deployment's list, for a company with nothing recorded (PRD §13.1, PEO-114). */
  readonly fallbackEntitlements: readonly string[];
}

export interface ScimCaller {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly system: string;
  readonly correlationId: string;
}

export interface ListQuery {
  readonly filter?: string | undefined;
  readonly startIndex?: number | undefined;
  readonly count?: number | undefined;
}

const Unauthenticated = () => err(failure('UNAUTHENTICATED', 'A valid bearer token is required'));
const Invalid = (message: string, path?: string) =>
  err(failure('SCIM_INVALID_VALUE', message, path === undefined ? undefined : [path]));
const Taken = (what: string) =>
  err(failure('SCIM_UNIQUENESS', `Another resource already has this ${what}`, [what]));
const Missing = () => err(failure('NOT_FOUND', 'No such resource'));

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
/** Entra sends booleans as "True" and "False". */
const flag = (v: unknown): boolean | undefined =>
  v === undefined || v === null ? undefined : v === true || String(v).toLowerCase() === 'true';
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Every path a filter reads. */
function pathsOf(filter: Filter): string[] {
  switch (filter.kind) {
    case 'and':
    case 'or':
      return [...pathsOf(filter.left), ...pathsOf(filter.right)];
    case 'not':
      return pathsOf(filter.filter);
    default:
      return [filter.path];
  }
}

/** A page of a list, as §3.4.2.4 numbers it: from 1, at most 200. */
function page<T>(items: readonly T[], query: ListQuery) {
  const startIndex = Math.max(1, Math.trunc(query.startIndex ?? 1));
  const count = Math.min(MAX_COUNT, Math.max(0, Math.trunc(query.count ?? 100)));
  return { startIndex, items: items.slice(startIndex - 1, startIndex - 1 + count) };
}

const listResponse = (total: number, startIndex: number, resources: readonly Json[]): Json => ({
  schemas: [LIST_RESPONSE],
  totalResults: total,
  startIndex,
  itemsPerPage: resources.length,
  Resources: resources,
});

export function scimProvisioning(deps: ScimDeps) {
  const { store, service } = deps;
  const now = () => deps.clock.instant();

  /** The connection's mapping, and the asking it writes and reads with. */
  async function writerFor(tx: Tx, caller: ScimCaller) {
    const mapping: MappingEntry[] = (await store.mappings(tx, caller.tenantId))
      .filter((m) => m.connectionId === caller.connectionId)
      .map(({ path, key }) => ({ path, key }));
    const source: ExternalSource = { connectionId: caller.connectionId, system: caller.system };
    const asking = asIntegration(caller, {
      connectionId: caller.connectionId,
      system: caller.system,
      owned: new Map(mapping.map((m) => [m.key, source])),
    });
    return { mapping, asking };
  }

  const location = (kind: 'Users' | 'Groups', id: string) => `${deps.baseUrl}/${kind}/${id}`;

  function userOf(link: ScimLink, mapping: readonly MappingEntry[], view: PersonView): Json {
    const pathOf = new Map(mapping.map((m) => [m.key, m.path]));
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(view.attributes)) {
      const path = pathOf.get(key);
      if (path !== undefined) values[path] = value;
    }
    return userResource({
      id: link.personId,
      userName: link.userName,
      externalId: link.externalId,
      active: link.active,
      values,
      meta: {
        created: link.createdAt,
        lastModified: link.updatedAt,
        location: location('Users', link.personId),
      },
    });
  }

  async function readUser(
    tx: Tx,
    asking: Asking,
    mapping: readonly MappingEntry[],
    link: ScimLink,
  ) {
    const view = await service.access.read(tx, { ...asking, personId: link.personId });
    return view.ok ? ok(userOf(link, mapping, view.value)) : view;
  }

  /**
   * Write a User's state onto a linked record: the mapped values that
   * differ from what it holds, and the link. One `synced_from_external`
   * names both; nothing different is nothing written.
   */
  async function sync(
    tx: Tx,
    caller: ScimCaller,
    asking: Asking,
    mapping: readonly MappingEntry[],
    link: ScimLink,
    held: Readonly<Record<string, unknown>>,
    next: Json,
    mode: 'replace' | 'merge',
  ): Promise<Result<Json>> {
    const userName = text(getCI(next, 'userName'));
    if (userName === null || userName.length > 320)
      return Invalid('userName is required', 'userName');
    const externalRaw = getCI(next, 'externalId');
    const externalId = externalRaw === undefined ? link.externalId : text(externalRaw);
    if (externalId !== null && externalId.length > 256)
      return Invalid('externalId is too long', 'externalId');
    const active = flag(getCI(next, 'active')) ?? link.active;

    const clash = await store.clash(tx, caller.tenantId, caller.connectionId, {
      userName,
      externalId,
      except: link.personId,
    });
    if (clash !== null) return Taken(clash);

    const wanted = changesFor(valuesOf(next), mapping, mode);
    const changes = Object.fromEntries(
      Object.entries(wanted).filter(([key, value]) => !same(held[key], value)),
    );
    const linkChanged = [
      ...(userName !== link.userName ? ['userName'] : []),
      ...(externalId !== link.externalId ? ['externalId'] : []),
      ...(active !== link.active ? ['active'] : []),
    ];
    const after: ScimLink = {
      ...link,
      userName,
      externalId,
      active,
      updatedAt: linkChanged.length > 0 || Object.keys(changes).length > 0 ? now() : link.updatedAt,
    };
    if (linkChanged.length > 0 || Object.keys(changes).length > 0) {
      await store.putLink(tx, caller.tenantId, caller.connectionId, after);
    }
    const synced = await service.access.syncExternal(tx, {
      ...asking,
      personId: link.personId,
      changes,
      linkChanged,
      externalId: externalId ?? userName,
    });
    return synced.ok ? ok(userOf(after, mapping, synced.value)) : synced;
  }

  const inTenant = <T>(
    caller: ScimCaller,
    fn: (tx: Tx, w: Awaited<ReturnType<typeof writerFor>>) => Promise<Result<T>>,
  ) => run(service, caller.tenantId, async (tx) => fn(tx, await writerFor(tx, caller)));

  const linked = async (tx: Tx, caller: ScimCaller, id: string) =>
    /^[0-9a-f-]{36}$/iu.test(id)
      ? store.link(tx, caller.tenantId, caller.connectionId, id.toLowerCase())
      : null;

  function groupOf(group: ScimGroup): Json {
    return {
      schemas: [CORE_GROUP],
      id: group.id,
      ...(group.externalId === null ? {} : { externalId: group.externalId }),
      displayName: group.displayName,
      members: group.members.map((value) => ({
        value,
        $ref: location('Users', value),
        type: 'User',
      })),
      meta: {
        resourceType: 'Group',
        created: group.createdAt,
        lastModified: group.updatedAt,
        location: location('Groups', group.id),
      },
    };
  }

  /** A Group's state from a body, checked: members are people this connection provisions. */
  async function groupFrom(
    tx: Tx,
    caller: ScimCaller,
    body: Json,
    base: ScimGroup,
  ): Promise<Result<ScimGroup>> {
    const displayName = text(getCI(body, 'displayName'));
    if (displayName === null || displayName.length > 256) {
      return Invalid('displayName is required', 'displayName');
    }
    const externalRaw = getCI(body, 'externalId');
    const externalId = externalRaw === undefined ? base.externalId : text(externalRaw);
    const raw = getCI(body, 'members');
    const members = new Set<string>();
    for (const m of Array.isArray(raw) ? raw : []) {
      const value = text(getCI(m, 'value'))?.toLowerCase() ?? null;
      if (value === null) return Invalid('Each member names a value', 'members');
      members.add(value);
    }
    const known = new Set(
      (await store.links(tx, caller.tenantId, caller.connectionId)).map((l) => l.personId),
    );
    const stranger = [...members].find((m) => !known.has(m));
    if (stranger !== undefined)
      return Invalid(`${stranger} is not a user this connection provisions`, 'members');
    const clash = (await store.groups(tx, caller.tenantId, caller.connectionId)).find(
      (g) => g.id !== base.id && g.displayName.toLowerCase() === displayName.toLowerCase(),
    );
    if (clash !== undefined) return Taken('displayName');
    return ok({ ...base, displayName, externalId, members: [...members], updatedAt: now() });
  }

  const bodyOf = (body: unknown): Result<Json> =>
    isObject(body) ? ok(body) : err(failure('SCIM_INVALID_SYNTAX', 'The body is a JSON object'));

  return {
    /** The connection a bearer token belongs to, if it is live and its company has People. */
    async authenticate(
      authorization: string | undefined,
      correlationId: string,
    ): Promise<Result<ScimCaller>> {
      const token = /^Bearer\s+(\S+)$/iu.exec(authorization ?? '')?.[1];
      const claims = token === undefined ? null : tokenClaims(token);
      if (token === undefined || claims === null) return Unauthenticated();
      const found = await service.inTenant(claims.tenantId, ({ tx }) =>
        store.connection(tx, claims.tenantId, claims.connectionId),
      );
      if (found === null || found.revokedAt !== null) return Unauthenticated();
      const current = tokenMatches(token, found.tokenHash);
      const previous =
        found.previousValidUntil !== null &&
        Date.parse(found.previousValidUntil) > Date.parse(now()) &&
        tokenMatches(token, found.previousTokenHash);
      if (!current && !previous) return Unauthenticated();
      const entitled = (await deps.entitlements(claims.tenantId)) ?? deps.fallbackEntitlements;
      if (!entitled.includes('module.people')) {
        return err(failure('NOT_ENTITLED', 'This workspace does not include People'));
      }
      return ok({
        tenantId: claims.tenantId,
        connectionId: found.id,
        system: found.system,
        correlationId,
      });
    },

    listUsers: (caller: ScimCaller, query: ListQuery) =>
      inTenant(caller, async (tx, { asking, mapping }): Promise<Result<Json>> => {
        const filter =
          query.filter === undefined || query.filter.trim() === ''
            ? null
            : parseFilter(query.filter);
        if (filter !== null && !filter.ok) return filter;
        const links = await store.links(tx, caller.tenantId, caller.connectionId);
        // A lookup by the link's own fields — what Okta and Entra send before
        // a create — reads no record; anything else reads every one.
        // ponytail: one read per linked person for such a filter; an index
        // over the mapped values is the upgrade if a tenant's lists get slow.
        const cheap =
          filter === null ||
          pathsOf(filter.value).every((p) =>
            LINK_FIELDS.has((splitSchema(p).rest.split(/[.[]/u)[0] ?? '').toLowerCase()),
          );
        const full = new Map<string, Json>();
        let matched: ScimLink[] = [...links];
        if (filter !== null) {
          const kept: ScimLink[] = [];
          for (const link of links) {
            let resource: Json = {
              id: link.personId,
              userName: link.userName,
              externalId: link.externalId,
              active: link.active,
              meta: { created: link.createdAt, lastModified: link.updatedAt },
            };
            if (!cheap) {
              // eslint-disable-next-line no-await-in-loop -- see the ponytail above
              const user = await readUser(tx, asking, mapping, link);
              if (!user.ok) continue;
              resource = user.value;
              full.set(link.personId, resource);
            }
            if (matches(filter.value, resource)) kept.push(link);
          }
          matched = kept;
        }
        const { startIndex, items } = page(matched, query);
        const resources: Json[] = [];
        for (const link of items) {
          const known = full.get(link.personId);
          // eslint-disable-next-line no-await-in-loop -- one page, at most 200
          const user = known === undefined ? await readUser(tx, asking, mapping, link) : ok(known);
          if (user.ok) resources.push(user.value);
        }
        return ok(listResponse(matched.length, startIndex, resources));
      }),

    getUser: (caller: ScimCaller, id: string) =>
      inTenant(caller, async (tx, { asking, mapping }) => {
        const link = await linked(tx, caller, id);
        return link === null ? Missing() : readUser(tx, asking, mapping, link);
      }),

    createUser: (caller: ScimCaller, raw: unknown) =>
      inTenant(caller, async (tx, { asking, mapping }): Promise<Result<Json>> => {
        const body = bodyOf(raw);
        if (!body.ok) return body;
        const userName = text(getCI(body.value, 'userName'));
        if (userName === null) return Invalid('userName is required', 'userName');
        const externalId = text(getCI(body.value, 'externalId'));
        const clash = await store.clash(tx, caller.tenantId, caller.connectionId, {
          userName,
          externalId,
          except: null,
        });
        if (clash !== null) return Taken(clash);
        const created = await service.access.create(tx, { ...asking, attributes: {} });
        if (!created.ok) return created;
        const at = now();
        // An empty link: `sync` writes it with everything the body says and
        // names each field on the one event.
        const blank: ScimLink = {
          personId: created.value.id,
          userName: '',
          externalId: null,
          active: true,
          createdAt: at,
          updatedAt: at,
        };
        return sync(tx, caller, asking, mapping, blank, {}, body.value, 'merge');
      }),

    replaceUser: (caller: ScimCaller, id: string, raw: unknown) =>
      inTenant(caller, async (tx, { asking, mapping }): Promise<Result<Json>> => {
        const body = bodyOf(raw);
        if (!body.ok) return body;
        const link = await linked(tx, caller, id);
        if (link === null) return Missing();
        const held = await service.access.read(tx, { ...asking, personId: link.personId });
        if (!held.ok) return held;
        return sync(
          tx,
          caller,
          asking,
          mapping,
          link,
          held.value.attributes,
          body.value,
          'replace',
        );
      }),

    patchUser: (caller: ScimCaller, id: string, raw: unknown) =>
      inTenant(caller, async (tx, { asking, mapping }): Promise<Result<Json>> => {
        const ops = parsePatch(raw);
        if (!ops.ok) return ops;
        const link = await linked(tx, caller, id);
        if (link === null) return Missing();
        const held = await service.access.read(tx, { ...asking, personId: link.personId });
        if (!held.ok) return held;
        const patched = applyPatch(userOf(link, mapping, held.value), ops.value);
        if (!patched.ok) return patched;
        // The patched User is the whole state: a mapped value it lost was removed.
        return sync(
          tx,
          caller,
          asking,
          mapping,
          link,
          held.value.attributes,
          patched.value,
          'replace',
        );
      }),

    /** Unlinked: the system stops mirroring them. Their record stays, HR's to end. */
    deleteUser: (caller: ScimCaller, id: string) =>
      inTenant(caller, async (tx, { asking }): Promise<Result<null>> => {
        const link = await linked(tx, caller, id);
        if (link === null) return Missing();
        await store.unlink(tx, caller.tenantId, caller.connectionId, link.personId);
        const synced = await service.access.syncExternal(tx, {
          ...asking,
          personId: link.personId,
          changes: {},
          linkChanged: ['active'],
          externalId: link.externalId ?? link.userName,
        });
        return synced.ok ? ok(null) : synced;
      }),

    listGroups: (caller: ScimCaller, query: ListQuery) =>
      inTenant(caller, async (tx): Promise<Result<Json>> => {
        const filter =
          query.filter === undefined || query.filter.trim() === ''
            ? null
            : parseFilter(query.filter);
        if (filter !== null && !filter.ok) return filter;
        const all = (await store.groups(tx, caller.tenantId, caller.connectionId)).map(groupOf);
        const matched = filter === null ? all : all.filter((g) => matches(filter.value, g));
        const { startIndex, items } = page(matched, query);
        return ok(listResponse(matched.length, startIndex, items));
      }),

    getGroup: (caller: ScimCaller, id: string) =>
      inTenant(caller, async (tx): Promise<Result<Json>> => {
        const group = (await store.groups(tx, caller.tenantId, caller.connectionId)).find(
          (g) => g.id === id.toLowerCase(),
        );
        return group === undefined ? Missing() : ok(groupOf(group));
      }),

    createGroup: (caller: ScimCaller, raw: unknown) =>
      inTenant(caller, async (tx): Promise<Result<Json>> => {
        const body = bodyOf(raw);
        if (!body.ok) return body;
        const at = now();
        const group = await groupFrom(tx, caller, body.value, {
          id: deps.newId(),
          displayName: '',
          externalId: null,
          members: [],
          createdAt: at,
          updatedAt: at,
        });
        if (!group.ok) return group;
        await store.putGroup(tx, caller.tenantId, caller.connectionId, group.value);
        return ok(groupOf(group.value));
      }),

    replaceGroup: (caller: ScimCaller, id: string, raw: unknown) =>
      inTenant(caller, async (tx): Promise<Result<Json>> => {
        const body = bodyOf(raw);
        if (!body.ok) return body;
        const base = (await store.groups(tx, caller.tenantId, caller.connectionId)).find(
          (g) => g.id === id.toLowerCase(),
        );
        if (base === undefined) return Missing();
        const group = await groupFrom(tx, caller, body.value, base);
        if (!group.ok) return group;
        await store.putGroup(tx, caller.tenantId, caller.connectionId, group.value);
        return ok(groupOf(group.value));
      }),

    patchGroup: (caller: ScimCaller, id: string, raw: unknown) =>
      inTenant(caller, async (tx): Promise<Result<Json>> => {
        const ops = parsePatch(raw);
        if (!ops.ok) return ops;
        const base = (await store.groups(tx, caller.tenantId, caller.connectionId)).find(
          (g) => g.id === id.toLowerCase(),
        );
        if (base === undefined) return Missing();
        const patched = applyPatch(groupOf(base), ops.value);
        if (!patched.ok) return patched;
        const group = await groupFrom(tx, caller, patched.value, base);
        if (!group.ok) return group;
        await store.putGroup(tx, caller.tenantId, caller.connectionId, group.value);
        return ok(groupOf(group.value));
      }),

    deleteGroup: (caller: ScimCaller, id: string) =>
      inTenant(caller, async (tx): Promise<Result<null>> =>
        (await store.deleteGroup(tx, caller.tenantId, caller.connectionId, id.toLowerCase()))
          ? ok(null)
          : Missing(),
      ),

    /** Kithena's extension, as this connection's mapping fills it (RFC 7643 §7). */
    extensionSchema: (caller: ScimCaller) =>
      inTenant(caller, async (tx, { mapping }): Promise<Result<Json>> => {
        const version = await service.schemas.current(tx, caller.tenantId);
        const byKey = new Map(
          (version?.document.attributes ?? []).map((d) => [d.key as string, d]),
        );
        return ok({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
          id: KITHENA_USER,
          name: 'People',
          description: 'Tenant-defined attributes, by attribute key',
          attributes: mapping.flatMap((m) => {
            const key = extensionKeyOf(m.path);
            const d = key === null ? undefined : byKey.get(key);
            return d === undefined
              ? []
              : [
                  {
                    name: d.key,
                    type:
                      d.dataType === 'boolean'
                        ? 'boolean'
                        : d.dataType === 'number'
                          ? 'decimal'
                          : 'string',
                    multiValued: d.dataType === 'multi_select',
                    description: d.label.default,
                    required: false,
                    caseExact: false,
                    mutability: 'readWrite',
                    returned: 'default',
                    uniqueness: d.uniqueScope === 'none' ? 'none' : 'server',
                  },
                ];
          }),
          meta: { resourceType: 'Schema', location: `${deps.baseUrl}/Schemas/${KITHENA_USER}` },
        });
      }),
  };
}

export type ScimProvisioning = ReturnType<typeof scimProvisioning>;
