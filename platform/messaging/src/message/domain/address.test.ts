import { describe, expect, it } from 'vitest';

import { toAddress } from './address.js';

/**
 * Most of this file is refusals, and that is the point. An address that reaches
 * the provider and bounces costs more than one that is refused here: hard
 * bounces are what get a sending domain suppressed, and a suppressed domain
 * means nobody's invitation arrives.
 */
const accepted = (raw: string): string => {
  const result = toAddress(raw);
  if (!result.ok) throw new Error(`expected ${raw} to be accepted`);
  return result.value;
};

describe('toAddress', () => {
  it('accepts an ordinary work address', () => {
    expect(accepted('ada@acme.example')).toBe('ada@acme.example');
  });

  it('lower-cases, so one mailbox is one address', () => {
    // Two spellings of one mailbox are two idempotency keys and two
    // suppression-list entries, which is how somebody gets the same invitation
    // twice and neither send knows about the other.
    expect(accepted('  Ada.Lovelace@Acme.Example  ')).toBe('ada.lovelace@acme.example');
  });

  it.each([
    ['no at sign', 'ada.acme.example'],
    ['two at signs', 'ada@acme@example'],
    ['nothing before the at', '@acme.example'],
    ['nothing after the at', 'ada@'],
    ['a domain with no dot', 'ada@localhost'],
    ['inner whitespace', 'ada lovelace@acme.example'],
    ['empty', '   '],
  ])('refuses %s', (_case, raw) => {
    expect(toAddress(raw).ok).toBe(false);
  });

  it('refuses an address carrying a line break', () => {
    // Not a typo — this is how a value becomes a header. It would be caught by
    // the whitespace rule too; it is asserted separately because the reason it
    // must never pass is different from the reason a space must not.
    expect(toAddress('ada@acme.example\r\nbcc: attacker@evil.example').ok).toBe(false);
    expect(toAddress('ada@acme.example\nbcc: attacker@evil.example').ok).toBe(false);
  });

  it('refuses an address longer than RFC 5321 allows', () => {
    expect(toAddress(`${'a'.repeat(250)}@acme.example`).ok).toBe(false);
  });
});
