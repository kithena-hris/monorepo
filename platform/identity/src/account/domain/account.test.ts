import { describe, expect, it } from 'vitest';
import { fixedClock, type Clock } from '@kithena/domain-kit';

import { Account, type AccountSnapshot, type EventContext } from './account.js';
import type { Session } from './session.js';

/**
 * The account state machine.
 *
 * Two rules here are the reason this layer is pure and tested first. Effective
 * dating decides whether someone hired on the 1st can log in on the 20th of the
 * previous month, and it is untestable without an injected clock. Termination
 * being terminal decides whether a leaver can be quietly reinstated, and it is
 * the invariant a labour inspector would ask about.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

function context(clock: Clock): EventContext {
  let n = 0;
  return {
    clock,
    // Deterministic rather than random: an assertion on which events were
    // raised should not depend on entropy.
    newEventId: () => {
      n += 1;
      return `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    },
    actor: { kind: 'system', process: 'test' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
  };
}

function snapshot(over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    id: ACCOUNT,
    identityId: '00000000-0000-4000-8000-0000000000d1',
    tenantId: TENANT,
    status: 'active',
    employmentStart: '2026-03-01',
    timeZone: 'Europe/Madrid',
    sessions: [],
    sessionLimit: 4,
    ...over,
  };
}

const device = { ip: '203.0.113.7', userAgent: 'test', aaguid: null };

const session = (id: string, slot: number, lastSeen: string): Session => ({
  id,
  slot,
  startedAt: '2026-03-01T00:00:00.000Z',
  lastSeenAt: `${lastSeen}T00:00:00.000Z`,
  amr: ['swk'],
  device: { ip: '203.0.113.7', userAgent: 'test', aaguid: null },
});

/* ------------------------------------------------------ effective dating -- */

describe('a hire cannot log in before their start date', () => {
  const beforeStart = fixedClock('2026-02-20T09:00:00.000Z');
  const afterStart = fixedClock('2026-03-02T09:00:00.000Z');

  it('refuses enrolment while the start date is in the future', () => {
    // HR enters a hire three weeks early, which is normal and good. Those
    // three weeks are not employment, and an account that works during them is
    // an account that works before anyone has signed anything.
    const account = Account.rehydrate(snapshot({ status: 'invited' }));

    const result = account.enrol('cred-1', context(beforeStart));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPLOYMENT_NOT_STARTED');
  });

  it('allows enrolment once the start date has arrived', () => {
    const account = Account.rehydrate(snapshot({ status: 'invited' }));
    expect(account.enrol('cred-1', context(afterStart)).ok).toBe(true);
    expect(account.status).toBe('active');
  });

  it('decides "has the day arrived" in the employee\'s own zone', () => {
    // 2026-03-01T00:30Z is already the 1st in Madrid and still the 28th of
    // February in Los Angeles. A start date is a calendar date, so the answer
    // depends on whose calendar — and getting this wrong lets someone in a day
    // early or locks them out for a day, depending on which way the sign goes.
    const justAfterMidnightUtc = fixedClock('2026-03-01T00:30:00.000Z');

    const madrid = Account.rehydrate(snapshot({ status: 'invited', timeZone: 'Europe/Madrid' }));
    const losAngeles = Account.rehydrate(
      snapshot({ status: 'invited', timeZone: 'America/Los_Angeles' }),
    );

    expect(madrid.enrol('c', context(justAfterMidnightUtc)).ok).toBe(true);
    expect(losAngeles.enrol('c', context(justAfterMidnightUtc)).ok).toBe(false);
  });
});

/* -------------------------------------------------------- the transitions -- */

describe('enrolment happens once', () => {
  const clock = fixedClock('2026-03-02T09:00:00.000Z');

  it('refuses to enrol an account nobody invited', () => {
    const account = Account.rehydrate(snapshot({ status: 'provisioned' }));
    const result = account.enrol('cred-1', context(clock));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_TRANSITION');
  });

  it('refuses to enrol an account that already is', () => {
    const account = Account.rehydrate(snapshot({ status: 'active' }));
    expect(account.enrol('cred-2', context(clock)).ok).toBe(false);
  });

  it('raises account.enrolled exactly once', () => {
    const account = Account.rehydrate(snapshot({ status: 'invited' }));
    account.enrol('cred-1', context(clock));
    const names = account.drainEvents().map((e) => e.eventName);
    expect(names).toEqual(['identity.account.enrolled']);
  });
});

describe('termination is terminal', () => {
  const clock = fixedClock('2026-06-01T09:00:00.000Z');

  it('cannot be reinstated', () => {
    // A leaver returning is a rehire — a new employment, deliberately entered.
    // If terminated could be reversed, an account with an OpenFGA relation
    // still attached could be switched back on by anyone who could suspend it.
    const account = Account.rehydrate(snapshot({ status: 'terminated' }));
    const result = account.reinstate(context(clock));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_TRANSITION');
  });

  it('cannot start a session', () => {
    const account = Account.rehydrate(snapshot({ status: 'terminated' }));
    expect(account.startSession({ id: 's1', device, amr: ['swk'] }, context(clock)).ok).toBe(false);
  });

  it('cannot be terminated twice', () => {
    const account = Account.rehydrate(snapshot({ status: 'terminated' }));
    expect(account.terminate('2026-05-31', context(clock)).ok).toBe(false);
  });

  it('works from any live state, including one that never enrolled', () => {
    // Someone hired who never started still has an account, and it still has
    // to be closed. Requiring `active` first would leave those open forever.
    for (const status of ['provisioned', 'invited', 'active', 'suspended'] as const) {
      const account = Account.rehydrate(snapshot({ status }));
      expect(account.terminate('2026-05-31', context(clock)).ok, status).toBe(true);
    }
  });

  it('destroys every live session and counts them', () => {
    const account = Account.rehydrate(
      snapshot({ sessions: [session('a', 1, '2026-05-01'), session('b', 2, '2026-05-02')] }),
    );

    account.terminate('2026-05-31', context(clock));

    const events = account.drainEvents();
    expect(events.map((e) => e.eventName)).toEqual([
      'identity.session.revoked',
      'identity.session.revoked',
      'identity.account.terminated',
    ]);
    expect(account.liveSessions).toEqual([]);
    const terminated = events.at(-1);
    if (!terminated) throw new Error('expected a termination event');
    expect((terminated.payload as { sessionsRevoked: number }).sessionsRevoked).toBe(2);
  });
});

describe('suspension holds the door without closing it', () => {
  const clock = fixedClock('2026-04-01T09:00:00.000Z');

  it('stops a suspended account starting a session', () => {
    const account = Account.rehydrate(snapshot({ status: 'suspended' }));
    expect(account.startSession({ id: 's1', device, amr: ['swk'] }, context(clock)).ok).toBe(false);
  });

  it('revokes live sessions when it suspends', () => {
    const account = Account.rehydrate(snapshot({ sessions: [session('a', 1, '2026-03-30')] }));
    account.suspend('investigation', context(clock));
    expect(account.liveSessions).toEqual([]);
    expect(account.status).toBe('suspended');
  });

  it('can be reinstated, unlike termination', () => {
    const account = Account.rehydrate(snapshot({ status: 'suspended' }));
    expect(account.reinstate(context(clock)).ok).toBe(true);
    expect(account.status).toBe('active');
  });
});

/* ------------------------------------------------------------- sessions -- */

describe('starting a session', () => {
  const clock = fixedClock('2026-04-01T09:00:00.000Z');

  it('needs an enrolled account, not merely an invited one', () => {
    const account = Account.rehydrate(snapshot({ status: 'invited' }));
    const result = account.startSession({ id: 's1', device, amr: ['swk'] }, context(clock));
    expect(result.ok).toBe(false);
  });

  it('takes a free slot and raises one event', () => {
    const account = Account.rehydrate(snapshot());

    const result = account.startSession({ id: 's1', device, amr: ['swk'] }, context(clock));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slot).toBe(1);
    expect(result.value.evicted).toBeNull();
    expect(account.drainEvents().map((e) => e.eventName)).toEqual(['identity.session.started']);
  });

  it('evicts the least recently used device and reports both events', () => {
    // The revocation is raised as well as the start, so a consumer can drop
    // the evicted session's cache entry and tell the person which device lost
    // its place — rather than discovering it when that device stops working.
    const full = Account.rehydrate(
      snapshot({
        sessions: [
          session('laptop', 1, '2026-03-31'),
          session('sold-phone', 2, '2026-02-01'),
          session('tablet', 3, '2026-03-30'),
          session('desktop', 4, '2026-03-29'),
        ],
      }),
    );

    const result = full.startSession({ id: 'new', device, amr: ['swk'] }, context(clock));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evicted?.id).toBe('sold-phone');
    expect(result.value.slot).toBe(2);
    expect(full.drainEvents().map((e) => e.eventName)).toEqual([
      'identity.session.revoked',
      'identity.session.started',
    ]);
    expect(full.liveSessions).toHaveLength(4);
  });

  it('frees the slot when a session is revoked', () => {
    const account = Account.rehydrate(snapshot({ sessions: [session('a', 1, '2026-03-30')] }));

    expect(account.revokeSession('a', 'signed_out', context(clock)).ok).toBe(true);
    const result = account.startSession({ id: 'b', device, amr: ['swk'] }, context(clock));

    if (!result.ok) return;
    expect(result.value.slot).toBe(1);
    expect(result.value.evicted).toBeNull();
  });

  it('refuses to revoke a session it does not have', () => {
    const account = Account.rehydrate(snapshot());
    const result = account.revokeSession('ghost', 'signed_out', context(clock));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
