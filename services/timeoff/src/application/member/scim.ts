import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { PersonId, TeamKey, TenantId, type CalendarDate } from '@kithena/contracts';

import { MemberFields, type Caller, type Deps, type Member, type ScimUser } from '../ports.js';
import { forbidden, isHrAdmin, transact } from '../shared.js';
import { endMember, upsertIn } from './sync.js';

/**
 * SCIM 2.0 member provisioning for a company without People (PRD §18,
 * TOF-114; RFC 7643, 7644): an identity provider — Entra, Okta — keeps
 * Time Off's members as it keeps its users. People's approach
 * (`services/people/src/application/scim/`), in Time Off's own copy and
 * scoped to what Time Off keeps: Users only, no groups, no attribute
 * mapping, because a member has a fixed handful of fields.
 *
 * A User becomes `MemberFields` and goes through `upsertIn`, the same
 * command an import and People's events use, so a hire posts its
 * entitlement however it arrived. Deprovisioning (`active: false`, or
 * DELETE) ends the member, who stays as a leaver: their requests and
 * punches are records, not a user account.
 *
 * Filters are `userName eq "…"` and `externalId eq "…"`, which is what the
 * providers send to match a user before creating one; anything else is
 * refused as `invalidFilter`, not ignored.
 */

export const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const ENTERPRISE_USER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
/** Time Off's own: what a member has that a User does not. */
export const TIMEOFF_USER = 'urn:kithena:params:scim:schemas:extension:timeoff:2.0:User';
const LIST_RESPONSE = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const MAX_COUNT = 200;

export type Json = Record<string, unknown>;

type ScimDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'notifier'>;

export interface ScimCaller {
  readonly tenantId: TenantId;
  readonly connectionId: string;
  readonly correlationId: string;
}

/* ----------------------------------------------------------------- token -- */

const PREFIX = 'kts_';
const uuidBytes = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex');
const uuidOf = (bytes: Buffer) => {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/** A connection for an identity provider, and its bearer token, shown this once. HR. */
export const issueScimConnection =
  (deps: Pick<Deps, 'uow' | 'authz' | 'newId'>) =>
  (caller: Caller): Promise<Result<{ id: string; token: string }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const id = deps.newId();
      const token = `${PREFIX}${Buffer.concat([uuidBytes(caller.tenantId), uuidBytes(id), randomBytes(32)]).toString('base64url')}`;
      await tx.scim.saveConnection({
        id,
        tokenHash: sha256(token),
        createdBy: caller.accountId,
        revokedAt: null,
      });
      return ok({ id, token });
    });

/** The connection's token stops working at once. HR. */
export const revokeScimConnection =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (caller: Caller, id: string): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const connection = await tx.scim.connection(id);
      if (connection === null) return err(failure('NOT_FOUND', 'No such connection'));
      if (connection.revokedAt === null)
        await tx.scim.saveConnection({ ...connection, revokedAt: deps.clock.instant() });
      return ok(undefined);
    });

const unauthenticated = (): Result<never> =>
  err(failure('UNAUTHENTICATED', 'A valid bearer token is required'));

/** The connection an `Authorization: Bearer kts_…` header proves. */
export const authenticateScim =
  (deps: Pick<Deps, 'uow'>) =>
  async (authorization: string | undefined, correlationId: string): Promise<Result<ScimCaller>> => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token.startsWith(PREFIX) || token.length > 200) return unauthenticated();
    const raw = Buffer.from(token.slice(PREFIX.length), 'base64url');
    if (raw.length !== 64) return unauthenticated();
    const tenant = TenantId.safeParse(uuidOf(raw.subarray(0, 16)));
    const connectionId = uuidOf(raw.subarray(16, 32));
    if (!tenant.success) return unauthenticated();
    return transact(deps, tenant.data, async (tx) => {
      const connection = await tx.scim.connection(connectionId);
      const given = Buffer.from(sha256(token), 'hex');
      const held = Buffer.from(connection?.tokenHash ?? '', 'hex');
      if (
        connection === null ||
        connection.revokedAt !== null ||
        given.length !== held.length ||
        !timingSafeEqual(given, held)
      ) {
        return unauthenticated();
      }
      return ok({ tenantId: tenant.data, connectionId, correlationId });
    });
  };

/* -------------------------------------------------------------- resource -- */

const invalid = (message: string, path?: string): Result<never> =>
  err(failure('SCIM_INVALID_VALUE', message, path === undefined ? undefined : [path]));
const missing = (): Result<never> => err(failure('NOT_FOUND', 'No such resource'));

/** Case-insensitive attribute lookup, as RFC 7643 §2.1 has attribute names. */
function get(object: unknown, name: string): unknown {
  if (typeof object !== 'object' || object === null) return undefined;
  const key = Object.keys(object).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : (object as Json)[key];
}
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
/** Entra sends booleans as "True" and "False". */
const flag = (v: unknown): boolean | undefined =>
  v === undefined || v === null
    ? undefined
    : v === true || (typeof v === 'string' && v.toLowerCase() === 'true');

function userOf(base: string, user: ScimUser, member: Member): Json {
  return {
    schemas: [CORE_USER, ENTERPRISE_USER, TIMEOFF_USER],
    id: member.personId,
    ...(user.externalId === null ? {} : { externalId: user.externalId }),
    userName: user.userName,
    name: { givenName: member.firstName, formatted: member.displayName },
    displayName: member.displayName,
    active: member.status !== 'left',
    ...(member.workEmail === null
      ? {}
      : { emails: [{ value: member.workEmail, type: 'work', primary: true }] }),
    [ENTERPRISE_USER]: {
      ...(member.teamName === null ? {} : { department: member.teamName }),
      ...(member.managerPersonId === null ? {} : { manager: { value: member.managerPersonId } }),
    },
    [TIMEOFF_USER]: {
      hireDate: member.hireDate,
      ...(member.terminationDate === null ? {} : { terminationDate: member.terminationDate }),
      ...(member.locationKey === null ? {} : { locationKey: member.locationKey }),
      ...(member.country === null ? {} : { country: member.country }),
      timeZone: member.timeZone,
    },
    meta: {
      resourceType: 'User',
      created: user.createdAt,
      lastModified: user.updatedAt,
      location: `${base}/Users/${member.personId}`,
    },
  };
}

/** A department as a team key: `Platform Team` → `t_platform_team`. */
const teamKeyOf = (department: string): TeamKey | null => {
  const key = TeamKey.safeParse(
    `t_${department
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '_')
      .replaceAll(/^_+|_+$/gu, '')}`.slice(0, 64),
  );
  return key.success ? key.data : null;
};

/** A User's state as a member's fields, over what the member already holds. */
function fieldsFrom(
  body: Json,
  personId: PersonId,
  existing: Member | null,
  today: CalendarDate,
): Result<{ fields: MemberFields; userName: string; externalId: string | null; active: boolean }> {
  const userName = text(get(body, 'userName'));
  if (userName === null || userName.length > 320)
    return invalid('userName is required', 'userName');
  const externalId = text(get(body, 'externalId'));
  if (externalId !== null && externalId.length > 256)
    return invalid('externalId is too long', 'externalId');
  const name = get(body, 'name');
  const given = text(get(name, 'givenName'));
  const family = text(get(name, 'familyName'));
  const displayName =
    text(get(body, 'displayName')) ??
    text(get(name, 'formatted')) ??
    ([given, family].filter(Boolean).join(' ') || existing?.displayName || userName);
  const emails = get(body, 'emails');
  const list: unknown[] = Array.isArray(emails) ? (emails as unknown[]) : [];
  const primary: unknown = list.find((e) => flag(get(e, 'primary')) === true) ?? list[0];
  const email = text(get(primary, 'value')) ?? (userName.includes('@') ? userName : null);
  const enterprise = get(body, ENTERPRISE_USER);
  const department = text(get(enterprise, 'department'));
  const managerRaw = get(enterprise, 'manager');
  const manager = PersonId.safeParse(
    typeof managerRaw === 'string' ? managerRaw : text(get(managerRaw, 'value')),
  );
  const own = get(body, TIMEOFF_USER);
  const parsed = MemberFields.safeParse({
    ...existing,
    personId,
    accountId: existing?.accountId ?? null,
    displayName,
    firstName: given ?? displayName.split(' ')[0] ?? displayName,
    workEmail: email,
    managerPersonId: manager.success ? manager.data : (existing?.managerPersonId ?? null),
    teamKey: department === null ? (existing?.teamKey ?? null) : teamKeyOf(department),
    teamName: department ?? existing?.teamName ?? null,
    locationKey: text(get(own, 'locationKey')) ?? existing?.locationKey ?? null,
    country: text(get(own, 'country')) ?? existing?.country ?? null,
    timeZone: text(get(own, 'timeZone')) ?? existing?.timeZone ?? 'UTC',
    hireDate: text(get(own, 'hireDate')) ?? existing?.hireDate ?? today,
    terminationDate: null,
    status: 'active',
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid(issue?.message ?? 'invalid user', issue?.path.join('.'));
  }
  return ok({
    fields: parsed.data,
    userName,
    externalId,
    active: flag(get(body, 'active')) ?? true,
  });
}

/* ------------------------------------------------------------------ users -- */

const uniqueness = (): Result<never> =>
  err(failure('SCIM_UNIQUENESS', 'Another user already has this userName', ['userName']));

/**
 * Writes a User and answers with it. A new member is a hire, its entitlement
 * posted; `active: false` ends the member, in its own transaction, after.
 */
async function write(
  deps: ScimDeps,
  caller: ScimCaller,
  base: string,
  body: Json,
  personId: PersonId,
  created: boolean,
): Promise<Result<Json>> {
  const saved = await transact(deps, caller.tenantId, async (tx) => {
    const existing = await tx.members.get(personId);
    const held = await tx.scim.user(personId);
    if (!created && (existing === null || held === null)) return missing();
    const today = deps.clock.date(existing?.timeZone ?? 'UTC');
    const user = fieldsFrom(body, personId, existing, today);
    if (!user.ok) return user;
    const clash = await tx.scim.byUserName(user.value.userName);
    if (clash !== null && clash.personId !== personId) return uniqueness();
    // A leaver deprovisioned again stays as they left; one coming back is active again.
    const stays = !user.value.active && existing?.status === 'left';
    const fields: MemberFields = stays
      ? { ...user.value.fields, status: 'left', terminationDate: existing.terminationDate }
      : user.value.fields;
    const done = await upsertIn(tx, deps, fields, {
      eventId: null,
      effectiveFrom: null,
      correlationId: caller.correlationId,
    });
    if (!done.ok) return done;
    const now = deps.clock.instant();
    await tx.scim.saveUser({
      personId,
      userName: user.value.userName,
      externalId: user.value.externalId,
      createdAt: held?.createdAt ?? now,
      updatedAt: now,
    });
    return ok({ end: !user.value.active && !stays, timeZone: fields.timeZone });
  });
  if (!saved.ok) return saved;
  if (saved.value.end) {
    const ended = await endMember(deps)(
      caller.tenantId,
      personId,
      deps.clock.date(saved.value.timeZone),
      { eventId: null, effectiveFrom: null, correlationId: caller.correlationId },
    );
    if (!ended.ok) return ended;
  }
  return getUser(deps)(caller, base, personId);
}

export const getUser =
  (deps: Pick<Deps, 'uow'>) =>
  (caller: ScimCaller, base: string, id: string): Promise<Result<Json>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const personId = PersonId.safeParse(id.toLowerCase());
      if (!personId.success) return missing();
      const [user, member] = await Promise.all([
        tx.scim.user(personId.data),
        tx.members.get(personId.data),
      ]);
      return user === null || member === null ? missing() : ok(userOf(base, user, member));
    });

/** `userName eq "x"` or `externalId eq "x"`, nothing else. */
function filterOf(filter: string | undefined): Result<((u: ScimUser) => boolean) | null> {
  if (filter === undefined || filter.trim() === '') return ok(null);
  const match = /^\s*(userName|externalId)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/iu.exec(filter);
  if (match === null) {
    return err(
      failure('SCIM_INVALID_FILTER', 'Only userName eq "…" and externalId eq "…" are supported'),
    );
  }
  const value = (match[2] ?? '').replaceAll(/\\(.)/gu, '$1');
  return ok(
    (match[1] ?? '').toLowerCase() === 'username'
      ? (u) => u.userName.toLowerCase() === value.toLowerCase()
      : (u) => u.externalId === value,
  );
}

export const listUsers =
  (deps: Pick<Deps, 'uow'>) =>
  (
    caller: ScimCaller,
    base: string,
    query: {
      readonly filter?: string | undefined;
      readonly startIndex?: number | undefined;
      readonly count?: number | undefined;
    },
  ): Promise<Result<Json>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const filter = filterOf(query.filter);
      if (!filter.ok) return filter;
      const users = (await tx.scim.users()).filter(filter.value ?? (() => true));
      const startIndex = Math.max(1, Math.trunc(query.startIndex ?? 1));
      const count = Math.min(MAX_COUNT, Math.max(0, Math.trunc(query.count ?? 100)));
      const page = users.slice(startIndex - 1, startIndex - 1 + count);
      const resources: Json[] = [];
      for (const u of page) {
        const member = await tx.members.get(u.personId);
        if (member !== null) resources.push(userOf(base, u, member));
      }
      return ok({
        schemas: [LIST_RESPONSE],
        totalResults: users.length,
        startIndex,
        itemsPerPage: resources.length,
        Resources: resources,
      });
    });

export const createUser =
  (deps: ScimDeps) =>
  (caller: ScimCaller, base: string, raw: unknown): Promise<Result<Json>> => {
    if (typeof raw !== 'object' || raw === null) return Promise.resolve(invalid('A User object'));
    return write(deps, caller, base, raw as Json, PersonId.parse(deps.newId()), true);
  };

export const replaceUser =
  (deps: ScimDeps) =>
  (caller: ScimCaller, base: string, id: string, raw: unknown): Promise<Result<Json>> => {
    const personId = PersonId.safeParse(id.toLowerCase());
    if (!personId.success) return Promise.resolve(missing());
    if (typeof raw !== 'object' || raw === null) return Promise.resolve(invalid('A User object'));
    return write(deps, caller, base, raw as Json, personId.data, false);
  };

/** A path PATCH may name, as the key it writes in the User object; `null` when unsupported. */
function pathKey(path: string): readonly string[] | null {
  const p = path.trim();
  const enterprise = `${ENTERPRISE_USER}:`;
  const own = `${TIMEOFF_USER}:`;
  if (p.toLowerCase().startsWith(enterprise.toLowerCase()))
    return [ENTERPRISE_USER, p.slice(enterprise.length).split('.')[0] ?? ''];
  if (p.toLowerCase().startsWith(own.toLowerCase())) return [TIMEOFF_USER, p.slice(own.length)];
  // `emails[type eq "work"].value`, how Entra names the work address.
  if (/^emails(\[.*\])?(\.value)?$/iu.test(p)) return ['emails'];
  if (/^name\.(givenName|familyName|formatted)$/iu.test(p)) return ['name', p.slice(5)];
  if (/^(userName|externalId|displayName|active)$/iu.test(p)) return [p];
  return null;
}

/**
 * RFC 7644 §3.5.2: `add`, `replace` and `remove` on the paths a member
 * has, or a value object with no path; the result is written like a PUT.
 */
export const patchUser =
  (deps: ScimDeps) =>
  async (caller: ScimCaller, base: string, id: string, raw: unknown): Promise<Result<Json>> => {
    const current = await getUser(deps)(caller, base, id);
    if (!current.ok) return current;
    const schemas = get(raw, 'schemas');
    const operations = get(raw, 'Operations');
    if (!Array.isArray(schemas) || !schemas.includes(PATCH_OP) || !Array.isArray(operations)) {
      return err(failure('SCIM_INVALID_SYNTAX', 'A PatchOp with Operations'));
    }
    const next: Json = structuredClone(current.value);
    for (const operation of operations as unknown[]) {
      const op = text(get(operation, 'op'))?.toLowerCase();
      const path = text(get(operation, 'path'));
      const value = get(operation, 'value');
      if (op !== 'add' && op !== 'replace' && op !== 'remove') {
        return err(failure('SCIM_INVALID_SYNTAX', `Unknown op ${String(op)}`));
      }
      if (path === null) {
        if (op === 'remove' || typeof value !== 'object' || value === null) {
          return err(failure('SCIM_NO_TARGET', 'A path is needed'));
        }
        Object.assign(next, value);
        continue;
      }
      const key = pathKey(path);
      if (key === null) return err(failure('SCIM_INVALID_PATH', `Time Off has no ${path}`));
      const [first = '', second] = key;
      if (first === 'emails') {
        next['emails'] =
          op === 'remove'
            ? []
            : [
                {
                  value: typeof value === 'string' ? value : get(value, 'value'),
                  type: 'work',
                  primary: true,
                },
              ];
      } else if (second === undefined) {
        // Removing an attribute is saying it has no value.
        next[first] = op === 'remove' ? null : value;
      } else {
        next[first] = Object.assign({}, next[first], {
          [second]: op === 'remove' ? null : value,
        });
      }
    }
    return write(deps, caller, base, next, PersonId.parse(String(current.value['id'])), false);
  };

/** Deprovisioning: the member ends today and stays, as a leaver. */
export const deleteUser =
  (deps: ScimDeps) =>
  async (caller: ScimCaller, base: string, id: string): Promise<Result<null>> => {
    const current = await getUser(deps)(caller, base, id);
    if (!current.ok) return current;
    const done = await write(
      deps,
      caller,
      base,
      { ...current.value, active: false },
      PersonId.parse(String(current.value['id'])),
      false,
    );
    return done.ok ? ok(null) : done;
  };

export const serviceProviderConfig = (base: string): Json => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: MAX_COUNT },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'Bearer token',
      description: 'The connection token HR issued for this identity provider',
      primary: true,
    },
  ],
  meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` },
});

export const resourceTypes = (base: string): Json[] => [
  {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
    id: 'User',
    name: 'User',
    endpoint: '/Users',
    schema: CORE_USER,
    schemaExtensions: [
      { schema: ENTERPRISE_USER, required: false },
      { schema: TIMEOFF_USER, required: false },
    ],
    meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
  },
];
