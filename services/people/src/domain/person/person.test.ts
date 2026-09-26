import { describe, expect, it } from 'vitest';
import { ChangedAttribute } from '@kithena/contracts';
import { fixedClock } from '@kithena/domain-kit';

import {
  hireFactsOf,
  identityFactsOf,
  Person,
  type EventContext,
  type HireFacts,
  type PersonSnapshot,
} from './person.js';

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
/** After the last working days these tests use, so a termination on one is allowed. */
const after = context('2027-01-04T09:00:00.000Z');
const UTC = 'Etc/UTC';
const resigned = { reason: 'resigned' } as const;

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

/** What `people.person.hired` carries beyond the aggregate's own columns. */
const HIRED: HireFacts = {
  legalEntityId: '00000000-0000-4000-8000-0000000000e1',
  name: { given: 'Ada', family: 'Lovelace', preferred: null },
  workEmail: 'ada@acme.test',
  managerId: null,
  orgUnitId: null,
  schemaVersion: 3,
  sourceOfRecord: 'own',
};

describe('the path a record actually takes', () => {
  it('runs provisional, pre-hire, active', () => {
    const p = person();
    expect(p.hire('2026-10-01', HIRED, ctx, 'Etc/UTC').ok).toBe(true);
    expect(p.status).toBe('pre_hire');
    expect(p.start(context('2026-10-01T09:00:00.000Z'), 'Etc/UTC').ok).toBe(true);
    expect(p.status).toBe('active');
  });

  it('lets a hire that is already in the past go straight to active', () => {
    // A record entered for somebody who started last month. Making an admin
    // perform two transitions to catch up would be a data-entry ritual.
    const p = person();
    expect(p.hire('2026-09-01', HIRED, ctx, 'Etc/UTC').ok).toBe(true);
    expect(p.status).toBe('active');
  });

  it('goes on leave and comes back', () => {
    const p = person({ status: 'active' });
    expect(p.startLeave(ctx, UTC).ok).toBe(true);
    expect(p.status).toBe('on_leave');
    expect(p.endLeave(ctx, UTC).ok).toBe(true);
    expect(p.status).toBe('active');
  });

  it('serves notice and then leaves', () => {
    const p = person({ status: 'active' });
    expect(p.giveNotice('2026-12-31', ctx, UTC).ok).toBe(true);
    expect(p.status).toBe('notice');
    expect(p.terminate('2026-12-31', after, UTC, resigned).ok).toBe(true);
    expect(p.status).toBe('terminated');
  });

  it('remembers the last working day notice was given for', () => {
    // Read by the repository writing the row and by the retention job, which
    // counts its schedule from the end of the employment rather than from the
    // day somebody last opened the file.
    const p = person({ status: 'active' });
    expect(p.lastWorkingDay).toBeNull();
    p.giveNotice('2026-12-31', ctx, UTC);
    expect(p.lastWorkingDay).toBe('2026-12-31');
  });

  it('lets somebody on leave resign without coming back first', () => {
    const p = person({ status: 'on_leave' });
    expect(p.giveNotice('2026-12-31', ctx, UTC).ok).toBe(true);
  });
});

describe('what is refused', () => {
  it('refuses to hire a record twice', () => {
    const p = person({ status: 'active', hireDate: '2026-01-01' });
    const again = p.hire('2027-01-01', HIRED, ctx, 'Etc/UTC');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('INVALID_TRANSITION');
  });

  it('refuses to start somebody nobody hired', () => {
    expect(person().start(ctx, 'Etc/UTC').ok).toBe(false);
  });

  it('refuses leave for somebody who has not started', () => {
    expect(person({ status: 'pre_hire', hireDate: '2026-12-01' }).startLeave(ctx, UTC).ok).toBe(false);
  });

  it('refuses to end leave for somebody who is not on it', () => {
    expect(person({ status: 'active' }).endLeave(ctx, UTC).ok).toBe(false);
  });

  it('refuses a last working day before the hire date', () => {
    const p = person({ status: 'active', hireDate: '2026-06-01' });
    const impossible = p.terminate('2026-01-01', after, UTC, resigned);
    expect(impossible.ok).toBe(false);
    if (impossible.ok) return;
    expect(impossible.error.code).toBe('LAST_DAY_BEFORE_HIRE');
  });
});

describe('terminated is a tombstone', () => {
  const leaver = () =>
    person({ status: 'terminated', hireDate: '2026-01-01', lastWorkingDay: '2026-08-31' });

  it('cannot be reinstated by starting again', () => {
    // A rehire is a new employment, deliberately entered. If this were
    // reversible, every relation a leaver still carries could be switched back
    // on by anybody who could end one.
    expect(leaver().start(ctx, 'Etc/UTC').ok).toBe(false);
  });

  it('cannot be terminated twice', () => {
    expect(leaver().terminate('2026-09-30', after, UTC, resigned).ok).toBe(false);
  });

  it('cannot go on leave', () => {
    expect(leaver().startLeave(ctx, UTC).ok).toBe(false);
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

describe('starting on the start date (§8.1)', () => {
  const preHire = () => person({ status: 'pre_hire', hireDate: '2026-10-01' });

  it('takes effect on the start date, whenever it is recorded', () => {
    const p = preHire();
    expect(p.start(context('2026-10-03T09:00:00.000Z'), 'Etc/UTC').ok).toBe(true);
    const raised = p.drainEvents();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      eventName: 'people.person.status_changed',
      effectiveFrom: '2026-10-01',
      payload: { previous: 'pre_hire', next: 'active', reason: 'started' },
    });
  });

  it('refuses before the start date has begun on the person’s own calendar', () => {
    // 2026-09-30T12:00Z is already 1 October in Auckland and still 30
    // September in Los Angeles.
    const at = context('2026-09-30T12:00:00.000Z');
    expect(preHire().start(at, 'Pacific/Auckland').ok).toBe(true);
    const early = preHire();
    const refused = early.start(at, 'America/Los_Angeles');
    expect(!refused.ok && refused.error.code).toBe('NOT_STARTED_YET');
    expect(early.status).toBe('pre_hire');
    expect(early.drainEvents()).toEqual([]);
  });
});

describe('what each transition raises', () => {
  it('raises a status change for every move, and a hire and a termination beside theirs', () => {
    const p = person();
    p.hire('2026-10-01', HIRED, ctx, 'Etc/UTC');
    p.start(context('2026-10-01T09:00:00.000Z'), 'Etc/UTC');
    p.giveNotice('2026-12-31', ctx, UTC);
    p.terminate('2026-12-31', after, UTC, resigned);

    const raised = p.drainEvents();
    expect(raised.map((e) => e.eventName)).toEqual([
      'people.person.status_changed',
      'people.person.hired',
      'people.person.status_changed',
      'people.person.status_changed',
      'people.person.status_changed',
      'people.person.terminated',
    ]);
    expect(raised.map((e) => (e.payload as { previous?: string }).previous ?? 'n/a')).toEqual([
      'provisional',
      'n/a',
      'pre_hire',
      'active',
      'notice',
      'n/a',
    ]);
  });

  it('raises nothing when a transition refuses', () => {
    // A refusal that had already moved the aggregate is the failure mode a
    // Result-returning domain exists to prevent.
    const p = person({ status: 'terminated', hireDate: '2026-01-01' });
    p.start(ctx, 'Etc/UTC');
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

describe('the facts identity keeps a copy of', () => {
  const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
  const facts = {
    name: { given: 'Ada', family: 'Lovelace', preferred: null },
    employmentStart: '2026-10-01',
  };

  it('are told to identity for a linked person, with the account named', () => {
    const p = person({ status: 'active', hireDate: '2026-10-01' });
    expect(p.shareIdentityFacts(facts, ctx, '2026-10-01')).toBe(true);
    const [event] = p.drainEvents();
    expect(event).toMatchObject({
      eventName: 'people.person.identity_facts_changed',
      effectiveFrom: '2026-10-01',
      payload: { personId: PERSON, identityAccountId: ACCOUNT, ...facts },
    });
  });

  it('are told to nobody for a person with no account', () => {
    // An import of four hundred people creates four hundred records and no
    // logins. There is no cached copy to correct, so there is no event.
    const p = person({ status: 'active', identityAccountId: null });
    expect(p.shareIdentityFacts(facts, ctx, null)).toBe(false);
    expect(p.drainEvents()).toEqual([]);
  });

  it('are not told when there is nothing to tell', () => {
    const p = person({ status: 'active' });
    expect(p.shareIdentityFacts({ name: null, employmentStart: null }, ctx, null)).toBe(false);
    expect(p.drainEvents()).toEqual([]);
  });

  it('name the account on every profile update too', () => {
    const p = person({ status: 'active' });
    p.updateProfile(
      [
        ChangedAttribute.parse({
          key: 'job_title',
          sectionKey: 'job',
          classification: 'internal',
          encrypted: false,
        }),
      ],
      1,
      ctx,
      null,
    );
    expect(p.drainEvents()[0]?.payload).toMatchObject({ identityAccountId: ACCOUNT });
  });
});

describe('a value dated in the future, on its day (PEO-124)', () => {
  const title = ChangedAttribute.parse({
    key: 'job_title',
    sectionKey: 'job',
    classification: 'internal',
    encrypted: false,
  });

  it('says it is now in force, effective from its own day rather than the run', () => {
    const p = person({ status: 'active' });
    expect(p.attributesInForce([title], 4, ctx, '2026-09-20').ok).toBe(true);
    expect(p.drainEvents()).toEqual([
      expect.objectContaining({
        eventName: 'people.person.attribute_effective',
        effectiveFrom: '2026-09-20',
        payload: {
          personId: PERSON,
          identityAccountId: '00000000-0000-4000-8000-0000000000b1',
          changed: [title],
          schemaVersion: 4,
        },
      }),
    ]);
  });

  it('says once that a scheduled value was refused on its day, with the code and never the value', () => {
    const p = person({ status: 'notice' });
    p.refuseScheduled(
      { historyId: '01890000-0000-7000-8000-0000000000f1', attributeKey: 'legal_entity_id', code: 'TRANSFER_ON_NOTICE' },
      ctx,
      '2026-10-10',
    );
    expect(p.drainEvents()).toEqual([
      expect.objectContaining({
        eventName: 'people.person.scheduled_change_refused',
        effectiveFrom: '2026-10-10',
        payload: {
          personId: PERSON,
          historyId: '01890000-0000-7000-8000-0000000000f1',
          attributeKey: 'legal_entity_id',
          reason: 'TRANSFER_ON_NOTICE',
        },
      }),
    ]);
  });

  it('brings nothing into force on a tombstone, or with nothing to bring', () => {
    const gone = person({ status: 'terminated' });
    expect(gone.attributesInForce([title], 4, ctx, '2026-09-20').ok).toBe(false);
    expect(person({ status: 'active' }).attributesInForce([], 4, ctx, '2026-09-20').ok).toBe(false);
  });
});

describe('hiring', () => {
  const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';

  it('says who was hired, under which schema version, and from which source', () => {
    // §10.2: `hired` gains `schemaVersion` and `sourceOfRecord`, and names the
    // account so identity needs no lookup to correct its copy.
    const p = person();
    p.hire('2026-10-01', HIRED, ctx, 'Etc/UTC');
    const hired = p.drainEvents().find((e) => e.eventName === 'people.person.hired');
    expect(hired).toMatchObject({
      effectiveFrom: '2026-10-01',
      payload: {
        personId: PERSON,
        identityAccountId: ACCOUNT,
        legalEntityId: HIRED.legalEntityId,
        name: HIRED.name,
        workEmail: 'ada@acme.test',
        employment: { from: '2026-10-01', to: null },
        status: 'pending',
        managerId: null,
        orgUnitId: null,
        schemaVersion: 3,
        sourceOfRecord: 'own',
      },
    });
  });

  it('reads as active when the start date has already arrived', () => {
    const p = person();
    p.hire('2026-09-01', HIRED, ctx, 'Etc/UTC');
    const hired = p.drainEvents().find((e) => e.eventName === 'people.person.hired');
    expect(hired?.payload).toMatchObject({ status: 'active' });
  });

  it('names no account for a person without one', () => {
    const p = person({ identityAccountId: null });
    p.hire('2026-10-01', HIRED, ctx, 'Etc/UTC');
    const hired = p.drainEvents().find((e) => e.eventName === 'people.person.hired');
    expect(hired?.payload).toMatchObject({ identityAccountId: null });
  });

  it('raises nothing when the hire is refused', () => {
    const p = person({ status: 'active', hireDate: '2026-01-01' });
    p.hire('2026-10-01', HIRED, ctx, 'Etc/UTC');
    expect(p.drainEvents()).toEqual([]);
  });
});

describe('the lifecycle dates, as history', () => {
  // A correction supersedes a history row. Without one for the hire date and
  // the last working day, neither could ever be corrected.

  it('records the hire date, effective on it, tied to the hire', () => {
    const p = person();
    p.hire('2026-10-01', HIRED, ctx, 'Etc/UTC');
    const hired = p.drainEvents().find((e) => e.eventName === 'people.person.hired');
    const [row, ...rest] = p.drainHistory();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      attributeKey: 'hire_date',
      value: '2026-10-01',
      effectiveFrom: '2026-10-01',
      supersedes: null,
      eventId: hired?.eventId,
      actor: ctx.actor,
    });
    expect(p.drainHistory()).toEqual([]);
  });

  it('records the last working day when notice is given, and again only if termination moves it', () => {
    const p = person({ status: 'active', hireDate: '2026-01-01' });
    p.giveNotice('2026-12-31', ctx, UTC);
    expect(p.drainHistory().map((e) => [e.attributeKey, e.value, e.effectiveFrom])).toEqual([
      ['last_working_day', '2026-12-31', '2026-12-31'],
    ]);
    p.terminate('2026-12-31', after, UTC, resigned);
    expect(p.drainHistory()).toEqual([]);

    const early = person({
      status: 'notice',
      hireDate: '2026-01-01',
      lastWorkingDay: '2026-12-31',
    });
    early.terminate('2026-11-30', after, UTC, resigned);
    expect(early.drainHistory().map((e) => e.value)).toEqual(['2026-11-30']);
  });

  it('records nothing when a transition is refused', () => {
    const p = person({ status: 'active', hireDate: '2026-06-01' });
    p.terminate('2026-01-01', after, UTC, resigned);
    p.hire('2026-10-01', HIRED, ctx, 'Etc/UTC');
    expect(p.drainHistory()).toEqual([]);
  });
});

describe('what a hire has to know', () => {
  const values = {
    given_name: 'Ada',
    family_name: 'Lovelace',
    work_email: 'ada@acme.test',
    manager_id: '00000000-0000-4000-8000-0000000000a2',
  };

  it('reads the name, the email and the placement off the record', () => {
    const facts = hireFactsOf(values, null, 3);
    expect(facts.ok && facts.value).toEqual({
      legalEntityId: null,
      name: { given: 'Ada', family: 'Lovelace', preferred: null },
      workEmail: 'ada@acme.test',
      managerId: '00000000-0000-4000-8000-0000000000a2',
      orgUnitId: null,
      schemaVersion: 3,
      sourceOfRecord: 'own',
    });
  });

  it('refuses a hire with no name or no work email, and says which', () => {
    // §14.4: there is no such thing as a person record without these.
    const facts = hireFactsOf({ given_name: 'Ada' }, null, 3);
    expect(!facts.ok && facts.error).toMatchObject({
      code: 'HIRE_INCOMPLETE',
      path: ['family_name', 'work_email'],
    });
  });
});

describe('correcting the hire date', () => {
  it('moves the date the record holds', () => {
    const p = person({ status: 'pre_hire', hireDate: '2026-10-01' });
    expect(p.correctHireDate('2026-11-01', ctx, 'Etc/UTC').ok).toBe(true);
    expect(p.hireDate).toBe('2026-11-01');
    expect(p.status).toBe('pre_hire');
    // The correction's own event is `attribute_corrected`, raised by the caller.
    expect(p.drainEvents()).toEqual([]);
  });

  it('starts a pre-hire whose corrected start date has already arrived', () => {
    // §8.1: pre_hire is "a start date in the future", active is "started".
    // A start date corrected into the past leaves nothing in the future.
    const p = person({ status: 'pre_hire', hireDate: '2026-10-01' });
    expect(p.correctHireDate('2026-09-01', ctx, 'Etc/UTC').ok).toBe(true);
    expect(p.status).toBe('active');
    const [moved] = p.drainEvents();
    expect(moved).toMatchObject({
      eventName: 'people.person.status_changed',
      effectiveFrom: '2026-09-01',
      payload: { previous: 'pre_hire', next: 'active', reason: 'corrected' },
    });
  });

  it('counts today as arrived, in the tenant’s calendar', () => {
    const p = person({ status: 'pre_hire', hireDate: '2026-10-01' });
    p.correctHireDate('2026-09-22', ctx, 'Europe/Madrid');
    expect(p.status).toBe('active');
  });

  it('returns an active record to pre-hire when the corrected start is still to come', () => {
    // §8.1: a start date corrected into the future says they have not started.
    // The move takes effect from the start date it corrects, which is when the
    // record wrongly became active (§8.5).
    const p = person({ status: 'active', hireDate: '2026-09-01' });
    expect(p.correctHireDate('2026-12-01', ctx, 'Etc/UTC').ok).toBe(true);
    expect(p.status).toBe('pre_hire');
    expect(p.hireDate).toBe('2026-12-01');
    const [moved, ...rest] = p.drainEvents();
    expect(rest).toEqual([]);
    expect(moved).toMatchObject({
      eventName: 'people.person.status_changed',
      effectiveFrom: '2026-09-01',
      payload: { previous: 'active', next: 'pre_hire', reason: 'corrected' },
    });
  });

  it('keeps an active record active when the corrected start is today, in the tenant’s calendar', () => {
    const p = person({ status: 'active', hireDate: '2026-09-01' });
    p.correctHireDate('2026-09-22', ctx, 'Europe/Madrid');
    expect(p.status).toBe('active');
    expect(p.drainEvents()).toEqual([]);
  });

  it('names the correction as the cause, which is where its supersedes is', () => {
    const p = person({ status: 'active', hireDate: '2026-09-01' });
    p.correctHireDate('2026-12-01', { ...ctx, causationId: 'the-correction' }, 'Etc/UTC');
    expect(p.drainEvents()[0]?.causationId).toBe('the-correction');
  });

  it('leaves a record on leave or on notice alone, whatever the corrected start', () => {
    for (const status of ['on_leave', 'notice'] as const) {
      const p = person({
        status,
        hireDate: '2026-09-01',
        lastWorkingDay: status === 'notice' ? '2027-06-30' : null,
      });
      expect(p.correctHireDate('2026-12-01', ctx, 'Etc/UTC').ok).toBe(true);
      expect(p.status).toBe(status);
      expect(p.drainEvents()).toEqual([]);
    }
  });

  it('leaves a terminated record terminated', () => {
    const p = person({
      status: 'terminated',
      hireDate: '2026-01-01',
      lastWorkingDay: '2026-06-30',
    });
    expect(p.correctHireDate('2026-02-01', ctx, 'Etc/UTC').ok).toBe(true);
    expect(p.status).toBe('terminated');
  });

  it('refuses a hire date after the last working day', () => {
    const p = person({
      status: 'terminated',
      hireDate: '2026-01-01',
      lastWorkingDay: '2026-06-30',
    });
    const late = p.correctHireDate('2026-07-01', ctx, 'Etc/UTC');
    expect(!late.ok && late.error.code).toBe('LAST_DAY_BEFORE_HIRE');
    expect(p.hireDate).toBe('2026-01-01');
  });

  it('refuses a discarded record, which holds nothing', () => {
    expect(person({ status: 'discarded' }).correctHireDate('2026-10-01', ctx, 'Etc/UTC').ok).toBe(
      false,
    );
  });
});

describe('correcting the last working day', () => {
  it('moves the date the record holds, and nothing else', () => {
    // §8.1 ends employment by an explicit transition, not by a date passing,
    // so a notice period corrected to have ended does not terminate anybody:
    // the record stays on notice, and HR's grid asks for the termination.
    const p = person({ status: 'notice', hireDate: '2026-01-01', lastWorkingDay: '2026-12-31' });
    expect(p.correctLastWorkingDay('2026-09-01').ok).toBe(true);
    expect(p.lastWorkingDay).toBe('2026-09-01');
    expect(p.status).toBe('notice');
    expect(p.drainEvents()).toEqual([]);
  });

  it('corrects a tombstone, which an auditor still reads', () => {
    const p = person({
      status: 'terminated',
      hireDate: '2026-01-01',
      lastWorkingDay: '2026-06-30',
    });
    expect(p.correctLastWorkingDay('2026-07-31').ok).toBe(true);
    expect(p.lastWorkingDay).toBe('2026-07-31');
  });

  it('refuses a last working day before the hire date', () => {
    const p = person({ status: 'notice', hireDate: '2026-06-01', lastWorkingDay: '2026-12-31' });
    const early = p.correctLastWorkingDay('2026-05-31');
    expect(!early.ok && early.error.code).toBe('LAST_DAY_BEFORE_HIRE');
    expect(p.lastWorkingDay).toBe('2026-12-31');
  });

  it('refuses to invent one for a record that has none', () => {
    // A last working day exists once notice is given; a correction supersedes
    // one, it does not put an active employee on notice.
    const early = person({ status: 'active', hireDate: '2026-01-01' }).correctLastWorkingDay(
      '2026-12-31',
    );
    expect(!early.ok && early.error.code).toBe('NO_LAST_WORKING_DAY');
  });

  it('refuses a discarded record', () => {
    expect(person({ status: 'discarded' }).correctLastWorkingDay('2026-10-01').ok).toBe(false);
  });
});

describe('reading the facts off a record', () => {
  it('takes a full legal name and the hire date', () => {
    expect(
      identityFactsOf({
        given_name: 'Ada',
        family_name: 'Lovelace',
        preferred_name: 'Countess',
        hire_date: '2026-10-01',
        job_title: 'ignored',
      }),
    ).toEqual({
      name: { given: 'Ada', family: 'Lovelace', preferred: 'Countess' },
      employmentStart: '2026-10-01',
    });
  });

  it('sends no name rather than half of one', () => {
    // Identity's row refuses a given name without a family name, and a
    // consumer that stalls on a check constraint stalls the whole partition.
    expect(identityFactsOf({ given_name: 'Ada' })).toEqual({ name: null, employmentStart: null });
  });

  it('reads an empty preferred name as none', () => {
    expect(
      identityFactsOf({ given_name: 'Ada', family_name: 'Lovelace', preferred_name: '' }).name,
    ).toEqual({ given: 'Ada', family: 'Lovelace', preferred: null });
  });
});

describe('the reporting line and the org, which authorization is derived from', () => {
  const BOSS = '00000000-0000-4000-8000-0000000000a2';
  const NEW_BOSS = '00000000-0000-4000-8000-0000000000a3';

  it('raises manager_changed with both managers, effective when the move is', () => {
    // OpenFGA's reporting-line tuples are rewritten from this event (PEO-092);
    // `profile_updated` names the key and never the value, so it cannot.
    const p = person({ status: 'active' });
    expect(p.moveManager(BOSS, NEW_BOSS, ctx, '2026-10-01')).toBe(true);
    const [event] = p.drainEvents();
    expect(event).toMatchObject({
      eventName: 'people.person.manager_changed',
      effectiveFrom: '2026-10-01',
      payload: { personId: PERSON, previousManagerId: BOSS, managerId: NEW_BOSS },
    });
  });

  it('raises nothing when the manager did not move', () => {
    const p = person({ status: 'active' });
    expect(p.moveManager(BOSS, BOSS, ctx, null)).toBe(false);
    expect(p.drainEvents()).toEqual([]);
  });

  it('raises org_changed with where the person now sits', () => {
    const p = person({ status: 'active' });
    const org = {
      orgUnitId: '00000000-0000-4000-8000-0000000000f1',
      costCentre: null,
      legalEntityId: null,
      locationId: null,
    };
    p.moveOrg(org, ctx, '2026-10-01');
    expect(p.drainEvents()[0]).toMatchObject({
      eventName: 'people.person.org_changed',
      payload: { personId: PERSON, ...org },
    });
  });
});

describe('ending employment, and leave, on the person’s own calendar (PEO-108)', () => {
  const active = () => person({ status: 'active', hireDate: '2026-01-01' });
  // 2026-09-30T12:00Z is already 1 October in Auckland and still 30 September
  // in Los Angeles.
  const noonUtc = context('2026-09-30T12:00:00.000Z');

  it('dates leave and notice from the day it is where the person works', () => {
    const p = active();
    p.startLeave(noonUtc, 'Pacific/Auckland');
    p.endLeave(noonUtc, 'America/Los_Angeles');
    p.giveNotice('2026-12-31', noonUtc, 'Pacific/Auckland', 'dismissed');
    expect(
      p.drainEvents().map((e) => [(e.payload as { reason: string }).reason, e.effectiveFrom]),
    ).toEqual([
      ['leave_started', '2026-10-01'],
      ['leave_ended', '2026-09-30'],
      ['dismissed', '2026-10-01'],
    ]);
  });

  it('gives notice as a resignation unless told otherwise', () => {
    const p = active();
    p.giveNotice('2026-12-31', ctx, UTC);
    expect(p.drainEvents()[0]?.payload).toMatchObject({ reason: 'resigned' });
  });

  it('terminates with a typed reason on the status change and the note on the termination', () => {
    const p = person({ status: 'notice', hireDate: '2026-01-01', lastWorkingDay: '2026-09-30' });
    const ended = p.terminate('2026-09-30', noonUtc, 'America/Los_Angeles', {
      reason: 'end_of_contract',
      note: 'Fixed term ran out',
      eligibleForRehire: true,
    });
    expect(ended.ok).toBe(true);
    const [moved, terminated] = p.drainEvents();
    expect(moved).toMatchObject({
      eventName: 'people.person.status_changed',
      effectiveFrom: '2026-09-30',
      payload: { previous: 'notice', next: 'terminated', reason: 'end_of_contract' },
    });
    expect(terminated).toMatchObject({
      eventName: 'people.person.terminated',
      effectiveFrom: '2026-09-30',
      payload: {
        lastWorkingDay: '2026-09-30',
        reason: 'Fixed term ran out',
        eligibleForRehire: true,
      },
    });
  });

  it('refuses to terminate before the last working day has come on their calendar: that is notice', () => {
    // The 1st has begun in Auckland and not in Los Angeles.
    const tomorrowInLa = active();
    const refused = tomorrowInLa.terminate('2026-10-01', noonUtc, 'America/Los_Angeles', resigned);
    expect(!refused.ok && refused.error.code).toBe('LAST_DAY_NOT_REACHED');
    expect(tomorrowInLa.status).toBe('active');
    expect(tomorrowInLa.drainEvents()).toEqual([]);
    expect(tomorrowInLa.drainHistory()).toEqual([]);

    expect(active().terminate('2026-10-01', noonUtc, 'Pacific/Auckland', resigned).ok).toBe(true);
  });

  it('closes a pre-hire who never started on their start date, which has not come yet', () => {
    // Somebody hired who never started still has a record to close, and has
    // no working day in the past to name.
    const p = person({ status: 'pre_hire', hireDate: '2026-11-01' });
    expect(p.terminate('2026-11-01', ctx, UTC, { reason: 'dismissed' }).ok).toBe(true);
    expect(p.status).toBe('terminated');
  });

  it('refuses to terminate a provisional record: that is discarding', () => {
    const refused = person().terminate('2026-09-01', ctx, UTC, resigned);
    expect(!refused.ok && refused.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('access ends with employment (PEO-109)', () => {
  const leaver = (over: Partial<PersonSnapshot> = {}) =>
    person({ status: 'terminated', hireDate: '2026-01-01', lastWorkingDay: '2026-09-30', ...over });
  // 11:30 UTC on 30 September: the 30th has ended in Auckland (UTC+13) and
  // has most of a day left in Los Angeles (UTC-7).
  const aucklandMidnight = context('2026-09-30T11:30:00.000Z');

  it('ends at the midnight after the last working day, where the person works', () => {
    const kiri = leaver();
    expect(kiri.endAccess(aucklandMidnight, 'Pacific/Auckland', 'day_ended').ok).toBe(true);
    expect(kiri.drainEvents()).toMatchObject([
      {
        eventName: 'people.person.access_ended',
        // The first day without access, on their calendar.
        effectiveFrom: '2026-10-01',
        payload: {
          personId: PERSON,
          identityAccountId: '00000000-0000-4000-8000-0000000000b1',
          lastWorkingDay: '2026-09-30',
          endedAt: '2026-09-30T11:00:00.000Z',
          trigger: 'last_working_day_ended',
        },
      },
    ]);
    expect(kiri.accessEndedAt).toBe('2026-09-30T11:00:00.000Z');
  });

  it('waits while the last working day is still going on their calendar', () => {
    const lucy = leaver();
    const early = lucy.endAccess(aucklandMidnight, 'America/Los_Angeles', 'day_ended');
    expect(!early.ok && early.error.code).toBe('LAST_DAY_NOT_ENDED');
    expect(lucy.drainEvents()).toEqual([]);
    expect(lucy.accessEndedAt).toBeNull();

    const later = context('2026-10-01T07:00:00.000Z');
    expect(lucy.endAccess(later, 'America/Los_Angeles', 'day_ended').ok).toBe(true);
    expect(lucy.drainEvents()[0]?.payload).toMatchObject({ endedAt: '2026-10-01T07:00:00.000Z' });
  });

  it('ends once per termination', () => {
    const p = leaver({ accessEndedAt: '2026-09-30T11:00:00.000Z' });
    const again = p.endAccess(after, UTC, 'day_ended');
    expect(!again.ok && again.error.code).toBe('ACCESS_ALREADY_ENDED');
    expect(p.drainEvents()).toEqual([]);
  });

  it('ends only for somebody whose employment has ended', () => {
    for (const status of ['notice', 'active', 'on_leave', 'pre_hire', 'provisional'] as const) {
      const p = person({ status, hireDate: '2026-01-01', lastWorkingDay: '2026-09-30' });
      const refused = p.endAccess(after, UTC, 'now');
      expect(!refused.ok && refused.error.code).toBe('INVALID_TRANSITION');
    }
    for (const status of ['active', 'on_leave', 'pre_hire', 'provisional'] as const) {
      const p = person({ status, hireDate: '2026-01-01', lastWorkingDay: '2026-09-30' });
      const refused = p.endAccess(after, UTC, 'day_ended');
      expect(!refused.ok && refused.error.code).toBe('INVALID_TRANSITION');
    }
  });

  it('ends on notice too once the last day has ended, termination confirmed or not', () => {
    // Confirming the termination is paperwork; ending access is security.
    const kiri = leaver({ status: 'notice' });
    expect(kiri.endAccess(aucklandMidnight, 'Pacific/Auckland', 'day_ended').ok).toBe(true);
    expect(kiri.status).toBe('notice');
    expect(kiri.drainEvents()[0]?.payload).toMatchObject({
      endedAt: '2026-09-30T11:00:00.000Z',
      trigger: 'last_working_day_ended',
    });

    const lucy = leaver({ status: 'notice' });
    const early = lucy.endAccess(aucklandMidnight, 'America/Los_Angeles', 'day_ended');
    expect(!early.ok && early.error.code).toBe('LAST_DAY_NOT_ENDED');

    // HR confirming the termination afterwards raises no second end.
    kiri.terminate('2026-09-30', aucklandMidnight, 'Pacific/Auckland', resigned);
    expect(kiri.accessEndedAt).toBe('2026-09-30T11:00:00.000Z');
    expect(kiri.drainEvents().map((e) => e.eventName)).not.toContain('people.person.access_ended');
  });

  it('ends now when HR says so, for a dismissal for cause, whatever the hour', () => {
    const p = leaver();
    // 09:00 UTC on the last working day itself: the day has not ended anywhere west of Tonga.
    const midMorning = context('2026-09-30T09:00:00.000Z');
    expect(p.endAccess(midMorning, 'Europe/Madrid', 'now').ok).toBe(true);
    expect(p.drainEvents()).toMatchObject([
      {
        eventName: 'people.person.access_ended',
        effectiveFrom: '2026-09-30',
        payload: { endedAt: '2026-09-30T09:00:00.000Z', trigger: 'ended_by_hr' },
      },
    ]);
  });

  it('is raised for somebody with no account too, with nobody for identity to suspend', () => {
    const p = leaver({ identityAccountId: null });
    expect(p.endAccess(after, UTC, 'day_ended').ok).toBe(true);
    expect(p.drainEvents()[0]?.payload).toMatchObject({ identityAccountId: null });
  });
});

describe('employment periods and rehire (PEO-110)', () => {
  const NZ = '00000000-0000-4000-8000-0000000000e1';
  const US = '00000000-0000-4000-8000-0000000000e2';
  const period1 = {
    period: 1,
    legalEntityId: NZ,
    leavingReason: 'resigned',
    eligibleForRehire: true,
    noticeFrom: 'active',
    rehireOverrideReason: null,
  } as const;
  const leaver = (over: Partial<PersonSnapshot> = {}) =>
    person({
      status: 'terminated',
      hireDate: '2024-01-08',
      lastWorkingDay: '2025-06-30',
      accessEndedAt: '2025-06-30T12:00:00.000Z',
      employment: period1,
      ...over,
    });
  // 2026-09-30T12:00Z: already 1 October in Auckland, still the 30th in Los Angeles.
  const noonUtc = context('2026-09-30T12:00:00.000Z');

  it('records each hire as a period, and notice and termination on it', () => {
    const p = person();
    p.hire('2026-10-01', HIRED, ctx, UTC);
    expect(p.drainPeriod()).toEqual({
      period: 1,
      legalEntityId: HIRED.legalEntityId,
      startedOn: '2026-10-01',
      lastWorkingDay: null,
      leavingReason: null,
      eligibleForRehire: null,
      noticeFrom: null,
      rehireOverrideReason: null,
    });
    expect(p.drainPeriod()).toBeNull();

    const onLeave = person({ status: 'on_leave', hireDate: '2026-01-01' });
    onLeave.giveNotice('2026-12-31', ctx, UTC, 'resigned');
    onLeave.terminate('2026-12-31', after, UTC, { reason: 'resigned', eligibleForRehire: false });
    expect(onLeave.drainPeriod()).toMatchObject({
      // A record from before periods existed is its first.
      period: 1,
      lastWorkingDay: '2026-12-31',
      noticeFrom: 'on_leave',
      leavingReason: 'resigned',
      eligibleForRehire: false,
    });
  });

  it('rehires into a new period on the same record, pre-hire until the start on their calendar', () => {
    const p = leaver();
    // The 1st has begun in Auckland, not in Los Angeles.
    expect(p.rehire('2026-10-01', { ...HIRED, legalEntityId: US }, noonUtc, 'America/Los_Angeles').ok).toBe(true);
    expect(p.status).toBe('pre_hire');
    expect(p.snapshot).toMatchObject({
      hireDate: '2026-10-01',
      lastWorkingDay: null,
      // Access stays ended until the new start.
      accessEndedAt: '2025-06-30T12:00:00.000Z',
    });
    expect(p.drainPeriod()).toMatchObject({
      period: 2,
      legalEntityId: US,
      startedOn: '2026-10-01',
      lastWorkingDay: null,
      leavingReason: null,
      eligibleForRehire: null,
    });
    expect(p.drainEvents().map((e) => [e.eventName, e.effectiveFrom, e.payload])).toEqual([
      [
        'people.person.status_changed',
        '2026-10-01',
        { personId: PERSON, previous: 'terminated', next: 'pre_hire', reason: 'rehired' },
      ],
      [
        'people.person.hired',
        '2026-10-01',
        expect.objectContaining({
          identityAccountId: '00000000-0000-4000-8000-0000000000b1',
          legalEntityId: US,
          employment: { from: '2026-10-01', to: null },
          status: 'pending',
        }),
      ],
    ]);
    // History: the new start, and no end date from it on.
    expect(p.drainHistory().map((h) => [h.attributeKey, h.value, h.effectiveFrom])).toEqual([
      ['hire_date', '2026-10-01', '2026-10-01'],
      ['last_working_day', null, '2026-10-01'],
    ]);

    // Their first day: active, and access back.
    expect(p.start(context('2026-10-01T08:00:00.000Z'), 'America/Los_Angeles').ok).toBe(true);
    expect(p.drainEvents().map((e) => [e.eventName, e.effectiveFrom])).toEqual([
      ['people.person.status_changed', '2026-10-01'],
      ['people.person.access_restored', '2026-10-01'],
    ]);
    expect(p.accessEndedAt).toBeNull();
  });

  it('rehires straight to active, with access back, when the start has come', () => {
    const p = leaver();
    expect(p.rehire('2026-10-01', HIRED, noonUtc, 'Pacific/Auckland').ok).toBe(true);
    expect(p.status).toBe('active');
    const restored = p.drainEvents().find((e) => e.eventName === 'people.person.access_restored');
    expect(restored).toMatchObject({
      effectiveFrom: '2026-10-01',
      payload: {
        personId: PERSON,
        identityAccountId: '00000000-0000-4000-8000-0000000000b1',
        restoredAt: '2026-09-30T12:00:00.000Z',
        reason: 'rehired',
      },
    });
  });

  it('refuses somebody marked not eligible, unless HR overrides with a reason it keeps', () => {
    const barred = { ...period1, eligibleForRehire: false } as const;
    const refused = leaver({ employment: barred }).rehire('2026-10-01', HIRED, noonUtc, UTC);
    expect(!refused.ok && refused.error.code).toBe('NOT_ELIGIBLE_FOR_REHIRE');
    const blank = leaver({ employment: barred }).rehire('2026-10-01', HIRED, noonUtc, UTC, '  ');
    expect(!blank.ok && blank.error.code).toBe('NOT_ELIGIBLE_FOR_REHIRE');

    const p = leaver({ employment: barred });
    expect(p.rehire('2026-10-01', HIRED, noonUtc, UTC, 'Cleared on appeal').ok).toBe(true);
    expect(p.drainPeriod()).toMatchObject({ period: 2, rehireOverrideReason: 'Cleared on appeal' });
    // Its own audit event: who (the envelope's actor), whom, which period, why. Nothing else.
    const override = p.drainEvents().filter((e) => e.eventName === 'people.person.rehire_override');
    expect(override).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-10-01',
        actor: { kind: 'system', process: 'test' },
        payload: { personId: PERSON, period: 2, reason: 'Cleared on appeal' },
      }),
    ]);
  });

  it('raises no override event when nothing was overridden', () => {
    const p = leaver();
    p.rehire('2026-10-01', HIRED, noonUtc, UTC, 'Not needed');
    expect(p.drainEvents().map((e) => e.eventName)).not.toContain('people.person.rehire_override');
    expect(p.drainPeriod()).toMatchObject({ rehireOverrideReason: null });
  });

  it('reads an unknown eligibility as not refused', () => {
    const p = leaver({ employment: { ...period1, eligibleForRehire: null } });
    expect(p.rehire('2026-10-01', HIRED, noonUtc, UTC).ok).toBe(true);
  });

  it('refuses from anything but terminated, and a start inside the old employment', () => {
    for (const status of ['provisional', 'pre_hire', 'active', 'on_leave', 'notice', 'discarded'] as const) {
      const r = person({ status, hireDate: '2024-01-08' }).rehire('2026-10-01', HIRED, noonUtc, UTC);
      expect(!r.ok && r.error.code, status).toBe('INVALID_TRANSITION');
    }
    const overlapping = leaver().rehire('2025-06-30', HIRED, noonUtc, UTC);
    expect(!overlapping.ok && overlapping.error.code).toBe('REHIRE_BEFORE_LAST_DAY');
  });
});

describe('withdrawing notice (PEO-111)', () => {
  const noticeRow = { id: '01890000-0000-7000-8000-00000000aaaa', effectiveFrom: '2026-09-30' };
  const onNotice = (noticeFrom: 'active' | 'on_leave' | null = 'active') =>
    person({
      status: 'notice',
      hireDate: '2026-01-01',
      lastWorkingDay: '2026-09-30',
      employment: {
        period: 1,
        legalEntityId: null,
        leavingReason: null,
        eligibleForRehire: null,
        noticeFrom,
        rehireOverrideReason: null,
      },
    });
  // 11:30 UTC on 30 September: the 30th has ended in Auckland, not in Los Angeles.
  const aucklandMidnight = context('2026-09-30T11:30:00.000Z');

  it('returns them to the status they gave notice from, dated today on their calendar', () => {
    const p = onNotice('on_leave');
    expect(p.withdrawNotice(aucklandMidnight, 'America/Los_Angeles', noticeRow).ok).toBe(true);
    expect(p.status).toBe('on_leave');
    expect(p.lastWorkingDay).toBeNull();
    expect(p.drainEvents().map((e) => [e.eventName, e.effectiveFrom, e.payload])).toEqual([
      [
        'people.person.status_changed',
        '2026-09-30',
        { personId: PERSON, previous: 'notice', next: 'on_leave', reason: 'notice_withdrawn' },
      ],
    ]);
    expect(p.drainPeriod()).toMatchObject({ lastWorkingDay: null, noticeFrom: null });
  });

  it('supersedes the notice’s last working day, from the date it was effective (§8.5)', () => {
    const p = onNotice();
    p.withdrawNotice(aucklandMidnight, 'America/Los_Angeles', noticeRow);
    const [event] = p.drainEvents();
    expect(p.drainHistory()).toEqual([
      expect.objectContaining({
        attributeKey: 'last_working_day',
        value: null,
        effectiveFrom: '2026-09-30',
        supersedes: noticeRow.id,
        eventId: event?.eventId,
      }),
    ]);
    expect(p.status).toBe('active');
  });

  it('is refused once the last working day has ended on their calendar', () => {
    const p = onNotice();
    const late = p.withdrawNotice(aucklandMidnight, 'Pacific/Auckland', noticeRow);
    expect(!late.ok && late.error.code).toBe('LAST_DAY_ENDED');
    expect(p.status).toBe('notice');
    expect(p.drainEvents()).toEqual([]);
  });

  it('reads a notice from before periods recorded where from as active', () => {
    const p = onNotice(null);
    expect(p.withdrawNotice(aucklandMidnight, 'America/Los_Angeles', null).ok).toBe(true);
    expect(p.status).toBe('active');
    expect(p.drainHistory()).toEqual([]);
  });

  it('is refused for anybody not on notice', () => {
    for (const status of ['active', 'on_leave', 'terminated', 'pre_hire'] as const) {
      const r = person({ status, hireDate: '2026-01-01' }).withdrawNotice(ctx, UTC, null);
      expect(!r.ok && r.error.code, status).toBe('INVALID_TRANSITION');
    }
  });
});

describe('correcting a notice’s last working day forward after access ended', () => {
  // Access ended at the end of 30 September, Auckland (11:00 UTC on the 30th).
  const ended = (over: Partial<PersonSnapshot> = {}) =>
    person({
      status: 'notice',
      hireDate: '2026-01-01',
      lastWorkingDay: '2026-09-30',
      accessEndedAt: '2026-09-30T11:00:00.000Z',
      ...over,
    });
  // 11:30 UTC on 1 October: the 1st has ended nowhere west of Kiritimati; it is
  // the 2nd in Auckland from 11:00 UTC, still the 1st in Los Angeles.
  const at = context('2026-10-01T11:30:00.000Z');

  it('restores access when the corrected day has not ended on their calendar', () => {
    const p = ended();
    expect(p.correctLastWorkingDay('2026-10-01', at, 'America/Los_Angeles').ok).toBe(true);
    expect(p.accessEndedAt).toBeNull();
    expect(p.drainEvents()).toMatchObject([
      {
        eventName: 'people.person.access_restored',
        effectiveFrom: '2026-10-01',
        payload: {
          personId: PERSON,
          restoredAt: '2026-10-01T11:30:00.000Z',
          reason: 'last_working_day_corrected',
        },
      },
    ]);
    // …and the job can end it again when the new day ends.
    expect(p.endAccess(context('2026-10-02T07:00:00.000Z'), 'America/Los_Angeles', 'day_ended').ok).toBe(true);
  });

  it('keeps it ended when the corrected day has already ended where they work', () => {
    const p = ended();
    expect(p.correctLastWorkingDay('2026-10-01', at, 'Pacific/Auckland').ok).toBe(true);
    expect(p.accessEndedAt).toBe('2026-09-30T11:00:00.000Z');
    expect(p.drainEvents()).toEqual([]);
  });

  it('restores nothing for a correction backwards, or for a terminated record', () => {
    const back = ended({ lastWorkingDay: '2026-09-30' });
    back.correctLastWorkingDay('2026-09-29', at, 'America/Los_Angeles');
    expect(back.drainEvents()).toEqual([]);

    const left = ended({ status: 'terminated' });
    left.correctLastWorkingDay('2026-10-01', at, 'America/Los_Angeles');
    expect(left.accessEndedAt).toBe('2026-09-30T11:00:00.000Z');
    expect(left.drainEvents()).toEqual([]);
  });
});

describe('placement and transfer (PEO-123)', () => {
  const ES = '00000000-0000-4000-8000-0000000000e1';
  const PT = '00000000-0000-4000-8000-0000000000e2';
  const inSpain = {
    period: 1,
    legalEntityId: ES,
    leavingReason: null,
    eligibleForRehire: null,
    noticeFrom: null,
    rehireOverrideReason: null,
    startedOn: '2024-01-08',
  } as const;
  const employed = (over: Partial<PersonSnapshot> = {}) =>
    person({ status: 'active', hireDate: '2024-01-08', employment: inSpain, ...over });

  it('is a transfer when an employee changes legal entity: one period closes, the next opens', () => {
    const p = employed();
    const placed = p.place(PT, '2026-10-01');
    expect(placed.ok && placed.value).toBe('transferred');
    expect(p.drainClosedPeriod()).toEqual({ ...inSpain, lastWorkingDay: '2026-09-30' });
    expect(p.drainPeriod()).toEqual({
      period: 2,
      legalEntityId: PT,
      startedOn: '2026-10-01',
      lastWorkingDay: null,
      leavingReason: null,
      eligibleForRehire: null,
      noticeFrom: null,
      rehireOverrideReason: null,
    });
    // Continuous service: the hire date, the status and access are the employment's, untouched.
    expect(p.snapshot).toMatchObject({ status: 'active', hireDate: '2024-01-08', lastWorkingDay: null });
    expect(p.drainEvents()).toEqual([]);
    expect(p.drainClosedPeriod()).toBeNull();
  });

  it('reads the entity a record from before periods was in off the record itself', () => {
    // Period 1 synthesised with no entity; the record says Spain.
    const p = person({ status: 'active', hireDate: '2024-01-08' });
    const placed = p.place(PT, '2026-10-01', ES);
    expect(placed.ok && placed.value).toBe('transferred');
    expect(p.drainClosedPeriod()).toMatchObject({ period: 1, legalEntityId: ES, lastWorkingDay: '2026-09-30' });
    expect(person({ status: 'active', hireDate: '2024-01-08' }).place(ES, '2026-10-01', ES)).toEqual({
      ok: true,
      value: 'unchanged',
    });
  });

  it('closes the old period on the last day of a month across a year end', () => {
    const p = employed();
    p.place(PT, '2027-01-01');
    expect(p.drainClosedPeriod()).toMatchObject({ lastWorkingDay: '2026-12-31' });
  });

  it('moves the period itself when there is no earlier employer to leave', () => {
    // A pre-hire has not started anywhere; nobody's first entity is a move.
    for (const p of [
      person({ status: 'pre_hire', hireDate: '2026-11-01', employment: inSpain }),
      employed({ employment: { ...inSpain, legalEntityId: null } }),
    ]) {
      const placed = p.place(PT, '2026-10-01');
      expect(placed.ok && placed.value).toBe('placed');
      expect(p.drainClosedPeriod()).toBeNull();
      expect(p.drainPeriod()).toMatchObject({ period: 1, legalEntityId: PT });
    }
  });

  it('re-places the current period for a change dated on or before its start: a correction', () => {
    const p = employed({ employment: { ...inSpain, period: 2, startedOn: '2026-10-01' } });
    const placed = p.place(PT, '2026-10-01');
    expect(placed.ok && placed.value).toBe('placed');
    expect(p.drainClosedPeriod()).toBeNull();
    expect(p.drainPeriod()).toMatchObject({ period: 2, legalEntityId: PT, startedOn: '2026-10-01' });
  });

  it('changes nothing when the entity is the one they are in, or for a record never hired', () => {
    const same = employed();
    expect(same.place(ES, '2026-10-01')).toEqual({ ok: true, value: 'unchanged' });
    expect(same.drainPeriod()).toBeNull();
    const provisional = person();
    expect(provisional.place(PT, '2026-10-01')).toEqual({ ok: true, value: 'unchanged' });
    expect(provisional.drainPeriod()).toBeNull();
  });

  it('refuses a transfer for somebody on notice, and any placement of a leaver', () => {
    const leaving = employed({ status: 'notice', lastWorkingDay: '2026-12-31' }).place(PT, '2026-10-01');
    expect(!leaving.ok && leaving.error.code).toBe('TRANSFER_ON_NOTICE');
    for (const status of ['terminated', 'discarded'] as const) {
      const r = employed({ status }).place(PT, '2026-10-01');
      expect(!r.ok && r.error.code, status).toBe('INVALID_TRANSITION');
    }
  });

  it('keeps a transfer period’s start when the hire date is corrected', () => {
    const p = employed({ employment: { ...inSpain, period: 2, startedOn: '2026-10-01' } });
    expect(p.correctHireDate('2024-01-15', ctx, UTC).ok).toBe(true);
    expect(p.drainPeriod()).toMatchObject({ period: 2, startedOn: '2026-10-01' });
    const first = employed();
    first.correctHireDate('2024-01-15', ctx, UTC);
    expect(first.drainPeriod()).toMatchObject({ period: 1, startedOn: '2024-01-15' });
  });
});

describe('being absorbed by a duplicate (PEO-074)', () => {
  const SURVIVOR = '00000000-0000-4000-8000-0000000000a9';
  const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
  const survivor = () =>
    person({ id: SURVIVOR, status: 'active', hireDate: '2026-01-05', identityAccountId: null });

  it('leaves a tombstone pointing at the survivor, and hands over its account', () => {
    const absorbed = person();
    const moved = absorbed.absorbInto(survivor().snapshot, ['date_of_birth'], ctx);
    expect(moved).toEqual({ ok: true, value: ACCOUNT });
    expect(absorbed.status).toBe('merged');
    expect(absorbed.snapshot).toMatchObject({ mergedInto: SURVIVOR, identityAccountId: null });
    expect(absorbed.deletable).toBe(false);
    expect(absorbed.drainEvents().map((e) => [e.eventName, e.payload])).toEqual([
      [
        'people.person.status_changed',
        { personId: PERSON, previous: 'provisional', next: 'merged', reason: 'merged' },
      ],
      [
        'people.person.merged',
        {
          survivingPersonId: SURVIVOR,
          absorbedPersonId: PERSON,
          attributesTaken: ['date_of_birth'],
          identityAccountId: ACCOUNT,
        },
      ],
    ]);
  });

  it('is refused for a record that holds an employment', () => {
    const absorbed = person({ status: 'active', hireDate: '2026-01-05' });
    const moved = absorbed.absorbInto(survivor().snapshot, [], ctx);
    expect(moved.ok).toBe(false);
    if (moved.ok) return;
    expect(moved.error.code).toBe('MERGE_ABSORBS_EMPLOYMENT');
    expect(absorbed.drainEvents()).toEqual([]);
  });

  it('cannot be edited, hired, discarded or corrected afterwards', () => {
    const absorbed = person({ status: 'merged', mergedInto: SURVIVOR, identityAccountId: null });
    expect(absorbed.updateProfile([], 3, ctx, null).ok).toBe(false);
    expect(absorbed.hire('2026-10-01', HIRED, ctx, UTC).ok).toBe(false);
    expect(absorbed.discard(ctx).ok).toBe(false);
    expect(absorbed.correctHireDate('2026-10-01', ctx, UTC).ok).toBe(false);
  });

  it('gives the survivor the account, once', () => {
    const s = survivor();
    expect(s.adoptAccount(ACCOUNT).ok).toBe(true);
    expect(s.identityAccountId).toBe(ACCOUNT);
    const again = s.adoptAccount('00000000-0000-4000-8000-0000000000b2');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('MERGE_TWO_ACCOUNTS');
  });
});
