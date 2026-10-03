import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarDate, LeaveTypeKey, PersonId, TenantId } from '@kithena/contracts';

import {
  DEFAULT_AUTO_APPROVAL,
  type ApprovalRule,
  type AutoApproval,
} from '../domain/approval/approval-rule.js';
import type { HolidayLayer } from '../domain/calendar/holiday-calendar.js';
import type {
  ApprovalStore,
  FeedStore,
  HolidayStore,
  Integration,
  IntegrationStore,
  SettingStore,
  Settings,
} from '../application/ports.js';
import { fromRange, instantOf, rangeOf } from './drizzle-leave.js';
import {
  approvalRule,
  delegation,
  feedVersion,
  holiday,
  holidayCalendar,
  integration,
  integrationMember,
  locationHolidayCalendar,
  setting,
  teamMinimum,
} from './tables.js';

/**
 * Approval settings, holiday calendars and feed tokens (TOF-032), bound to
 * one tenant transaction.
 */

type SettingKey = 'auto_approval' | 'attendance_rules' | 'parental_company' | keyof Settings;

/** A tenant setting stored as one document, or `fallback` when none is. */
export async function readSetting<T>(
  tx: PostgresJsDatabase,
  key: SettingKey,
  fallback: T,
): Promise<T> {
  const [row] = await tx.select({ value: setting.value }).from(setting).where(eq(setting.key, key));
  return row === undefined ? fallback : (row.value as T);
}

/** The settings without a store of their own (`ports.ts`, `Settings`). */
export function drizzleSettings(tx: PostgresJsDatabase, tenantId: TenantId): SettingStore {
  return {
    get: (key) => readSetting(tx, key, null),
    set: (key, value) => writeSetting(tx, tenantId, key, value),
  };
}

export async function writeSetting(
  tx: PostgresJsDatabase,
  tenantId: TenantId,
  key: SettingKey,
  value: object,
): Promise<void> {
  await tx
    .insert(setting)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({ target: [setting.tenantId, setting.key], set: { value } });
}

/**
 * The domain's rule has no key; the table's key is its place in the list.
 *
 * ponytail: a leave type's `approvalRuleKey` names a rule by that position,
 * and nothing in the domain reads it yet. Give `ApprovalRule` a key when
 * something does.
 */
const ruleKey = (i: number): string => `rule_${String(i + 1).padStart(3, '0')}`;

export function drizzleApprovals(tx: PostgresJsDatabase, tenantId: TenantId): ApprovalStore {
  return {
    async rules() {
      const rows = await tx.select().from(approvalRule).orderBy(asc(approvalRule.key));
      return rows.map((r): ApprovalRule => ({
        subject: r.subject as ApprovalRule['subject'],
        leaveTypes: r.leaveTypes as LeaveTypeKey[] | null,
        when: r.appliesWhen as ApprovalRule['when'],
        approvers: r.approvers as ApprovalRule['approvers'][number][],
      }));
    },
    async setRules(rules) {
      const keys = rules.map((_, i) => ruleKey(i));
      await tx
        .delete(approvalRule)
        .where(keys.length === 0 ? undefined : notInArray(approvalRule.key, keys));
      for (const [i, r] of rules.entries()) {
        const values = {
          subject: r.subject,
          leaveTypes: r.leaveTypes === null ? null : [...r.leaveTypes],
          appliesWhen: r.when,
          approvers: [...r.approvers],
        };
        // oxlint-disable-next-line no-await-in-loop -- a handful of rules, in order
        await tx
          .insert(approvalRule)
          .values({ tenantId, key: ruleKey(i), ...values })
          .onConflictDoUpdate({ target: [approvalRule.tenantId, approvalRule.key], set: values });
      }
    },
    autoApproval: () => readSetting<AutoApproval>(tx, 'auto_approval', DEFAULT_AUTO_APPROVAL),
    setAutoApproval: (auto) => writeSetting(tx, tenantId, 'auto_approval', auto),

    async delegation(approverId) {
      const [r] = await tx
        .select()
        .from(delegation)
        .where(eq(delegation.approverPersonId, approverId));
      return r === undefined
        ? null
        : {
            approverId: r.approverPersonId as PersonId,
            delegateId: r.delegatePersonId as PersonId,
            range: r.during === null ? null : fromRange(r.during),
            automatic: r.automatic,
            salaryRelated: r.salaryRelated,
          };
    },
    async saveDelegation(d) {
      const values = {
        delegatePersonId: d.delegateId,
        during: d.range === null ? null : rangeOf(d.range),
        automatic: d.automatic,
        salaryRelated: d.salaryRelated,
      };
      await tx
        .insert(delegation)
        .values({ tenantId, approverPersonId: d.approverId, ...values })
        .onConflictDoUpdate({
          target: [delegation.tenantId, delegation.approverPersonId],
          set: values,
        });
    },
    async removeDelegation(approverId) {
      await tx.delete(delegation).where(eq(delegation.approverPersonId, approverId));
    },

    async teamMinimum(teamKey) {
      const [r] = await tx.select().from(teamMinimum).where(eq(teamMinimum.teamKey, teamKey));
      return r === undefined ? null : { atLeast: r.atLeast, unit: r.unit as 'people' | 'percent' };
    },
    async setTeamMinimum(teamKey, minimum) {
      if (minimum === null) {
        await tx.delete(teamMinimum).where(eq(teamMinimum.teamKey, teamKey));
        return;
      }
      await tx
        .insert(teamMinimum)
        .values({ tenantId, teamKey, ...minimum })
        .onConflictDoUpdate({ target: [teamMinimum.tenantId, teamMinimum.teamKey], set: minimum });
    },
  };
}

export function drizzleHolidays(tx: PostgresJsDatabase, tenantId: TenantId): HolidayStore {
  return {
    async layers() {
      const calendars = await tx.select().from(holidayCalendar).orderBy(asc(holidayCalendar.key));
      const days = await tx.select().from(holiday).orderBy(asc(holiday.day));
      return calendars.map((c): HolidayLayer => ({
        key: c.key,
        name: c.name,
        level: c.level as HolidayLayer['level'],
        weekendRule: c.weekendRule as HolidayLayer['weekendRule'],
        holidays: days
          .filter((h) => h.calendarKey === c.key)
          .map((h) => ({ date: h.day as CalendarDate, name: h.name })),
      }));
    },
    async saveLayer(layer) {
      const values = { name: layer.name, level: layer.level, weekendRule: layer.weekendRule };
      await tx
        .insert(holidayCalendar)
        .values({ tenantId, key: layer.key, ...values })
        .onConflictDoUpdate({
          target: [holidayCalendar.tenantId, holidayCalendar.key],
          set: values,
        });
      await tx.delete(holiday).where(eq(holiday.calendarKey, layer.key));
      if (layer.holidays.length > 0) {
        await tx.insert(holiday).values(
          layer.holidays.map((h) => ({
            tenantId,
            calendarKey: layer.key,
            day: h.date,
            name: h.name,
          })),
        );
      }
    },
    async removeLayer(key) {
      // Its days and its assignments go with it (ON DELETE CASCADE).
      await tx.delete(holidayCalendar).where(eq(holidayCalendar.key, key));
    },
    async assigned(locationKey) {
      const rows = await tx
        .select({ key: locationHolidayCalendar.calendarKey })
        .from(locationHolidayCalendar)
        .where(eq(locationHolidayCalendar.locationKey, locationKey))
        .orderBy(asc(locationHolidayCalendar.position));
      return rows.map((r) => r.key);
    },
    async assign(locationKey, layerKeys) {
      await tx
        .delete(locationHolidayCalendar)
        .where(eq(locationHolidayCalendar.locationKey, locationKey));
      if (layerKeys.length === 0) return;
      await tx.insert(locationHolidayCalendar).values(
        layerKeys.map((calendarKey, position) => ({
          tenantId,
          locationKey,
          calendarKey,
          position,
        })),
      );
    },
  };
}

export function drizzleFeeds(tx: PostgresJsDatabase, tenantId: TenantId): FeedStore {
  return {
    async version(personId) {
      const [r] = await tx
        .select({ version: feedVersion.version })
        .from(feedVersion)
        .where(eq(feedVersion.personId, personId));
      return r?.version ?? 0;
    },
    async bump(personId) {
      const [r] = await tx
        .insert(feedVersion)
        .values({ tenantId, personId, version: 1 })
        .onConflictDoUpdate({
          target: [feedVersion.tenantId, feedVersion.personId],
          set: { version: sql`feed_version.version + 1` },
        })
        .returning({ version: feedVersion.version });
      return r?.version ?? 1;
    },
  };
}

const integrationOf = (r: typeof integration.$inferSelect): Integration => ({
  provider: r.provider as Integration['provider'],
  config: r.config as Integration['config'],
  secret: r.secret,
  connectedAt: instantOf(r.connectedAt),
  connectedBy: r.connectedBy,
});

/** Calendar and chat connections (TOF-109), secrets sealed by their adapters. */
export function drizzleIntegrations(tx: PostgresJsDatabase, tenantId: TenantId): IntegrationStore {
  return {
    async list() {
      return (await tx.select().from(integration).orderBy(asc(integration.provider))).map(
        integrationOf,
      );
    },
    async get(provider) {
      const [r] = await tx.select().from(integration).where(eq(integration.provider, provider));
      return r === undefined ? null : integrationOf(r);
    },
    async save(i) {
      const row = {
        config: i.config,
        secret: i.secret,
        connectedAt: i.connectedAt,
        connectedBy: i.connectedBy,
      };
      await tx
        .insert(integration)
        .values({ tenantId, provider: i.provider, ...row })
        .onConflictDoUpdate({ target: [integration.tenantId, integration.provider], set: row });
    },
    async remove(provider) {
      // The members' grants go with it (ON DELETE CASCADE).
      await tx.delete(integration).where(eq(integration.provider, provider));
    },
    async memberSecret(provider, personId) {
      const [r] = await tx
        .select({ secret: integrationMember.secret })
        .from(integrationMember)
        .where(
          and(eq(integrationMember.provider, provider), eq(integrationMember.personId, personId)),
        );
      return r?.secret ?? null;
    },
    async setMemberSecret(provider, personId, sealed) {
      if (sealed === null) {
        await tx
          .delete(integrationMember)
          .where(
            and(eq(integrationMember.provider, provider), eq(integrationMember.personId, personId)),
          );
        return;
      }
      await tx
        .insert(integrationMember)
        .values({ tenantId, provider, personId, secret: sealed })
        .onConflictDoUpdate({
          target: [
            integrationMember.tenantId,
            integrationMember.provider,
            integrationMember.personId,
          ],
          set: { secret: sealed },
        });
    },
  };
}
