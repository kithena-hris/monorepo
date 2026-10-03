import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarDate, LocationKey, PersonId, TeamKey, TenantId } from '@kithena/contracts';

import type {
  Location,
  LocationStore,
  Member,
  MemberStore,
  ScimStore,
  ScimUser,
} from '../application/ports.js';
import { instantOf } from './drizzle-leave.js';
import { location, member, scimConnection, scimUser, tenant } from './tables.js';

/**
 * The member projection and the locations that fill it in (TOF-029, TOF-045),
 * bound to one tenant transaction.
 *
 * `last_event_id` and `last_effective_from` are `NOT NULL` so a row
 * comparison never meets a null; a member that no event has touched yet (an
 * import) is stored as the nil UUID and `-infinity`, which every real event
 * moves past, and read back as `null`. The upsert writes only when the pair
 * moves forward or stays put: the application has already ignored a stale
 * event, and this is the same rule where two writers could race.
 */

const NO_EVENT = '00000000-0000-0000-0000-000000000000';
const NEVER = '-infinity';

type MemberRow = typeof member.$inferSelect;

function toMember(r: MemberRow): Member {
  return {
    personId: r.personId as PersonId,
    accountId: r.accountId,
    displayName: r.displayName,
    firstName: r.firstName ?? r.displayName,
    workEmail: r.workEmail,
    managerPersonId: r.managerPersonId as PersonId | null,
    teamKey: r.teamKey as TeamKey | null,
    teamName: r.teamName,
    locationKey: r.locationKey as LocationKey | null,
    country: r.country,
    region: r.region,
    city: r.city,
    timeZone: r.timeZone,
    // Every write sets it; the column is nullable only for TOF-029's sake.
    hireDate: r.hireDate as CalendarDate,
    terminationDate: r.terminationDate as CalendarDate | null,
    workPattern: r.workPattern,
    // The table's word for a leaver is People's.
    status: r.status === 'terminated' ? 'left' : (r.status as 'active' | 'on_leave'),
    lastEventId: r.lastEventId === NO_EVENT ? null : r.lastEventId,
    lastEffectiveFrom: r.lastEffectiveFrom === NEVER ? null : (r.lastEffectiveFrom as CalendarDate),
  };
}

export function drizzleMembers(tx: PostgresJsDatabase, tenantId: TenantId): MemberStore {
  return {
    async get(personId) {
      const [row] = await tx.select().from(member).where(eq(member.personId, personId));
      return row === undefined ? null : toMember(row);
    },

    async list(filter) {
      const rows = await tx
        .select()
        .from(member)
        .where(filter?.teamKey === undefined ? undefined : eq(member.teamKey, filter.teamKey))
        .orderBy(asc(member.displayName), asc(member.personId));
      return rows.map(toMember);
    },

    async byAccount(accountId) {
      const rows = await tx.select().from(member).where(eq(member.accountId, accountId)).limit(2);
      const [only] = rows;
      return rows.length === 1 && only !== undefined ? toMember(only) : null;
    },

    async save(m) {
      const values = {
        accountId: m.accountId,
        displayName: m.displayName,
        firstName: m.firstName,
        workEmail: m.workEmail,
        managerPersonId: m.managerPersonId,
        teamKey: m.teamKey,
        teamName: m.teamName,
        locationKey: m.locationKey,
        country: m.country,
        region: m.region,
        city: m.city,
        timeZone: m.timeZone,
        hireDate: m.hireDate,
        terminationDate: m.terminationDate,
        workPattern: m.workPattern === null ? null : [...m.workPattern],
        status: m.status === 'left' ? 'terminated' : m.status,
        lastEventId: m.lastEventId ?? NO_EVENT,
        lastEffectiveFrom: m.lastEffectiveFrom ?? NEVER,
      };
      await tx
        .insert(member)
        .values({ tenantId, personId: m.personId, ...values })
        .onConflictDoUpdate({
          target: [member.tenantId, member.personId],
          set: values,
          setWhere: sql`(member.last_effective_from, member.last_event_id)
            <= (excluded.last_effective_from, excluded.last_event_id)`,
        });
      // Background jobs run for every tenant with a member (`knownTenants`).
      await tx.insert(tenant).values({ tenantId }).onConflictDoNothing();
    },
  };
}

export function drizzleLocations(tx: PostgresJsDatabase, tenantId: TenantId): LocationStore {
  return {
    async get(key) {
      const [row] = await tx
        .select()
        .from(location)
        .where(and(eq(location.tenantId, tenantId), eq(location.locationKey, key)));
      return row === undefined
        ? null
        : {
            locationKey: row.locationKey as LocationKey,
            name: row.name,
            country: row.country,
            timeZone: row.timeZone,
          };
    },

    async save(l: Location) {
      const values = { name: l.name, country: l.country, timeZone: l.timeZone };
      await tx
        .insert(location)
        .values({ tenantId, locationKey: l.locationKey, ...values })
        .onConflictDoUpdate({ target: [location.tenantId, location.locationKey], set: values });
    },
  };
}

/**
 * Every tenant with a member, for the background jobs. Outside any tenant
 * transaction: `timeoff.tenant` is the one table readable without one.
 */
export async function knownTenants(db: PostgresJsDatabase): Promise<TenantId[]> {
  const rows = await db
    .select({ tenantId: tenant.tenantId })
    .from(tenant)
    .orderBy(asc(tenant.tenantId));
  return rows.map((r) => r.tenantId as TenantId);
}

const scimUserOf = (r: typeof scimUser.$inferSelect): ScimUser => ({
  personId: r.personId as PersonId,
  userName: r.userName,
  externalId: r.externalId,
  createdAt: instantOf(r.createdAt),
  updatedAt: instantOf(r.updatedAt),
});

/** SCIM connections and what an identity provider calls each member (TOF-114). */
export function drizzleScim(tx: PostgresJsDatabase, tenantId: TenantId): ScimStore {
  return {
    async connection(id) {
      const [r] = await tx.select().from(scimConnection).where(eq(scimConnection.id, id));
      return r === undefined
        ? null
        : {
            id: r.id,
            tokenHash: r.tokenHash,
            createdBy: r.createdBy,
            revokedAt: r.revokedAt === null ? null : instantOf(r.revokedAt),
          };
    },
    async saveConnection(c) {
      await tx
        .insert(scimConnection)
        .values({
          tenantId,
          id: c.id,
          tokenHash: c.tokenHash,
          createdBy: c.createdBy,
          revokedAt: c.revokedAt,
        })
        .onConflictDoUpdate({
          target: [scimConnection.tenantId, scimConnection.id],
          set: { revokedAt: c.revokedAt },
        });
    },
    async user(personId) {
      const [r] = await tx.select().from(scimUser).where(eq(scimUser.personId, personId));
      return r === undefined ? null : scimUserOf(r);
    },
    async byUserName(userName) {
      const [r] = await tx
        .select()
        .from(scimUser)
        .where(sql`lower(${scimUser.userName}) = lower(${userName})`);
      return r === undefined ? null : scimUserOf(r);
    },
    async users() {
      return (await tx.select().from(scimUser).orderBy(asc(scimUser.createdAt))).map(scimUserOf);
    },
    async saveUser(u) {
      const row = { userName: u.userName, externalId: u.externalId };
      await tx
        .insert(scimUser)
        .values({ tenantId, personId: u.personId, ...row })
        .onConflictDoUpdate({ target: [scimUser.tenantId, scimUser.personId], set: row });
    },
  };
}
