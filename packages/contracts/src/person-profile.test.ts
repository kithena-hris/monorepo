import { describe, expect, it } from 'vitest';

import { checkPersonProfile, isTimeZone } from './person-profile.js';

/**
 * The rule the enrolment form and the identity service both parse with.
 *
 * The time zone half is the one that matters: every invitation path defaults an
 * account to `Etc/UTC`, so the value this accepts is the difference between a
 * clock that says what time it is where somebody works and one that says UTC.
 */
describe('isTimeZone', () => {
  it('accepts a canonical zone', () => {
    expect(isTimeZone('Europe/Madrid')).toBe(true);
    expect(isTimeZone('Etc/UTC')).toBe(true);
  });

  it('accepts an alias a real device reports', () => {
    // `Intl.supportedValuesOf('timeZone')` returns canonical names only, which
    // is why this is asked of the formatter instead: a phone in India reports
    // `Asia/Calcutta` and refusing it would refuse the employee.
    expect(isTimeZone('Asia/Calcutta')).toBe(true);
  });

  it('refuses an empty string and a name nobody publishes', () => {
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('checkPersonProfile', () => {
  it('takes a zone and no number', () => {
    const checked = checkPersonProfile({ timeZone: 'Europe/Madrid' });
    expect(checked).toEqual({ ok: true, value: { timeZone: 'Europe/Madrid', mobile: null } });
  });

  it('treats an empty number as no number', () => {
    // A form renders an empty input and sends the empty string back. That is
    // not a value and not an error.
    for (const mobile of ['', '   ', null, undefined]) {
      const checked = checkPersonProfile({ timeZone: 'Europe/Madrid', mobile });
      expect(checked.ok && checked.value.mobile).toBeNull();
    }
  });

  it('keeps a number as it was typed, separators and all', () => {
    // Normalising would need a library that tracks numbering plans. Storing
    // what somebody typed is honest; rewriting it into a shape they do not
    // recognise is how a verification call gets made to the wrong number.
    const checked = checkPersonProfile({
      timeZone: 'Europe/Madrid',
      mobile: '  +34 600 123 456 ',
    });
    expect(checked.ok && checked.value.mobile).toBe('+34 600 123 456');
  });

  it('points at the field that is wrong', () => {
    const zone = checkPersonProfile({ timeZone: 'Mars/Olympus_Mons' });
    expect(zone.ok).toBe(false);
    expect(!zone.ok && zone.problem.field).toBe('timeZone');

    const number = checkPersonProfile({ timeZone: 'Europe/Madrid', mobile: 'call me' });
    expect(number.ok).toBe(false);
    expect(!number.ok && number.problem.field).toBe('mobile');
  });

  it('refuses a number with too few digits to be one', () => {
    const checked = checkPersonProfile({ timeZone: 'Europe/Madrid', mobile: '+34 12' });
    expect(checked.ok).toBe(false);
  });

  it('refuses a number long enough to be somewhere to paste an essay', () => {
    const checked = checkPersonProfile({
      timeZone: 'Europe/Madrid',
      mobile: `+34 ${'1'.repeat(40)}`,
    });
    expect(checked.ok).toBe(false);
  });
});
