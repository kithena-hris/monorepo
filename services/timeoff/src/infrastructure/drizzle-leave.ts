import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CalendarDate,
  Instant,
  LeaveTypeDefinition,
  LedgerEntry,
  PolicyDefinition,
  type DayAmount,
  type LeaveTypeKey,
  type PersonId,
  type RequestStatus,
  type TenantId,
} from '@kithena/contracts';

import type { ApproverRole } from '../domain/approval/approval-rule.js';
import { addDays, type DateRange } from '../domain/days.js';
import { LeaveType } from '../domain/policy/leave-type.js';
import { Policy, type PolicyId, type PolicyVersion } from '../domain/policy/policy.js';
import {
  LeaveRequest,
  type LeaveRequestId,
  type Proposal,
  type Span,
} from '../domain/request/leave-request.js';
import type {
  LeaveTypeStore,
  LedgerStore,
  PolicyStore,
  RequestRecord,
  RequestStore,
} from '../application/ports.js';
import { pageCursor } from '../application/shared.js';
import { ledgerEntry, leaveType, policy, policyVersion, request } from './tables.js';

/**
 * Leave types, policies, the ledger and requests (TOF-030, TOF-031), bound to
 * one tenant transaction. Aggregates come back through their `rehydrate`;
 * rows going out are parsed by the contract on the way back in, so a column
 * that drifted from its schema fails on read rather than in a fold.
 */

/* ---------------------------------------------------------- pg values -- */

/** Postgres prints `2026-10-01 07:00:00+00`; the contract wants ISO 8601. */
export const instantOf = (value: string): Instant =>
  Instant.parse(new Date(value.replace(' ', 'T').replace(/([+-]\d\d)$/u, '$1:00')).toISOString());

/** `{from, to}` inclusive as Postgres's canonical `[from,to+1)`. */
export const rangeOf = (r: DateRange): string => `[${r.from},${addDays(r.to, 1)})`;

/** `[2026-10-19,2026-10-24)` back to inclusive days. */
export function fromRange(text: string): DateRange {
  const [from = '', upper = ''] = text.replace(/[[\]()]/gu, '').split(',');
  return { from: CalendarDate.parse(from), to: addDays(CalendarDate.parse(upper), -1) };
}

/** `{[a,b),[c,d)}`: a multirange's runs, in order. */
const runsOf = (text: string): DateRange[] =>
  (text.match(/\[[^)]*\)/gu) ?? []).map((r) => fromRange(r));

const multirangeOf = (runs: readonly DateRange[]): string => `{${runs.map(rangeOf).join(',')}}`;

/* --------------------------------------------------------- leave types -- */

type LeaveTypeRow = typeof leaveType.$inferSelect;

function toLeaveType(r: LeaveTypeRow): LeaveType {
  return LeaveType.rehydrate({
    definition: LeaveTypeDefinition.parse({
      key: r.key,
      name: r.name,
      category: r.category,
      colorToken: r.colorToken,
      icon: r.icon,
      unit: r.unit,
      tracked: r.tracked,
      paid: r.paid,
      approvalRuleKey: r.approvalRuleKey,
      visibility: r.visibility,
      requiresNote:
        r.requiresNoteAfterDays === null ? null : { afterDays: r.requiresNoteAfterDays },
      appliesTo: r.appliesTo,
      statutory: r.statutory,
    }),
    hidden: r.hiddenAt !== null,
    deleted: r.deletedAt !== null,
  });
}

/** Keep the moment it was first hidden or deleted; clear it when it no longer is. */
const since = (on: boolean, column: string): SQL | null =>
  on ? sql`coalesce(${sql.raw(`leave_type.${column}`)}, now())` : null;

export function drizzleLeaveTypes(tx: PostgresJsDatabase, tenantId: TenantId): LeaveTypeStore {
  return {
    async get(key) {
      const [row] = await tx.select().from(leaveType).where(eq(leaveType.key, key));
      return row === undefined ? null : toLeaveType(row);
    },
    async list() {
      return (
        await tx.select().from(leaveType).orderBy(asc(leaveType.createdAt), asc(leaveType.key))
      ).map(toLeaveType);
    },
    async save(t) {
      const d = t.definition;
      const values = {
        name: d.name,
        category: d.category,
        colorToken: d.colorToken,
        icon: d.icon,
        unit: d.unit,
        tracked: d.tracked,
        paid: d.paid,
        approvalRuleKey: d.approvalRuleKey,
        visibility: d.visibility,
        requiresNoteAfterDays: d.requiresNote?.afterDays ?? null,
        appliesTo: d.appliesTo,
        statutory: d.statutory,
      };
      await tx
        .insert(leaveType)
        .values({
          tenantId,
          key: d.key,
          ...values,
          hiddenAt: t.hidden ? sql`now()` : null,
          deletedAt: t.deleted ? sql`now()` : null,
        })
        .onConflictDoUpdate({
          target: [leaveType.tenantId, leaveType.key],
          set: {
            ...values,
            hiddenAt: since(t.hidden, 'hidden_at'),
            deletedAt: since(t.deleted, 'deleted_at'),
          },
        });
    },
  };
}

/* ------------------------------------------------------------ policies -- */

async function policiesWhere(
  tx: PostgresJsDatabase,
  tenantId: TenantId,
  where: SQL | undefined,
): Promise<Policy[]> {
  const rows = await tx
    .select({
      id: policy.id,
      version: policyVersion.version,
      status: policyVersion.status,
      definition: policyVersion.definition,
      effectiveFrom: policyVersion.effectiveFrom,
    })
    .from(policy)
    .innerJoin(
      policyVersion,
      and(eq(policyVersion.tenantId, policy.tenantId), eq(policyVersion.policyId, policy.id)),
    )
    .where(where)
    .orderBy(asc(policy.createdAt), asc(policy.id), asc(policyVersion.version));
  const versions = new Map<string, PolicyVersion[]>();
  for (const r of rows) {
    const list = versions.get(r.id) ?? [];
    list.push({
      version: r.version,
      status: r.status as PolicyVersion['status'],
      definition: PolicyDefinition.parse(r.definition),
      effectiveFrom: r.effectiveFrom as CalendarDate | null,
    });
    versions.set(r.id, list);
  }
  return [...versions].map(([id, vs]) =>
    Policy.rehydrate({ id: id as PolicyId, tenantId, versions: vs }),
  );
}

export function drizzlePolicies(tx: PostgresJsDatabase, tenantId: TenantId): PolicyStore {
  return {
    async get(id) {
      return (await policiesWhere(tx, tenantId, eq(policy.id, id)))[0] ?? null;
    },
    forLeaveType: (key) => policiesWhere(tx, tenantId, eq(policy.leaveTypeKey, key)),
    list: () => policiesWhere(tx, tenantId, undefined),

    /**
     * A published version is never written again: the table refuses any
     * change to one, even to the same values. A draft is written in place,
     * and published by that write.
     */
    async save(p) {
      await tx
        .insert(policy)
        .values({ tenantId, id: p.id, leaveTypeKey: p.latest.definition.leaveTypeKey })
        .onConflictDoNothing();
      const stored = new Map(
        (
          await tx
            .select({ version: policyVersion.version, status: policyVersion.status })
            .from(policyVersion)
            .where(eq(policyVersion.policyId, p.id))
        ).map((r) => [r.version, r.status]),
      );
      for (const v of p.versions) {
        if (stored.get(v.version) === 'published') continue;
        const values = {
          status: v.status,
          definition: v.definition,
          effectiveFrom: v.effectiveFrom,
          publishedAt: v.status === 'published' ? sql`now()` : null,
        };
        // oxlint-disable-next-line no-await-in-loop -- one policy's few versions, in order
        await tx
          .insert(policyVersion)
          .values({ tenantId, policyId: p.id, version: v.version, ...values })
          .onConflictDoUpdate({
            target: [policyVersion.tenantId, policyVersion.policyId, policyVersion.version],
            set: values,
          });
      }
    },
  };
}

/* -------------------------------------------------------------- ledger -- */

export function drizzleLedger(tx: PostgresJsDatabase, tenantId: TenantId): LedgerStore {
  const forMembers = async (
    personIds: readonly PersonId[],
    key?: LeaveTypeKey,
  ): Promise<LedgerEntry[]> => {
    if (personIds.length === 0) return [];
    const rows = await tx
      .select()
      .from(ledgerEntry)
      .where(
        and(
          inArray(ledgerEntry.personId, [...personIds]),
          key === undefined ? undefined : eq(ledgerEntry.leaveTypeKey, key),
        ),
      )
      .orderBy(asc(ledgerEntry.occurredAt), asc(ledgerEntry.id));
    return rows.map((r) =>
      LedgerEntry.parse({
        entryId: r.id,
        personId: r.personId,
        leaveTypeKey: r.leaveTypeKey,
        kind: r.kind,
        amount: r.amount,
        unit: r.unit,
        effectiveOn: r.effectiveOn,
        occurredAt: instantOf(r.occurredAt),
        policyVersion: r.policyVersion,
        supersedes: r.supersedes,
        requestId: r.requestId,
        reason: r.reason,
      }),
    );
  };
  return {
    forMember: (personId, key) => forMembers([personId], key),
    forMembers,
    async append(entries) {
      if (entries.length === 0) return;
      await tx.insert(ledgerEntry).values(
        entries.map((e) => ({
          tenantId,
          id: e.entryId,
          personId: e.personId,
          leaveTypeKey: e.leaveTypeKey,
          kind: e.kind,
          amount: e.amount,
          unit: e.unit,
          effectiveOn: e.effectiveOn,
          occurredAt: e.occurredAt,
          policyVersion: e.policyVersion,
          supersedes: e.supersedes,
          requestId: e.requestId,
          reason: e.reason,
        })),
      );
    },
  };
}

/* ------------------------------------------------------------ requests -- */

const requestColumns = {
  row: request,
  category: leaveType.category,
  tracked: leaveType.tracked,
  paid: leaveType.paid,
  unit: leaveType.unit,
};

type RequestRow = {
  row: typeof request.$inferSelect;
  category: string;
  tracked: boolean;
  paid: string;
  unit: string;
};

function toRecord(tenantId: TenantId, { row: r, ...type }: RequestRow): RequestRecord {
  const runs = runsOf(r.days);
  const first = runs[0];
  const last = runs.at(-1);
  if (first === undefined || last === undefined) throw new Error(`Request ${r.id} has no days`);
  const span: Span = {
    from: first.from,
    to: last.to,
    startsHalfDay: r.startsHalfDay,
    endsHalfDay: r.endsHalfDay,
    workingDays: r.workingDays as DayAmount,
  };
  const leave = LeaveTypeDefinition.pick({
    key: true,
    category: true,
    tracked: true,
    paid: true,
    unit: true,
  }).parse({ key: r.leaveTypeKey, ...type });
  return {
    request: LeaveRequest.rehydrate({
      id: r.id as LeaveRequestId,
      tenantId,
      personId: r.personId as PersonId,
      leaveType: leave,
      status: r.status as RequestStatus,
      span,
      runs,
      proposals: r.proposals as Proposal[],
      pendingChange: r.pendingChange as Span | null,
      belowZero: r.belowZero,
      sickNoteFileId: r.sickNoteFileId,
      datesEventId: r.datesEventId ?? '',
      version: r.version,
    }),
    routing: {
      chain: r.approvalChain as ApproverRole[],
      step: r.approvalStep,
      since: (r.waitingSince ?? instantOf(r.requestedAt).slice(0, 10)) as CalendarDate,
      escalatedTo: r.escalatedTo as PersonId | 'hr' | null,
    },
    note: r.note,
    requestedAt: instantOf(r.requestedAt),
    proposedBy: r.proposedBy,
    proposalMessage: r.proposalMessage,
  };
}

export function drizzleRequests(tx: PostgresJsDatabase, tenantId: TenantId): RequestStore {
  const select = () =>
    tx
      .select(requestColumns)
      .from(request)
      .innerJoin(
        leaveType,
        and(eq(leaveType.tenantId, request.tenantId), eq(leaveType.key, request.leaveTypeKey)),
      );
  return {
    async get(id) {
      const [row] = await select().where(eq(request.id, id));
      return row === undefined ? null : toRecord(tenantId, row);
    },

    /** Overlap is on the bounds, gap days included, as the in-memory store has it. */
    async list(f) {
      const rows = await select()
        .where(
          and(
            f.personIds === undefined ? undefined : inArray(request.personId, [...f.personIds]),
            f.statuses === undefined ? undefined : inArray(request.status, [...f.statuses]),
            f.from === undefined && f.to === undefined
              ? undefined
              : sql`range_merge(${request.days}) && daterange(${f.from ?? null}::date, ${f.to ?? null}::date, '[]')`,
          ),
        )
        .orderBy(asc(request.requestedAt), asc(request.id));
      return rows.map((row) => toRecord(tenantId, row));
    },

    /**
     * The keyset over `request_page_newest` or `request_page_soonest`
     * (`migrations/20261004121000_timeoff_request_pages.sql`): one more row
     * than the page says whether there is a next.
     */
    async page(f) {
      const after = pageCursor.read(f.after);
      const first = sql`lower(range_merge(${request.days}))`;
      const rows = await select()
        .where(
          and(
            f.personIds === undefined ? undefined : inArray(request.personId, [...f.personIds]),
            inArray(request.status, [...f.statuses]),
            f.from === undefined
              ? undefined
              : sql`upper(range_merge(${request.days})) > ${f.from}::date`,
            after === null
              ? undefined
              : f.order === 'newest'
                ? sql`(${request.requestedAt}, ${request.id}) < (${after.key}::timestamptz, ${after.id}::uuid)`
                : sql`(${first}, ${request.id}) > (${after.key}::date, ${after.id}::uuid)`,
          ),
        )
        .orderBy(
          ...(f.order === 'newest'
            ? [desc(request.requestedAt), desc(request.id)]
            : [asc(first), asc(request.id)]),
        )
        .limit(f.limit + 1);
      const records = rows.slice(0, f.limit).map((row) => toRecord(tenantId, row));
      const last = records.at(-1);
      return {
        records,
        next:
          rows.length > f.limit && last !== undefined
            ? pageCursor.of(
                f.order === 'newest' ? last.requestedAt : last.request.span.from,
                last.request.id,
              )
            : null,
      };
    },

    async save(record) {
      const s = record.request.snapshot;
      const values = {
        personId: s.personId,
        leaveTypeKey: s.leaveType.key,
        status: s.status,
        days: multirangeOf(s.runs),
        startsHalfDay: s.span.startsHalfDay,
        endsHalfDay: s.span.endsHalfDay,
        workingDays: s.span.workingDays,
        belowZero: s.belowZero,
        note: record.note,
        sickNoteFileId: s.sickNoteFileId,
        proposals: s.proposals,
        pendingChange: s.pendingChange,
        datesEventId: s.datesEventId === '' ? null : s.datesEventId,
        version: s.version,
        requestedAt: record.requestedAt,
        approvalChain: [...record.routing.chain],
        approvalStep: record.routing.step,
        waitingSince: record.routing.since,
        escalatedTo: record.routing.escalatedTo,
        proposedBy: record.proposedBy,
        proposalMessage: record.proposalMessage,
      };
      await tx
        .insert(request)
        .values({ tenantId, id: s.id, ...values })
        .onConflictDoUpdate({ target: [request.tenantId, request.id], set: values });
    },
  };
}
