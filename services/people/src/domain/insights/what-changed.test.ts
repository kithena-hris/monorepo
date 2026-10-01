import { describe, expect, it } from 'vitest';

import {
  answerByRules,
  answeredFrom,
  askContext,
  filled,
  forRecipient,
  leaversByTeam,
  periodOf,
  phraseContext,
  phrasedFrom,
  shortened,
  summarise,
  titleOf,
  wordsFor,
  type Figures,
  type Period,
  type Summary,
} from './what-changed.js';

const september = (): Period => {
  const p = periodOf('month', '2026-10-01');
  if (!p.ok) throw new Error(p.error.message);
  return p.value;
};

const figures = (over: Partial<Figures> = {}): Figures => ({
  minimum: 10,
  movement: { opening: 398, closing: 412, joiners: 14, leavers: 3 },
  previous: { joiners: 6, leavers: 1 },
  joinersBy: [
    { value: 'eng', label: 'Engineering', count: 9 },
    { value: 'sales', label: 'Sales', count: 5 },
  ],
  leaversBy: [{ value: 'support', label: 'Support', count: 3 }],
  named: ['eng', 'support'],
  complete: { before: 27, after: 21 },
  gap: 'Bank details',
  span: { over: 2, before: 1, limit: 8 },
  pay: { above: 1, below: 0 },
  ...over,
});

const texts = (s: Summary) => filled(s).map((p) => p.text);

describe('the period', () => {
  it('is the unit holding yesterday, the last night with a snapshot, against the one before', () => {
    expect(september()).toEqual({
      kind: 'month',
      from: '2026-09-01',
      to: '2026-09-30',
      before: { from: '2026-08-01', to: '2026-08-31' },
      partial: false,
    });
    const week = periodOf('week', '2026-10-01');
    expect(week.ok && week.value).toEqual({
      kind: 'week',
      from: '2026-09-28',
      to: '2026-09-30',
      before: { from: '2026-09-21', to: '2026-09-27' },
      partial: true,
    });
    const quarter = periodOf('quarter', '2026-10-01');
    expect(quarter.ok && quarter.value.from).toBe('2026-07-01');
    expect(quarter.ok && quarter.value.before).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('takes a custom range against the same number of days before it', () => {
    const custom = periodOf('custom', '2026-10-01', { from: '2026-09-01', to: '2026-09-15' });
    expect(custom.ok && custom.value).toEqual({
      kind: 'custom',
      from: '2026-09-01',
      to: '2026-09-15',
      before: { from: '2026-08-17', to: '2026-08-31' },
      partial: false,
    });
  });

  it('refuses a custom range that is backwards, unfinished, or longer than a year', () => {
    for (const range of [
      { from: '2026-09-15', to: '2026-09-01' },
      { from: '2026-09-01', to: '2026-10-01' },
      { from: '2025-01-01', to: '2026-09-01' },
      { from: 'soon', to: '2026-09-01' },
    ]) {
      expect(periodOf('custom', '2026-10-01', range).ok).toBe(false);
    }
    expect(periodOf('custom', '2026-10-01').ok).toBe(false);
  });

  it('is said in words, and says when it is not over', () => {
    expect(wordsFor(september())).toEqual({
      name: 'September',
      title: 'September 2026',
      inWords: 'in September',
      against: 'August',
      unit: 'month',
    });
    const october = periodOf('month', '2026-10-15');
    expect(october.ok && wordsFor(october.value).name).toBe('October so far');
    const week = periodOf('week', '2026-10-01');
    expect(week.ok && wordsFor(week.value).name).toBe('The week of 28 Sep so far');
    const custom = periodOf('custom', '2026-10-01', { from: '2026-09-01', to: '2026-09-15' });
    expect(custom.ok && wordsFor(custom.value)).toMatchObject({
      name: '1 Sep to 15 Sep',
      against: 'the 15 days before',
      unit: 'period',
    });
  });
});

describe('the points, from the figures and nothing else', () => {
  it('says each change once, with its figure and the records behind it', () => {
    const summary = summarise(figures(), september());
    expect(filled(summary).map((p) => [p.key, p.figure, p.text])).toEqual([
      ['headcount', '+14', 'Headcount grew from 398 to 412. 9 of the 14 joiners are in Engineering.'],
      ['leavers', '3', '3 people left, all in Support, up from 1 the month before.'],
      ['completeness', '−6 pts', 'Missing details fell from 27% to 21%. The biggest gap is Bank details.'],
      ['span', '2', '2 managers now have more than 8 direct reports, up from 1.'],
      ['pay', '1', '1 grade has a median above its band.'],
    ]);
    expect(titleOf(summary, september())).toBe('September in five points');
  });

  it('links each point to the records it came from', () => {
    const [headcount, leavers] = filled(summarise(figures(), september()));
    expect(headcount?.sources).toEqual([
      { kind: 'joiners', label: '14 joiners', from: '2026-09-01', to: '2026-09-30' },
      { kind: 'group', label: 'Engineering', value: 'eng' },
    ]);
    expect(leavers?.sources).toEqual([
      { kind: 'turnover', label: 'Turnover' },
      { kind: 'group', label: 'Support', value: 'support' },
    ]);
  });

  it('marks every figure and name it filled in, so a reader can tell data from words', () => {
    const [headcount] = filled(summarise(figures(), september()));
    expect(headcount?.parts.filter((p) => p.strong).map((p) => p.text)).toEqual([
      '398',
      '412',
      '9',
      '14',
      'Engineering',
    ]);
  });

  it('never names a team smaller than the cohort minimum', () => {
    const text = texts(summarise(figures({ named: [] }), september())).join(' ');
    expect(text).not.toContain('Engineering');
    expect(text).not.toContain('Support');
    expect(text).toContain('14 people joined.');
  });

  it('names a team only when it holds most of the change', () => {
    const spread = figures({
      joinersBy: [
        { value: 'eng', label: 'Engineering', count: 7 },
        { value: 'sales', label: 'Sales', count: 7 },
      ],
      named: ['eng', 'sales'],
    });
    expect(texts(summarise(spread, september()))[0]).toBe(
      'Headcount grew from 398 to 412. 14 people joined.',
    );
  });

  it('says a fall, a standstill and nobody leaving in plain words', () => {
    const quiet = figures({
      movement: { opening: 40, closing: 40, joiners: 0, leavers: 0 },
      previous: { joiners: 0, leavers: 2 },
      complete: { before: 10, after: 10 },
      gap: null,
      span: { over: 0, before: 1, limit: 8 },
      pay: null,
    });
    expect(texts(summarise(quiet, september()))).toEqual([
      'Headcount held at 40.',
      'Nobody left, after 2 the month before.',
      'Missing details held at 10%.',
      'No manager has more than 8 direct reports now, down from 1.',
    ]);
    const shrinking = figures({ movement: { opening: 40, closing: 38, joiners: 0, leavers: 2 } });
    expect(texts(summarise(shrinking, september()))[0]).toBe('Headcount fell from 40 to 38.');
  });

  it('leaves out what the viewer may not see, and says nothing about nothing', () => {
    const none = figures({
      movement: null,
      previous: null,
      complete: null,
      span: null,
      pay: null,
    });
    expect(summarise(none, september()).points).toEqual([]);
    expect(titleOf(summarise(none, september()), september())).toBe('September');
  });

  it('marks pay as finance’s', () => {
    const pay = filled(summarise(figures(), september())).find((p) => p.key === 'pay');
    expect(pay?.audience).toBe('Finance only');
  });
});

describe('what a model is shown', () => {
  it('is the sentences with every figure and name held back', () => {
    const summary = summarise(figures(), september());
    const context = JSON.stringify(phraseContext(summary, september()));
    const bare = context.replace(/\{[ng]\d+\}/gu, '');
    expect(bare).not.toMatch(/\d/u);
    for (const value of Object.values(summary.fill)) {
      if (/[a-z]/iu.test(value)) expect(bare).not.toContain(value);
    }
    expect(context).toContain('Headcount grew from {n1} to {n2}.');
  });

  it('is the question and the same sentences, when somebody asks a follow-up', () => {
    const summary = summarise(figures(), september());
    const context = JSON.stringify(askContext(summary, 'why is Support losing people?'));
    expect(context).toContain('why is Support losing people?');
    expect(context).not.toContain('412');
    expect(context).not.toContain('Bank details');
  });
});

describe('a model’s wording', () => {
  const summary = summarise(figures(), september());

  it('replaces a point’s sentence when it keeps that point’s placeholders and writes no number', () => {
    const phrased = phrasedFrom(summary, {
      points: [{ key: 'span', sentence: 'There are {n9} managers with over {n10} reports, from {n11}.' }],
    });
    expect(phrased === null ? null : texts(phrased)[3]).toBe(
      'There are 2 managers with over 8 reports, from 1.',
    );
    expect(phrased === null ? null : texts(phrased)[0]).toBe(texts(summary)[0]);
  });

  it('is refused whole for a number of its own, an invented or dropped placeholder, or a stray key', () => {
    const one = (sentence: string, key = 'span') => phrasedFrom(summary, { points: [{ key, sentence }] });
    expect(one('{n9} managers, {n10} reports, from {n11}, about 3 more')).toBeNull();
    expect(one('{n9} managers, {n10} reports, from {n11}, about twelve')).toBeNull();
    expect(one('{n9} managers, {n10} reports')).toBeNull();
    expect(one('{n9} {n10} {n11} {n1}')).toBeNull();
    expect(one('{n9} {n10} {n11}', 'mood')).toBeNull();
    expect(phrasedFrom(summary, { points: [], note: 'x' })).toBeNull();
    expect(phrasedFrom(summary, 'text')).toBeNull();
  });

  it('may keep a number word the sentence already had', () => {
    const quiet = summarise(
      figures({ span: { over: 0, before: 1, limit: 8 }, pay: null }),
      september(),
    );
    const span = quiet.points.find((p) => p.key === 'span');
    const placeholders = span?.sentence.match(/\{n\d+\}/gu)?.join(' ') ?? '';
    expect(
      phrasedFrom(quiet, {
        points: [{ key: 'span', sentence: `No manager now has more than ${placeholders}.` }],
      }),
    ).not.toBeNull();
  });
});

describe('a follow-up question', () => {
  const summary = summarise(figures(), september());

  it('is answered from the points it is about, with the figures People holds', () => {
    const answer = answerByRules(summary, 'why is Support losing people?');
    expect(answer.kind).toBe('answer');
    expect(answer.keys).toEqual(['leavers']);
    expect(answer.sentences.map((s) => s.map((p) => p.text).join(''))).toEqual([
      'Kithena has the figures, not the reasons. These are the ones that bear on it:',
      '3 people left, all in Support, up from 1 the month before.',
    ]);
  });

  it('says plainly what it will not do, and when nothing here answers it', () => {
    expect(answerByRules(summary, 'who are the worst performers in Sales?').kind).toBe('refused');
    expect(answerByRules(summary, 'how many people are off sick?').kind).toBe('refused');
    expect(answerByRules(summary, 'what is the weather in Madrid').kind).toBe('unknown');
  });

  it('takes a model’s answer only in placeholders it was given, and with no number of its own', () => {
    const fine = answeredFrom(summary, 'why are people leaving?', {
      answerable: true,
      sentences: ['{n5} people left, all in {g2}.'],
      keys: ['leavers'],
    });
    expect(fine?.sentences.map((s) => s.map((p) => p.text).join(''))).toEqual([
      '3 people left, all in Support.',
    ]);
    expect(
      answeredFrom(summary, 'why?', { answerable: true, sentences: ['{n99} left'], keys: [] }),
    ).toBeNull();
    expect(
      answeredFrom(summary, 'why?', { answerable: true, sentences: ['7 left'], keys: [] }),
    ).toBeNull();
    expect(
      answeredFrom(summary, 'why?', { answerable: true, sentences: ['x'], keys: ['mood'] }),
    ).toBeNull();
    expect(answeredFrom(summary, 'why?', { answerable: false, sentences: [], keys: [] })?.kind).toBe(
      'unknown',
    );
  });
});

describe('a summary for somebody else', () => {
  const sender = figures();

  it('keeps what the recipient sees the same, and leaves out the rest, saying why', () => {
    const shared = forRecipient(sender, figures({ pay: null }), september(), 'Nora Becker');
    expect(shared.summary.points.map((p) => p.key)).toEqual([
      'headcount',
      'leavers',
      'completeness',
      'span',
    ]);
    expect(shared.notes).toEqual([
      'Pay is left out, because Nora Becker can’t see pay in aggregate.',
      'Team names are kept, because Nora Becker can see them.',
    ]);
  });

  it('leaves out a point whose numbers the recipient would not get, and uses their wording', () => {
    const narrower = figures({
      movement: { opening: 20, closing: 21, joiners: 1, leavers: 0 },
      named: [],
    });
    const shared = forRecipient(sender, narrower, september(), 'Marco Ruiz');
    expect(shared.summary.points.map((p) => p.key)).toEqual(['completeness', 'span', 'pay']);
    expect(shared.notes[0]).toBe(
      'Headcount is left out, because Marco Ruiz sees a different set of people.',
    );
  });

  it('keeps a point without the team names the recipient may not see', () => {
    const shared = forRecipient(sender, figures({ named: [] }), september(), 'Nora Becker');
    expect(texts(shared.summary)[0]).toBe('Headcount grew from 398 to 412. 14 people joined.');
    expect(shared.notes).toContain('Team names are left out, because Nora Becker can’t see them.');
  });

  it('never names to the sender a team or section the sender could not name', () => {
    const shared = forRecipient(
      figures({ named: [], gap: null }),
      figures(),
      september(),
      'Nora Becker',
    );
    const text = texts(shared.summary).join(' ');
    expect(text).not.toContain('Engineering');
    expect(text).not.toContain('Bank details');
  });

  it('sends nothing to somebody who sees no Insights', () => {
    const shared = forRecipient(sender, null, september(), 'Sam Okoro');
    expect(shared.summary.points).toEqual([]);
    expect(shared.notes).toEqual(['Sam Okoro can’t see Insights, so there is nothing to send.']);
  });

  it('is shorter when asked: the first three points', () => {
    const summary = summarise(sender, september());
    expect(shortened(summary, 'short').points.map((p) => p.key)).toEqual([
      'headcount',
      'leavers',
      'completeness',
    ]);
    expect(shortened(summary, 'detailed').points).toHaveLength(5);
  });
});

describe('leavers by team', () => {
  it('names the teams big enough to name, and puts the rest together', () => {
    expect(
      leaversByTeam(
        [
          { month: '2026-07', value: 'support', label: 'Support', count: 1 },
          { month: '2026-08', value: 'support', label: 'Support', count: 1 },
          { month: '2026-09', value: 'support', label: 'Support', count: 3 },
          { month: '2026-08', value: 'eng', label: 'Engineering', count: 1 },
          { month: '2026-09', value: 'legal', label: 'Legal', count: 1 },
          { month: '2026-09', value: null, label: 'Not set', count: 1 },
        ],
        ['support', 'eng'],
        ['2026-07', '2026-08', '2026-09'],
      ),
    ).toEqual({
      categories: ['Support', 'Engineering', 'Other teams'],
      series: [
        { label: 'Jul', values: [1, 0, 0] },
        { label: 'Aug', values: [1, 1, 0] },
        { label: 'Sep', values: [3, 0, 2] },
      ],
    });
    expect(leaversByTeam([], ['eng'], ['2026-09'])).toBeNull();
  });
});
