import { describe, expect, it } from 'vitest';
import { LeaveTypeKey, ParentalPlanApproved, ParentalPlanSubmitted } from '@kithena/contracts';

import { es } from '../../country-packs/es.js';
import { MONDAY_TO_FRIDAY } from '../calendar/working-days.js';
import { ADAM, context, date, TENANT } from '../fixtures.js';
import type { EntitlementAnswers } from './entitlement.js';
import { ParentalPlan, parentalPlanId, type BlockKind, type PlanBlock } from './plan.js';

const HR_ACCOUNT = '88888888-8888-7888-8888-888888888888';
const ctx = context('2026-10-01T09:00:00.000Z');

const answers: EntitlementAnswers = {
  role: 'other_parent',
  childDate: date('2027-01-14'),
  singleParent: false,
  children: 1,
  pack: es.parental,
  company: { extraWeeks: 2, afterServiceYears: 1 },
  hiredOn: date('2022-09-01'),
};

const keyOf: Record<BlockKind, string> = {
  mandatory: 'parental',
  flexible: 'parental',
  later: 'parental',
  vacation: 'vacation',
  company: 'company_parental',
};
const block = (kind: BlockKind, from: string, to: string): PlanBlock => ({
  kind,
  leaveTypeKey: LeaveTypeKey.parse(keyOf[kind]),
  from: date(from),
  to: date(to),
});

/** T9, in whole calendar weeks: 6 at the birth, 8 straight after, 4 vacation days, Acme's 2, 3 in August. */
const t9 = [
  block('mandatory', '2027-01-14', '2027-02-24'),
  block('flexible', '2027-02-25', '2027-04-21'),
  block('vacation', '2027-04-22', '2027-04-27'),
  block('company', '2027-04-28', '2027-05-11'),
  block('flexible', '2027-08-02', '2027-08-22'),
];

const draft = (blocks: readonly PlanBlock[] = t9) =>
  ParentalPlan.draft({
    id: parentalPlanId('a3f1c2d4-0000-7000-8000-0000000000aa'),
    tenantId: TENANT,
    personId: ADAM,
    answers,
    calendar: { pattern: MONDAY_TO_FRIDAY, holidays: new Set() },
    blocks,
  });

const codes = (plan: ParentalPlan) => plan.check().map((f) => f.code);
const without = (i: number) => t9.filter((_, j) => j !== i);

describe('the parental plan (PRD §12.2)', () => {
  it('Adam’s plan passes every rule and keeps 2 weeks for later', () => {
    const plan = draft();
    expect(plan.check()).toEqual([]);
    expect(plan.keptWeeks).toBe(2);
  });

  it('refuses a flexible block of 10 days: flexible weeks are whole weeks', () => {
    const plan = draft([...without(4), block('flexible', '2027-08-02', '2027-08-11')]);
    expect(codes(plan)).toEqual(['WHOLE_WEEKS']);
  });

  it('refuses a flexible block that runs past the child’s first birthday', () => {
    const plan = draft([...without(4), block('flexible', '2028-01-03', '2028-01-23')]);
    expect(codes(plan)).toEqual(['FLEXIBLE_DEADLINE']);
  });

  it('mandatory weeks start at the birth and run the full 6 weeks', () => {
    expect(codes(draft([block('mandatory', '2027-01-18', '2027-02-28')]))).toEqual([
      'MANDATORY_AT_BIRTH',
    ]);
    expect(codes(draft([block('mandatory', '2027-01-14', '2027-02-17')]))).toEqual([
      'MANDATORY_AT_BIRTH',
    ]);
    expect(codes(draft(without(0)))).toEqual(['MANDATORY_AT_BIRTH']);
  });

  it('keeps every total within the entitlement', () => {
    const plan = draft([...t9, block('flexible', '2027-09-06', '2027-09-12')]);
    expect(codes(plan)).toEqual(['OVER_ENTITLEMENT']);
    const company = draft([...without(3), block('company', '2027-04-28', '2027-05-18')]);
    expect(codes(company)).toEqual(['OVER_ENTITLEMENT']);
  });

  it('refuses blocks that overlap, and statutory weeks before the birth for the other parent', () => {
    expect(codes(draft([...t9, block('vacation', '2027-08-20', '2027-08-24')]))).toEqual([
      'OVERLAP',
    ]);
    expect(codes(draft([...without(4), block('flexible', '2026-12-31', '2027-01-13')]))).toEqual([
      'TOO_EARLY',
    ]);
  });

  it('sets a notice reminder 15 days before each flexible block', () => {
    expect(draft().reminders).toEqual([
      { blockFrom: date('2027-02-25'), remindOn: date('2027-02-10') },
      { blockFrom: date('2027-08-02'), remindOn: date('2027-07-18') },
    ]);
  });

  it('when the birth is recorded, the mandatory weeks and the blocks running on from them move', () => {
    const plan = draft();
    plan.recordBirth(date('2027-01-20'));
    expect(plan.blocks.map((b) => [b.kind, b.from, b.to])).toEqual([
      ['mandatory', '2027-01-20', '2027-03-02'],
      ['flexible', '2027-03-03', '2027-04-27'],
      ['vacation', '2027-04-28', '2027-05-03'],
      ['company', '2027-05-04', '2027-05-17'],
      ['flexible', '2027-08-02', '2027-08-22'],
    ]);
    expect(plan.entitlement.flexibleBefore).toBe(date('2028-01-20'));
    expect(plan.check()).toEqual([]);
  });

  it('submits with plan_submitted and the working days of each block', () => {
    const plan = draft();
    const submitted = plan.submit(ctx);
    expect(submitted.ok).toBe(true);
    const [event] = plan.drainEvents();
    expect(event?.eventName).toBe(ParentalPlanSubmitted.name);
    expect(event?.effectiveFrom).toBe('2027-01-14');
    const payload = ParentalPlanSubmitted.payload.parse(event?.payload);
    expect(payload.dueDate).toBe('2027-01-14');
    expect(payload.blocks.map((b) => [b.leaveTypeKey, b.workingDays])).toEqual([
      ['parental', '30.000'],
      ['parental', '40.000'],
      ['vacation', '4.000'],
      ['company_parental', '10.000'],
      ['parental', '15.000'],
    ]);
  });

  it('will not submit a plan that breaks a rule', () => {
    const plan = draft(without(0));
    const result = plan.submit(ctx);
    expect(result.ok ? null : result.error.code).toBe('MANDATORY_AT_BIRTH');
    expect(plan.drainEvents()).toEqual([]);
  });

  it('HR approves a submitted plan with plan_approved, and only a submitted one', () => {
    const plan = draft();
    const early = plan.approve(HR_ACCOUNT, ctx);
    expect(early.ok ? null : early.error.code).toBe('INVALID_TRANSITION');
    plan.submit(ctx);
    expect(plan.approve(HR_ACCOUNT, ctx).ok).toBe(true);
    expect(plan.status).toBe('approved');
    const events = plan.drainEvents();
    expect(events.map((e) => e.eventName)).toEqual([
      ParentalPlanSubmitted.name,
      ParentalPlanApproved.name,
    ]);
    expect(ParentalPlanApproved.payload.parse(events[1]?.payload).approvedBy).toBe(HR_ACCOUNT);
  });
});
