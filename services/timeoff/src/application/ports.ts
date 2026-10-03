import * as z from 'zod';
import { isTimeZone, type Clock, type PendingEvent } from '@kithena/domain-kit';
import {
  CalendarDate,
  CountryCode,
  LocationKey,
  PersonId,
  TeamKey,
  type Actor,
  type Instant,
  type LedgerEntry,
  type LeaveTypeKey,
  type TenantId,
} from '@kithena/contracts';

import type { ApprovalRule, ApproverRole, AutoApproval } from '../domain/approval/approval-rule.js';
import type { Delegation } from '../domain/approval/delegation.js';
import type { Punch } from '../domain/attendance/clock.js';
import type { AttendanceRules } from '../domain/attendance/day.js';
import type { PayPeriod, TimeLine } from '../domain/attendance/pay-period.js';
import type { Schedule } from '../domain/attendance/schedule.js';
import type { HolidayLayer } from '../domain/calendar/holiday-calendar.js';
import type { EventContext } from '../domain/context.js';
import type { TeamMinimum } from '../domain/coverage/coverage.js';
import type { LeaveType } from '../domain/policy/leave-type.js';
import type { Policy, PolicyId } from '../domain/policy/policy.js';
import type { LeaveRequest, LeaveRequestId } from '../domain/request/leave-request.js';
import type { CompanyParentalPolicy, ParentRole } from '../domain/parental/entitlement.js';
import type { ParentalPlanId, PlanBlock, PlanStatus } from '../domain/parental/plan.js';

/**
 * What the Time Off use cases read and write through, and nothing wider.
 *
 * Every store is reached through `UnitOfWork.run`, which hands out the stores
 * bound to one tenant transaction: `app.tenant_id` lives as long as the
 * transaction that set it (People's `unit-of-work.ts`), so a store that opened
 * its own would see an empty tenant. The Drizzle adapters (TOF-034) bind each
 * store to the transaction; the in-memory ones in `testing/` ignore it.
 */

/** Somebody asking: their account, the person they sign in as, and the request's correlation. */
export interface Caller {
  readonly tenantId: TenantId;
  readonly accountId: string;
  /** `null` for an HR account that is not itself a member. */
  readonly personId: PersonId | null;
  readonly correlationId: string;
}

/* ---------------------------------------------------------------- member -- */

/**
 * The projection of a person that Time Off keeps (PRD §5.2): the fields a
 * People event or an import row carries, validated here because both are
 * boundaries.
 */
export const MemberFields = z.object({
  personId: PersonId,
  /**
   * The identity account the member signs in with; `null` for somebody who
   * has none. A checked string rather than `z.uuid()`, under which TS 7 loses
   * this object's inferred type (the subgraph and the tests stop compiling).
   */
  accountId: z.string().check(z.uuid()).nullable().default(null),
  displayName: z.string().trim().min(1).max(200),
  firstName: z.string().trim().min(1).max(100),
  /**
   * Where messaging reaches the member (a nudge, TOF-098); `null` until People
   * or an import says. Checked as the account id is, for TS 7's sake.
   */
  workEmail: z.string().check(z.email()).nullable().default(null),
  managerPersonId: PersonId.nullable().default(null),
  teamKey: TeamKey.nullable().default(null),
  teamName: z.string().trim().max(200).nullable().default(null),
  locationKey: LocationKey.nullable().default(null),
  country: CountryCode.nullable().default(null),
  region: z.string().trim().max(100).nullable().default(null),
  city: z.string().trim().max(100).nullable().default(null),
  /** The zone whose calendar decides the member's "today". */
  timeZone: z
    .string()
    .refine((tz) => tz === 'UTC' || isTimeZone(tz), 'not a time zone')
    .default('UTC'),
  hireDate: CalendarDate,
  terminationDate: CalendarDate.nullable().default(null),
  /** ISO weekdays worked; `null` takes the default, Monday to Friday. */
  workPattern: z.array(z.int().min(1).max(7)).min(1).nullable().default(null),
  status: z.enum(['active', 'on_leave', 'left']).default('active'),
});
export type MemberFields = z.infer<typeof MemberFields>;

export type Member = MemberFields & {
  /** The last event applied, for idempotency, and its effective date, for order (TOF-029). */
  readonly lastEventId: string | null;
  readonly lastEffectiveFrom: CalendarDate | null;
};

export interface MemberStore {
  get(personId: PersonId): Promise<Member | null>;
  list(filter?: { readonly teamKey?: TeamKey }): Promise<readonly Member[]>;
  /** The member signing in as this account, when exactly one does. */
  byAccount(accountId: string): Promise<Member | null>;
  save(member: Member): Promise<void>;
}

/**
 * A work location as People's `people.location.*` events describe it
 * (TOF-045): how a member's location, which People names by id, becomes the
 * country and zone the projection keeps.
 */
export interface Location {
  readonly locationKey: LocationKey;
  readonly name: string;
  readonly country: MemberFields['country'];
  readonly timeZone: string;
}

export interface LocationStore {
  get(locationKey: LocationKey): Promise<Location | null>;
  save(location: Location): Promise<void>;
}

/* ---------------------------------------------------------------- policy -- */

export interface LeaveTypeStore {
  get(key: LeaveTypeKey): Promise<LeaveType | null>;
  list(): Promise<readonly LeaveType[]>;
  save(leaveType: LeaveType): Promise<void>;
}

export interface PolicyStore {
  get(id: PolicyId): Promise<Policy | null>;
  /** Every policy for a leave type, oldest first; `appliesTo` picks among them. */
  forLeaveType(key: LeaveTypeKey): Promise<readonly Policy[]>;
  list(): Promise<readonly Policy[]>;
  save(policy: Policy): Promise<void>;
}

/** Append-only (TOF-030 revokes UPDATE and DELETE). */
export interface LedgerStore {
  forMember(personId: PersonId, leaveTypeKey?: LeaveTypeKey): Promise<readonly LedgerEntry[]>;
  append(entries: readonly LedgerEntry[]): Promise<void>;
}

/* --------------------------------------------------------------- request -- */

/** Where a request sits in its approval chain, which the aggregate does not hold. */
export interface Routing {
  /** The roles still to approve, in order (`resolveApprovers`). */
  readonly chain: readonly ApproverRole[];
  /** The index in `chain` waiting now. */
  readonly step: number;
  /** The day it started waiting at this step, which escalation counts from. */
  readonly since: CalendarDate;
  /** Set once nobody decided in time (§9.7): the approver's manager, or HR. */
  readonly escalatedTo: PersonId | 'hr' | null;
}

export interface RequestRecord {
  readonly request: LeaveRequest;
  readonly routing: Routing;
  readonly note: string | null;
  readonly requestedAt: Instant;
  /** The account that suggested other dates, which approves them when accepted. */
  readonly proposedBy: string | null;
}

export interface RequestStore {
  get(id: LeaveRequestId): Promise<RequestRecord | null>;
  /**
   * Requests overlapping `from`–`to` (any, when absent), for some members (all,
   * when absent), in any of `statuses` (all, when absent).
   */
  list(filter: {
    readonly personIds?: readonly PersonId[];
    readonly statuses?: readonly LeaveRequest['status'][];
    readonly from?: CalendarDate;
    readonly to?: CalendarDate;
  }): Promise<readonly RequestRecord[]>;
  save(record: RequestRecord): Promise<void>;
}

/* -------------------------------------------------------------- settings -- */

export interface ApprovalStore {
  rules(): Promise<readonly ApprovalRule[]>;
  setRules(rules: readonly ApprovalRule[]): Promise<void>;
  autoApproval(): Promise<AutoApproval>;
  setAutoApproval(auto: AutoApproval): Promise<void>;
  /** The approver's delegation, one each. */
  delegation(approverId: PersonId): Promise<Delegation | null>;
  saveDelegation(delegation: Delegation): Promise<void>;
  removeDelegation(approverId: PersonId): Promise<void>;
  teamMinimum(teamKey: TeamKey): Promise<TeamMinimum | null>;
  setTeamMinimum(teamKey: TeamKey, minimum: TeamMinimum | null): Promise<void>;
}

/** Layered calendars, and which layers each work location gets (§10.2). */
export interface HolidayStore {
  layers(): Promise<readonly HolidayLayer[]>;
  saveLayer(layer: HolidayLayer): Promise<void>;
  removeLayer(key: string): Promise<void>;
  /** The layer keys a location observes, most general first. */
  assigned(locationKey: LocationKey): Promise<readonly string[]>;
  assign(locationKey: LocationKey, layerKeys: readonly string[]): Promise<void>;
}

/** An overtime day a manager decided (§11.6). */
export interface OvertimeDecision {
  readonly personId: PersonId;
  readonly date: CalendarDate;
  readonly minutes: number;
  readonly outcome: 'comp' | 'paid' | 'declined';
  readonly decidedBy: string;
}

/** Punches are append-only (TOF-033); periods lock when closed. */
export interface AttendanceStore {
  punches(personId: PersonId): Promise<readonly Punch[]>;
  appendPunch(personId: PersonId, punch: Punch): Promise<void>;
  /** The member's own schedule, or `null` for the tenant default. */
  schedule(personId: PersonId): Promise<Schedule | null>;
  setSchedule(personId: PersonId, schedule: Schedule): Promise<void>;
  rules(): Promise<AttendanceRules>;
  setRules(rules: AttendanceRules): Promise<void>;
  periods(): Promise<readonly PayPeriod[]>;
  savePeriod(period: PayPeriod): Promise<void>;
  lines(): Promise<readonly TimeLine[]>;
  appendLine(line: TimeLine): Promise<void>;
  overtime(personId: PersonId): Promise<readonly OvertimeDecision[]>;
  decideOvertime(decision: OvertimeDecision): Promise<void>;
}

/* -------------------------------------------------------------- parental -- */

/** Who covers one piece of the parent's work while they are away (T10, manual for now). */
export interface HandoverItem {
  readonly work: string;
  readonly coveredBy: string;
}

/**
 * A parental plan as stored (PRD §12): the aggregate's state, plus what only
 * the application holds — what teammates see, the handover, and when it was
 * sent and approved. The answers keep the company's policy as it was when
 * they were given, and the country whose pack decided the law; the member's
 * hire date and calendar are read again when the plan is loaded.
 */
export interface StoredPlan {
  readonly id: ParentalPlanId;
  readonly personId: PersonId;
  readonly status: PlanStatus;
  readonly country: NonNullable<MemberFields['country']>;
  readonly role: ParentRole;
  /** The due date, the decision, or the birth once recorded. */
  readonly childDate: CalendarDate;
  readonly dueDate: CalendarDate | null;
  readonly birth: CalendarDate | null;
  readonly singleParent: boolean;
  readonly children: number;
  readonly company: CompanyParentalWeeks | null;
  readonly blocks: readonly PlanBlock[];
  readonly version: number;
  /** Teammates see "Parental leave", or just "Away"; HR and the manager always see the type. */
  readonly teamSees: 'type' | 'away';
  readonly handover: readonly HandoverItem[];
  readonly sentAt: Instant | null;
  readonly approvedAt: Instant | null;
  readonly approvedBy: string | null;
}

/** The company's own parental weeks (T8: "Acme adds 2 paid weeks"), booked as one leave type. */
export interface CompanyParentalWeeks extends CompanyParentalPolicy {
  readonly leaveTypeKey: LeaveTypeKey;
}

export interface ParentalStore {
  get(id: ParentalPlanId): Promise<StoredPlan | null>;
  /** Newest first. */
  list(filter: {
    readonly personId?: PersonId;
    readonly statuses?: readonly PlanStatus[];
  }): Promise<readonly StoredPlan[]>;
  save(plan: StoredPlan): Promise<void>;
  company(): Promise<CompanyParentalWeeks | null>;
  setCompany(weeks: CompanyParentalWeeks): Promise<void>;
}

/** A policy's draft running beside the version in effect, for a month (PRD §6.3, TOF-093). */
export interface PolicyShadow {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

/** The small tenant settings kept as one document each, by key. */
export interface Settings {
  /** Shadow runs, by policy id. */
  readonly policy_shadows: Readonly<Record<string, PolicyShadow>>;
  /** The smallest group a report may describe, as People last said (`people.settings.changed`). */
  readonly cohort_minimum: { readonly value: number };
}

export interface SettingStore {
  get<K extends keyof Settings>(key: K): Promise<Settings[K] | null>;
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
}

/** The revocation counter behind a calendar feed token (§10.1). */
export interface FeedStore {
  version(personId: PersonId): Promise<number>;
  bump(personId: PersonId): Promise<number>;
}

/** The transactional outbox: written in the same transaction as the change. */
export interface Outbox {
  publish(events: readonly PendingEvent[]): Promise<void>;
}

/**
 * A REST write's `Idempotency-Key` (TOF-046), saved in the write's own
 * transaction, so the write and the record of it commit together or not at
 * all — People's rule. `answer` is the body the write answered with: a retry
 * is answered with it rather than run again.
 */
export interface StoredKey {
  readonly requestHash: string;
  readonly status: number;
  readonly answer: unknown;
}

export interface IdempotencyStore {
  find(key: string): Promise<StoredKey | null>;
  /** False when another request committed this key first. */
  save(key: string, stored: StoredKey): Promise<boolean>;
}

/** Every store, bound to one tenant transaction. */
export interface Tx {
  readonly tenantId: TenantId;
  readonly members: MemberStore;
  readonly locations: LocationStore;
  readonly leaveTypes: LeaveTypeStore;
  readonly policies: PolicyStore;
  readonly ledger: LedgerStore;
  readonly requests: RequestStore;
  readonly approvals: ApprovalStore;
  readonly holidays: HolidayStore;
  readonly attendance: AttendanceStore;
  readonly feeds: FeedStore;
  readonly parental: ParentalStore;
  readonly settings: SettingStore;
  readonly outbox: Outbox;
  readonly idempotency: IdempotencyStore;
}

export interface UnitOfWork {
  /** Commits when `fn` resolves, rolls back when it throws. */
  run<R>(tenantId: TenantId, fn: (tx: Tx) => Promise<R>): Promise<R>;
}

/* --------------------------------------------------------- authorization -- */

/**
 * The relations TOF-048's OpenFGA model defines: `approver`, `delegate` and
 * `teammate` on `member:<personId>`, `hr_admin` on `tenant:<tenantId>`.
 */
export type Relation = 'approver' | 'delegate' | 'hr_admin' | 'teammate';

/** OpenFGA's `Check`, as one question. */
export interface Authorizer {
  check(
    tenantId: TenantId,
    tuple: {
      readonly user: `person:${string}` | `account:${string}`;
      readonly relation: Relation;
      readonly object: `member:${string}` | `tenant:${string}`;
    },
  ): Promise<boolean>;
}

/* ------------------------------------------------------- timers, notices -- */

/**
 * The escalation clock of a pending request (TOF-039). The Temporal adapter
 * starts one workflow per request; called after the transaction commits.
 */
export interface ApprovalTimers {
  started(tenantId: TenantId, requestId: LeaveRequestId, correlationId: string): Promise<void>;
  closed(tenantId: TenantId, requestId: LeaveRequestId): Promise<void>;
}

/** What Time Off tells a person, by whatever channel messaging chooses. */
export type Notice =
  | { readonly kind: 'approval_waiting'; readonly requestId: string; readonly reminder: boolean }
  | { readonly kind: 'approval_escalated'; readonly requestId: string }
  | {
      readonly kind: 'use_it_or_lose_it';
      readonly leaveTypeKey: LeaveTypeKey;
      readonly left: string;
      readonly carries: string;
    }
  | { readonly kind: 'missed_clock_out'; readonly date: CalendarDate }
  | { readonly kind: 'overtime_waiting'; readonly personId: PersonId; readonly date: CalendarDate }
  | { readonly kind: 'still_clocked_in' }
  | { readonly kind: 'parental_plan_sent'; readonly planId: string }
  | {
      readonly kind: 'parental_notice_due';
      readonly planId: string;
      readonly blockFrom: CalendarDate;
    }
  | {
      readonly kind: 'negative_on_leaving';
      readonly leaveTypeKey: LeaveTypeKey;
      readonly days: string;
    };

/**
 * A nudge to rest (T28, TOF-098), through `platform/messaging` over internal
 * HTTP as identity's invitation is: the recipient's address, a link on their
 * company's own origin, and words carrying only their own figures. Rejects
 * when messaging refuses it.
 */
export interface NudgeMailer {
  send(
    tenantId: TenantId,
    message: {
      readonly email: string;
      readonly url: string;
      readonly companyName: string;
      readonly dedupeKey: string;
      readonly heading: string;
      readonly lede: string;
    },
  ): Promise<void>;
}

export interface Notifier {
  /** At most once per `dedupeKey`, so a job run twice tells nobody twice. */
  notify(tenantId: TenantId, to: PersonId | 'hr', notice: Notice, dedupeKey: string): Promise<void>;
}

/* ------------------------------------------------------------------ deps -- */

/** What every use case is built from. */
export interface Deps {
  readonly uow: UnitOfWork;
  readonly authz: Authorizer;
  readonly clock: Clock;
  /** UUIDv7 in production; deterministic in tests. */
  readonly newId: () => string;
  readonly timers: ApprovalTimers;
  readonly notifier: Notifier;
  /** Signs calendar feed tokens. */
  readonly feedSecret: string;
  /** Messaging's door for nudges; absent, nudges are refused as unavailable. */
  readonly mailer?: NudgeMailer;
}

export const userActor = (caller: Caller): Actor => ({ kind: 'user', userId: caller.accountId });
export const systemActor = (process: string): Actor => ({ kind: 'system', process });

/** The domain's context for one transition. */
export function contextFor(
  deps: Pick<Deps, 'clock' | 'newId'>,
  actor: Actor,
  correlationId: string,
  timeZone: string,
): EventContext {
  return {
    clock: deps.clock,
    newId: deps.newId,
    actor,
    correlationId,
    causationId: null,
    timeZone,
  };
}
