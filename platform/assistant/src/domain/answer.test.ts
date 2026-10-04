import { describe, expect, it } from 'vitest';
import { CapabilityOutput } from '@kithena/contracts';
import { fixedClock, ok } from '@kithena/domain-kit';

import {
  answerOf,
  failedAnswer,
  NO_PROFILE,
  refusedAnswer,
  unavailableAnswer,
  unclearAnswer,
  type Setting,
} from './answer.js';
import { todayIn } from './dates.js';
import { execute } from './execute.js';
import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from './fixtures.js';
import { refused } from './mask.js';
import { offer, readPlan } from './plan.js';

/**
 * The answer, written from what the modules returned (assistant PRD §7,
 * §11). People's sentences from `application/assistant/ask.ts` carry over,
 * so a company with People alone reads what it reads today; every worked
 * example in §7 is a case here.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SETTING: Setting = {
  today: todayIn('Europe/Madrid', fixedClock('2026-10-06T10:00:00Z')),
  channel: 'slack',
  offered: offer([PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE]),
  leaveTypes: TIMEOFF_CATALOGUE.leaveTypes,
  origin: 'https://acme.app.kithena.com',
  namesPrivateLeave: false,
};

interface Row {
  name: string;
  title?: string;
  detail?: string;
  team?: string;
  self?: true;
}

const people = (
  total: number,
  described: string,
  rows: Row[] = [],
  extra: { scope?: 'everyone' | 'visible'; ids?: number[]; notes?: string[] } = {},
) =>
  CapabilityOutput.parse({
    kind: 'people',
    rows: rows.map(({ team, ...row }, i) => ({
      personId: id(i + 1),
      ...row,
      groups: team === undefined ? {} : { team },
    })),
    total,
    scope: extra.scope ?? 'everyone',
    described,
    notes: extra.notes ?? [],
    ...(extra.ids === undefined ? {} : { ids: extra.ids.map(id) }),
  });

/** The plan read, run against fixed results per step, and answered. */
async function answer(
  plan: unknown,
  results: Record<string, unknown>,
  setting: Partial<Setting> = {},
) {
  const read = readPlan(JSON.stringify(plan), SETTING.offered);
  if (!read.ok || read.value.kind !== 'plan') throw new Error(JSON.stringify(read));
  const s = { ...SETTING, ...setting };
  const run = await execute(read.value, s.today, (step) =>
    Promise.resolve(ok(CapabilityOutput.parse(results[step.id]))),
  );
  if (!run.ok) throw new Error(JSON.stringify(run.error));
  return answerOf(read.value, run.value, s);
}

const one = (capability: string, input: Record<string, unknown>, kind = 'list', extra = {}) => ({
  kind: 'plan',
  steps: [{ id: 's1', capability, input }],
  answer: { kind, step: 's1' },
  ...extra,
});

const SALES = { filters: [{ key: 'department', op: 'in', values: ['sales'] }] };
const TODAY = { on: 'today' };
const ON_SICK_LEAVE = {
  on: 'today',
  filters: [{ key: 'leave_type', op: 'in', values: ['sick'] }],
};

describe('People’s sentences, carried over from ask.ts', () => {
  it('lists people, with the phrase People wrote for them', async () => {
    const a = await answer(one('people.find', SALES), {
      s1: people(2, 'whose department is Sales', [
        { name: 'Dwight Schrute', title: 'Salesman' },
        { name: 'Jim Halpert', title: 'Salesman' },
      ]),
    });
    expect(a).toEqual({
      text: 'I found 2 people whose department is Sales.\n• Dwight Schrute — Salesman\n• Jim Halpert — Salesman',
      understood: 'People whose department is Sales',
      people: [
        { id: id(1), name: 'Dwight Schrute', title: 'Salesman' },
        { id: id(2), name: 'Jim Halpert', title: 'Salesman' },
      ],
      answered: true,
    });
  });

  it('says the directory has the rest beyond the first page', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ name: `Person ${String(i)}` }));
    const a = await answer(one('people.find', SALES), {
      s1: people(30, 'whose department is Sales', rows),
    });
    expect(a.text).toMatch(
      /^I found 30 people whose department is Sales\. Here are the first 25; the directory has the rest\.\n• Person 0\n/u,
    );
  });

  it('answers who reports to somebody, found by name', async () => {
    const a = await answer(one('people.reports', { name: 'Michael' }), {
      s1: people(2, 'Michael Scott', [{ name: 'Dwight Schrute' }, { name: 'Jim Halpert' }]),
    });
    expect(a.text).toBe('Michael Scott has 2 direct reports:\n• Dwight Schrute\n• Jim Halpert');
    expect(a.understood).toBe('Who reports to Michael Scott');
    const none = await answer(one('people.reports', { name: 'Michael' }), {
      s1: people(0, 'Michael Scott'),
    });
    expect(none.text).toBe('No one reports to Michael Scott at the moment.');
  });

  it('opens with the model’s own words, and fills in the count itself', async () => {
    const a = await answer(
      one('people.reports', { name: 'Michael' }, 'list', {
        say: 'Sure! Here are the {n} people on Michael’s team.',
      }),
      { s1: people(2, 'Michael Scott', [{ name: 'Dwight Schrute' }, { name: 'Jim Halpert' }]) },
    );
    expect(a.text).toMatch(/^Sure! Here are the 2 people on Michael’s team\.\n•/u);
  });

  it('never lets an opening without the count stand in for a count', async () => {
    const a = await answer(
      one('people.find', {}, 'count', { say: 'Here’s the count for the company:' }),
      { s1: people(4, 'across the company') },
    );
    expect(a.text).toBe('There are 4 people across the company.');
  });

  it('says nobody when the count is nought', async () => {
    const a = await answer(one('people.find', SALES, 'count'), {
      s1: people(0, 'whose department is Sales'),
    });
    expect(a.text).toBe('Nobody whose department is Sales at the moment.');
  });

  it('splits a count by group, largest first', async () => {
    const a = await answer(one('people.find', {}, 'count', {}), {
      s1: people(1, 'across the company'),
    });
    expect(a.text).toBe('There is 1 person across the company.');
    const grouped = await answer(
      {
        kind: 'plan',
        steps: [{ id: 's1', capability: 'timeoff.away', input: TODAY }],
        answer: { kind: 'count', step: 's1', by: 'team' },
      },
      {
        s1: people(4, 'away on Tuesday 6 October', [
          { name: 'A', team: 'Sales' },
          { name: 'B', team: 'Engineering' },
          { name: 'C' },
          { name: 'D', team: 'Engineering' },
        ]),
      },
    );
    expect(grouped.text).toBe(
      'Here’s how the 4 people away on Tuesday 6 October split by team:\n• Engineering: 2\n• Sales: 1\n• No team: 1',
    );
    expect(grouped.understood).toBe('People away on Tuesday 6 October, by team');
  });

  it('reads "me" as whoever asks, and says so when they have no profile', async () => {
    const a = await answer(one('people.person', { name: '@me' }, 'one'), {
      s1: { kind: 'not_found', self: true },
    });
    expect(a.text).toBe(NO_PROFILE);
  });

  it('asks which one when a name matches several, and says when it matches nobody', async () => {
    const several = await answer(one('people.person', { name: 'Michael' }, 'one'), {
      s1: {
        kind: 'ambiguous',
        name: 'Michael',
        candidates: [
          { personId: id(1), name: 'Michael Scott', title: 'Regional Manager' },
          { personId: id(2), name: 'Michael Klump' },
        ],
      },
    });
    expect(several.text).toBe(
      'A few people are called Michael. Which one did you mean?\n• Michael Scott — Regional Manager\n• Michael Klump',
    );
    expect(several.people).toHaveLength(2);
    const nobody = await answer(one('people.person', { name: 'Michel' }, 'one'), {
      s1: { kind: 'not_found', name: 'Michel' },
    });
    expect(nobody.text).toBe('I couldn’t find anyone called Michel. Could you check the spelling?');
  });

  it('describes one person', async () => {
    const a = await answer(one('people.person', { name: 'Michael' }, 'one'), {
      s1: {
        kind: 'profile',
        personId: id(1),
        name: 'Michael Scott',
        title: 'Regional Manager',
        manager: 'David Wallace',
        hireDate: '2019-03-12',
        email: 'michael@dunder.example',
        self: false,
      },
    });
    expect(a.text).toBe(
      'Michael Scott works as Regional Manager. They report to David Wallace and joined on 12 March 2019. You can reach them at michael@dunder.example.',
    );
    expect(a.understood).toBe('About Michael Scott');
  });

  it('lists what waits for approval, or says nothing does', async () => {
    const a = await answer(one('people.approvals', {}, 'one'), {
      s1: {
        kind: 'items',
        items: [
          { name: 'Jim Halpert', label: 'Job title' },
          { name: 'Pam Beesly', label: 'Address' },
        ],
        total: 2,
      },
    });
    expect(a.text).toBe(
      '2 changes are waiting for your approval:\n• Jim Halpert — Job title\n• Pam Beesly — Address',
    );
    const none = await answer(one('people.approvals', {}, 'one'), {
      s1: { kind: 'items', items: [], total: 0 },
    });
    expect(none.text).toBe('You’re all caught up. Nothing is waiting for your approval.');
  });

  it('lists the time off waiting for the asker’s decision, or says none is (AST-031)', async () => {
    const a = await answer(one('timeoff.pending', {}, 'one'), {
      s1: {
        kind: 'items',
        items: [{ name: 'Hana Kim', label: 'Vacation · Tue 6 Oct (1 day)' }],
        total: 1,
      },
    });
    expect(a.text).toBe(
      '1 time off request is waiting for your decision:\n• Hana Kim — Vacation · Tue 6 Oct (1 day)',
    );
    expect(a.understood).toBe('What waits for your decision in Time Off');
    const none = await answer(one('timeoff.pending', {}, 'one'), {
      s1: { kind: 'items', items: [], total: 0 },
    });
    expect(none.text).toBe('You’re all caught up. No time off requests are waiting for you.');
  });

  it('never writes a private type beside a name in a chat app, in what waits either', async () => {
    const a = await answer(one('timeoff.pending', {}, 'one'), {
      s1: {
        kind: 'items',
        items: [{ name: 'Adam Novak', label: 'Baja médica · Tue 6 Oct (1 day)' }],
        total: 1,
      },
    });
    expect(a.text).toContain('• Adam Novak — Away · Tue 6 Oct (1 day)');
  });

  it('drops an opening that carries a number of its own', async () => {
    const a = await answer(one('people.find', SALES, 'count', { say: 'All {n} of the 3 teams:' }), {
      s1: people(2, 'whose department is Sales'),
    });
    expect(a.text).toBe('There are 2 people whose department is Sales.');
  });
});

describe('the worked examples', () => {
  it('§7.1 Ada, HR: how many people are off today', async () => {
    const a = await answer(
      one('timeoff.away', TODAY, 'count', { say: 'Here’s who is out today: {n} people.' }),
      { s1: people(14, 'away on Tuesday 6 October') },
    );
    expect(a).toEqual({
      text: 'Here’s who is out today: 14 people.',
      understood: 'People away on Tuesday 6 October',
      people: [],
      answered: true,
    });
  });

  it('§7.1 Adam, who sees only part of the company, is never shown a company-wide number', async () => {
    const a = await answer(
      one('timeoff.away', TODAY, 'count', { say: 'Here’s who is out today: {n} people.' }),
      { s1: people(3, 'away on Tuesday 6 October', [], { scope: 'visible' }) },
    );
    expect(a.text).toBe(
      'There are 3 people you can see away on Tuesday 6 October. You see your own team; HR sees everyone.',
    );
  });

  const managersOfSick = {
    kind: 'plan',
    steps: [
      { id: 's1', capability: 'timeoff.away', input: ON_SICK_LEAVE },
      { id: 's2', capability: 'people.managers', within: 's1', input: {} },
    ],
    answer: { kind: 'list', step: 's2' },
  };

  it('§7.2 Marco: the managers of people on sick leave, named, the people themselves not', async () => {
    const a = await answer(managersOfSick, {
      s1: people(2, 'away on sick leave on Tuesday 6 October', [], {
        scope: 'visible',
        ids: [7, 8],
      }),
      s2: people(
        1,
        'their managers',
        [{ name: 'Marco Ruiz', title: 'Engineering Manager', self: true }],
        { scope: 'visible' },
      ),
    });
    expect(a.text).toBe(
      'The people away on sick leave on Tuesday 6 October that you can see report to:\n• Marco Ruiz (you) — Engineering Manager',
    );
    expect(a.understood).toBe('Managers of people away on sick leave on Tuesday 6 October');
  });

  it('§7.2 Ada: every manager, without a count per manager', async () => {
    const a = await answer(managersOfSick, {
      s1: people(5, 'away on sick leave on Tuesday 6 October', [], { ids: [1, 2, 3, 4, 5] }),
      s2: people(2, 'their managers', [{ name: 'Marco Ruiz' }, { name: 'Pam Beesly' }]),
    });
    expect(a.text).toBe(
      'The people away on sick leave on Tuesday 6 October report to:\n• Marco Ruiz\n• Pam Beesly',
    );
  });

  it('§7.3 Marco: who in Engineering is off next week, a private type read as Away', async () => {
    const a = await answer(
      {
        kind: 'plan',
        steps: [
          {
            id: 's1',
            capability: 'people.find',
            input: { filters: [{ key: 'department', op: 'in', values: ['engineering'] }] },
          },
          { id: 's2', capability: 'timeoff.away', within: 's1', input: { on: 'next_week' } },
        ],
        answer: { kind: 'list', step: 's2' },
      },
      {
        s1: people(3, 'whose department is Engineering', [], { ids: [1, 2, 3], scope: 'visible' }),
        s2: people(
          2,
          'away 12–18 October',
          [
            { name: 'Ana Ruiz', detail: 'Mon 12 to Wed 14 · Vacation' },
            { name: 'Ben Ode', detail: 'Thu 15 · Baja médica' },
          ],
          { scope: 'visible' },
        ),
      },
    );
    expect(a.text).toBe(
      'I found 2 people you can see whose department is Engineering and away 12–18 October. You see your own team; HR sees everyone.\n• Ana Ruiz — Mon 12 to Wed 14 · Vacation\n• Ben Ode — Thu 15 · Away',
    );
    expect(a.understood).toBe('People whose department is Engineering and away 12–18 October');
  });

  it('§7.4 People only: time off is not part of this company’s Kithena', () => {
    expect(unavailableAnswer('timeoff', ['people']).text).toBe(
      'I can’t see time off: your company doesn’t use Time Off in Kithena. I can help with your people — who is in a team, who reports to whom, how many people work where.',
    );
  });

  it('§7.5 Time Off only: reporting lines are not part of it', () => {
    expect(unavailableAnswer('people', ['timeoff']).text).toBe(
      'I can’t see reporting lines here: your company doesn’t use People in Kithena. I can help with who is away and when.',
    );
  });

  it('§7.6 a question nobody can answer', () => {
    expect(unclearAnswer().text).toBe(
      'I’m not sure I followed that. I can help with questions about your people and their time off.',
    );
    expect(unclearAnswer('I can only help with people.')).toEqual({
      text: 'I can only help with people.',
      understood: 'Not a question I can answer',
      people: [],
      answered: false,
    });
    const quit = refused('Who is likely to quit?');
    if (quit === null) throw new Error('not refused');
    expect(refusedAnswer(quit).text).toBe('Kithena doesn’t guess what people will do.');
  });

  it('§7.7 Adam: nobody he may see the type of, and the fixed sentence about the rule', async () => {
    const empty = {
      s1: people(0, 'away on sick leave on Tuesday 6 October', [], { scope: 'visible' }),
    };
    const a = await answer(one('timeoff.away', ON_SICK_LEAVE), empty);
    expect(a.text).toBe(
      'Nobody you can see away on sick leave on Tuesday 6 October at the moment. Teammates’ sick and parental leave shows to you only as Away.',
    );
    expect(a.people).toEqual([]);
  });

  it('§7.8 Ada in a channel: the count and a link, never the names', async () => {
    const a = await answer(one('timeoff.away', ON_SICK_LEAVE), {
      s1: people(5, 'away on sick leave on Tuesday 6 October', [
        { name: 'Toby Flenderson', detail: 'Tue 6 · Baja médica' },
      ]),
    });
    expect(a).toEqual({
      text: 'There are 5 people away on sick leave on Tuesday 6 October. I don’t name people on sick or parental leave in Slack — see who in Time Off: https://acme.app.kithena.com/time-off/calendar/month?day=2026-10-06&types=sick',
      understood: 'People away on sick leave on Tuesday 6 October',
      people: [],
      answered: true,
    });
  });

  it('names them outside a chat app, where the module already decided who may see them', async () => {
    const a = await answer(
      one('timeoff.away', ON_SICK_LEAVE),
      {
        s1: people(1, 'away on sick leave', [
          { name: 'Toby Flenderson', detail: 'Tue 6 · Baja médica' },
        ]),
      },
      { channel: 'web' },
    );
    expect(a.text).toBe(
      'I found 1 person away on sick leave.\n• Toby Flenderson — Tue 6 · Baja médica',
    );
  });

  describe('a company that chose to name private leave in chat (§11.4, AST-029a)', () => {
    const sickToday = (rows: Row[], extra = {}) => ({
      s1: people(rows.length, 'away on sick leave on Tuesday 6 October', rows, extra),
    });

    it('off: a sick-leave filter answers with a count and a link', async () => {
      const a = await answer(
        one('timeoff.away', ON_SICK_LEAVE),
        sickToday([{ name: 'Toby Flenderson', detail: 'Tue 6 · Baja médica' }]),
        { namesPrivateLeave: false },
      );
      expect(a.text).toBe(
        'There is 1 person away on sick leave on Tuesday 6 October. I don’t name people on sick or parental leave in Slack — see who in Time Off: https://acme.app.kithena.com/time-off/calendar/month?day=2026-10-06&types=sick',
      );
      expect(a.people).toEqual([]);
    });

    it('on: names the people the asker may see as sick, with the type Time Off showed them', async () => {
      const a = await answer(
        one('timeoff.away', ON_SICK_LEAVE),
        sickToday([
          { name: 'Toby Flenderson', detail: 'Tue 6 · Baja médica' },
          { name: 'Yuki Tanaka', detail: 'Tue 6 to Wed 7 · Baja médica' },
        ]),
        { namesPrivateLeave: true },
      );
      expect(a.text).toBe(
        'I found 2 people away on sick leave on Tuesday 6 October.\n• Toby Flenderson — Tue 6 · Baja médica\n• Yuki Tanaka — Tue 6 to Wed 7 · Baja médica',
      );
      expect(a.people.map((p) => p.name)).toEqual(['Toby Flenderson', 'Yuki Tanaka']);
    });

    it('on: an asker who may only see "Away" still gets "Away"', async () => {
      // Time Off's sight rule ran first: a type the asker may not see is "Away" in its rows,
      // and a type filter finds nobody for them. The switch widens neither.
      const away = await answer(
        one('timeoff.away', TODAY),
        {
          s1: people(
            2,
            'away on Tuesday 6 October',
            [
              { name: 'Adam Novak', detail: 'Tue 6 · Away' },
              { name: 'Leo Martin', detail: 'Tue 6, half day · Vacation' },
            ],
            { scope: 'visible' },
          ),
        },
        { namesPrivateLeave: true },
      );
      expect(away.text).toContain('• Adam Novak — Tue 6 · Away');
      const filtered = await answer(
        one('timeoff.away', ON_SICK_LEAVE),
        sickToday([], { scope: 'visible' }),
        { namesPrivateLeave: true },
      );
      expect(filtered.text).toBe(
        'I couldn’t find anyone you can see away on sick leave on Tuesday 6 October. Teammates’ sick and parental leave shows to you only as Away.',
      );
      expect(filtered.people).toEqual([]);
    });
  });

  it('§7.9 a module that does not answer', () => {
    expect(failedAnswer({ code: 'UNREACHABLE', module: 'timeoff' }).text).toBe(
      'I couldn’t reach Time Off just now, so I can’t say who is away. Try again in a minute.',
    );
    expect(failedAnswer({ code: 'REFUSED', module: 'timeoff', message: 'Not for you.' }).text).toBe(
      'Not for you.',
    );
    expect(failedAnswer({ code: 'TOO_BROAD' }).text).toMatch(/^That covers too many people/u);
  });
});

describe('balances (AST-030)', () => {
  const VACATION = { key: 'leave_type', op: 'in', values: ['vacation'] };
  const MORE_THAN_TEN = { key: 'days_left', op: 'after', values: ['10'] };

  it('how much vacation do I have left: the asker’s own, said to them', async () => {
    const a = await answer(one('timeoff.balances', { name: '@me', filters: [VACATION] }), {
      s1: people(
        1,
        'with a Vacation balance',
        [{ name: 'Adam Novak', detail: '12.5 days left', self: true }],
        { scope: 'visible' },
      ),
    });
    expect(a).toEqual({
      text: 'You have 12.5 days left.',
      understood: 'You, with a Vacation balance',
      people: [],
      answered: true,
    });
  });

  it('who in my team has more than ten days left: named, each with their days', async () => {
    const a = await answer(
      {
        kind: 'plan',
        steps: [
          { id: 's1', capability: 'people.reports', input: { name: '@me' } },
          {
            id: 's2',
            capability: 'timeoff.balances',
            input: { filters: [MORE_THAN_TEN] },
            within: 's1',
          },
        ],
        answer: { kind: 'list', step: 's2' },
      },
      {
        s1: people(2, 'Marco Ruiz', [], { ids: [1, 2] }),
        s2: people(
          1,
          'with more than 10 days of Vacation left',
          [{ name: 'Adam Novak', detail: '12.5 days left' }],
          { scope: 'visible' },
        ),
      },
    );
    expect(a.text).toBe(
      'I found 1 person you can see reporting to Marco Ruiz and with more than 10 days of Vacation left. You see your own team; HR sees everyone.\n• Adam Novak — 12.5 days left',
    );
  });

  it('never writes a private type beside a name in a chat app, in any part of the detail', async () => {
    const a = await answer(one('timeoff.balances', { filters: [VACATION] }), {
      s1: people(1, 'with a Vacation balance', [
        { name: 'Adam Novak', detail: '3 days left · Baja médica, 25 days left · Vacation' },
      ]),
    });
    expect(a.text).toContain('• Adam Novak — 3 days left · Away, 25 days left · Vacation');
  });

  it('gives a private type’s balances as a count in a chat app, even about the asker', async () => {
    const sick = { name: '@me', filters: [{ key: 'leave_type', op: 'in', values: ['sick'] }] };
    const a = await answer(one('timeoff.balances', sick), {
      s1: people(
        1,
        'with a Baja médica balance',
        [{ name: 'Adam Novak', detail: '3 days left', self: true }],
        { scope: 'visible' },
      ),
    });
    expect(a.people).toEqual([]);
    expect(a.text).not.toContain('Adam');
    expect(a.text).not.toContain('3 days');
  });
});

describe('what else an answer says', () => {
  it('adds the modules’ own notes', async () => {
    const a = await answer(one('timeoff.away', TODAY, 'count'), {
      s1: people(0, 'away on Tuesday 6 October', [], {
        notes: ['Tuesday 6 October is a public holiday in Madrid.'],
      }),
    });
    expect(a.text).toBe(
      'Nobody away on Tuesday 6 October at the moment. Tuesday 6 October is a public holiday in Madrid.',
    );
  });

  it('says the dates are UTC when the asker has no zone it knows', async () => {
    const a = await answer(
      one('timeoff.away', TODAY, 'count'),
      { s1: people(2, 'away on Tuesday 6 October') },
      { today: todayIn(null, fixedClock('2026-10-06T10:00:00Z')) },
    );
    expect(a.text).toBe(
      'There are 2 people away on Tuesday 6 October. Dates are in UTC: your account has no time zone.',
    );
  });
});
