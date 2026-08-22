import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import {
  admitOperator,
  admitOperatorSession,
  type Operator,
  type OperatorSession,
} from './operator.js';

const operator = (status: Operator['status']): Operator => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  identityId: '00000000-0000-4000-8000-0000000000d9',
  email: 'ops@kithena.com',
  status,
});

const session = (over: Partial<OperatorSession> = {}): OperatorSession => ({
  id: '00000000-0000-4000-8000-0000000000f9',
  operatorId: '00000000-0000-4000-8000-0000000000e1',
  startedAt: '2026-04-01T09:00:00.000Z',
  lastSeenAt: '2026-04-01T09:00:00.000Z',
  expiresAt: '2026-04-01T17:00:00.000Z',
  revokedAt: null,
  ...over,
});

const clock = fixedClock('2026-04-01T09:30:00.000Z');

describe('admitOperator', () => {
  it('admits an active operator', () => {
    expect(admitOperator(operator('active')).ok).toBe(true);
  });

  it('refuses one who has been named but has not enrolled', () => {
    // Reaching a sign-in with a credential while still `invited` means
    // something is wrong rather than merely incomplete.
    expect(admitOperator(operator('invited')).ok).toBe(false);
  });

  it('refuses a suspended operator', () => {
    expect(admitOperator(operator('suspended')).ok).toBe(false);
  });
});

describe('admitOperatorSession', () => {
  it('admits a live session', () => {
    expect(admitOperatorSession(session(), clock).ok).toBe(true);
  });

  it('refuses a revoked one whatever the clock says', () => {
    expect(admitOperatorSession(session({ revokedAt: '2026-04-01T09:15:00.000Z' }), clock).ok).toBe(
      false,
    );
  });

  it('refuses one past its absolute expiry', () => {
    expect(admitOperatorSession(session({ expiresAt: '2026-04-01T09:00:00.000Z' }), clock).ok).toBe(
      false,
    );
  });

  it('refuses one idle for more than an hour', () => {
    // Nowhere near its absolute expiry, and over an hour since it was used. An
    // operator is at a desk; the only thing a longer window buys is more time
    // for somebody else to use their laptop.
    expect(
      admitOperatorSession(session({ lastSeenAt: '2026-04-01T08:00:00.000Z' }), clock).ok,
    ).toBe(false);
  });

  it('says the same thing however it refused', () => {
    const revoked = admitOperatorSession(session({ revokedAt: '2026-04-01T09:00:00Z' }), clock);
    const expired = admitOperatorSession(session({ expiresAt: '2026-01-01T00:00:00Z' }), clock);
    if (revoked.ok || expired.ok) throw new Error('both should refuse');
    expect(revoked.error).toEqual(expired.error);
  });
});
