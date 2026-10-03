import { describe, expect, it } from 'vitest';

import { draftPolicy } from '../admin/admin.js';
import { recordingJudge, recordingWriter } from '../testing/assist.js';
import { caller, hr, people, world } from '../testing/world.js';
import { readPolicyProse } from './policy-prose.js';

/** T32's handbook paragraph. */
const BERLIN =
  'Everyone in Berlin gets 28 days a year. New joiners can book once they pass probation, but it ' +
  'counts from their first day. They can carry 5 days into the next year if they use them before ' +
  'April. People can go up to 2 days negative if their manager and HR agree.';

describe('a policy in plain words (TOF-094)', () => {
  it('reads the paragraph into the ordinary form by Time Off’s own rules, and asks which days', async () => {
    const app = world();
    const read = await readPolicyProse(app.deps)(hr, { text: BERLIN });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.ai).toBe(false);
    expect(read.value.rules.map((r) => [r.label, r.value])).toEqual([
      ['Allowance', '28 days a year, given up front'],
      ['Starts', 'From the first day'],
      ['Carry-over', 'Up to 5 days, used by 31 Mar'],
      ['Negative', 'Up to 2 days, manager then HR'],
    ]);
    expect(read.value.question).toMatchObject({
      key: 'day_kind',
      title: '“28 days”, but which days?',
      body: { ai: false },
    });
    expect(read.value.definition).toMatchObject({
      leaveTypeKey: 'vacation',
      allowance: [{ fromYears: 0, days: '28.000' }],
      carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } },
      negativeBalance: { limit: '2.000', approvers: 'manager_then_hr' },
    });
    expect(read.value.problems).toEqual([]);
  });

  it('counts calendar days as working days, and lets HR change what it understood', async () => {
    const app = world();
    const read = await readPolicyProse(app.deps)(hr, {
      text: BERLIN,
      dayKind: 'calendar',
      carryOver: '0',
      negative: '3',
    });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.rules[0]?.value).toBe('20 days a year, given up front (28 calendar days)');
    expect(read.value.question).toMatchObject({ key: 'earning' });
    expect(read.value.definition).toMatchObject({
      allowance: [{ days: '20.000' }],
      carryOver: null,
      negativeBalance: { limit: '3.000' },
    });
  });

  it('creates nothing until the definition goes to the ordinary draft, which the domain validates', async () => {
    const app = world();
    const read = await readPolicyProse(app.deps)(hr, { text: BERLIN, dayKind: 'working' });
    if (!read.ok || read.value.definition === null) throw new Error('not read');
    const before = app.state(hr.tenantId).policies.size;
    const drafted = await draftPolicy(app.deps)(hr, read.value.definition);
    expect(drafted.ok).toBe(true);
    expect(app.state(hr.tenantId).policies.size).toBe(before + 1);
  });

  it('says when the text gives no allowance, and is HR’s alone', async () => {
    const app = world();
    const read = await readPolicyProse(app.deps)(hr, { text: 'People can carry 5 days over.' });
    expect(read.ok && read.value.problems).toEqual([
      { path: 'allowance', message: 'The text does not say how many days a year people get.' },
    ]);
    expect(read.ok && read.value.definition).toBeNull();
    const adam = await readPolicyProse(app.deps)(caller(people.adam), { text: BERLIN });
    expect(adam).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('lets TypeSafe say what each figure sets, and a model ask the question', async () => {
    const app = world();
    const judge = recordingJudge((id) =>
      id === 'figure_0'
        ? 'allowance'
        : id === 'figure_1'
          ? 'carry_over'
          : id === 'figure_2'
            ? 'negative'
            : id === 'earning'
              ? 'monthly'
              : null,
    );
    const writer = recordingWriter(() => 'Are the 28 days working days or calendar days?');
    const read = await readPolicyProse({ ...app.deps, judge, writer })(hr, { text: BERLIN });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.ai).toBe(true);
    expect(read.value.rules[0]?.value).toBe('28 days a year, earned monthly');
    expect(read.value.question?.body).toEqual({
      text: 'Are the 28 days working days or calendar days?',
      ai: true,
    });
    expect(JSON.stringify(judge.asks)).toContain('28 days');
  });
});
