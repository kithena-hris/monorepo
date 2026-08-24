import { describe, expect, it } from 'vitest';

import { presentsInternalToken } from './service-token.js';

/**
 * The check that stands in front of every unauthenticated internal route.
 *
 * It had no test while it lived inside one service, which is the wrong way
 * round: it is eight lines, and every one of them is the difference between an
 * internal API and a public one.
 */
const carrier = (value: string | string[] | undefined) => ({
  headers: { 'x-internal-token': value },
});

describe('presentsInternalToken', () => {
  it('admits the exact token', () => {
    expect(presentsInternalToken(carrier('s3cret'), 's3cret')).toBe(true);
  });

  it('refuses a different token of the same length', () => {
    // Same length on purpose: this is the case `timingSafeEqual` exists for,
    // and the one a length check alone would wave through.
    expect(presentsInternalToken(carrier('s3cres'), 's3cret')).toBe(false);
  });

  it('refuses a token that merely starts correctly', () => {
    expect(presentsInternalToken(carrier('s3c'), 's3cret')).toBe(false);
    expect(presentsInternalToken(carrier('s3cretary'), 's3cret')).toBe(false);
  });

  it('refuses a missing header', () => {
    expect(presentsInternalToken({ headers: {} }, 's3cret')).toBe(false);
  });

  it('refuses a repeated header', () => {
    // Node gives an array when a header arrives twice. Joining it, or reading
    // the first element, would let a caller send the real token alongside
    // anything else and choose which one is compared.
    expect(presentsInternalToken(carrier(['s3cret', 'other']), 's3cret')).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    // An empty expected value is a deployment that forgot to set the variable.
    // Comparing it would make the empty string a valid token, which turns a
    // missing setting into an open door rather than a closed one.
    expect(presentsInternalToken(carrier(''), '')).toBe(false);
    expect(presentsInternalToken(carrier('anything'), '')).toBe(false);
  });
});
