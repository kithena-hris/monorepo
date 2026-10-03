import { describe, expect, it } from 'vitest';

import { nextSequence, tenantOfToken, tokenFromFragment } from './kiosk';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DEVICE = '01890000-0000-7000-8000-000000000001';
const token = `kk_${Buffer.concat([
  Buffer.from(TENANT.replaceAll('-', ''), 'hex'),
  Buffer.from(DEVICE.replaceAll('-', ''), 'hex'),
  Buffer.alloc(32, 7),
]).toString('base64url')}`;

describe('the kiosk’s rules (TOF-108)', () => {
  it('takes its token from HR’s link once, and nothing else from the fragment', () => {
    expect(tokenFromFragment(`#token=${token}`)).toBe(token);
    expect(tokenFromFragment('#token=something-else')).toBeNull();
    expect(tokenFromFragment('')).toBeNull();
  });

  it('numbers taps upward and never behind the clock, so a wiped tablet stays ahead', () => {
    expect(nextSequence(5, 3)).toBe(6);
    expect(nextSequence(0, 1_790_000_000_000)).toBe(1_790_000_000_000);
    expect(nextSequence(1_790_000_000_000, 1_790_000_000_000)).toBe(1_790_000_000_001);
  });

  it('reads the tenant a token names, and nothing from a token that is not one', () => {
    expect(tenantOfToken(token)).toBe(TENANT);
    expect(tenantOfToken('kk_short')).toBeNull();
    expect(tenantOfToken('Bearer nonsense')).toBeNull();
  });
});
