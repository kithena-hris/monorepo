import { describe, expect, it } from 'vitest';
import { lastFour } from './last-four.js';

describe('lastFour', () => {
  it('keeps the tail of a typed value', () => {
    expect(lastFour('ES9121000418450200051332')).toBe('1332');
  });

  it('has nothing for an empty value', () => {
    expect(lastFour('')).toBeNull();
  });

  it('has nothing for a structured value, whose tail is JSON', () => {
    expect(lastFour('{"amountMinor":"8500000","currency":"USD"}')).toBeNull();
    expect(lastFour('["a","b"]')).toBeNull();
  });
});
