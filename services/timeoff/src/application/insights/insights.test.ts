import { describe, expect, it } from 'vitest';

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

  it('takes its sentences from the writer it is given, the seam the assistant fills', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const read = await insights(app.deps, ({ point }) => ({ text: point.kind, sources: [] }))(hr);
    expect(read.ok && read.value.points.map((p) => p.text)).toEqual(['unbooked', 'no_break']);
  });
});
