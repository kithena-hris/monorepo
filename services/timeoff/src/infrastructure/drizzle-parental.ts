import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarDate, Instant, LeaveTypeKey, PersonId, TenantId } from '@kithena/contracts';

import type {
  CompanyParentalWeeks,
  HandoverItem,
  ParentalStore,
  StoredPlan,
} from '../application/ports.js';
import type { ParentRole } from '../domain/parental/entitlement.js';
import type { ParentalPlanId, PlanBlock, PlanStatus } from '../domain/parental/plan.js';
import { readSetting, writeSetting } from './drizzle-settings.js';
import { parentalBlock, parentalPlan } from './tables.js';

/**
 * Parental plans and their blocks (TOF-102), bound to one tenant
 * transaction. A save writes the plan and replaces its blocks whole: a draft
 * is dragged about freely, and a sent plan's blocks only move with a birth.
 */

type PlanRow = typeof parentalPlan.$inferSelect;
type BlockRow = typeof parentalBlock.$inferSelect;

function toStored(r: PlanRow, blocks: readonly BlockRow[]): StoredPlan {
  return {
    id: r.id as ParentalPlanId,
    personId: r.personId as PersonId,
    status: r.status as PlanStatus,
    country: r.country,
    role: r.role as ParentRole,
    childDate: r.childDate as CalendarDate,
    dueDate: r.dueDate as CalendarDate | null,
    birth: r.birthDate as CalendarDate | null,
    singleParent: r.singleParent,
    children: r.children,
    company: r.company as CompanyParentalWeeks | null,
    blocks: blocks
      .toSorted((a, b) => a.position - b.position)
      .map((b) => ({
        kind: b.kind as PlanBlock['kind'],
        leaveTypeKey: b.leaveTypeKey as LeaveTypeKey,
        from: b.fromOn as CalendarDate,
        to: b.toOn as CalendarDate,
      })),
    version: r.version,
    teamSees: r.teamSees as StoredPlan['teamSees'],
    handover: r.handover as HandoverItem[],
    sentAt: r.sentAt as Instant | null,
    approvedAt: r.approvedAt as Instant | null,
    approvedBy: r.approvedBy,
  };
}

export function drizzleParental(tx: PostgresJsDatabase, tenantId: TenantId): ParentalStore {
  const withBlocks = async (rows: readonly PlanRow[]): Promise<StoredPlan[]> => {
    if (rows.length === 0) return [];
    const blocks = await tx
      .select()
      .from(parentalBlock)
      .where(
        inArray(
          parentalBlock.planId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(parentalBlock.position));
    return rows.map((r) =>
      toStored(
        r,
        blocks.filter((b) => b.planId === r.id),
      ),
    );
  };
  return {
    async get(id) {
      const rows = await tx.select().from(parentalPlan).where(eq(parentalPlan.id, id));
      return (await withBlocks(rows))[0] ?? null;
    },

    /** Newest first: ids are UUIDv7, so they sort by when the plan was started. */
    async list(f) {
      const rows = await tx
        .select()
        .from(parentalPlan)
        .where(
          and(
            f.personId === undefined ? undefined : eq(parentalPlan.personId, f.personId),
            f.statuses === undefined ? undefined : inArray(parentalPlan.status, [...f.statuses]),
          ),
        )
        .orderBy(desc(parentalPlan.id));
      return withBlocks(rows);
    },

    async save(plan) {
      const values = {
        personId: plan.personId,
        status: plan.status,
        country: plan.country,
        role: plan.role,
        childDate: plan.childDate,
        dueDate: plan.dueDate,
        birthDate: plan.birth,
        singleParent: plan.singleParent,
        children: plan.children,
        company: plan.company,
        teamSees: plan.teamSees,
        handover: [...plan.handover],
        version: plan.version,
        sentAt: plan.sentAt,
        approvedAt: plan.approvedAt,
        approvedBy: plan.approvedBy,
      };
      await tx
        .insert(parentalPlan)
        .values({ tenantId, id: plan.id, ...values })
        .onConflictDoUpdate({ target: [parentalPlan.tenantId, parentalPlan.id], set: values });
      await tx.delete(parentalBlock).where(eq(parentalBlock.planId, plan.id));
      if (plan.blocks.length > 0) {
        await tx.insert(parentalBlock).values(
          plan.blocks.map((b, position) => ({
            tenantId,
            planId: plan.id,
            position,
            kind: b.kind,
            leaveTypeKey: b.leaveTypeKey,
            fromOn: b.from,
            toOn: b.to,
          })),
        );
      }
    },

    company: () => readSetting<CompanyParentalWeeks | null>(tx, 'parental_company', null),

    setCompany: (weeks) => writeSetting(tx, tenantId, 'parental_company', weeks),
  };
}
