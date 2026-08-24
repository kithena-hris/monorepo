import { describe, expect, it } from 'vitest';

import { parseSender } from './sender.js';

/**
 * The setting most likely to be edited by somebody who is not thinking about
 * this file — moving from a shared mailbox to a dedicated sending address is a
 * one-line change made in a hurry. Every case below is a way that line could be
 * wrong, and the point of all of them is that the service refuses to start
 * rather than sending nothing and saying nothing.
 */
const parsed = (raw: string) => {
  const result = parseSender(raw);
  if (!result.ok) throw new Error(`expected ${raw} to parse`);
  return result.value;
};

describe('parseSender', () => {
  it('takes a display name and an address', () => {
    expect(parsed('Kithena <info@kithena.com>')).toEqual({
      displayName: 'Kithena',
      address: 'info@kithena.com',
      formatted: 'Kithena <info@kithena.com>',
    });
  });

  it('takes a bare address, which is what somebody types in a hurry', () => {
    expect(parsed('info@kithena.com')).toEqual({
      displayName: null,
      address: 'info@kithena.com',
      formatted: 'info@kithena.com',
    });
  });

  it('normalises the address, so two spellings are one sender', () => {
    expect(parsed('  Kithena  <Info@Kithena.com>  ').formatted).toBe('Kithena <info@kithena.com>');
  });

  it('keeps a multi-word name intact', () => {
    expect(parsed('Kithena People Team <info@kithena.com>').displayName).toBe(
      'Kithena People Team',
    );
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['a name with no address', 'Kithena'],
    ['empty angle brackets', 'Kithena <>'],
    ['an address that is not one', 'Kithena <info@localhost>'],
    ['two at signs', 'info@@kithena.com'],
  ])('refuses %s', (_case, raw) => {
    expect(parseSender(raw).ok).toBe(false);
  });

  it.each([
    ['a comma, which separates addresses', 'Kithena, Ltd <info@kithena.com>'],
    ['a quote, which closes a quoted string', 'Kithena "HR" <info@kithena.com>'],
    ['an angle bracket, which closes the address', 'Kith<ena <info@kithena.com>'],
    ['a line break, which starts a new header', 'Kithena\nBcc: x@evil.example <info@kithena.com>'],
  ])('refuses a display name containing %s', (_case, raw) => {
    // Refused rather than stripped. A company called "Smith, Jones" has that
    // comma on purpose, and quietly deleting it is a worse answer than asking
    // for a different string.
    expect(parseSender(raw).ok).toBe(false);
  });
});
