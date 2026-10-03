import { describe, expect, it } from 'vitest';

import { recordingWriter, shown } from '../testing/assist.js';
import { caller, hr, people, TENANT, world } from '../testing/world.js';
import { insights } from './insights.js';

/**
 * Insights on Platform's 1 October: seven people, 25 days each and nothing
 * booked, so all of it unbooked, 20 each above the carry-over of 5, and
 * nobody has had a day off since June.
 */

describe('insights (TOF-097)', () => {
  it('says the month in points from the domain’s numbers, for HR across the company', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const read = await insights(app.deps)(hr);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.scope).toBe('company');
    expect(read.value.points).toEqual([
      expect.objectContaining({
        kind: 'unbooked',
        figure: '175',
        text: '175 days of vacation are still unbooked this year. At this pace 7 people will lose some at the year end.',
      }),
      expect.objectContaining({
        kind: 'no_break',
        figure: '7',
        text: '7 people haven’t taken a day off since June.',
      }),
    ]);
    expect(read.value.points[1]?.personIds).toHaveLength(7);
    expect(read.value.people.find((p) => p.personId === people.adam)).toMatchObject({
      left: '25.000',
      losesAtYearEnd: '20.000',
      lastDayOff: null,
    });
    expect(read.value.months.map((m) => m.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });

  it('never describes a group under the cohort minimum, sick leave included', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const small = await insights(app.deps)(hr);
    if (!small.ok) throw new Error(small.error.message);
    expect(small.value.cohortMinimum).toBe(10);
    expect(small.value.teams).toEqual([]);
    expect(small.value.hiddenTeams).toBe(1);
    expect(small.value.months.every((m) => m.sick === null)).toBe(true);

    // People's minimum, lowered for the test's seven, lets Platform be described.
    app.state(TENANT).settings.set('cohort_minimum', { value: 5 });
    const shown = await insights(app.deps)(hr);
    if (!shown.ok) throw new Error(shown.error.message);
    expect(shown.value.teams).toEqual([
      expect.objectContaining({ team: 'platform', teamName: 'Platform', people: 7 }),
    ]);
    expect(shown.value.points[1]?.text).toBe(
      '7 people haven’t taken a day off since June. 7 of them are in Platform.',
    );
    expect(shown.value.months[0]?.sick).toBe('0.000');
  });

  it('is a manager’s reports for a manager, and nothing for anybody else', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const marco = await insights(app.deps)(caller(people.marco));
    expect(marco.ok && marco.value.scope).toBe('team');
    expect(marco.ok && marco.value.people).toHaveLength(6);
    expect(await insights(app.deps)(caller(people.adam))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('takes its sentences from the assistant’s writer, with nobody in the prompt', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    app.state(TENANT).settings.set('cohort_minimum', { value: 5 });
    const writer = recordingWriter((key) =>
      key === 'p0'
        ? '175 days are still unbooked, and 7 people would lose some.'
        : '7 people, all 7 in {team}, have had no day off since June.',
    );
    const read = await insights({ ...app.deps, writer })(hr);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.points.map((p) => [p.text, p.ai])).toEqual([
      ['175 days are still unbooked, and 7 people would lose some.', true],
      ['7 people, all 7 in Platform, have had no day off since June.', true],
    ]);
    expect(read.value.points[0]?.sources).toEqual(['Balances', 'Carry-over']);
    // Counts only: no person, no id, and the team as a placeholder.
    const prompt = shown(writer.asks);
    for (const id of Object.values(people)) expect(prompt).not.toContain(id);
    for (const name of ['Adam', 'Marco', 'Platform']) expect(prompt).not.toContain(name);
  });

  it('keeps the template for a line the model got wrong, and without a model', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    // 9 is nowhere in the facts.
    const writer = recordingWriter((key) => (key === 'p0' ? null : '9 people need a break.'));
    const read = await insights({ ...app.deps, writer })(hr);
    expect(read.ok && read.value.points.map((p) => [p.text, p.ai])).toEqual([
      [
        '175 days of vacation are still unbooked this year. At this pace 7 people will lose some at the year end.',
        false,
      ],
      ['7 people haven’t taken a day off since June.', false],
    ]);
    const plain = await insights(app.deps)(hr);
    expect(plain.ok && plain.value.points.every((p) => !p.ai)).toBe(true);
  });
});
