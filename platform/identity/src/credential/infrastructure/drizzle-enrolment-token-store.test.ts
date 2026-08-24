import { describe, expect, it } from 'vitest';

import { asInstant } from './drizzle-enrolment-token-store.js';

/**
 * The conversion that stood between an invitation and the person it was for.
 *
 * `instant` columns are `mode: 'string'`, so a `timestamptz` arrives in
 * Postgres's own text format. The messaging service validates the expiry with
 * `z.iso.datetime` and refused every invitation with a 422 — and nothing in the
 * type system had a word to say about it, because both shapes are `string`.
 * This file exists because only running the two services together found it.
 */
describe('asInstant', () => {
  it('converts what Postgres actually sends', () => {
    // The literal value that caused the 422: a space rather than a `T`, and a
    // two-digit offset rather than `+00:00`.
    expect(asInstant('2026-08-26 22:31:15.112301+00')).toBe('2026-08-26T22:31:15.112Z');
  });

  it('keeps the instant when the offset is not UTC', () => {
    expect(asInstant('2026-08-26 22:31:15.112301+05:30')).toBe('2026-08-26T17:01:15.112Z');
  });

  it('is idempotent against a value that is already ISO 8601', () => {
    expect(asInstant('2026-08-26T22:31:15.112Z')).toBe('2026-08-26T22:31:15.112Z');
  });

  it('produces something z.iso.datetime accepts', () => {
    // The actual requirement, asserted as itself rather than as a shape that
    // looks about right.
    expect(asInstant('2026-08-26 22:31:15.112301+00')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('throws on something it cannot read, rather than passing it on', () => {
    // A bug, not a condition. The column is NOT NULL, so an unreadable value
    // means the driver or the column type moved underneath this — and carrying
    // on would put a broken deadline in front of a person.
    expect(() => asInstant('not a timestamp')).toThrow(/unreadable timestamp/);
  });
});
