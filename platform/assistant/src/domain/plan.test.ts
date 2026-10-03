import { describe, expect, it } from 'vitest';
import { RuntimeCatalogue } from '@kithena/contracts';

import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from './fixtures.js';
import { offer, readPlan, saying, type Offer } from './plan.js';

/**
 * A plan is read against what was offered to this asker, and refused whole
 * the moment one rule fails (assistant PRD §9.2). Each rule has a test that
 * breaks only it.
 */

const BOTH = offer([PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE]);
const PEOPLE_ONLY = offer([PEOPLE_CATALOGUE]);
const TIMEOFF_ONLY = offer([TIMEOFF_CATALOGUE]);

/** Time Off's leave types as the model saw them after masking: `L1` in place of a private one. */
function masked(offered: Offer): Offer {
  const away = offered.get('timeoff.away');
  if (away === undefined) return offered;
  const fields = away.fields.map((f) =>
    f.key === 'leave_type'
      ? { ...f, options: [{ value: 'L1', label: 'a leave type named in the question' }] }
      : f,
  );
  return new Map([...offered, ['timeoff.away', { ...away, fields }]]);
}

const read = (plan: unknown, offered: Offer = BOTH) => readPlan(JSON.stringify(plan), offered);

const refusal = (plan: unknown, offered: Offer = BOTH) => {
  const r = read(plan, offered);
  return r.ok ? 'accepted' : r.error.code;
};

const plan = (steps: unknown[], answer: unknown = { kind: 'list', step: 's1' }, extra = {}) => ({
  kind: 'plan',
  steps,
  answer,
  ...extra,
});

const away = (input: Record<string, unknown> = { on: 'today' }, extra = {}) => ({
  id: 's1',
  capability: 'timeoff.away',
  input,
  ...extra,
});

describe('the catalogue offered to the model', () => {
  it('offers both modules’ capabilities, and drops what yields to People', () => {
    expect([...BOTH.keys()]).toEqual([
      'people.find',
      'people.person',
      'people.reports',
      'people.managers',
      'people.approvals',
      'timeoff.away',
    ]);
    expect(BOTH.get('timeoff.away')?.fields.map((f) => f.key)).toEqual(['leave_type']);
  });

  it('yields nothing where People is absent', () => {
    expect([...TIMEOFF_ONLY.keys()]).toEqual(['timeoff.away', 'timeoff.managers']);
    expect(TIMEOFF_ONLY.get('timeoff.away')?.fields.map((f) => f.key)).toEqual([
      'leave_type',
      'team',
    ]);
  });

  it('leaves out a capability served only at a version the assistant does not pin', () => {
    const v2 = RuntimeCatalogue.parse({
      ...PEOPLE_CATALOGUE,
      serves: [{ name: 'people.find', version: 2 }],
    });
    expect([...offer([v2]).keys()]).toEqual([]);
  });

  it('leaves out a capability a module serves under another module’s name', () => {
    const odd = RuntimeCatalogue.parse({
      ...TIMEOFF_CATALOGUE,
      serves: [{ name: 'people.find', version: 1 }],
    });
    expect([...offer([odd]).keys()]).toEqual([]);
  });
});

describe('a plan for every worked example is accepted', () => {
  it('§7.1 how many people are off today', () => {
    const r = read(
      plan(
        [away()],
        { kind: 'count', step: 's1' },
        { say: 'Here’s who is out today: {n} people.' },
      ),
    );
    expect(r.ok && r.value).toMatchObject({
      kind: 'plan',
      steps: [{ id: 's1', capability: { name: 'timeoff.away' }, input: { on: 'today' } }],
      answer: { kind: 'count', step: 's1' },
      say: 'Here’s who is out today: {n} people.',
    });
  });

  it('§7.2 the managers of people on L1 today', () => {
    const r = read(
      plan(
        [
          away({ on: 'today', filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }] }),
          { id: 's2', capability: 'people.managers', within: 's1', input: {} },
        ],
        { kind: 'list', step: 's2' },
      ),
      masked(BOTH),
    );
    expect(r.ok).toBe(true);
  });

  it('§7.3 who in Engineering is off next week', () => {
    const r = read(
      plan(
        [
          {
            id: 's1',
            capability: 'people.find',
            input: { filters: [{ key: 'department', op: 'in', values: ['engineering'] }] },
          },
          { ...away({ on: 'next_week' }), id: 's2', within: 's1' },
        ],
        { kind: 'list', step: 's2' },
      ),
    );
    expect(r.ok).toBe(true);
  });

  it('§7.4 People only: unavailable time off, who reports to Michael, my approvals', () => {
    expect(read({ kind: 'unavailable', module: 'timeoff' }, PEOPLE_ONLY)).toEqual({
      ok: true,
      value: { kind: 'unavailable', module: 'timeoff' },
    });
    expect(
      refusal(
        plan([{ id: 's1', capability: 'people.reports', input: { name: 'Michael' } }]),
        PEOPLE_ONLY,
      ),
    ).toBe('accepted');
    expect(
      refusal(
        plan([{ id: 's1', capability: 'people.approvals', input: {} }], {
          kind: 'one',
          step: 's1',
        }),
        PEOPLE_ONLY,
      ),
    ).toBe('accepted');
  });

  it('§7.5 Time Off only: its own managers and its own team filter', () => {
    expect(
      refusal(
        plan(
          [
            away({ on: 'today', filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }] }),
            { id: 's2', capability: 'timeoff.managers', within: 's1', input: {} },
          ],
          { kind: 'list', step: 's2' },
        ),
        masked(TIMEOFF_ONLY),
      ),
    ).toBe('accepted');
    expect(
      refusal(
        plan([
          away({ on: 'next_week', filters: [{ key: 'team', op: 'in', values: ['engineering'] }] }),
        ]),
        TIMEOFF_ONLY,
      ),
    ).toBe('accepted');
    expect(refusal({ kind: 'unavailable', module: 'people' }, TIMEOFF_ONLY)).toBe('accepted');
  });

  it('§7.6 a question nobody can answer keeps the model’s reply', () => {
    expect(read({ kind: 'unclear', reply: 'I can only help with people.' })).toEqual({
      ok: true,
      value: { kind: 'unclear', reply: 'I can only help with people.' },
    });
    expect(read({ kind: 'unclear', reply: ' ' })).toEqual({ ok: true, value: { kind: 'unclear' } });
  });

  it('§7.7 and §7.8 who is on L1 today', () => {
    expect(
      refusal(
        plan([away({ on: 'today', filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }] })]),
        masked(BOTH),
      ),
    ).toBe('accepted');
  });

  it('a count by a group the capability declares, explicit or any select field', () => {
    expect(refusal(plan([away()], { kind: 'count', step: 's1', by: 'team' }))).toBe('accepted');
    expect(
      refusal(
        plan([{ id: 's1', capability: 'people.find', input: {} }], {
          kind: 'count',
          step: 's1',
          by: 'department',
        }),
      ),
    ).toBe('accepted');
  });

  it('finds the JSON a model talked around', () => {
    const r = readPlan(`Sure: ${JSON.stringify(plan([away()]))} hope that helps`, BOTH);
    expect(r.ok).toBe(true);
  });
});

describe('a filter is read as People reads one', () => {
  it('takes an option’s label as its value, and asks a choice as "any of"', () => {
    const r = read(
      plan([
        {
          id: 's1',
          capability: 'people.find',
          input: { filters: [{ key: 'department', op: 'is', values: ['Engineering'] }] },
        },
      ]),
    );
    expect(r.ok && r.value.kind === 'plan' && r.value.steps[0]?.input.filters).toEqual([
      { key: 'department', op: 'in', values: ['engineering'] },
    ]);
  });
});

describe('a plan is refused whole when', () => {
  it('it is not JSON, or not an object', () => {
    expect(readPlan('no plan here', BOTH)).toEqual({ ok: false, error: { code: 'SHAPE' } });
    expect(readPlan('{not json}', BOTH)).toEqual({ ok: false, error: { code: 'SHAPE' } });
  });

  it('it carries a key the shape does not expect', () => {
    expect(refusal({ ...plan([away()]), confidence: 'high' })).toBe('SHAPE');
    expect(refusal(plan([{ ...away(), why: 'x' }]))).toBe('SHAPE');
  });

  it('it has more than four steps', () => {
    const steps = ['s1', 's2', 's3', 's4', 's1'].map((id) => away(undefined, { id }));
    expect(refusal(plan(steps))).toBe('SHAPE');
  });

  it('two steps share an id', () => {
    expect(refusal(plan([away(), away()]))).toBe('DUPLICATE_STEP');
  });

  it('a step names a capability not offered: not entitled, or yielded', () => {
    expect(refusal(plan([away()]), PEOPLE_ONLY)).toBe('NOT_OFFERED');
    expect(
      refusal(
        plan([
          { id: 's1', capability: 'people.find', input: {} },
          { id: 's2', capability: 'timeoff.managers', within: 's1', input: {} },
        ]),
      ),
    ).toBe('NOT_OFFERED');
  });

  it('a step’s input fails its capability’s schema', () => {
    expect(refusal(plan([away({})]))).toBe('INPUT');
    expect(refusal(plan([away({ on: 'the day after tomorrow' })]))).toBe('INPUT');
  });

  it('a step uses an input its capability does not accept', () => {
    expect(
      refusal(
        plan([
          {
            id: 's1',
            capability: 'people.reports',
            input: {
              name: 'Michael',
              filters: [{ key: 'department', op: 'in', values: ['sales'] }],
            },
          },
        ]),
      ),
    ).toBe('INPUT');
  });

  it('a step writes what only the assistant sets', () => {
    expect(refusal(plan([away({ on: 'today', limit: 25 })]))).toBe('ASSISTANT_ONLY');
    expect(
      refusal(plan([away({ on: 'today', personIds: ['00000000-0000-4000-8000-000000000001'] })])),
    ).toBe('ASSISTANT_ONLY');
  });

  it('a filter names a field not offered, or one that yielded', () => {
    expect(
      refusal(
        plan([
          {
            id: 's1',
            capability: 'people.find',
            input: { filters: [{ key: 'salary', op: 'is', values: ['1'] }] },
          },
        ]),
      ),
    ).toBe('FILTER_FIELD');
    expect(
      refusal(
        plan([
          away({ on: 'today', filters: [{ key: 'team', op: 'in', values: ['engineering'] }] }),
        ]),
      ),
    ).toBe('FILTER_FIELD');
  });

  it('a filter uses an operator its field’s kind does not take', () => {
    expect(
      refusal(
        plan([
          {
            id: 's1',
            capability: 'people.find',
            input: { filters: [{ key: 'department', op: 'contains', values: ['eng'] }] },
          },
        ]),
      ),
    ).toBe('FILTER_OP');
  });

  it('a filter names an option that is neither a value nor a label', () => {
    expect(
      refusal(
        plan([
          {
            id: 's1',
            capability: 'people.find',
            input: { filters: [{ key: 'department', op: 'in', values: ['marketing'] }] },
          },
        ]),
      ),
    ).toBe('FILTER_OPTION');
  });

  it('a sort names neither a field nor a metric offered', () => {
    expect(
      refusal(
        plan([
          {
            id: 's1',
            capability: 'people.find',
            input: { sort: { key: 'tenure', direction: 'desc' } },
          },
        ]),
      ),
    ).toBe('accepted');
    expect(
      refusal(
        plan([
          {
            id: 's1',
            capability: 'people.find',
            input: { sort: { key: 'salary', direction: 'desc' } },
          },
        ]),
      ),
    ).toBe('SORT');
  });

  it('a step groups by a key its capability does not declare', () => {
    expect(
      refusal(plan([{ id: 's1', capability: 'people.find', input: { groupBy: 'job_title' } }])),
    ).toBe('GROUP');
  });

  it('`within` names a step that is not earlier', () => {
    expect(
      refusal(
        plan([
          { ...away(), within: 's2' },
          { id: 's2', capability: 'people.find', input: {} },
        ]),
      ),
    ).toBe('WITHIN');
    expect(refusal(plan([{ ...away(), within: 's1' }]))).toBe('WITHIN');
  });

  it('`within` is missing where the capability means nothing alone, or there where it takes none', () => {
    expect(refusal(plan([{ id: 's1', capability: 'people.managers', input: {} }]))).toBe('WITHIN');
    expect(
      refusal(
        plan([
          { id: 's1', capability: 'people.find', input: {} },
          { id: 's2', capability: 'people.reports', within: 's1', input: { name: 'Michael' } },
        ]),
      ),
    ).toBe('WITHIN');
  });

  it('`within` narrows to a step that finds no people', () => {
    expect(
      refusal(
        plan([
          { id: 's1', capability: 'people.person', input: { name: 'Michael' } },
          { ...away(), id: 's2', within: 's1' },
        ]),
      ),
    ).toBe('WITHIN');
  });

  it('the answer names a step that does not exist', () => {
    expect(refusal(plan([away()], { kind: 'list', step: 's2' }))).toBe('ANSWER_STEP');
  });

  it('the answer counts by a group the step’s capability does not declare', () => {
    expect(refusal(plan([away()], { kind: 'count', step: 's1', by: 'department' }))).toBe('GROUP');
  });

  it('the answer counts or lists what is not people', () => {
    expect(
      refusal(
        plan([{ id: 's1', capability: 'people.person', input: { name: 'Michael' } }], {
          kind: 'count',
          step: 's1',
        }),
      ),
    ).toBe('ANSWER_KIND');
  });
});

describe('the model’s opening', () => {
  it('is dropped, not the plan, when it holds a digit, markup or another placeholder', () => {
    for (const say of [
      'There are 14 people off.',
      'Here are **{n}** people:',
      'Hi {name}, {n} people.',
    ]) {
      const r = read(plan([away()], { kind: 'count', step: 's1' }, { say }));
      expect(r.ok && r.value.kind === 'plan' && r.value.say).toBeUndefined();
    }
  });

  it('keeps plain words with {n}', () => {
    expect(saying('  Here’s who is out:   {n} people. ')).toBe('Here’s who is out: {n} people.');
  });
});
