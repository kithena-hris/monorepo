import { describe, expect, it } from 'vitest';
import { err, failure, fixedClock, ok } from '@kithena/domain-kit';

import type { Operator } from '../domain/operator.js';
import { operatorSignIn, type OperatorSignInDeps } from './operator-sign-in.js';

const operator: Operator = {
  id: '00000000-0000-4000-8000-0000000000e1',
  identityId: '00000000-0000-4000-8000-0000000000d9',
  email: 'ops@kithena.com',
  status: 'active',
};

function deps(over: Partial<OperatorSignInDeps> = {}): OperatorSignInDeps & { refusals: string[] } {
  const refusals: string[] = [];
  return {
    refusals,
    verify: () => Promise.resolve(ok({ identityId: operator.identityId })),
    findOperator: () => Promise.resolve(operator),
    startSession: () => Promise.resolve('00000000-0000-4000-8000-0000000000f9'),
    clock: fixedClock('2026-04-01T09:00:00.000Z'),
    onRefusal: (reason) => refusals.push(reason),
    ...over,
  };
}

const request = { response: {}, origin: 'https://admin.kithena.com', challenge: 'c' };

describe('operatorSignIn', () => {
  it('signs in an active operator and dates the session eight hours out', async () => {
    const result = await operatorSignIn(deps())(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expiresAt).toBe('2026-04-01T17:00:00.000Z');
  });

  it('refuses a valid passkey belonging to somebody who is not an operator', async () => {
    // The credential table is shared on purpose — one human, one passkey — so
    // an employee's key reaching this endpoint is expected rather than strange.
    const d = deps({ findOperator: () => Promise.resolve(null) });
    expect((await operatorSignIn(d)(request)).ok).toBe(false);
    expect(d.refusals).toEqual(['not-an-operator']);
  });

  it('never asks who an operator is when the passkey did not verify', async () => {
    let asked = 0;
    const d = deps({
      verify: () => Promise.resolve(err(failure('x', 'no'))),
      findOperator: () => {
        asked += 1;
        return Promise.resolve(operator);
      },
    });
    await operatorSignIn(d)(request);
    expect(asked).toBe(0);
  });

  it('refuses one who has not enrolled, and one who is suspended', async () => {
    for (const status of ['invited', 'suspended'] as const) {
      const d = deps({ findOperator: () => Promise.resolve({ ...operator, status }) });
      expect((await operatorSignIn(d)(request)).ok, status).toBe(false);
      expect(d.refusals).toEqual([`operator-${status}`]);
    }
  });

  it('tells a stranger nothing about which of those it was', async () => {
    // "Not an operator" and "suspended operator" are the same answer outside.
    // The second would otherwise confirm that a named person runs this, which
    // is a shortlist worth having if you intend to phish somebody.
    const stranger = await operatorSignIn(deps({ findOperator: () => Promise.resolve(null) }))(
      request,
    );
    const suspended = await operatorSignIn(
      deps({ findOperator: () => Promise.resolve({ ...operator, status: 'suspended' }) }),
    )(request);
    if (stranger.ok || suspended.ok) throw new Error('both should refuse');
    expect(stranger.error).toEqual(suspended.error);
  });

  it('starts no session when it refuses', async () => {
    let started = 0;
    const d = deps({
      findOperator: () => Promise.resolve(null),
      startSession: () => {
        started += 1;
        return Promise.resolve('x');
      },
    });
    await operatorSignIn(d)(request);
    expect(started).toBe(0);
  });
});
