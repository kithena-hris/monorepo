import { describe, expect, it } from 'vitest';
import {
  AssistantAsker,
  CapabilityOutput,
  type AssistantQuestion,
  type CapabilityInput,
  type ModuleKey,
  type RuntimeCatalogue,
} from '@kithena/contracts';
import { err, fixedClock, ok } from '@kithena/domain-kit';

import {
  NOT_ALLOWED,
  NOT_IN_KITHENA,
  NOT_NOW,
  TOO_SLOW,
  UNAVAILABLE,
  UNCLEAR,
  WHO_ARE_YOU,
} from '../domain/answer.js';
import type { CallOutcome } from '../domain/execute.js';
import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from '../domain/fixtures.js';
import { asker, type AskDeps } from './ask.js';
import type { AskerLookup, Modules, Planned, PlanRequest } from './ports.js';

/**
 * The ask use case over fake ports (assistant PRD §7, §10.4): identity, the
 * modules and the model are stand-ins, and everything between them — masking,
 * refusals, validation, dates, the join, the answer — is the real thing.
 * Tuesday 6 October 2026 in Madrid, as every worked example.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clock = fixedClock('2026-10-06T10:00:00Z');

const BOTH = ['module.people', 'module.timeoff'];
const accountOf = (entitlements: string[] = BOTH): AskerLookup =>
  ok(
    AssistantAsker.parse({
      accountId: id(900),
      timeZone: 'Europe/Madrid',
      slug: 'acme',
      entitlements,
    }),
  );

const question = (text: string, channel: AssistantQuestion['channel'] = 'slack') => ({
  tenantId: TENANT as AssistantQuestion['tenantId'],
  email: 'marco@acme.example',
  question: text,
  channel,
});

interface Row {
  name: string;
  title?: string;
  detail?: string;
  self?: true;
}
const people = (
  total: number,
  described: string,
  rows: Row[] = [],
  extra: { scope?: 'everyone' | 'visible'; ids?: number[] } = {},
) =>
  CapabilityOutput.parse({
    kind: 'people',
    rows: rows.map((row, i) => ({ personId: id(i + 1), ...row, groups: {} })),
    total,
    scope: extra.scope ?? 'everyone',
    described,
    notes: [],
    ...(extra.ids === undefined ? {} : { ids: extra.ids.map(id) }),
  });

type Answers = Record<
  string,
  (input: CapabilityInput, signal: AbortSignal) => Promise<CallOutcome>
>;

/** Modules that serve the fixtures' catalogues (null: did not answer) and the given results. */
function fakeModules(
  catalogues: Partial<Record<ModuleKey, RuntimeCatalogue | null>>,
  answers: Answers = {},
) {
  const calls: { name: string; input: CapabilityInput }[] = [];
  const asked: ModuleKey[] = [];
  const modules: Modules = {
    configured: Object.keys(catalogues) as ModuleKey[],
    catalogue: (module) => {
      asked.push(module);
      return Promise.resolve(catalogues[module] ?? null);
    },
    call: (capability, input, _as, _id, signal) => {
      calls.push({ name: capability.name, input });
      const answer = answers[capability.name];
      return answer === undefined
        ? Promise.resolve(err({ code: 'UNREACHABLE' }))
        : answer(input, signal);
    },
  };
  return { modules, calls, asked };
}

const returns = (output: unknown) => (): Promise<CallOutcome> =>
  Promise.resolve(ok(CapabilityOutput.parse(output)));

/** A model that answers every question with `plan`, and remembers what it was asked. */
function fakePlanner(plan: unknown) {
  const requests: PlanRequest[] = [];
  return {
    requests,
    planner: {
      plan: (_tenant: string, request: PlanRequest): Promise<Planned> => {
        requests.push(request);
        return Promise.resolve(
          typeof plan === 'function'
            ? (plan as (r: PlanRequest) => Planned)(request)
            : { ok: true, text: JSON.stringify(plan) },
        );
      },
    },
  };
}

function ask(
  over: Partial<AskDeps> & Pick<AskDeps, 'modules'>,
  identity: AskerLookup = accountOf(),
) {
  return asker({
    identity: { asker: () => Promise.resolve(identity) },
    planner: null,
    clock,
    originOf: (slug) => `https://${slug}.app.kithena.com`,
    ...over,
  });
}

const one = (capability: string, input: Record<string, unknown>, kind = 'list', extra = {}) => ({
  kind: 'plan',
  steps: [{ id: 's1', capability, input }],
  answer: { kind, step: 's1' },
  ...extra,
});

const BOTH_MODULES = { people: PEOPLE_CATALOGUE, timeoff: TIMEOFF_CATALOGUE };

describe('§7.1 how many people are off today', () => {
  const plan = one('timeoff.away', { on: 'today' }, 'count', {
    say: 'Here’s who is out today: {n} people.',
  });

  it('Ada, HR: the count Time Off gave, with today resolved in her zone', async () => {
    const { modules, calls } = fakeModules(BOTH_MODULES, {
      'timeoff.away': returns(people(14, 'away on Tuesday 6 October')),
    });
    const { planner, requests } = fakePlanner(plan);
    const asked = await ask({ modules, planner })(question('How many people are off today?'), 'c');
    expect(asked.answer.text).toBe('Here’s who is out today: 14 people.');
    expect(asked).toMatchObject({ outcome: 'answered', called: ['timeoff.away'], steps: 1 });
    expect(calls[0]?.input).toEqual({ on: { from: '2026-10-06', to: '2026-10-06' }, limit: 0 });
    // Time Off's team filter and its managers yield to People's (§8.4).
    expect(requests[0]?.offer.has('timeoff.managers')).toBe(false);
    expect(requests[0]?.unavailable).toEqual([]);
  });

  it('Adam, an employee, is told how many he can see, and what he sees', async () => {
    const { modules } = fakeModules(BOTH_MODULES, {
      'timeoff.away': returns(people(3, 'away on Tuesday 6 October', [], { scope: 'visible' })),
    });
    const asked = await ask({ modules, planner: fakePlanner(plan).planner })(
      question('How many people are off today?'),
      'c',
    );
    expect(asked.answer.text).toBe(
      'There are 3 people you can see away on Tuesday 6 October. You see your own team; HR sees everyone.',
    );
  });
});

describe('§7.2 the managers of people on sick leave today', () => {
  const plan = {
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
  };

  it('masks the type before the model, unmasks it for Time Off, and names Marco as "you"', async () => {
    const { modules, calls } = fakeModules(BOTH_MODULES, {
      'timeoff.away': returns(
        people(2, 'away on Baja médica on Tuesday 6 October', [], {
          scope: 'visible',
          ids: [7, 8],
        }),
      ),
      'people.managers': returns(
        people(1, 'the managers of the people found', [{ name: 'Marco Ruiz', self: true }]),
      ),
    });
    const { planner, requests } = fakePlanner(plan);
    const asked = await ask({ modules, planner })(
      question('Who are the managers of people on sick leave today?'),
      'c',
    );
    const shown = requests[0];
    expect(shown?.question).toBe('Who are the managers of people on L1 today?');
    const types = shown?.offer.get('timeoff.away')?.fields.find((f) => f.key === 'leave_type');
    expect(types?.options.map((o) => o.value)).toEqual(['vacation', 'personal', 'comp', 'L1']);
    expect(JSON.stringify(shown?.offer.get('timeoff.away')?.fields)).not.toMatch(/sick|Baja/iu);

    expect(calls.map((c) => c.name)).toEqual(['timeoff.away', 'people.managers']);
    expect(calls[0]?.input.filters).toEqual([{ key: 'leave_type', op: 'in', values: ['sick'] }]);
    expect(calls[0]?.input).toMatchObject({ limit: 0, ids: true });
    expect(calls[1]?.input).toMatchObject({ personIds: [id(7), id(8)], limit: 25 });
    expect(asked.answer.text).toBe(
      'The people away on Baja médica on Tuesday 6 October that you can see report to:\n• Marco Ruiz (you)',
    );
  });
});

describe('§7.3 who in Engineering is off next week', () => {
  const plan = {
    kind: 'plan',
    steps: [
      {
        id: 's1',
        capability: 'people.find',
        input: { filters: [{ key: 'department', op: 'in', values: ['Engineering'] }] },
      },
      { id: 's2', capability: 'timeoff.away', within: 's1', input: { on: 'next_week' } },
    ],
    answer: { kind: 'list', step: 's2' },
  };

  it('joins People’s people to Time Off’s absences, next week being 12–18 October', async () => {
    const { modules, calls } = fakeModules(BOTH_MODULES, {
      'people.find': returns(people(3, 'whose department is Engineering', [], { ids: [1, 2, 3] })),
      'timeoff.away': returns(
        people(
          2,
          'away from Monday 12 to Sunday 18 October',
          [
            { name: 'Ana Ruiz', detail: 'Mon 12 to Wed 14 · Vacation' },
            { name: 'Ben Ode', detail: 'Thu 15 · Baja médica' },
          ],
          { scope: 'visible' },
        ),
      ),
    });
    const asked = await ask({ modules, planner: fakePlanner(plan).planner })(
      question('Who in Engineering is off next week?'),
      'c',
    );
    expect(calls[0]?.input).toMatchObject({
      filters: [{ key: 'department', op: 'in', values: ['engineering'] }],
      ids: true,
    });
    expect(calls[1]?.input).toMatchObject({
      on: { from: '2026-10-12', to: '2026-10-18' },
      personIds: [id(1), id(2), id(3)],
    });
    // A private type never sits beside a name in a chat app (§11.4).
    expect(asked.answer.text).toContain(
      '• Ana Ruiz — Mon 12 to Wed 14 · Vacation\n• Ben Ode — Thu 15 · Away',
    );
  });

  it('§7.9 with Time Off restarting: the module named, never a partial join', async () => {
    const { modules } = fakeModules(BOTH_MODULES, {
      'people.find': returns(people(1, 'whose department is Engineering', [], { ids: [1] })),
    });
    const asked = await ask({ modules, planner: fakePlanner(plan).planner })(
      question('Who in Engineering is off next week?'),
      'c',
    );
    expect(asked.answer.text).toBe(
      'I couldn’t reach Time Off just now, so I can’t say who is away. Try again in a minute.',
    );
    expect(asked).toMatchObject({ outcome: 'failed', reason: 'UNREACHABLE' });
  });
});

describe('§7.4 a company with People only', () => {
  it('says time off is not part of its Kithena, and what People can do', async () => {
    const { modules, asked: fetched } = fakeModules({ people: PEOPLE_CATALOGUE });
    const { planner, requests } = fakePlanner({ kind: 'unavailable', module: 'timeoff' });
    const asked = await ask({ modules, planner }, accountOf(['module.people']))(
      question('How many people are off today?'),
      'c',
    );
    expect(fetched).toEqual(['people']);
    expect(requests[0]?.unavailable).toEqual(['timeoff']);
    expect([...(requests[0]?.offer.keys() ?? [])].every((n) => n.startsWith('people.'))).toBe(true);
    expect(asked.answer.text).toBe(
      'I can’t see time off: your company doesn’t use Time Off in Kithena. I can help with your people — who is in a team, who reports to whom, how many people work where.',
    );
    expect(asked.outcome).toBe('unavailable');
  });

  it('answers who reports to Michael as People always has', async () => {
    const { modules } = fakeModules(
      { people: PEOPLE_CATALOGUE },
      {
        'people.reports': returns(
          people(2, 'Michael Scott', [{ name: 'Dwight Schrute' }, { name: 'Jim Halpert' }]),
        ),
      },
    );
    const asked = await ask(
      { modules, planner: fakePlanner(one('people.reports', { name: 'Michael' })).planner },
      accountOf(['module.people']),
    )(question('Who reports to Michael?'), 'c');
    expect(asked.answer.text).toBe(
      'Michael Scott has 2 direct reports:\n• Dwight Schrute\n• Jim Halpert',
    );
  });

  it('refuses sick leave before the model: nothing offers it as a leave type', async () => {
    const { modules } = fakeModules({ people: PEOPLE_CATALOGUE });
    const { planner, requests } = fakePlanner({ kind: 'unclear', reply: '' });
    const asked = await ask({ modules, planner }, accountOf(['module.people']))(
      question('Who is on sick leave today?'),
      'c',
    );
    expect(asked.answer.text).toBe(
      'Kithena never searches by health or other special-category data.',
    );
    expect(asked).toMatchObject({ outcome: 'refused', reason: 'special' });
    expect(requests).toHaveLength(0);
  });
});

describe('§7.5 a company with Time Off only', () => {
  it('answers the managers from Time Off’s own projection, nothing yielding', async () => {
    const { modules, calls } = fakeModules(
      { timeoff: TIMEOFF_CATALOGUE },
      {
        'timeoff.away': returns(
          people(1, 'away on Baja médica on Tuesday 6 October', [], { ids: [4] }),
        ),
        'timeoff.managers': returns(people(1, 'managers of people', [{ name: 'Ravi Patel' }])),
      },
    );
    const { planner, requests } = fakePlanner({
      kind: 'plan',
      steps: [
        {
          id: 's1',
          capability: 'timeoff.away',
          input: { on: 'today', filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }] },
        },
        { id: 's2', capability: 'timeoff.managers', within: 's1', input: {} },
      ],
      answer: { kind: 'list', step: 's2' },
    });
    const asked = await ask({ modules, planner }, accountOf(['module.timeoff']))(
      question('Who are the managers of people off sick today?'),
      'c',
    );
    expect(requests[0]?.offer.has('timeoff.managers')).toBe(true);
    expect(requests[0]?.offer.get('timeoff.away')?.fields.map((f) => f.key)).toContain('team');
    expect(requests[0]?.question).toBe('Who are the managers of people L1 today?');
    expect(calls.map((c) => c.name)).toEqual(['timeoff.away', 'timeoff.managers']);
    expect(asked.answer.text).toContain('• Ravi Patel');
  });

  it('says reporting lines are not part of its Kithena', async () => {
    const { modules } = fakeModules({ timeoff: TIMEOFF_CATALOGUE });
    const asked = await ask(
      { modules, planner: fakePlanner({ kind: 'unavailable', module: 'people' }).planner },
      accountOf(['module.timeoff']),
    )(question('Who reports to Marco?'), 'c');
    expect(asked.answer.text).toBe(
      'I can’t see reporting lines here: your company doesn’t use People in Kithena. I can help with who is away and when.',
    );
  });
});

describe('a company with neither', () => {
  it('asks no module, and says what it does not have', async () => {
    const { modules, asked: fetched } = fakeModules(BOTH_MODULES);
    const { planner, requests } = fakePlanner({ kind: 'unavailable', module: 'timeoff' });
    const asked = await ask({ modules, planner }, accountOf([]))(
      question('Who is off today?'),
      'c',
    );
    expect(fetched).toEqual([]);
    expect(requests[0]?.offer.size).toBe(0);
    expect(requests[0]?.unavailable).toEqual(['people', 'timeoff']);
    expect(asked.answer.text).toBe(
      'I can’t see time off: your company doesn’t use Time Off in Kithena.',
    );
  });
});

describe('§7.6 a question nobody can answer', () => {
  it('the weather: the model’s own reply, or the fixed one', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    const reply = 'I can only help with your people and their time off.';
    const own = await ask({ modules, planner: fakePlanner({ kind: 'unclear', reply }).planner })(
      question('What’s the weather in Madrid?'),
      'c',
    );
    expect(own).toMatchObject({ answer: { text: reply, answered: false }, outcome: 'unclear' });
    const fixed = await ask({
      modules,
      planner: fakePlanner({ kind: 'unclear', reply: '' }).planner,
    })(question('What’s the weather in Madrid?'), 'c');
    expect(fixed.answer.text).toBe(UNCLEAR);
  });

  it('a salary: the gateway refused the prompt', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    const { planner } = fakePlanner(() => ({ ok: false, code: 'NOT_ALLOWED' }));
    const asked = await ask({ modules, planner })(question('What’s Marco’s salary?'), 'c');
    expect(asked).toMatchObject({
      answer: { text: NOT_ALLOWED },
      outcome: 'refused',
      reason: 'AI_GATEWAY',
    });
  });

  it('who will quit: refused before the model', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    const { planner, requests } = fakePlanner({ kind: 'unclear', reply: '' });
    const asked = await ask({ modules, planner })(question('Who is likely to quit?'), 'c');
    expect(asked.answer.text).toBe('Kithena doesn’t guess what people will do.');
    expect(requests).toHaveLength(0);
  });

  it('a plan that does not hold up is "not sure I followed", with its reason', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    const asked = await ask({
      modules,
      planner: fakePlanner(one('payroll.run', {})).planner,
    })(question('Run payroll'), 'c');
    expect(asked).toMatchObject({
      answer: { text: UNCLEAR },
      outcome: 'unclear',
      reason: 'NOT_OFFERED',
    });
    const offered = await ask({
      modules,
      planner: fakePlanner(one('people.find', { personIds: [id(1)] })).planner,
    })(question('Everyone'), 'c');
    expect(offered).toMatchObject({ outcome: 'unclear', reason: 'ASSISTANT_ONLY' });
  });

  it('"unavailable" for a module the company has is a misreading, not a fact', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    const asked = await ask({
      modules,
      planner: fakePlanner({ kind: 'unavailable', module: 'people' }).planner,
    })(question('Who reports to Marco?'), 'c');
    expect(asked).toMatchObject({ answer: { text: UNCLEAR }, outcome: 'unclear' });
  });
});

describe('§7.7 and §7.8 private leave', () => {
  const plan = one('timeoff.away', {
    on: 'today',
    filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }],
  });

  it('Adam, who sees teammates’ sick leave only as Away: nobody, and the rule', async () => {
    const { modules } = fakeModules(BOTH_MODULES, {
      'timeoff.away': returns(
        people(0, 'away on Baja médica on Tuesday 6 October', [], { scope: 'visible' }),
      ),
    });
    const asked = await ask({ modules, planner: fakePlanner(plan).planner })(
      question('Who is on sick leave today?'),
      'c',
    );
    expect(asked.answer.text).toContain(
      'Teammates’ sick and parental leave shows to you only as Away.',
    );
  });

  it('Ada in a channel: the count and the calendar link, never the names', async () => {
    const { modules } = fakeModules(BOTH_MODULES, {
      'timeoff.away': returns(
        people(5, 'away on Baja médica on Tuesday 6 October', [{ name: 'Somebody' }]),
      ),
    });
    const asked = await ask({ modules, planner: fakePlanner(plan).planner })(
      question('who is on sick leave today?'),
      'c',
    );
    expect(asked.answer.text).toContain(
      'https://acme.app.kithena.com/time-off/calendar/month?day=2026-10-06&types=sick',
    );
    expect(asked.answer.text).not.toContain('Somebody');
    expect(asked.answer.people).toEqual([]);
  });

  it('Ada, where the company chose names in chat: Time Off says so with its catalogue (AST-029a)', async () => {
    const { modules } = fakeModules(
      { ...BOTH_MODULES, timeoff: { ...TIMEOFF_CATALOGUE, chatNamesPrivateLeave: true } },
      {
        'timeoff.away': returns(
          people(1, 'away on Baja médica on Tuesday 6 October', [
            { name: 'Somebody', detail: 'Tue 6 · Baja médica' },
          ]),
        ),
      },
    );
    const asked = await ask({ modules, planner: fakePlanner(plan).planner })(
      question('who is on sick leave today?'),
      'c',
    );
    expect(asked.answer.text).toContain('• Somebody — Tue 6 · Baja médica');
    expect(asked.answer.text).not.toContain('/time-off/calendar/');
  });
});

describe('when something does not answer', () => {
  it('identity: nobody by that email, or identity unreachable', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    const { planner } = fakePlanner({ kind: 'unclear', reply: '' });
    const nobody = await ask({ modules, planner }, err('NOT_FOUND'))(question('Who is off?'), 'c');
    expect(nobody).toMatchObject({ answer: { text: NOT_IN_KITHENA }, reason: 'NOT_IN_KITHENA' });
    const down = await ask({ modules, planner }, err('UNREACHABLE'))(question('Who is off?'), 'c');
    expect(down.answer.text).toBe(WHO_ARE_YOU);
  });

  it('a module whose catalogue fails is left out, and a question about it names it', async () => {
    const { modules } = fakeModules({ people: PEOPLE_CATALOGUE, timeoff: null });
    const { planner, requests } = fakePlanner({ kind: 'unavailable', module: 'timeoff' });
    const asked = await ask({ modules, planner })(question('Who is off today?'), 'c');
    expect(requests[0]?.offer.has('timeoff.away')).toBe(false);
    expect(asked.answer.text).toBe(
      'I couldn’t reach Time Off just now, so I can’t say who is away. Try again in a minute.',
    );
  });

  it('a module that refuses: its own words, never retried', async () => {
    const { modules, calls } = fakeModules(BOTH_MODULES, {
      'timeoff.away': () =>
        Promise.resolve(
          err({ code: 'REFUSED', message: 'This workspace does not include Time Off' }),
        ),
    });
    const asked = await ask({
      modules,
      planner: fakePlanner(one('timeoff.away', { on: 'today' }, 'count')).planner,
    })(question('How many are off today?'), 'c');
    expect(asked.answer.text).toBe('This workspace does not include Time Off');
    expect(calls).toHaveLength(1);
  });

  it('no model configured, the model failing, or the hour’s budget spent', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    const none = await ask({ modules })(question('Who is off today?'), 'c');
    expect(none).toMatchObject({ answer: { text: UNAVAILABLE }, reason: 'NO_MODEL' });

    const failing = fakePlanner(() => ({ ok: false, code: 'FAILED' }));
    const failed = await ask({ modules, planner: failing.planner })(question('Who is off?'), 'c');
    expect(failed.answer.text).toBe(NOT_NOW);

    const { planner, requests } = fakePlanner({ kind: 'unclear', reply: '' });
    const budgeted = ask({ modules, planner, plansPerHour: 1 });
    await budgeted(question('Who is off today?'), 'c');
    const spent = await budgeted(question('Who is off today?'), 'c');
    expect(spent).toMatchObject({ answer: { text: UNAVAILABLE }, reason: 'BUDGET' });
    expect(requests).toHaveLength(1);
  });

  it('a question past its deadline is too slow, and what is in flight is aborted', async () => {
    let aborted = false;
    const { modules } = fakeModules(BOTH_MODULES, {
      'timeoff.away': (_input, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve(err({ code: 'UNREACHABLE' }));
          });
        }),
    });
    const asked = await ask({
      modules,
      planner: fakePlanner(one('timeoff.away', { on: 'today' }, 'count')).planner,
      questionMs: 20,
    })(question('How many are off today?'), 'c');
    expect(asked).toMatchObject({ answer: { text: TOO_SLOW }, reason: 'TOO_SLOW' });
    expect(aborted).toBe(true);
  });

  it('runs at most eight questions at once; the ninth waits its turn', async () => {
    const { modules } = fakeModules(BOTH_MODULES);
    let inFlight = 0;
    let most = 0;
    const release: (() => void)[] = [];
    const planner = {
      plan: () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        return new Promise<Planned>((resolve) => {
          release.push(() => {
            inFlight -= 1;
            resolve({ ok: true, text: '{"kind":"unclear","reply":""}' });
          });
        });
      },
    };
    const asking = ask({ modules, planner });
    const all = Array.from({ length: 9 }, () => asking(question('Who is off?'), 'c'));
    await new Promise((r) => setTimeout(r, 10));
    expect(release).toHaveLength(8);
    release.shift()?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(release).toHaveLength(8);
    while (release.length > 0) release.shift()?.();
    await Promise.all(all);
    expect(most).toBe(8);
  });
});

describe('balances, end to end (AST-030)', () => {
  it('how much vacation do I have left?', async () => {
    const { modules, calls } = fakeModules(
      { people: PEOPLE_CATALOGUE, timeoff: TIMEOFF_CATALOGUE },
      {
        'timeoff.balances': returns(
          people(
            1,
            'with a Vacation balance',
            [{ name: 'Marco Ruiz', detail: '12.5 days left', self: true }],
            { scope: 'visible' },
          ),
        ),
      },
    );
    const { planner } = fakePlanner(
      one('timeoff.balances', {
        name: '@me',
        filters: [{ key: 'leave_type', op: 'in', values: ['vacation'] }],
      }),
    );
    const asked = await ask({ modules, planner })(
      question('How much vacation do I have left?'),
      'c',
    );
    expect(calls).toEqual([
      {
        name: 'timeoff.balances',
        input: {
          name: '@me',
          filters: [{ key: 'leave_type', op: 'in', values: ['vacation'] }],
          limit: 25,
        },
      },
    ]);
    expect(asked.answer.text).toBe('You have 12.5 days left.');
  });

  it('who in my team has more than 10 days left?', async () => {
    const { modules, calls } = fakeModules(
      { people: PEOPLE_CATALOGUE, timeoff: TIMEOFF_CATALOGUE },
      {
        'people.reports': returns(people(2, 'Marco Ruiz', [], { ids: [1, 2] })),
        'timeoff.balances': returns(
          people(
            1,
            'with more than 10 days of Vacation left',
            [{ name: 'Adam Novak', detail: '12.5 days left' }],
            { scope: 'visible' },
          ),
        ),
      },
    );
    const { planner } = fakePlanner({
      kind: 'plan',
      steps: [
        { id: 's1', capability: 'people.reports', input: { name: '@me' } },
        {
          id: 's2',
          capability: 'timeoff.balances',
          within: 's1',
          input: { filters: [{ key: 'days_left', op: 'after', values: ['10'] }] },
        },
      ],
      answer: { kind: 'list', step: 's2' },
    });
    const asked = await ask({ modules, planner })(
      question('Who in my team has more than 10 days left?'),
      'c',
    );
    expect(calls[1]).toEqual({
      name: 'timeoff.balances',
      input: {
        filters: [{ key: 'days_left', op: 'after', values: ['10'] }],
        limit: 25,
        personIds: [id(1), id(2)],
      },
    });
    expect(asked.answer.text).toContain('• Adam Novak — 12.5 days left');
  });
});

describe('what’s waiting for me, end to end (AST-032)', () => {
  it('asks People and Time Off for their queues and lists each under its name', async () => {
    const { modules, calls } = fakeModules(
      { people: PEOPLE_CATALOGUE, timeoff: TIMEOFF_CATALOGUE },
      {
        'people.approvals': returns({
          kind: 'items',
          items: [{ name: 'Jim Halpert', label: 'Job title' }],
          total: 1,
        }),
        'timeoff.pending': returns({
          kind: 'items',
          items: [{ name: 'Hana Kim', label: 'Vacation · Tue 6 Oct (1 day)' }],
          total: 1,
        }),
      },
    );
    const { planner } = fakePlanner({
      kind: 'plan',
      steps: [
        { id: 's1', capability: 'people.approvals', input: {} },
        { id: 's2', capability: 'timeoff.pending', input: {} },
      ],
      answer: { kind: 'one', step: ['s1', 's2'] },
    });
    const asked = await ask({ modules, planner })(question('What’s waiting for me?'), 'c');
    expect(calls).toEqual([
      { name: 'people.approvals', input: { limit: 25 } },
      { name: 'timeoff.pending', input: { limit: 25 } },
    ]);
    expect(asked.answer.text).toBe(
      '2 things are waiting for you:\nPeople:\n• Jim Halpert — Job title\nTime Off:\n• Hana Kim — Vacation · Tue 6 Oct (1 day)',
    );
    expect(asked).toMatchObject({ outcome: 'answered', steps: 2, answerKind: 'one' });
  });
});
