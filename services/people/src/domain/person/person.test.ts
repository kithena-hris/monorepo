import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import { Person, type EventContext, type PersonSnapshot } from './person.js';

/**
 * The record's own state machine, which starts before employment does.
 *
 * Two rules carry the rest. **Terminated is a tombstone**: employment records
 * outlive employment, so a leaver is a record that cannot be edited back into
 * life rather than a row somebody deletes — a rehire is a new employment,
 * entered deliberately. And **`discarded` is reachable from `provisional`
 * alone**, because it is the one state a hard delete is permitted from: an
 * account provisioned by mistake on a Tuesday holds nobody's employment
 * history, and every other state does.
 */

const PERSON = '00000000-0000-4000-8000-0000000000a1';

/**
 * What a transition needs from outside itself, passed in rather than reached
 * for. Event ids are deterministic here for the same reason the clock is
 * fixed: an assertion about which events were raised should not depend on
 * entropy.
 */
function context(at = '2026-09-22T09:00:00.000Z'): EventContext {
  let n = 0;
  return {
    clock: fixedClock(at),
    newEventId: () => {
      n += 1;
      return `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    },
    actor: { kind: 'system', process: 'test' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
  };
}

const ctx = context();

function snapshot(over: Partial<PersonSnapshot> = {}): PersonSnapshot {
  return {
    id: PERSON,
    tenantId: '00000000-0000-4000-8000-000000000001',
    status: 'provisional',
    identityAccountId: '00000000-0000-4000-8000-0000000000b1',
    hireDate: null,
    lastWorkingDay: null,
    ...over,
  };
}

const person = (over: Partial<PersonSnapshot> = {}) => Person.rehydrate(snapshot(over));

describe('the path a record actually takes', () => {
  it('runs provisional, pre-hire, active', () => {
    const p = person();
    expect(p.hire('2026-10-01', ctx).ok).toBe(true);
    expect(p.status).toBe('pre_hire');
    expect(p.start(ctx).ok).toBe(true);
    expect(p.status).toBe('active');
  });

  it('lets a hire that is already in the past go straight to active', () => {
    // A record entered for somebody who started last month. Making an admin
    // perform two transitions to catch up would be a data-entry ritual.
    const p = person();
    expect(p.hire('2026-09-01', ctx).ok).toBe(true);
    expect(p.status).toBe('active');
  });

  it('goes on leave and comes back', () => {
    const p = person({ status: 'active' });
    expect(p.startLeave(ctx).ok).toBe(true);
    expect(p.status).toBe('on_leave');
    expect(p.endLeave(ctx).ok).toBe(true);
    expect(p.status).toBe('active');
  });

  it('serves notice and then leaves', () => {
    const p = person({ status: 'active' });
    expect(p.giveNotice('2026-12-31', ctx).ok).toBe(true);
    expect(p.status).toBe('notice');
    expect(p.terminate('2026-12-31', ctx).ok).toBe(true);
    expect(p.status).toBe('terminated');
  });

  it('remembers the last working day notice was given for', () => {
    // Read by the repository writing the row and by the retention job, which
    // counts its schedule from the end of the employment rather than from the
    // day somebody last opened the file.
    const p = person({ status: 'active' });
    expect(p.lastWorkingDay).toBeNull();
    p.giveNotice('2026-12-31', ctx);
    expect(p.lastWorkingDay).toBe('2026-12-31');
  });

  it('lets somebody on leave resign without coming back first', () => {
    const p = person({ status: 'on_leave' });
    expect(p.giveNotice('2026-12-31', ctx).ok).toBe(true);
  });
});

describe('what is refused', () => {
  it('refuses to hire a record twice', () => {
    const p = person({ status: 'active', hireDate: '2026-01-01' });
    const again = p.hire('2027-01-01', ctx);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('INVALID_TRANSITION');
  });

  it('refuses to start somebody nobody hired', () => {
    expect(person().start(ctx).ok).toBe(false);
  });

  it('refuses leave for somebody who has not started', () => {
    expect(person({ status: 'pre_hire', hireDate: '2026-12-01' }).startLeave(ctx).ok).toBe(false);
  });

  it('refuses to end leave for somebody who is not on it', () => {
    expect(person({ status: 'active' }).endLeave(ctx).ok).toBe(false);
  });

  it('refuses a last working day before the hire date', () => {
    const p = person({ status: 'active', hireDate: '2026-06-01' });
    const impossible = p.terminate('2026-01-01', ctx);
    expect(impossible.ok).toBe(false);
    if (impossible.ok) return;
    expect(impossible.error.code).toBe('LAST_DAY_BEFORE_HIRE');
  });
});

describe('terminated is a tombstone', () => {
  const leaver = () => person({ status: 'terminated', hireDate: '2026-01-01', lastWorkingDay: '2026-08-31' });

  it('cannot be reinstated by starting again', () => {
    // A rehire is a new employment, deliberately entered. If this were
    // reversible, every relation a leaver still carries could be switched back
    // on by anybody who could end one.
    expect(leaver().start(ctx).ok).toBe(false);
  });

  it('cannot be terminated twice', () => {
    expect(leaver().terminate('2026-09-30', ctx).ok).toBe(false);
  });

  it('cannot go on leave', () => {
    expect(leaver().startLeave(ctx).ok).toBe(false);
  });

  it('cannot be discarded, because the record is the history', () => {
    const discarded = leaver().discard(ctx);
    expect(discarded.ok).toBe(false);
    if (discarded.ok) return;
    expect(discarded.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('discarding', () => {
  it('is permitted from provisional', () => {
    // An account provisioned by mistake on a Tuesday holds nobody's employment
    // history. This is the one state a hard delete may follow.
    const p = person();
    expect(p.discard(ctx).ok).toBe(true);
    expect(p.status).toBe('discarded');
    expect(p.deletable).toBe(true);
  });

  it('is refused from every other state', () => {
    for (const status of ['pre_hire', 'active', 'on_leave', 'notice'] as const) {
      expect(person({ status, hireDate: '2026-01-01' }).discard(ctx).ok, status).toBe(false);
    }
  });

  it('leaves every other state undeletable', () => {
    expect(person({ status: 'active' }).deletable).toBe(false);
    expect(person({ status: 'terminated' }).deletable).toBe(false);
  });
});

describe('what each transition raises', () => {
  it('raises one event per transition, in order', () => {
    const p = person();
    p.hire('2026-10-01', ctx);
    p.start(ctx);
    p.giveNotice('2026-12-31', ctx);
    p.terminate('2026-12-31', ctx);

    const raised = p.drainEvents();
    expect(raised.map((e) => e.eventName)).toEqual([
      'people.person.status_changed',
      'people.person.status_changed',
      'people.person.status_changed',
      'people.person.terminated',
    ]);
    expect(raised.map((e) => (e.payload as { previous?: string }).previous ?? 'n/a')).toEqual([
      'provisional',
      'pre_hire',
      'active',
      'n/a',
    ]);
  });

  it('raises nothing when a transition refuses', () => {
    // A refusal that had already moved the aggregate is the failure mode a
    // Result-returning domain exists to prevent.
    const p = person({ status: 'terminated', hireDate: '2026-01-01' });
    p.start(ctx);
    expect(p.drainEvents()).toEqual([]);
    expect(p.status).toBe('terminated');
  });

  it('drains once', () => {
    const p = person();
    p.discard(ctx);
    expect(p.drainEvents()).toHaveLength(1);
    expect(p.drainEvents()).toHaveLength(0);
  });
});
