import { describe, expect, it } from 'vitest';

import { asAddress } from './device.js';

/**
 * Keeping non-addresses out of an `inet` column.
 *
 * This exists because of a real failure, twice. `Device.ip` was a string with
 * `'unknown'` meaning absence; that is harmless beside a `text` column and
 * fatal beside `inet`, which raised `22P02` and turned a polite refusal into a
 * 500. Making the field nullable stopped this service inventing the
 * placeholder, and a caller kept sending one — because "not null" and "is an
 * address" are different claims.
 */
describe('asAddress', () => {
  it('accepts addresses Postgres accepts', () => {
    for (const value of ['203.0.113.7', '::1', '2001:db8::1', '10.0.0.0/8', 'fe80::1%eth0']) {
      expect(asAddress(value), value).toBe(value);
    }
  });

  it('refuses the placeholder that caused this', () => {
    expect(asAddress('unknown')).toBeNull();
  });

  it('refuses anything that is not an address', () => {
    for (const value of ['', 'localhost', 'not an ip', '<script>', null, undefined, 42, {}]) {
      expect(asAddress(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('refuses something longer than any address can be', () => {
    // A bounded field reaching a database is worth bounding here too.
    expect(asAddress('1'.repeat(200))).toBeNull();
  });
});
