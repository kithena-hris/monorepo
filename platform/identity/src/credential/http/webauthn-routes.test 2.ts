import { describe, expect, it } from 'vitest';

import { deviceFrom } from './webauthn-routes.js';

/**
 * What the route makes of whatever a caller sent.
 *
 * This file exists because the bug it covers was declared fixed twice and was
 * not. `deviceFrom` returned the literal `'unknown'` for a missing address,
 * which reaches an `inet` column and raises `22P02` — and widening
 * `Device.ip` to `string | null` did not change it, because this function
 * declared its own return type as `{ ip: string }` and `string` is assignable
 * to `string | null`. The compiler had nothing to say.
 *
 * The lesson is not "be careful with edits". It is that a type is not a value,
 * and the only thing that would have caught this is calling the function.
 */
describe('deviceFrom', () => {
  it('turns a missing address into null, never a placeholder', () => {
    // The exact failure: `'unknown'` in an `inet` column.
    expect(deviceFrom({}).ip).toBeNull();
    expect(deviceFrom(undefined).ip).toBeNull();
    expect(deviceFrom(null).ip).toBeNull();
    expect(deviceFrom({ userAgent: 'x' }).ip).toBeNull();
  });

  it('refuses a value that is not an address, whoever sent it', () => {
    // The caller holds the internal token, which makes it trusted and not
    // infallible. This is the value the login screen actually sent.
    expect(deviceFrom({ ip: 'unknown' }).ip).toBeNull();
    expect(deviceFrom({ ip: 'localhost' }).ip).toBeNull();
    expect(deviceFrom({ ip: '' }).ip).toBeNull();
  });

  it('keeps a real address', () => {
    expect(deviceFrom({ ip: '203.0.113.7' }).ip).toBe('203.0.113.7');
    expect(deviceFrom({ ip: '2001:db8::1' }).ip).toBe('2001:db8::1');
  });

  it('treats a missing user agent as absent rather than as the word', () => {
    expect(deviceFrom({}).userAgent).toBeNull();
    expect(deviceFrom({ userAgent: '' }).userAgent).toBeNull();
    expect(deviceFrom({ userAgent: 'Mozilla/5.0' }).userAgent).toBe('Mozilla/5.0');
  });

  it('ignores anything it was not asked for', () => {
    const device = deviceFrom({ ip: '203.0.113.7', evil: 'DROP TABLE', aaguid: 42 });
    expect(device.aaguid).toBeNull();
    expect(Object.keys(device).toSorted()).toEqual(['aaguid', 'ip', 'userAgent']);
  });
});
