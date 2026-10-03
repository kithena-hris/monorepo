import { describe, expect, it } from 'vitest';
import { LeaveTypeKey } from '@kithena/contracts';

import {
  answerParental,
  parentalCase,
  parentalScreen,
  sendParentalPlan,
} from '../parental/parental.js';
import { recordingWriter, shown } from '../testing/assist.js';
import { caller, d, hr, people, TENANT, world } from '../testing/world.js';

/**
 * Adam's plan (T9, T11): the other parent, due 14 January 2027, at Acme, laid
 * out by the domain with every flexible week straight after the mandatory 6.
 */
const adam = caller(people.adam);

async function planned() {
  const app = world();
  app.state(TENANT).parentalCompany = {
    extraWeeks: 2,
    afterServiceYears: 1,
    leaveTypeKey: LeaveTypeKey.parse('company_parental'),
  };
  const started = await answerParental(app.deps)(adam, {
    role: 'other_parent',
    childDate: d('2027-01-14'),
    singleParent: false,
    children: 1,
    teamSees: 'type',
  });
  if (!started.ok) throw new Error(started.error.message);
  return { app, planId: started.value.planId };
}

describe('why this plan (TOF-092)', () => {
  it('says the shape from the domain’s weeks, templated without a model', async () => {
    const { app } = await planned();
    const screen = await parentalScreen(app.deps)(adam, {});
    if (!screen.ok) throw new Error(screen.error.message);
    expect(screen.value.plan?.explanation).toEqual({
      text:
        '11 of your 11 flexible weeks follow the mandatory 6, so most of your time is at the start. ' +
        '2 weeks are kept for later. Each flexible block needs 15 days’ notice, and Kithena reminds you.',
      ai: false,
    });
  });

  it('lets a model explain it from week counts alone: no date, no name', async () => {
    const { app, planId } = await planned();
    const writer = recordingWriter(() => 'You are home for the first 17 weeks.');
    const sent = await sendParentalPlan(app.deps)(adam, planId);
    expect(sent.ok).toBe(true);
    const view = await parentalCase({ ...app.deps, writer })(hr, planId);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.plan.explanation).toEqual({
      text: 'You are home for the first 17 weeks.',
      ai: true,
    });
    const prompt = shown(writer.asks);
    for (const never of [
      '2027',
      '2026',
      'Jan',
      'Adam',
      'Novak',
      people.adam,
      'due',
      'birth date',
    ]) {
      expect(prompt).not.toContain(never);
    }
  });
});
