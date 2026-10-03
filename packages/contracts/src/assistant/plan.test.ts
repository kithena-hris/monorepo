import { describe, expect, it } from 'vitest';

import { AssistantPlan } from './plan.js';

/** §7.2's plan, as the model returns it. */
const managersOfSick = {
  kind: 'plan',
  steps: [
    {
      id: 's1',
      capability: 'timeoff.away',
      input: { on: 'today', filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }] },
    },
    { id: 's2', capability: 'people.managers', within: 's1', input: {} },
  ],
  answer: { kind: 'list', step: 's2' },
  say: 'Here are the managers: {n}.',
};

const step = (id: string) => ({ id, capability: 'people.find', input: {} });

describe('the plan (AST-004)', () => {
  it('reads the three kinds the model may answer with', () => {
    expect(AssistantPlan.safeParse(managersOfSick).success).toBe(true);
    expect(
      AssistantPlan.safeParse({
        kind: 'plan',
        steps: [step('s1')],
        answer: { kind: 'count', step: 's1', by: 'department' },
      }).success,
    ).toBe(true);
    expect(AssistantPlan.safeParse({ kind: 'unclear', reply: 'Not sure.' }).success).toBe(true);
    expect(AssistantPlan.safeParse({ kind: 'unavailable', module: 'timeoff' }).success).toBe(true);
    expect(AssistantPlan.safeParse({ kind: 'unavailable', module: 'weather' }).success).toBe(false);
  });

  it('refuses an extra key at every level', () => {
    expect(AssistantPlan.safeParse({ ...managersOfSick, why: 'x' }).success).toBe(false);
    expect(
      AssistantPlan.safeParse({
        ...managersOfSick,
        steps: [{ ...step('s1'), limit: 5 }],
      }).success,
    ).toBe(false);
    expect(
      AssistantPlan.safeParse({
        ...managersOfSick,
        answer: { kind: 'list', step: 's2', by: 'team' },
      }).success,
    ).toBe(false);
    expect(AssistantPlan.safeParse({ kind: 'unclear', reply: 'x', say: 'y' }).success).toBe(false);
    expect(
      AssistantPlan.safeParse({ kind: 'unavailable', module: 'people', reply: 'x' }).success,
    ).toBe(false);
  });

  it('refuses five steps, none, or a step id beyond s4', () => {
    const plan = (steps: unknown[]) => ({
      kind: 'plan',
      steps,
      answer: { kind: 'list', step: 's1' },
    });
    expect(AssistantPlan.safeParse(plan(['s1', 's2', 's3', 's4'].map(step))).success).toBe(true);
    expect(AssistantPlan.safeParse(plan(['s1', 's2', 's3', 's4', 's4'].map(step))).success).toBe(
      false,
    );
    expect(AssistantPlan.safeParse(plan([])).success).toBe(false);
    expect(AssistantPlan.safeParse(plan([step('s5')])).success).toBe(false);
  });

  it('holds say to 240 and a reply to 500', () => {
    expect(AssistantPlan.safeParse({ ...managersOfSick, say: 'x'.repeat(241) }).success).toBe(
      false,
    );
    expect(AssistantPlan.safeParse({ kind: 'unclear', reply: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('takes a capability by its name, not by anything else', () => {
    expect(
      AssistantPlan.safeParse({ ...managersOfSick, steps: [{ ...step('s1'), capability: 'find' }] })
        .success,
    ).toBe(false);
  });
});
