import { describe, expect, it } from 'vitest';

import { formatDuration, formatTime, parseTime, usesTwelveHours } from './times.ts';

describe('times', () => {
  it('reads what people type', () => {
    expect(parseTime('930')).toBe('09:30');
    expect(parseTime('9:30pm')).toBe('21:30');
    expect(parseTime('12am')).toBe('00:00');
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('9:75')).toBeNull();
  });

  it('writes the locale clock and keeps the value 24-hour', () => {
    expect(formatTime('09:30', 'de-DE')).toBe('09:30');
    expect(formatTime('21:30', 'en-US')).toMatch(/^9:30\sPM$/);
    expect(usesTwelveHours('en-US')).toBe(true);
    expect(usesTwelveHours('en-GB')).toBe(false);
  });

  it('reads a duration back', () => {
    expect(formatDuration(450)).toBe('7h 30m');
    expect(formatDuration(480)).toBe('8h');
    expect(formatDuration(45)).toBe('45m');
  });
});
