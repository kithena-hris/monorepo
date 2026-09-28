import { describe, expect, it } from 'vitest';

import { dayColumns, formatMinutes, layoutEvents } from './scheduler-model';

const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

describe('layoutEvents', () => {
  it('gives a lone event the whole column', () => {
    const slots = layoutEvents([{ id: 'a', column: 'mon', start: at(9), end: at(10) }]);
    expect(slots.get('a')).toEqual({ lane: 0, lanes: 1 });
  });

  it('puts two overlapping events side by side', () => {
    const slots = layoutEvents([
      { id: 'interview', column: 'wed', start: at(9, 30), end: at(11) },
      { id: 'review', column: 'wed', start: at(10), end: at(11, 30) },
    ]);
    expect(slots.get('interview')).toEqual({ lane: 0, lanes: 2 });
    expect(slots.get('review')).toEqual({ lane: 1, lanes: 2 });
  });

  it('treats back-to-back events as not overlapping', () => {
    const slots = layoutEvents([
      { id: 'a', column: 'mon', start: at(9), end: at(10) },
      { id: 'b', column: 'mon', start: at(10), end: at(11) },
    ]);
    expect(slots.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(slots.get('b')).toEqual({ lane: 0, lanes: 1 });
  });

  it('reuses a lane freed inside a chain of overlaps', () => {
    // a overlaps b, b overlaps c, a and c do not: two lanes, and c takes a's.
    const slots = layoutEvents([
      { id: 'a', column: 'mon', start: at(9), end: at(10) },
      { id: 'b', column: 'mon', start: at(9, 30), end: at(11) },
      { id: 'c', column: 'mon', start: at(10), end: at(12) },
    ]);
    expect(slots.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(slots.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(slots.get('c')).toEqual({ lane: 0, lanes: 2 });
  });

  it('keeps columns apart', () => {
    const slots = layoutEvents([
      { id: 'a', column: 'mon', start: at(9), end: at(10) },
      { id: 'b', column: 'tue', start: at(9), end: at(10) },
    ]);
    expect(slots.get('b')).toEqual({ lane: 0, lanes: 1 });
  });
});

describe('formatMinutes', () => {
  it('writes the 24-hour clock', () => {
    expect(formatMinutes(at(9))).toBe('9:00');
    expect(formatMinutes(at(14, 5))).toBe('14:05');
  });
});

describe('dayColumns', () => {
  it('counts calendar days without drifting across a clock change', () => {
    // 25 October 2026 is when Europe leaves summer time: a day 25 hours long.
    const days = dayColumns('2026-10-23', 4, 'en-GB');
    expect(days.map((d) => d.id)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
    expect(days.map((d) => d.label)).toEqual(['Fri 23', 'Sat 24', 'Sun 25', 'Mon 26']);
  });

  it('names the day in full for assistive tech', () => {
    expect(dayColumns('2026-10-14', 1, 'en-GB')[0]?.fullLabel).toBe('Wednesday 14 October');
  });
});
