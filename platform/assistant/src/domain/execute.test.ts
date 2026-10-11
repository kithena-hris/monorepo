import { describe, expect, it } from 'vitest';
import {
  CapabilityOutput,
  type CapabilityInput,
  type CapabilityOutput as Output,
} from '@kithena/contracts';
import { err, fixedClock, ok } from '@kithena/domain-kit';

import { todayIn } from './dates.js';
import { execute, grouped, limitFor, order, type Call, type CallOutcome } from './execute.js';
import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from './fixtures.js';
import { offer, readPlan, type ValidPlan } from './plan.js';

/**
 * Running a plan: steps in waves, each narrowed to the people an earlier one
 * found, a failure failing everything that depends on it, and a count by
 * group folded here (assistant PRD §9.3, §9.5, §9.6). The modules are a fake
 * `call`.
 */

const TODAY = todayIn('Europe/Madrid', fixedClock('2026-10-06T10:00:00Z'));
const OFFER = offer([PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE]);

type Plan = Extract<ValidPlan, { kind: 'plan' }>;
function planOf(steps: unknown[], answer: unknown = { kind: 'list', step: 's1' }): Plan {
  const read = readPlan(JSON.stringify({ kind: 'plan', steps, answer }), OFFER);
  if (!read.ok || read.value.kind !== 'plan') throw new Error(JSON.stringify(read));
  return read.value;
}

const stepOf = (plan: Plan, i: number) => {
  const step = plan.steps[i];
  if (step === undefined) throw new Error(`no step ${String(i)}`);
  return step;
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = (total: number, rows: { n: number; team?: string }[] = [], ids?: number[]): Output =>
  CapabilityOutput.parse({
    kind: 'people',
    rows: rows.map(({ n, team }) => ({
      personId: id(n),
      name: `Person ${String(n)}`,
      groups: team === undefined ? {} : { team },
    })),
    ...(ids === undefined ? {} : { ids: ids.map(id) }),
    total,
    scope: 'everyone',
    described: 'somebody',
  });

/** A fake module per capability, recording what each step was called with and when. */
function modules(answers: Record<string, (input: CapabilityInput) => CallOutcome>) {
  const log: string[] = [];
  const inputs = new Map<string, CapabilityInput>();
  const call: Call = async (step, input) => {
    log.push(`start ${step.id}`);
    inputs.set(step.id, input);
    await Promise.resolve();
    log.push(`end ${step.id}`);
    const answer = answers[step.capability.name];
    if (answer === undefined) throw new Error(`no fake for ${step.capability.name}`);
    return answer(input);
  };
  return { call, log, inputs };
}

const find = (filters: unknown[] = []) => ({
  id: 's1',
  capability: 'people.find',
  input: { filters },
});
const awayNextWeek = {
  id: 's2',
  capability: 'timeoff.away',
  within: 's1',
  input: { on: 'next_week' },
};

describe('the order steps run in', () => {
  it('puts independent steps in one wave, and a step after the one it narrows to', () => {
    const plan = planOf(
      [
        find(),
        { id: 's2', capability: 'timeoff.away', input: { on: 'today' } },
        { id: 's3', capability: 'people.managers', within: 's2', input: {} },
      ],
      { kind: 'list', step: 's3' },
    );
    expect(order(plan).map((wave) => wave.map((s) => s.id))).toEqual([['s1', 's2'], ['s3']]);
  });
});

describe('how much each call asks for', () => {
  it('asks nothing but the total for a count, and up to 5,000 rows for a count by group', () => {
    const counted = planOf([find()], { kind: 'count', step: 's1' });
    expect(limitFor(stepOf(counted, 0), counted)).toEqual({ limit: 0 });
    const byTeam = planOf([{ id: 's1', capability: 'timeoff.away', input: { on: 'today' } }], {
      kind: 'count',
      step: 's1',
      by: 'team',
    });
    expect(limitFor(stepOf(byTeam, 0), byTeam)).toEqual({ limit: 5000 });
  });

  it('asks 25 for a list, and only the ids for a step another narrows to', () => {
    const plan = planOf([find(), awayNextWeek], { kind: 'list', step: 's2' });
    expect(limitFor(stepOf(plan, 0), plan)).toEqual({ limit: 0, ids: true });
    expect(limitFor(stepOf(plan, 1), plan)).toEqual({ limit: 25 });
  });

  it('asks 25 of every queue one answer lists', () => {
    const plan = planOf(
      [
        { id: 's1', capability: 'people.approvals', input: {} },
        { id: 's2', capability: 'timeoff.pending', input: {} },
      ],
      { kind: 'one', step: ['s1', 's2'] },
    );
    expect(limitFor(stepOf(plan, 0), plan)).toEqual({ limit: 25 });
    expect(limitFor(stepOf(plan, 1), plan)).toEqual({ limit: 25 });
  });

  it('sends no limit to a profile', () => {
    const plan = planOf([{ id: 's1', capability: 'people.person', input: { name: 'Michael' } }], {
      kind: 'one',
      step: 's1',
    });
    expect(limitFor(stepOf(plan, 0), plan)).toEqual({});
  });
});

describe('running a plan', () => {
  it('joins two steps: the second narrowed to the first’s people, its dates resolved', async () => {
    const away = people(1, [{ n: 2 }]);
    const m = modules({
      'people.find': () => ok(people(2, [], [1, 2])),
      'timeoff.away': () => ok(away),
    });
    const plan = planOf(
      [find([{ key: 'department', op: 'in', values: ['engineering'] }]), awayNextWeek],
      { kind: 'list', step: 's2' },
    );
    const run = await execute(plan, TODAY, m.call);
    expect(m.inputs.get('s1')).toEqual({
      filters: [{ key: 'department', op: 'in', values: ['engineering'] }],
      limit: 0,
      ids: true,
    });
    expect(m.inputs.get('s2')).toEqual({
      on: { from: '2026-10-12', to: '2026-10-18' },
      limit: 25,
      personIds: [id(1), id(2)],
    });
    expect(run.ok && run.value.answered.id).toBe('s2');
    expect(run.ok && run.value.output).toEqual(away);
    expect(run.ok && [...run.value.outputs.keys()]).toEqual(['s1', 's2']);
  });

  it('runs independent steps at once', async () => {
    const m = modules({
      'people.find': () => ok(people(3)),
      'timeoff.away': () => ok(people(1)),
    });
    const plan = planOf(
      [find(), { id: 's2', capability: 'timeoff.away', input: { on: 'today' } }],
      {
        kind: 'count',
        step: 's2',
      },
    );
    expect((await execute(plan, TODAY, m.call)).ok).toBe(true);
    expect(m.log).toEqual(['start s1', 'start s2', 'end s1', 'end s2']);
  });

  it('fails every step after one that failed, and names its module', async () => {
    const m = modules({
      'people.find': () => err({ code: 'UNREACHABLE' }),
      'timeoff.away': () => ok(people(0)),
    });
    const run = await execute(
      planOf([find(), awayNextWeek], { kind: 'list', step: 's2' }),
      TODAY,
      m.call,
    );
    expect(run).toEqual({ ok: false, error: { code: 'UNREACHABLE', module: 'people' } });
    expect(m.inputs.has('s2')).toBe(false);
  });

  it('fails an answer over several queues when any of them fails', async () => {
    const items = CapabilityOutput.parse({ kind: 'items', items: [], total: 0 });
    const m = modules({
      'people.approvals': () => ok(items),
      'timeoff.pending': () => err({ code: 'UNREACHABLE' }),
    });
    const run = await execute(
      planOf(
        [
          { id: 's1', capability: 'people.approvals', input: {} },
          { id: 's2', capability: 'timeoff.pending', input: {} },
        ],
        { kind: 'one', step: ['s1', 's2'] },
      ),
      TODAY,
      m.call,
    );
    expect(run).toEqual({ ok: false, error: { code: 'UNREACHABLE', module: 'timeoff' } });
  });

  it('carries a module’s refusal in its own words', async () => {
    const m = modules({
      'timeoff.away': () => err({ code: 'REFUSED', message: 'Time Off is not part of your plan.' }),
    });
    const plan = planOf([{ id: 's1', capability: 'timeoff.away', input: { on: 'today' } }]);
    expect(await execute(plan, TODAY, m.call)).toEqual({
      ok: false,
      error: { code: 'REFUSED', module: 'timeoff', message: 'Time Off is not part of your plan.' },
    });
  });

  it('never joins on a truncated list: more than 5,000 is too broad', async () => {
    const m = modules({
      'people.find': () => ok(people(6000, [], [1, 2, 3])),
      'timeoff.away': () => ok(people(0)),
    });
    const run = await execute(
      planOf([find(), awayNextWeek], { kind: 'list', step: 's2' }),
      TODAY,
      m.call,
    );
    expect(run).toEqual({ ok: false, error: { code: 'TOO_BROAD' } });
    expect(m.inputs.has('s2')).toBe(false);
  });

  it('treats a step another narrows to that returns no ids as a module outside its contract', async () => {
    const m = modules({ 'people.find': () => ok(people(2)), 'timeoff.away': () => ok(people(0)) });
    const run = await execute(
      planOf([find(), awayNextWeek], { kind: 'list', step: 's2' }),
      TODAY,
      m.call,
    );
    expect(run).toEqual({ ok: false, error: { code: 'UNREACHABLE', module: 'people' } });
  });

  it('answers with the earlier step when a name it was given matched several people', async () => {
    const several = CapabilityOutput.parse({
      kind: 'ambiguous',
      name: 'Michael',
      candidates: [
        { personId: id(1), name: 'Michael Scott' },
        { personId: id(2), name: 'Michael Klump' },
      ],
    });
    const m = modules({ 'people.find': () => ok(several), 'timeoff.away': () => ok(people(0)) });
    const plan = planOf(
      [{ id: 's1', capability: 'people.find', input: { name: 'Michael' } }, awayNextWeek],
      { kind: 'list', step: 's2' },
    );
    const run = await execute(plan, TODAY, m.call);
    expect(run.ok && run.value.answered.id).toBe('s1');
    expect(run.ok && run.value.output).toEqual(several);
    expect(m.inputs.has('s2')).toBe(false);
  });

  it('refuses a range that ends before it starts', async () => {
    const m = modules({ 'timeoff.away': () => ok(people(0)) });
    const plan = planOf([
      { id: 's1', capability: 'timeoff.away', input: { on: { from: 'next_week', to: 'today' } } },
    ]);
    expect(await execute(plan, TODAY, m.call)).toEqual({ ok: false, error: { code: 'DATES' } });
    expect(m.log).toEqual([]);
  });
});

describe('a count by group', () => {
  it('groups the final rows by the key and counts each group, largest first', async () => {
    const rows = [
      { n: 1, team: 'Engineering' },
      { n: 2, team: 'Sales' },
      { n: 3, team: 'Engineering' },
      { n: 4 },
    ];
    const m = modules({ 'timeoff.away': () => ok(people(4, rows)) });
    const plan = planOf([{ id: 's1', capability: 'timeoff.away', input: { on: 'today' } }], {
      kind: 'count',
      step: 's1',
      by: 'team',
    });
    const run = await execute(plan, TODAY, m.call);
    expect(run.ok && run.value.groups).toEqual([
      { label: 'Engineering', count: 2 },
      { label: 'Sales', count: 1 },
      { label: null, count: 1 },
    ]);
  });

  it('is too broad when the module could not return every row', async () => {
    const m = modules({ 'timeoff.away': () => ok(people(6000, [{ n: 1, team: 'Sales' }])) });
    const plan = planOf([{ id: 's1', capability: 'timeoff.away', input: { on: 'today' } }], {
      kind: 'count',
      step: 's1',
      by: 'team',
    });
    expect(await execute(plan, TODAY, m.call)).toEqual({ ok: false, error: { code: 'TOO_BROAD' } });
  });

  it('orders groups of one size by name', () => {
    expect(
      grouped(
        [
          { personId: id(1) as never, name: 'A', groups: { team: 'Sales' } },
          { personId: id(2) as never, name: 'B', groups: { team: 'Design' } },
        ],
        'team',
      ),
    ).toEqual([
      { label: 'Design', count: 1 },
      { label: 'Sales', count: 1 },
    ]);
  });
});
