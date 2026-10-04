import { ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import { LeaveTypeKey, type CalendarDate } from '@kithena/contracts';

import { es } from '../../country-packs/es.js';
import { workingDays, type WorkCalendar } from '../../domain/calendar/working-days.js';
import { addDays } from '../../domain/days.js';
import {
  parentalEntitlement,
  type EntitlementAnswers,
  type ParentalEntitlement,
  type ParentalRules,
  type ParentRole,
} from '../../domain/parental/entitlement.js';
import {
  ParentalPlan,
  parentalPlanId,
  type ParentalPlanId,
  type PlanBlock,
} from '../../domain/parental/plan.js';
import { explainPlan, planTemplate } from '../assist/plan.js';
import { templated } from '../assist/written.js';
import { memberView } from '../screens/employee.js';
import type {
  ParentalCasesView,
  ParentalCaseView,
  ParentalEntitlementView,
  ParentalPlanView,
  ParentalScreenView,
} from '../screens/views.js';
import {
  contextFor,
  userActor,
  type Caller,
  type CompanyParentalWeeks,
  type Deps,
  type HandoverItem,
  type Member,
  type StoredPlan,
  type Tx,
} from '../ports.js';
import {
  calendarOf,
  forbidden,
  isHrAdmin,
  notFound,
  refuse,
  relates,
  self,
  transact,
} from '../shared.js';

/**
 * Parental leave (PRD §12, TOF-102): the parent answers four questions, lays
 * the plan out, hands their work over and sends it; HR checks it against the
 * rules and approves; the birth, once recorded, moves the mandatory weeks.
 *
 * Every number is the domain's (`domain/parental/`). What only the
 * application holds — what teammates see, the handover, when it was sent —
 * rides beside the aggregate in a `StoredPlan`. **A draft is private**
 * (§12.4): nobody but the parent reads it, HR included, until it is sent.
 */

type ReadDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'writer'>;
type WriteDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'notifier'>;

/** The parental rules of each country with a pack. A second country is a second entry. */
const PACKS: Readonly<Record<string, ParentalRules>> = { ES: es.parental };

/** The statutory weeks and the vacation earned while away, booked as the pack's own types. */
const STATUTORY = LeaveTypeKey.parse('parental');
const VACATION = LeaveTypeKey.parse('vacation');

export interface ParentalAnswers {
  readonly role: ParentRole;
  /** The due date, or the adoption or fostering decision. */
  readonly childDate: CalendarDate;
  readonly singleParent: boolean;
  readonly children: number;
}

/* -------------------------------------------------------------- loading -- */

function answersOf(
  stored: Pick<StoredPlan, 'role' | 'childDate' | 'singleParent' | 'children' | 'company'>,
  pack: ParentalRules,
  member: Member,
): EntitlementAnswers {
  return {
    role: stored.role,
    childDate: stored.childDate,
    singleParent: stored.singleParent,
    children: stored.children,
    pack,
    company: stored.company,
    hiredOn: member.hireDate,
  };
}

/** The member's working week and holidays over everything a plan can reach. */
const planCalendar = (tx: Tx, member: Member, e: ParentalEntitlement): Promise<WorkCalendar> =>
  calendarOf(tx, member, e.startsFrom, e.laterBefore);

interface Loaded {
  readonly stored: StoredPlan;
  readonly plan: ParentalPlan;
  readonly member: Member;
  readonly calendar: WorkCalendar;
}

async function load(tx: Tx, stored: StoredPlan): Promise<Result<Loaded>> {
  const member = await tx.members.get(stored.personId);
  const pack = PACKS[stored.country];
  if (member === null || pack === undefined) return notFound('Parental plan');
  const answers = answersOf(stored, pack, member);
  const calendar = await planCalendar(tx, member, parentalEntitlement(answers));
  const plan = ParentalPlan.rehydrate({
    id: stored.id,
    tenantId: tx.tenantId,
    personId: stored.personId,
    answers,
    calendar,
    blocks: stored.blocks,
    status: stored.status,
    dueDate: stored.dueDate,
    birth: stored.birth,
    version: stored.version,
  });
  return ok({ stored, plan, member, calendar });
}

/** The plan as it now is, with what the application keeps beside it. */
const restored = (l: Loaded, extra: Partial<StoredPlan> = {}): StoredPlan => ({
  ...l.stored,
  status: l.plan.status,
  childDate: l.plan.answers.childDate,
  birth: l.plan.birth,
  blocks: l.plan.blocks,
  version: l.plan.version,
  ...extra,
});

/** Writes the plan and publishes what it raised, in the caller's transaction. */
async function persist(tx: Tx, plan: ParentalPlan, stored: StoredPlan): Promise<void> {
  await tx.parental.save(stored);
  await tx.outbox.publish(plan.drainEvents());
}

/**
 * The caller's plan: their own, at any status, or — for HR and the manager —
 * one that has been sent. A draft is the parent's alone.
 */
async function reachable(
  deps: Pick<Deps, 'authz'>,
  tx: Tx,
  caller: Caller,
  planId: ParentalPlanId,
): Promise<Result<StoredPlan & { readonly mine: boolean; readonly hr: boolean }>> {
  const stored = await tx.parental.get(planId);
  if (stored === null) return notFound('Parental plan');
  const mine = caller.personId === stored.personId;
  const hr = await isHrAdmin(deps, caller);
  if (mine) return ok({ ...stored, mine, hr });
  if (stored.status === 'draft') return notFound('Parental plan');
  if (hr || (await relates(deps, caller, 'approver', stored.personId)))
    return ok({ ...stored, mine, hr });
  return forbidden();
}

/* ------------------------------------------------------------ defaults -- */

/**
 * The plan a new set of answers starts from: the mandatory weeks at the
 * child's date, every flexible week straight after, then the company's;
 * the later weeks kept. The parent drags it from there.
 */
function firstBlocks(
  e: ParentalEntitlement,
  childDate: CalendarDate,
  company: CompanyParentalWeeks | null,
): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  let from = childDate;
  const add = (kind: PlanBlock['kind'], weeks: number, leaveTypeKey: LeaveTypeKey): void => {
    if (weeks <= 0) return;
    const to = addDays(from, weeks * 7 - 1);
    blocks.push({ kind, leaveTypeKey, from, to });
    from = addDays(to, 1);
  };
  add('mandatory', e.mandatoryWeeks, STATUTORY);
  add('flexible', e.flexibleWeeks, STATUTORY);
  if (company !== null) add('company', e.companyWeeks, company.leaveTypeKey);
  return blocks;
}

/** A block's leave type is the plan's to decide, never the browser's. */
function keyed(kind: PlanBlock['kind'], company: CompanyParentalWeeks | null): LeaveTypeKey {
  if (kind === 'vacation') return VACATION;
  if (kind === 'company') return company?.leaveTypeKey ?? STATUTORY;
  return STATUTORY;
}

/* -------------------------------------------------------------- writes -- */

/**
 * T8: the four answers and what teammates see. The first answers start a
 * draft laid out from the entitlement; new answers to a draft lay it out
 * again, unless they change nothing the entitlement reads. A plan with HR is
 * not answered again: it is HR's to approve as sent.
 */
export const answerParental =
  (deps: WriteDeps) =>
  (
    caller: Caller,
    input: ParentalAnswers & { readonly teamSees: StoredPlan['teamSees'] },
  ): Promise<Result<{ planId: ParentalPlanId }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const me = await self(tx, caller);
      if (!me.ok) return me;
      const member = me.value;
      const pack = member.country === null ? undefined : PACKS[member.country];
      if (member.country === null || pack === undefined) {
        return refuse('NO_COUNTRY_PACK', 'Parental leave is not planned for your country yet');
      }
      const [latest] = await tx.parental.list({ personId: member.personId });
      if (latest?.status === 'submitted') {
        return refuse('INVALID_TRANSITION', 'Your plan is with HR; it is answered as sent');
      }
      const draft = latest?.status === 'draft' ? latest : null;
      const company = await tx.parental.company();
      const answers = answersOf({ ...input, company }, pack, member);
      const entitlement = parentalEntitlement(answers);
      const same =
        draft !== null &&
        draft.role === input.role &&
        draft.childDate === input.childDate &&
        draft.singleParent === input.singleParent &&
        draft.children === input.children;
      const stored: StoredPlan = {
        id: draft?.id ?? parentalPlanId(deps.newId()),
        personId: member.personId,
        status: 'draft',
        country: member.country,
        role: input.role,
        childDate: input.childDate,
        dueDate: input.role === 'adopting' ? null : input.childDate,
        birth: null,
        singleParent: input.singleParent,
        children: input.children,
        company,
        blocks: same ? draft.blocks : firstBlocks(entitlement, input.childDate, company),
        version: 0,
        teamSees: input.teamSees,
        handover: draft?.handover ?? [],
        sentAt: null,
        approvedAt: null,
        approvedBy: null,
      };
      await tx.parental.save(stored);
      return ok({ planId: stored.id });
    });

/** T9: the blocks as the parent left them. Kept even when a rule breaks; sending checks. */
export const editParentalBlocks =
  (deps: WriteDeps) =>
  (
    caller: Caller,
    input: {
      readonly planId: ParentalPlanId;
      readonly blocks: readonly Omit<PlanBlock, 'leaveTypeKey'>[];
    },
  ): Promise<Result<{ problems: readonly DomainFailure[] }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const found = await reachable(deps, tx, caller, input.planId);
      if (!found.ok) return found;
      if (!found.value.mine) return forbidden();
      const loaded = await load(tx, found.value);
      if (!loaded.ok) return loaded;
      const { plan, stored } = loaded.value;
      const blocks = input.blocks.map((b) => ({
        ...b,
        leaveTypeKey: keyed(b.kind, stored.company),
      }));
      const replaced = plan.replaceBlocks(blocks);
      if (!replaced.ok) return replaced;
      await persist(tx, plan, restored(loaded.value));
      return ok({ problems: plan.check() });
    });

/** T10: who covers what, and what teammates see. A draft's only. */
export const saveParentalHandover =
  (deps: WriteDeps) =>
  (
    caller: Caller,
    input: {
      readonly planId: ParentalPlanId;
      readonly handover: readonly HandoverItem[];
      readonly teamSees: StoredPlan['teamSees'];
    },
  ): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const found = await reachable(deps, tx, caller, input.planId);
      if (!found.ok) return found;
      if (!found.value.mine) return forbidden();
      const { mine: _mine, hr: _hr, ...stored } = found.value;
      if (stored.status !== 'draft') {
        return refuse('INVALID_TRANSITION', 'A sent plan’s handover is HR’s to change');
      }
      await tx.parental.save({
        ...stored,
        handover: [...input.handover],
        teamSees: input.teamSees,
      });
      return ok(undefined);
    });

/**
 * T10's "Send to HR and Marco": the rules hold or nothing is sent. HR and
 * the manager are told, and `plan_submitted` goes out with the blocks.
 */
export const sendParentalPlan =
  (deps: WriteDeps) =>
  (caller: Caller, planId: ParentalPlanId): Promise<Result<{ status: 'submitted' }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const found = await reachable(deps, tx, caller, planId);
      if (!found.ok) return found;
      if (!found.value.mine) return forbidden();
      const loaded = await load(tx, found.value);
      if (!loaded.ok) return loaded;
      const { plan, member } = loaded.value;
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const sent = plan.submit(ctx);
      if (!sent.ok) return sent;
      await persist(tx, plan, restored(loaded.value, { sentAt: deps.clock.instant() }));
      const notice = { kind: 'parental_plan_sent', planId } as const;
      if (member.managerPersonId !== null) {
        await deps.notifier.notify(
          caller.tenantId,
          member.managerPersonId,
          notice,
          `parental-sent:${planId}:manager`,
        );
      }
      await deps.notifier.notify(caller.tenantId, 'hr', notice, `parental-sent:${planId}:hr`);
      return ok({ status: 'submitted' as const });
    });

/** T11's "Approve plan": HR, after the rules check, which the domain runs again. */
export const approveParentalPlan =
  (deps: WriteDeps) =>
  (caller: Caller, planId: ParentalPlanId): Promise<Result<{ status: 'approved' }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const stored = await tx.parental.get(planId);
      if (stored === null || stored.status === 'draft') return notFound('Parental plan');
      const loaded = await load(tx, stored);
      if (!loaded.ok) return loaded;
      const { plan, member } = loaded.value;
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const approved = plan.approve(caller.accountId, ctx);
      if (!approved.ok) return approved;
      await persist(
        tx,
        plan,
        restored(loaded.value, {
          approvedAt: deps.clock.instant(),
          approvedBy: caller.accountId,
        }),
      );
      return ok({ status: 'approved' as const });
    });

/**
 * The baby arrived (§12.4): the parent or HR records the date, and the
 * mandatory weeks move with it. A sent plan tells HR and the manager.
 */
export const recordParentalBirth =
  (deps: WriteDeps) =>
  (
    caller: Caller,
    input: { readonly planId: ParentalPlanId; readonly birth: CalendarDate },
  ): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const found = await reachable(deps, tx, caller, input.planId);
      if (!found.ok) return found;
      if (!found.value.mine && !found.value.hr) return forbidden();
      if (found.value.role === 'adopting') {
        return refuse('NOT_A_BIRTH', 'An adoption or fostering plan runs from the decision');
      }
      const loaded = await load(tx, found.value);
      if (!loaded.ok) return loaded;
      const { plan, member } = loaded.value;
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const recorded = plan.recordBirth(input.birth, ctx);
      if (!recorded.ok) return recorded;
      await persist(tx, plan, restored(loaded.value));
      return ok(undefined);
    });

/**
 * The notice the employer is owed before each flexible block (§12.2), told to
 * the parent on the day it falls due, for a plan HR has. Run daily; the
 * notifier's key makes a second run tell nobody twice.
 */
export const parentalNotices =
  (deps: Pick<Deps, 'uow' | 'clock' | 'notifier'>) =>
  (tenantId: Caller['tenantId']): Promise<Result<number>> =>
    transact(deps, tenantId, async (tx) => {
      let told = 0;
      for (const stored of await tx.parental.list({ statuses: ['submitted', 'approved'] })) {
        // oxlint-disable-next-line no-await-in-loop -- one transaction, a handful of plans
        const loaded = await load(tx, stored);
        if (!loaded.ok) continue;
        const today = deps.clock.date(loaded.value.member.timeZone);
        for (const r of loaded.value.plan.reminders) {
          if (r.remindOn !== today) continue;
          // oxlint-disable-next-line no-await-in-loop -- at most a block or two a day
          await deps.notifier.notify(
            tenantId,
            stored.personId,
            { kind: 'parental_notice_due', planId: stored.id, blockFrom: r.blockFrom },
            `parental-notice:${stored.id}:${r.blockFrom}`,
          );
          told += 1;
        }
      }
      return ok(told);
    });

/* --------------------------------------------------------------- reads -- */

function entitlementView(
  e: ParentalEntitlement,
  company: StoredPlan['company'],
): ParentalEntitlementView {
  return {
    law: e.law,
    mandatoryWeeks: e.mandatoryWeeks,
    flexibleWeeks: e.flexibleWeeks,
    flexibleBefore: e.flexibleBefore,
    laterWeeks: e.laterWeeks,
    laterBefore: e.laterBefore,
    startsFrom: e.startsFrom,
    paidBy: e.paidBy,
    payPercent: e.payPercent,
    companyWeeks: e.companyWeeks,
    companyAfterYears:
      company === null || company.extraWeeks === 0 ? null : company.afterServiceYears,
    vacationAccrues: e.vacationAccrues,
    noticeDays: e.noticeDays,
  };
}

function planView(l: Loaded): ParentalPlanView {
  const shaped = planShape(l);
  return { ...shaped, explanation: templated(planTemplate(shaped)) };
}

/** The plan's explanation in the model's words, once the read's transaction has closed. */
async function explained<V extends { readonly plan: ParentalPlanView | null }>(
  deps: ReadDeps,
  tenantId: Caller['tenantId'],
  read: Result<V>,
): Promise<Result<V>> {
  if (!read.ok || read.value.plan === null || deps.writer === undefined) return read;
  return ok({
    ...read.value,
    plan: {
      ...read.value.plan,
      explanation: await explainPlan(deps.writer, tenantId, read.value.plan),
    },
  });
}

function planShape(l: Loaded): Omit<ParentalPlanView, 'explanation'> {
  const { plan, stored, calendar } = l;
  const e = plan.entitlement;
  return {
    planId: plan.id,
    status: plan.status,
    role: stored.role,
    childDate: plan.answers.childDate,
    dueDate: plan.dueDate,
    birth: plan.birth,
    singleParent: stored.singleParent,
    children: stored.children,
    teamSees: stored.teamSees,
    handover: [...stored.handover],
    blocks: plan.blocks
      .toSorted((a, b) => a.from.localeCompare(b.from))
      .map((b) => {
        const statutory = b.kind === 'mandatory' || b.kind === 'flexible' || b.kind === 'later';
        return {
          kind: b.kind,
          leaveTypeKey: b.leaveTypeKey,
          from: b.from,
          to: b.to,
          workingDays: workingDays(
            { from: b.from, to: b.to, startsHalfDay: false, endsHalfDay: false },
            calendar,
          ),
          paidBy: statutory ? e.paidBy : 'employer',
          payPercent: statutory ? e.payPercent : 100,
        };
      }),
    keptWeeks: plan.keptWeeks,
    reminders: [...plan.reminders],
    problems: plan.check().map((p) => ({ code: p.code, message: p.message })),
    entitlement: entitlementView(e, stored.company),
    sentAt: stored.sentAt,
    approvedAt: stored.approvedAt,
  };
}

const managerOf = async (tx: Tx, member: Member): Promise<string | null> =>
  member.managerPersonId === null
    ? null
    : ((await tx.members.get(member.managerPersonId))?.displayName ?? null);

/**
 * T8–T10, MT11, MT12: the caller's newest plan, and the entitlement the
 * answers asked about would give, worked out and saved nowhere.
 */
export const parentalScreen =
  (deps: ReadDeps) =>
  async (caller: Caller, ask: Partial<ParentalAnswers>): Promise<Result<ParentalScreenView>> =>
    explained(
      deps,
      caller.tenantId,
      await transact<ParentalScreenView>(deps, caller.tenantId, async (tx) => {
        const member = caller.personId === null ? null : await tx.members.get(caller.personId);
        if (member === null) {
          return ok({
            member: null,
            managerName: null,
            supported: false,
            plan: null,
            preview: null,
          });
        }
        const pack = member.country === null ? undefined : PACKS[member.country];
        const [latest] = await tx.parental.list({ personId: member.personId });
        const loaded = latest === undefined ? null : await load(tx, latest);
        let preview: ParentalEntitlementView | null = null;
        if (pack !== undefined && ask.role !== undefined && ask.childDate !== undefined) {
          const company = await tx.parental.company();
          const answers = answersOf(
            {
              role: ask.role,
              childDate: ask.childDate,
              singleParent: ask.singleParent ?? false,
              children: ask.children ?? 1,
              company,
            },
            pack,
            member,
          );
          preview = entitlementView(parentalEntitlement(answers), company);
        }
        return ok({
          member: memberView(member),
          managerName: await managerOf(tx, member),
          supported: pack !== undefined,
          plan: loaded?.ok === true ? planView(loaded.value) : null,
          preview,
        });
      }),
    );

/**
 * T11: the case for HR, and for the manager, once it is sent. The checklist
 * links what belongs to modules this one is not (Payroll, Benefits) rather
 * than doing it; the birth certificate is asked for 3 days after the due date.
 */
/**
 * HR's list of cases (TOF-099c): every sent plan, waiting for HR first then
 * approved, newest first in each, with who it is and when they are away. A
 * draft is the parent's own and never listed. HR only.
 */
export const parentalCases =
  (deps: ReadDeps) =>
  (caller: Caller): Promise<Result<ParentalCasesView>> =>
    transact<ParentalCasesView>(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const plans = await tx.parental.list({ statuses: ['submitted', 'approved'] });
      const cases: ParentalCasesView['cases'][number][] = [];
      for (const p of plans) {
        const member = await tx.members.get(p.personId);
        if (member === null) continue;
        const booked = p.blocks.filter((b) => b.kind !== 'later');
        cases.push({
          planId: p.id,
          personId: p.personId,
          displayName: member.displayName,
          teamName: member.teamName,
          status: p.status === 'approved' ? 'approved' : 'submitted',
          sentAt: p.sentAt,
          from: booked.map((b) => b.from).toSorted()[0] ?? null,
          to:
            booked
              .map((b) => b.to)
              .toSorted()
              .at(-1) ?? null,
        });
      }
      return ok({
        cases: cases.toSorted(
          (a, b) =>
            (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1) ||
            (b.sentAt ?? '').localeCompare(a.sentAt ?? ''),
        ),
      });
    });

export const parentalCase =
  (deps: ReadDeps) =>
  async (caller: Caller, planId: ParentalPlanId): Promise<Result<ParentalCaseView>> =>
    explained(
      deps,
      caller.tenantId,
      await transact<ParentalCaseView>(deps, caller.tenantId, async (tx) => {
        const found = await reachable(deps, tx, caller, planId);
        if (!found.ok) return found;
        const { mine: _mine, hr, ...stored } = found.value;
        const loaded = await load(tx, stored);
        if (!loaded.ok) return loaded;
        const { plan, member } = loaded.value;
        const sent = plan.status !== 'draft';
        const rulesHold = plan.check().length === 0;
        const birthStep: ParentalCaseView['checklist'][number][] =
          stored.role === 'adopting'
            ? []
            : [
                {
                  key: 'birth_certificate',
                  status: plan.birth === null ? 'scheduled' : 'todo',
                  module: null,
                  on: plan.dueDate === null ? null : addDays(plan.dueDate, 3),
                },
              ];
        return ok({
          member: memberView(member),
          managerName: await managerOf(tx, member),
          plan: planView(loaded.value),
          checklist: [
            { key: 'entitlement', status: rulesHold ? 'done' : 'todo', module: null, on: null },
            { key: 'manager_told', status: sent ? 'done' : 'todo', module: null, on: null },
            { key: 'certificate', status: 'todo', module: null, on: null },
            { key: 'payroll', status: 'elsewhere', module: 'payroll', on: null },
            { key: 'benefits', status: 'elsewhere', module: 'benefits', on: null },
            ...birthStep,
          ],
          canApprove: hr && plan.status === 'submitted' && rulesHold,
        });
      }),
    );
