import { describe, expect, it } from 'vitest';
import {
  LeaveTypeKey,
  ParentalBirthRecorded,
  ParentalPlanApproved,
  ParentalPlanSubmitted,
} from '@kithena/contracts';

import type { ParentalPlanId } from '../../domain/parental/plan.js';
import { ADA_ACCOUNT, caller, d, hr, people, TENANT, world } from '../testing/world.js';
import {
  answerParental,
  approveParentalPlan,
  editParentalBlocks,
  parentalCase,
  parentalNotices,
  parentalScreen,
  recordParentalBirth,
  saveParentalHandover,
  sendParentalPlan,
} from './parental.js';

/**
 * Adam plans his parental leave (PRD §12, T8–T11): the other parent, due 14
 * January 2027, two parents, one baby, at Acme, which adds 2 paid weeks after
 * a year's service. Marco is told when he sends it; Ada approves.
 */

const adam = caller(people.adam);
const marco = caller(people.marco);
const omar = caller(people.omar);

const answers = {
  role: 'other_parent' as const,
  childDate: d('2027-01-14'),
  singleParent: false,
  children: 1,
  teamSees: 'type' as const,
};

function acme() {
  const app = world();
  app.state(TENANT).parentalCompany = {
    extraWeeks: 2,
    afterServiceYears: 1,
    leaveTypeKey: LeaveTypeKey.parse('company_parental'),
  };
  return app;
}

async function started(app = acme()): Promise<{ app: typeof app; planId: ParentalPlanId }> {
  const result = await answerParental(app.deps)(adam, answers);
  if (!result.ok) throw new Error(result.error.message);
  return { app, planId: result.value.planId };
}

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

describe('parental leave (TOF-102)', () => {
  it('T8: the answers give 6 + 11 + 2 weeks and Acme’s 2, before anything is saved', async () => {
    const app = acme();
    const screen = unwrap(await parentalScreen(app.deps)(adam, answers));
    expect(screen.plan).toBeNull();
    expect(screen.supported).toBe(true);
    expect(screen.managerName).toBe('Marco Ruiz');
    expect(screen.preview).toMatchObject({
      mandatoryWeeks: 6,
      flexibleWeeks: 11,
      flexibleBefore: '2028-01-14',
      laterWeeks: 2,
      companyWeeks: 2,
      companyAfterYears: 1,
      paidBy: 'social_security',
      payPercent: 100,
    });
    expect(app.state(TENANT).plans.size).toBe(0);
  });

  it('starts a private draft laid out from the entitlement, which nobody else reads', async () => {
    const { app, planId } = await started();
    const { plan } = unwrap(await parentalScreen(app.deps)(adam, {}));
    expect(plan?.status).toBe('draft');
    expect(plan?.blocks.map((b) => [b.kind, b.from, b.to, b.paidBy])).toEqual([
      ['mandatory', '2027-01-14', '2027-02-24', 'social_security'],
      ['flexible', '2027-02-25', '2027-05-12', 'social_security'],
      ['company', '2027-05-13', '2027-05-26', 'employer'],
    ]);
    expect(plan?.problems).toEqual([]);
    expect(plan?.keptWeeks).toBe(2);
    for (const who of [marco, hr]) {
      // oxlint-disable-next-line no-await-in-loop -- two callers, one after the other
      const seen = await parentalCase(app.deps)(who, planId);
      expect(seen.ok ? null : seen.error.code).toBe('NOT_FOUND');
    }
    expect(app.state(TENANT).events).toEqual([]);
  });

  it('keeps the dragged blocks when the answers change nothing the entitlement reads', async () => {
    const { app, planId } = await started();
    const moved = unwrap(
      await editParentalBlocks(app.deps)(adam, {
        planId,
        blocks: [
          { kind: 'mandatory', from: d('2027-01-14'), to: d('2027-02-24') },
          { kind: 'flexible', from: d('2027-02-25'), to: d('2027-04-21') },
          { kind: 'flexible', from: d('2027-08-02'), to: d('2027-08-22') },
        ],
      }),
    );
    expect(moved.problems).toEqual([]);
    await answerParental(app.deps)(adam, { ...answers, teamSees: 'away' });
    const { plan } = unwrap(await parentalScreen(app.deps)(adam, {}));
    expect(plan?.teamSees).toBe('away');
    expect(plan?.blocks.map((b) => b.from)).toEqual(['2027-01-14', '2027-02-25', '2027-08-02']);
    expect(plan?.reminders).toEqual([
      { blockFrom: '2027-02-25', remindOn: '2027-02-10' },
      { blockFrom: '2027-08-02', remindOn: '2027-07-18' },
    ]);
  });

  it('keeps a block that breaks a rule, says which, and will not send it', async () => {
    const { app, planId } = await started();
    const edited = unwrap(
      await editParentalBlocks(app.deps)(adam, {
        planId,
        blocks: [
          { kind: 'mandatory', from: d('2027-01-14'), to: d('2027-02-24') },
          { kind: 'flexible', from: d('2027-02-25'), to: d('2027-03-06') },
        ],
      }),
    );
    expect(edited.problems.map((p) => p.code)).toEqual(['WHOLE_WEEKS']);
    const sent = await sendParentalPlan(app.deps)(adam, planId);
    expect(sent.ok ? null : sent.error.code).toBe('WHOLE_WEEKS');
    expect(app.notices).toEqual([]);
  });

  it('nobody else edits, hands over or sends Adam’s plan', async () => {
    const { app, planId } = await started();
    for (const who of [omar, hr]) {
      // oxlint-disable-next-line no-await-in-loop -- two callers, one after the other
      const edited = await editParentalBlocks(app.deps)(who, { planId, blocks: [] });
      expect(edited.ok).toBe(false);
      // oxlint-disable-next-line no-await-in-loop -- two callers, one after the other
      const sent = await sendParentalPlan(app.deps)(who, planId);
      expect(sent.ok).toBe(false);
    }
  });

  it('sends with the handover: Marco and HR are told, plan_submitted goes out', async () => {
    const { app, planId } = await started();
    unwrap(
      await saveParentalHandover(app.deps)(adam, {
        planId,
        handover: [{ work: 'Billing v2 code reviews', coveredBy: 'Leo Martin' }],
        teamSees: 'type',
      }),
    );
    expect(unwrap(await sendParentalPlan(app.deps)(adam, planId))).toEqual({
      status: 'submitted',
    });
    expect(app.notices.map((n) => n.to)).toEqual([people.marco, 'hr']);
    expect(app.state(TENANT).events.map((e) => e.eventName)).toEqual([ParentalPlanSubmitted.name]);
    const again = await answerParental(app.deps)(adam, answers);
    expect(again.ok ? null : again.error.code).toBe('INVALID_TRANSITION');
    const handover = await saveParentalHandover(app.deps)(adam, {
      planId,
      handover: [],
      teamSees: 'away',
    });
    expect(handover.ok ? null : handover.error.code).toBe('INVALID_TRANSITION');
  });

  it('T11: HR sees the checklist, the rules check, and approves; Marco sees but cannot', async () => {
    const { app, planId } = await started();
    unwrap(await sendParentalPlan(app.deps)(adam, planId));
    const forMarco = unwrap(await parentalCase(app.deps)(marco, planId));
    expect(forMarco.canApprove).toBe(false);
    const refused = await approveParentalPlan(app.deps)(marco, planId);
    expect(refused.ok ? null : refused.error.code).toBe('FORBIDDEN');
    const omarSees = await parentalCase(app.deps)(omar, planId);
    expect(omarSees.ok ? null : omarSees.error.code).toBe('FORBIDDEN');

    const view = unwrap(await parentalCase(app.deps)(hr, planId));
    expect(view.canApprove).toBe(true);
    expect(view.plan.problems).toEqual([]);
    expect(view.checklist.map((s) => [s.key, s.status, s.module, s.on])).toEqual([
      ['entitlement', 'done', null, null],
      ['manager_told', 'done', null, null],
      ['certificate', 'todo', null, null],
      ['payroll', 'elsewhere', 'payroll', null],
      ['benefits', 'elsewhere', 'benefits', null],
      ['birth_certificate', 'scheduled', null, '2027-01-17'],
    ]);
    expect(unwrap(await approveParentalPlan(app.deps)(hr, planId))).toEqual({ status: 'approved' });
    const events = app.state(TENANT).events;
    expect(events.at(-1)?.eventName).toBe(ParentalPlanApproved.name);
    expect(ParentalPlanApproved.payload.parse(events.at(-1)?.payload).approvedBy).toBe(ADA_ACCOUNT);
    expect(unwrap(await parentalCase(app.deps)(hr, planId)).canApprove).toBe(false);
  });

  it('records the birth: the mandatory weeks move with it, and HR is told', async () => {
    const { app, planId } = await started();
    unwrap(await sendParentalPlan(app.deps)(adam, planId));
    unwrap(await recordParentalBirth(app.deps)(adam, { planId, birth: d('2027-01-20') }));
    const view = unwrap(await parentalCase(app.deps)(hr, planId));
    expect(view.plan.birth).toBe('2027-01-20');
    expect(view.plan.dueDate).toBe('2027-01-14');
    expect(view.plan.blocks[0]).toMatchObject({ kind: 'mandatory', from: '2027-01-20' });
    expect(view.checklist.at(-1)?.status).toBe('todo');
    expect(app.state(TENANT).events.at(-1)?.eventName).toBe(ParentalBirthRecorded.name);
    const twice = await recordParentalBirth(app.deps)(hr, { planId, birth: d('2027-01-21') });
    expect(twice.ok ? null : twice.error.code).toBe('BIRTH_ALREADY_RECORDED');
    const marcoRecords = await recordParentalBirth(app.deps)(marco, {
      planId,
      birth: d('2027-01-21'),
    });
    expect(marcoRecords.ok ? null : marcoRecords.error.code).toBe('FORBIDDEN');
  });

  it('reminds Adam on the day each flexible block’s notice falls due, once', async () => {
    const { app, planId } = await started();
    unwrap(
      await editParentalBlocks(app.deps)(adam, {
        planId,
        blocks: [
          { kind: 'mandatory', from: d('2027-01-14'), to: d('2027-02-24') },
          { kind: 'flexible', from: d('2027-08-02'), to: d('2027-08-22') },
        ],
      }),
    );
    unwrap(await sendParentalPlan(app.deps)(adam, planId));
    app.clock.set('2027-07-18T08:00:00.000Z');
    expect(unwrap(await parentalNotices(app.deps)(TENANT))).toBe(1);
    await parentalNotices(app.deps)(TENANT);
    expect(app.notices.filter((n) => n.notice.kind === 'parental_notice_due')).toEqual([
      expect.objectContaining({
        to: people.adam,
        notice: { kind: 'parental_notice_due', planId, blockFrom: '2027-08-02' },
      }),
    ]);
  });

  it('refuses a member whose country has no pack', async () => {
    const app = acme();
    const s = app.state(TENANT);
    const me = s.members.get(people.adam);
    if (me !== undefined) s.members.set(people.adam, { ...me, country: 'PT' });
    const result = await answerParental(app.deps)(adam, answers);
    expect(result.ok ? null : result.error.code).toBe('NO_COUNTRY_PACK');
    expect(unwrap(await parentalScreen(app.deps)(adam, answers)).supported).toBe(false);
  });
});
