import { describe, expect, it } from 'vitest';
import type { CalendarDate } from '@kithena/contracts';

import { calendarStarts, groups, isoWeek, weekOf } from './automation.js';
import {
  blocked,
  checks,
  draftCycle,
  dueDates,
  move,
  startAction,
  subjectsOf,
  type Cycle,
} from './cycle.js';
import {
  audiences,
  checkGive,
  DEFAULT_FEEDBACK,
  readerOf,
  undo,
  type Feedback,
} from './feedback.js';
import {
  canSeeGoal,
  checkIn,
  checkWeights,
  goalScore,
  krProgress,
  progress,
  visibilityOf,
  type Goal,
} from './goals.js';
import { complete, scan, type Assignment, type LearningItem } from './learning.js';
import {
  access,
  changeScore,
  closeStatus,
  decide,
  decideUnlock,
  detach,
  hold,
  nominate,
  reattach,
  releaseHold,
  requestUnlock,
  save,
  submit,
  type CalibrationSession,
  type Nomination,
  type Review,
} from './review.js';
import { dueNow, dueOn, ownNotesDueOn } from './retention.js';
import { invitation } from './calendar.js';
import { position } from './sentiment.js';
import {
  afterSend,
  liveVersions,
  ready,
  rotated,
  subscribes,
  type WebhookEndpoint,
} from './webhook.js';

/** The element at an index, or the test fails here. */
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};

const day = (s: string) => s as CalendarDate;
const AT = '2026-11-16T09:00:00.000Z';

const cycle = (patch: Partial<Cycle> = {}): Cycle => ({
  ...draftCycle({
    id: 'c1',
    name: 'H2 2026',
    owner: 'ada',
    ownerName: 'Ada',
    start: day('2026-11-16'),
    zone: 'Europe/Madrid',
    at: AT,
    templates: { self: 't-self', manager: 't-mgr', peer: 't-peer' },
  }),
  ...patch,
});

const review = (patch: Partial<Review> = {}): Review => ({
  id: 'r1',
  cycleId: 'c1',
  kind: 'manager',
  subjectId: 'adam',
  authorId: 'marco',
  templateId: 't',
  version: 1,
  status: 'not_started',
  answers: {},
  revision: 0,
  savedAt: null,
  due: day('2026-12-14'),
  submitted: [],
  suggestions: {},
  drafted: [],
  unlock: null,
  released: null,
  acknowledged: null,
  confidential: false,
  shared: true,
  detached: null,
  declined: null,
  handover: null,
  hidden: false,
  calibrated: null,
  goals: [],
  createdAt: AT,
  ...patch,
});

describe('a cycle', () => {
  it('schedules when it starts later and launches when it starts today', () => {
    expect(startAction(cycle(), day('2026-11-01'))).toEqual({ ok: true, value: 'schedule' });
    expect(startAction(cycle(), day('2026-11-16'))).toEqual({ ok: true, value: 'launch' });
    expect(startAction(cycle(), day('2026-11-17')).ok).toBe(false);
  });

  it('moves only along its state machine', () => {
    expect(move(cycle(), 'scheduling').ok).toBe(true);
    expect(move(cycle(), 'closed').ok).toBe(false);
    expect(move(cycle({ state: 'launching' }), 'launch_failed').ok).toBe(true);
    expect(move(cycle({ state: 'launch_failed' }), 'launching').ok).toBe(true);
  });

  it('resolves relative deadlines from the start and from nominations', () => {
    const due = dueDates(cycle());
    expect(due.self).toBe('2026-11-30');
    expect(due.nominations).toBe('2026-11-19');
    expect(due.peer).toBe('2026-12-08');
  });

  it('blocks a launch with nobody, or with someone who has no manager', () => {
    const templates = {
      't-self': { name: 'Self', published: 3 },
      't-mgr': { name: 'Manager', published: 3 },
      't-peer': { name: 'Peer', published: 2 },
    };
    expect(
      blocked(checks({ cycle: cycle(), today: day('2026-11-01'), subjects: [], templates })),
    ).toBe(true);
    const nora = checks({
      cycle: cycle(),
      today: day('2026-11-01'),
      subjects: [{ personId: 'nora', name: 'Nora Becker', managerId: null }],
      templates,
    });
    expect(nora.find((i) => i.level === 'block')?.title).toBe('Nora Becker has no manager');
    const fine = checks({
      cycle: cycle(),
      today: day('2026-11-01'),
      subjects: [{ personId: 'adam', name: 'Adam', managerId: 'marco' }],
      templates,
    });
    expect(blocked(fine)).toBe(false);
  });

  it('takes the filter, then inclusions, less exclusions', () => {
    const people = [
      {
        personId: 'a',
        status: 'active',
        department: 'Engineering',
        managerPersonId: null,
        title: null,
        hiredOn: null,
        legalEntityId: null,
      },
      {
        personId: 'b',
        status: 'active',
        department: 'Sales',
        managerPersonId: null,
        title: null,
        hiredOn: null,
        legalEntityId: null,
      },
      {
        personId: 'c',
        status: 'active',
        department: 'Engineering',
        managerPersonId: null,
        title: null,
        hiredOn: null,
        legalEntityId: null,
      },
    ];
    const c = cycle({
      participants: {
        filter: [{ field: 'department', value: 'Engineering' }],
        include: [{ personId: 'b', reason: null, by: 'ada', at: AT }],
        exclude: [{ personId: 'c', reason: 'On leave', by: 'ada', at: AT }],
        keepInStep: true,
      },
    });
    expect(subjectsOf(c, people).toSorted()).toEqual(['a', 'b']);
  });
});

describe('a review', () => {
  it('saves against its revision and refuses a stale one', () => {
    const r = save(review(), { q1: { value: 'Shipped', comment: null } }, 0, AT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toMatchObject({ status: 'in_progress', revision: 1 });
    const stale = save(r.value, { q1: { value: 'Other', comment: null } }, 0, AT);
    expect(stale.ok ? null : stale.error.code).toBe('STALE_REVISION');
  });

  it('waits for every AI suggestion to be confirmed before it submits', () => {
    const r = review({
      suggestions: { q2: { value: 4, reason: 'Peers said so', confirmed: false } },
    });
    const refused = submit(r, AT, 380);
    expect(refused.ok ? null : refused.error.code).toBe('UNCONFIRMED');
    const edited = save(r, { q2: { value: 3, comment: null } }, 0, AT);
    if (!edited.ok) throw new Error('save');
    expect(submit(edited.value, AT, 300).ok).toBe(true);
  });

  it('unlocks only through a request HR decides, with a reason', () => {
    const locked = review({
      status: 'locked',
      submitted: [{ revision: 3, answers: {}, at: AT, scoreHundredths: 380 }],
    });
    expect(requestUnlock(locked, 'too short', AT).ok).toBe(false);
    const asked = requestUnlock(locked, 'Rated before the last peer review', AT);
    if (!asked.ok) throw new Error('ask');
    expect(asked.value.status).toBe('unlock_requested');
    const declined = decideUnlock(asked.value, { approved: false, by: 'ada', at: AT, note: 'No' });
    expect(declined.ok && declined.value.status).toBe('locked');
    const approved = decideUnlock(asked.value, { approved: true, by: 'ada', at: AT, note: 'Fine' });
    expect(approved.ok && approved.value.status).toBe('unlocked');
  });

  it('maps every status at close, an unlocked review completing on its last submission', () => {
    const submitted = [{ revision: 2, answers: {}, at: AT, scoreHundredths: 380 }];
    expect(closeStatus(review({ status: 'not_started' }))).toBe('abandoned');
    expect(closeStatus(review({ status: 'in_progress' }))).toBe('withdrawn');
    expect(closeStatus(review({ status: 'locked', submitted }))).toBe('completed');
    expect(closeStatus(review({ status: 'unlocked', submitted }))).toBe('completed');
    expect(closeStatus(review({ status: 'in_review', submitted }))).toBe('completed');
    expect(closeStatus(review({ status: 'unlock_requested', submitted }))).toBe('completed');
  });

  it('holds a scored review for calibration and gives it back', () => {
    const r = review({
      status: 'locked',
      submitted: [{ revision: 1, answers: {}, at: AT, scoreHundredths: 380 }],
    });
    const held = hold(r);
    if (!held.ok) throw new Error('hold');
    expect(held.value.status).toBe('in_review');
    expect(requestUnlock(held.value, 'Rated before the last peer review', AT).ok).toBe(false);
    expect(releaseHold(held.value).status).toBe('locked');
    expect(hold(review()).ok).toBe(false);
  });

  it('detaches a submitted review and cancels an unsubmitted one, and reattaches a kept one', () => {
    const submitted = review({
      status: 'locked',
      submitted: [{ revision: 1, answers: {}, at: AT, scoreHundredths: null }],
    });
    const d = detach(submitted, AT);
    expect(d.detached).not.toBeNull();
    expect(detach(review({ status: 'in_progress' }), AT).status).toBe('cancelled');
    expect(reattach(d).detached).toBeNull();
  });

  it('shows the subject nothing before release, and confidential kinds only above the minimum', () => {
    const reader = {
      personId: 'adam',
      hr: false,
      reports: new Set<string>(),
      calibrating: new Set<string>(),
    };
    const peer = review({
      kind: 'peer',
      authorId: 'omar',
      status: 'locked',
      submitted: [{ revision: 1, answers: {}, at: AT, scoreHundredths: null }],
    });
    expect(access(peer, reader, true)).toBeNull();
    const released = { ...peer, released: { at: AT, by: 'marco' } };
    expect(access(released, reader, false)).toBeNull();
    expect(access(released, reader, true)).toBe('subject');
    const manager = { ...reader, personId: 'marco', reports: new Set(['adam']) };
    expect(access(peer, manager, false)).toBe('full');
    expect(access(peer, { ...reader, personId: 'diego' }, true)).toBeNull();
  });
});

describe('nominations', () => {
  const n: Nomination = {
    id: 'n1',
    cycleId: 'c1',
    subjectId: 'adam',
    kind: 'peer',
    by: 'adam',
    approverId: 'marco',
    nominees: [],
    state: 'draft',
    note: null,
    at: AT,
  };

  it('takes anyone but the subject, between the bounds', () => {
    const bounds = { min: 2, max: 4, approval: true };
    expect(nominate(n, ['adam', 'omar'], bounds, null, AT).ok).toBe(false);
    expect(nominate(n, ['omar'], bounds, null, AT).ok).toBe(false);
    const ok = nominate(n, ['omar', 'priya', 'diego'], bounds, null, AT);
    expect(ok.ok && ok.value.state).toBe('waiting');
  });

  it('is approved with a decline, its reason, and a replacement', () => {
    const waiting = nominate(n, ['omar', 'yuki'], { min: 2, max: 4, approval: true }, null, AT);
    if (!waiting.ok) throw new Error('nominate');
    expect(decide(waiting.value, [{ personId: 'yuki', approve: false, reason: '' }], []).ok).toBe(
      false,
    );
    const done = decide(
      waiting.value,
      [{ personId: 'yuki', approve: false, reason: 'Two weeks together' }],
      ['priya'],
    );
    if (!done.ok) throw new Error('decide');
    expect(done.value.nominees.map((x) => `${x.personId}:${x.state}`)).toEqual([
      'omar:approved',
      'yuki:declined',
      'priya:approved',
    ]);
  });
});

describe('calibration', () => {
  it('needs a reason for every change', () => {
    const s: CalibrationSession = {
      id: 's',
      name: 'Eng',
      cycleId: 'c1',
      calibrators: ['nora'],
      subjects: ['adam'],
      meetsOn: null,
      state: 'not_started',
      changes: [],
      potentialQuestionId: null,
      at: AT,
    };
    const change = {
      personId: 'adam',
      reviewId: 'r1',
      was: 380,
      now: 420,
      reason: '',
      by: 'nora',
      at: AT,
    };
    expect(changeScore(s, change).ok).toBe(false);
    expect(changeScore(s, { ...change, reason: 'Impact under-weighted' }).ok).toBe(true);
  });
});

describe('feedback', () => {
  it('offers the audiences the company allows, and praise is always named', () => {
    expect(audiences(DEFAULT_FEEDBACK, false)).toEqual(['recipient_manager', 'manager_only']);
    const praise = checkGive(DEFAULT_FEEDBACK, {
      from: 'a',
      to: 'b',
      praise: true,
      audience: 'everyone',
      showName: false,
    });
    expect(praise.ok && praise.value.showName).toBe(true);
    expect(
      checkGive(DEFAULT_FEEDBACK, {
        from: 'a',
        to: 'a',
        praise: false,
        audience: 'recipient',
        showName: true,
      }).ok,
    ).toBe(false);
  });

  it('can be undone for ten minutes by its writer only', () => {
    const f = { id: 'f', from: 'a', to: 'b', at: AT, undone: false } as Feedback;
    expect(undo(f, 'a', Date.parse(AT) + 9 * 60_000).ok).toBe(true);
    expect(undo(f, 'a', Date.parse(AT) + 11 * 60_000).ok).toBe(false);
    expect(undo(f, 'b', Date.parse(AT)).ok).toBe(false);
  });

  it('keeps manager-only feedback from its recipient', () => {
    const f = {
      id: 'f',
      from: 'a',
      to: 'b',
      audience: 'manager_only',
      showName: true,
      undone: false,
    } as Feedback;
    expect(readerOf(f, { personId: 'b', hr: false, managerOfRecipient: false }).sees).toBe(false);
    expect(readerOf(f, { personId: 'm', hr: false, managerOfRecipient: true }).sees).toBe(true);
  });
});

describe('goals', () => {
  const g: Goal = {
    id: 'g',
    title: 'Latency',
    description: '',
    ownerId: 'adam',
    ownerKind: 'person',
    periodId: 'h2',
    parentId: null,
    weight: 40,
    commitment: 'committed',
    status: 'active',
    keyResults: [
      {
        id: 'k1',
        title: 'p95',
        measure: 'number',
        start: 780,
        target: 400,
        current: 520,
        unit: 'ms',
        weight: null,
        linked: null,
      },
      {
        id: 'k2',
        title: 'Queue',
        measure: 'percentage',
        start: 0,
        target: 100,
        current: 50,
        unit: '%',
        weight: null,
        linked: null,
      },
    ],
    checkIns: [],
    createdAt: AT,
  };

  it('computes progress either direction and averages key results', () => {
    expect(krProgress(must(g.keyResults[0]))).toBe(68);
    expect(progress(g)).toBe(59);
  });

  it('weights the goal score and wants weights to sum to 100', () => {
    expect(checkWeights([{ weight: 40 }, { weight: 30 }]).ok).toBe(false);
    expect(
      goalScore([
        g,
        { ...g, id: 'h', weight: 60, keyResults: [{ ...must(g.keyResults[1]), current: 100 }] },
      ]),
    ).toBe(420);
  });

  it('takes a check-in that moves a key result', () => {
    const c = checkIn(g, {
      at: AT,
      by: 'adam',
      values: { k1: 400 },
      confidence: 'on_track',
      note: null,
    });
    expect(c.ok && progress(c.value)).toBe(75);
  });

  describe('who sees a goal', () => {
    // Adam reports to Marco; Omar is Adam's peer under Marco; Priya reports to Adam.
    const owner = { managerId: 'marco' };
    const reader = (personId: string, managerId: string | null, org: string[] = []) => ({
      personId,
      managerId,
      hr: false,
      org: new Set(org),
    });
    const adam = reader('adam', 'marco');
    const marco = reader('marco', 'ceo', ['adam', 'omar', 'priya']);
    const omar = reader('omar', 'marco');
    const priya = reader('priya', 'adam');
    const stranger = reader('zoe', 'someone');

    it('is private until made public: the owner, their managers and HR', () => {
      expect(visibilityOf(g)).toBe('owner');
      for (const r of [adam, marco, { ...stranger, hr: true }])
        expect(canSeeGoal(g, r, owner), r.personId).toBe(true);
      for (const r of [omar, priya, stranger]) expect(canSeeGoal(g, r, owner), r.personId).toBe(false);
    });

    it('shows a team goal to the owner’s peers and reports too', () => {
      const team = { ...g, visibility: 'team' as const };
      expect([omar, priya, stranger].map((r) => canSeeGoal(team, r, owner))).toEqual([
        true,
        true,
        false,
      ]);
    });

    it('shows a public goal to everyone, and a company goal is public unless HR says otherwise', () => {
      expect(canSeeGoal({ ...g, visibility: 'everyone' }, stranger, owner)).toBe(true);
      const company = { ...g, ownerKind: 'company' as const, ownerId: null };
      expect(visibilityOf(company)).toBe('everyone');
      expect(canSeeGoal(company, stranger, null)).toBe(true);
    });
  });
});

describe('learning', () => {
  const item: LearningItem = {
    id: 'i',
    title: 'Incident command',
    kind: 'session',
    provider: 'Acme',
    minutes: 90,
    parts: [],
    acknowledgement: null,
    quiz: null,
    recursMonths: null,
    certificateYears: 3,
    sessions: [{ id: 's', start: AT, end: AT, place: 'Retiro', online: null, qr: 'code-1' }],
    skills: [],
    url: null,
    createdAt: AT,
  };
  const a: Assignment = {
    id: 'a',
    itemId: 'i',
    personId: 'adam',
    by: 'ada',
    why: 'Required',
    due: null,
    cycleId: null,
    done: [],
    acknowledgedAt: null,
    quiz: null,
    attendance: [],
    completedAt: null,
    expiresOn: null,
    at: AT,
  };

  it('completes a session on a scan of its code, with the certificate’s expiry', () => {
    expect(scan(a, item, 'wrong', AT).ok).toBe(false);
    const s = scan(a, item, 'code-1', AT);
    expect(s.ok && s.value.completedAt).toBe(AT);
    expect(s.ok && s.value.expiresOn).toBe('2029-11-16');
    expect(complete(a, item, AT).completedAt).toBeNull();
  });
});

describe('automations', () => {
  it('lists calendar starts from a month', () => {
    expect(
      calendarStarts(
        { kind: 'calendar', every: 'half', startMonth: 1, leadDays: 14 },
        day('2026-10-17'),
        2,
      ),
    ).toEqual(['2027-01-01', '2027-07-01']);
  });

  it('groups probation reviews by week: 3 months after the start, twice', () => {
    const t = {
      kind: 'event',
      event: 'hired',
      offsetDays: 90,
      repeatDays: 90,
      times: 2,
      group: 'week',
      leadDays: 14,
    } as const;
    const g = groups(t, [
      { personId: 'mei', on: day('2026-07-13') },
      { personId: 'yuki', on: day('2026-07-15') },
    ]);
    expect(g.map((x) => [x.start, x.people.length])).toEqual([
      ['2026-10-05', 1],
      ['2026-10-12', 1],
      ['2027-01-04', 1],
      ['2027-01-11', 1],
    ]);
    expect(weekOf(day('2026-10-14'))).toBe('2026-10-12');
    expect(isoWeek(day('2026-10-14'))).toBe(42);
  });
});

describe('sentiment', () => {
  it('weighs labels by sentence length onto 0–100', () => {
    expect(position([])).toBeNull();
    expect(position([{ sentence: 'Great work on the migration.', label: 2 }])).toBe(100);
    expect(
      position([
        { sentence: 'Good.', label: 1 },
        { sentence: 'Late.', label: -1 },
      ]),
    ).toBe(50);
  });
});

describe('retention', () => {
  const rule = { reviewsYears: 3, feedbackYears: 1, notesYears: 1, learningYears: 2, aiYears: 1 };
  const day = (d: string) => d as CalendarDate;

  it('counts each kind’s years from the last working day, and a leaver’s own notes 30 days', () => {
    expect(dueOn(day('2024-02-29'), 'reviews', rule)).toBe('2027-03-01');
    expect(dueOn(day('2025-03-31'), 'feedback', rule)).toBe('2026-03-31');
    expect(ownNotesDueOn(day('2026-09-15'))).toBe('2026-10-15');
  });

  it('is due once the day comes, never for a leaver on hold or without a date', () => {
    const leavers = [
      { personId: 'gone', leftOn: day('2025-06-30') },
      { personId: 'held', leftOn: day('2020-01-01') },
      { personId: 'undated', leftOn: null },
      { personId: 'recent', leftOn: day('2026-10-01') },
    ];
    expect(dueNow(leavers, new Set(['held']), rule, day('2026-10-17'))).toEqual([
      { personId: 'gone', leftOn: '2025-06-30', kinds: ['feedback', 'notes', 'ai'], ownNotes: true },
    ]);
  });
});

describe('a webhook endpoint', () => {
  const T0 = new Date('2026-10-17T10:00:00.000Z');
  const at = (ms: number) => new Date(T0.getTime() + ms);
  const endpoint: WebhookEndpoint = {
    id: 'w',
    url: 'https://hooks.example.com/kithena',
    events: ['performance.review.released'],
    version: 1,
    previous: null,
    createdAt: T0.toISOString(),
    disabled: null,
    cursor: { at: T0.toISOString(), id: '00000000-0000-0000-0000-000000000000' },
    failing: null,
    last: null,
  };
  const sent = (status: number) => ({ eventId: 'e1', writtenAt: '2026-10-17T10:00:05.000Z', status });

  it('takes what it subscribes to, or everything for *', () => {
    expect(subscribes(endpoint, 'performance.review.released')).toBe(true);
    expect(subscribes(endpoint, 'performance.goal.checked_in')).toBe(false);
    expect(subscribes({ events: ['*'] }, 'performance.goal.checked_in')).toBe(true);
  });

  it('moves on past a delivered event, and waits out a failed one before anything after it', () => {
    expect(afterSend(endpoint, sent(204), T0).cursor.id).toBe('e1');
    const failed = afterSend(endpoint, sent(500), T0);
    expect(failed.cursor.id).not.toBe('e1');
    expect(failed.failing).toMatchObject({ attempts: 1, retryAt: '2026-10-17T10:00:30.000Z' });
    expect(ready(failed, at(10_000))).toBe(false);
    expect(ready(failed, at(30_000))).toBe(true);
    expect(afterSend(failed, sent(200), at(30_000)).failing).toBeNull();
  });

  it('is turned off after 24 hours of failures, saying why', () => {
    const failing = afterSend(endpoint, sent(503), T0);
    const off = afterSend(failing, sent(0), at(24 * 60 * 60 * 1000));
    expect(off.disabled?.why).toContain('24 hours');
    expect(ready(off, at(25 * 60 * 60 * 1000))).toBe(false);
  });

  it('signs with the old secret too for a day after a rotation', () => {
    const next = rotated(endpoint, T0);
    expect(liveVersions(next, at(60_000))).toEqual([2, 1]);
    expect(liveVersions(next, at(25 * 60 * 60 * 1000))).toEqual([2]);
  });
});

describe('a session’s calendar invitation', () => {
  const base = {
    uid: 's1@performance.kithena.com',
    sequence: 1,
    method: 'REQUEST' as const,
    start: '2026-11-03T09:00:00.000Z',
    end: '2026-11-03T10:30:00.000Z',
    title: 'Giving feedback, well',
    description: 'Bring one example; we practise, in pairs.',
    location: 'Room 4, Madrid',
    url: null,
    organizer: { name: 'Acme', email: 'no-reply@kithena.com' },
    attendee: { name: 'Ada Lovelace', email: 'ada@acme.example' },
    stamp: '2026-10-17T08:00:00.000Z',
  };

  it('is one event a calendar can add, with times in UTC and text escaped', () => {
    const ics = invitation(base);
    expect(ics).toContain('METHOD:REQUEST\r\n');
    expect(ics).toContain('DTSTART:20261103T090000Z');
    expect(ics).toContain('DESCRIPTION:Bring one example\\; we practise\\, in pairs.');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('cancels the same event, by its UID', () => {
    const ics = invitation({ ...base, method: 'CANCEL', sequence: 2 });
    expect(ics).toContain('UID:s1@performance.kithena.com');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:2');
  });

  it('folds a long line rather than letting a calendar cut it', () => {
    const ics = invitation({ ...base, description: 'x'.repeat(200) });
    expect(ics).toContain('\r\n x');
  });
});
