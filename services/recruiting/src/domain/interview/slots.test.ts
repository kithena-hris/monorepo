import { describe, expect, it } from 'vitest';

import { freeSlots, ics, OFFICE_WEEK, slotGrid, type Availability } from './slots.js';

const marco: Availability = {
  personId: 'marco',
  timeZone: 'Europe/Berlin',
  week: OFFICE_WEEK,
  away: [],
  busy: [],
};
const sam: Availability = {
  personId: 'sam',
  timeZone: 'America/New_York',
  week: OFFICE_WEEK,
  away: [],
  busy: [],
};

describe('free slots (PRD §16.4)', () => {
  it('offers hours inside the working day in the interviewer’s zone', () => {
    // Monday 19 October 2026: Berlin is UTC+2, so 09:00–17:00 is 07:00–15:00 UTC.
    const slots = freeSlots([marco], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', 60);
    expect(slots[0]).toBe('2026-10-19T07:00:00.000Z');
    expect(slots.at(-1)).toBe('2026-10-19T14:00:00.000Z');
    expect(slots).toHaveLength(15);
  });

  it('finds the overlap of two zones, and skips a day off and a booked hour', () => {
    // New York 09:00 is 13:00 UTC; Berlin ends at 15:00 UTC: 13:00 and 13:30 and 14:00 fit an hour.
    expect(freeSlots([marco, sam], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', 60)).toEqual([
      '2026-10-19T13:00:00.000Z',
      '2026-10-19T13:30:00.000Z',
      '2026-10-19T14:00:00.000Z',
    ]);
    expect(
      freeSlots(
        [{ ...marco, away: ['2026-10-19'] }],
        '2026-10-19T00:00:00Z',
        '2026-10-20T00:00:00Z',
        60,
      ),
    ).toEqual([]);
    const busy = freeSlots(
      [{ ...marco, busy: [['2026-10-19T07:00:00Z', '2026-10-19T08:00:00Z']] }],
      '2026-10-19T00:00:00Z',
      '2026-10-19T09:00:00Z',
      60,
    );
    expect(busy).toEqual(['2026-10-19T08:00:00.000Z']);
  });

  it('keeps a taken time on the grid, marked taken, so a candidate sees it greyed out', () => {
    const grid = slotGrid(
      [{ ...marco, busy: [['2026-10-19T07:00:00Z', '2026-10-19T08:00:00Z']] }],
      '2026-10-19T00:00:00Z',
      '2026-10-19T09:00:00Z',
      60,
      30,
      undefined,
      ['2026-10-19T08:00:00.000Z'],
    );
    expect(grid).toEqual([
      { at: '2026-10-19T07:00:00.000Z', taken: true },
      { at: '2026-10-19T07:30:00.000Z', taken: true },
      { at: '2026-10-19T08:00:00.000Z', taken: true },
    ]);
    // Outside working hours or on a day off is not on the grid at all.
    expect(
      slotGrid(
        [{ ...marco, away: ['2026-10-19'] }],
        '2026-10-19T00:00:00Z',
        '2026-10-20T00:00:00Z',
        60,
      ),
    ).toEqual([]);
    // The free ones are the same as freeSlots gives.
    const both = slotGrid([marco, sam], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', 60);
    expect(both.filter((s) => !s.taken).map((s) => s.at)).toEqual(
      freeSlots([marco, sam], '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', 60),
    );
  });

  it('writes an invitation a calendar opens', () => {
    const text = ics({
      uid: 'i1@kithena',
      start: '2026-10-19T13:00:00.000Z',
      minutes: 45,
      title: 'Interview; Kithena',
      description: 'Tech, with Marco',
      location: null,
      organizerEmail: 'jobs@acme.example',
      stamp: '2026-10-15T10:00:00.000Z',
    });
    expect(text).toContain('DTSTART:20261019T130000Z\r\nDTEND:20261019T134500Z');
    expect(text).toContain('SUMMARY:Interview\\; Kithena');
  });

  it('carries the meeting link and everyone taking part', () => {
    const text = ics({
      uid: 'i1@kithena',
      start: '2026-10-19T13:00:00.000Z',
      minutes: 45,
      title: 'Interview',
      description: 'Agenda',
      location: 'https://meet.google.com/abc-defg-hij',
      url: 'https://meet.google.com/abc-defg-hij',
      organizerEmail: 'jobs@acme.example',
      stamp: '2026-10-15T10:00:00.000Z',
      attendees: [
        { email: 'yuki@example.com', name: 'Yuki Tanaka' },
        { email: 'marco@acme.example', name: 'Marco Rossi' },
      ],
    });
    expect(text).toContain('URL:https://meet.google.com/abc-defg-hij');
    expect(text).toContain('LOCATION:https://meet.google.com/abc-defg-hij');
    expect(text).toContain('CN="Yuki Tanaka"');
    expect(text).toContain(':mailto:marco@acme.example');
  });
});
