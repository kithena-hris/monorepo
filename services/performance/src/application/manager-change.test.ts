import { describe, expect, it } from 'vitest';
import type { CalendarDate, TenantId } from '@kithena/contracts';

import { draftCycle, type Cycle } from '../domain/cycle.js';
import { newReview, type Review } from '../domain/review.js';
import { memoryUnitOfWork } from '../testing/memory.js';
import type { PersonId } from '@kithena/contracts';

import type { Member } from './ports.js';
import { leaverManagerReviews, managerChanged, onReportingLineMoved } from './manager-change.js';

const TENANT = '00000000-0000-4000-8000-00000000000a' as TenantId;
const day = (s: string) => s as CalendarDate;
const AT = '2026-11-20T09:00:00.000Z';

const running: Cycle = {
  ...draftCycle({
    id: 'c1',
    name: 'H2 2026',
    owner: 'ada',
    ownerName: 'Ada',
    start: day('2026-11-02'),
    zone: 'Europe/Madrid',
    at: AT,
    templates: { self: 't-self', manager: 't-mgr' },
  }),
  state: 'in_progress',
  snapshot: {
    subjects: ['adam', 'bea', 'cai'],
    pinned: { manager: { templateId: 't-mgr', version: 2 } },
    due: { manager: day('2026-11-30') },
  },
};

const managerReview = (id: string, subjectId: string, patch: Partial<Review>): Review => ({
  ...newReview({
    id,
    cycleId: 'c1',
    kind: 'manager',
    subjectId,
    authorId: 'marco',
    templateId: 't-mgr',
    version: 2,
    due: day('2026-11-23'),
    confidential: false,
    hidden: false,
    goals: [],
    at: AT,
  }),
  ...patch,
});

async function world(reviews: readonly Review[]) {
  const { uow } = memoryUnitOfWork();
  await uow.run(TENANT, async (tx) => {
    await tx.cycles.save(running);
    for (const r of reviews) await tx.reviews.save(r);
  });
  let n = 0;
  const change = (personId: string, managerId: string | null) =>
    uow.run(TENANT, (tx) =>
      managerChanged(tx, () => `new-${String(++n)}`, {
        personId,
        managerId,
        at: AT,
        today: day('2026-11-20'),
      }),
    );
  const all = () => uow.run(TENANT, (tx) => tx.reviews.find({ cycleId: 'c1' }));
  return { change, all };
}

describe('a manager change in a running cycle (§8.8)', () => {
  it('gives the new manager a review, and settles the old one by where it got to', async () => {
    const w = await world([
      managerReview('submitted', 'adam', { status: 'locked' }),
      managerReview('fresh', 'bea', {}),
      managerReview('drafting', 'cai', { status: 'in_progress' }),
    ]);
    const done = [];
    for (const p of ['adam', 'bea', 'cai']) done.push(await w.change(p, 'priya'));
    const by = new Map((await w.all()).map((r) => [r.id, r]));
    expect(by.get('submitted')?.status).toBe('locked');
    expect(by.get('submitted')?.formerManager ?? null).toBeNull();
    expect(by.get('fresh')?.status).toBe('cancelled');
    // Marked, so the old manager's Inbox can say it is theirs no more.
    expect(by.get('fresh')?.formerManager).toEqual({ at: AT, to: 'priya' });
    // What to tell whom: a review given each time, one taken only where one was pending.
    expect(done.map((d) => d.given.length)).toEqual([1, 1, 1]);
    expect(done.map((d) => d.taken.map((t) => t.change))).toEqual([[], ['remove'], ['outdate']]);
    expect(by.get('drafting')?.status).toBe('in_progress');
    expect(by.get('drafting')?.formerManager).toEqual({ at: AT, to: 'priya' });
    const priyas = (await w.all()).filter((r) => r.authorId === 'priya');
    expect(priyas.map((r) => r.subjectId).toSorted()).toEqual(['adam', 'bea', 'cai']);
    // Due when the old one was, never sooner than a week from today.
    expect(priyas.every((r) => r.due === day('2026-11-27') && r.status === 'not_started')).toBe(
      true,
    );
    expect(priyas.every((r) => r.handover?.from === 'marco')).toBe(true);
  });

  it('gives the review back, theirs to submit, to a manager who returns', async () => {
    const w = await world([managerReview('drafting', 'cai', { status: 'in_progress' })]);
    await w.change('cai', 'priya');
    await w.change('cai', 'marco');
    const marcos = (await w.all()).filter((r) => r.authorId === 'marco');
    expect(marcos).toHaveLength(1);
    expect(marcos[0]?.formerManager).toBeNull();
    expect(marcos[0]?.status).toBe('in_progress');
  });

  it('only settles the old ones when nobody takes over', async () => {
    const w = await world([managerReview('fresh', 'bea', {})]);
    await w.change('bea', null);
    const all = await w.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('cancelled');
  });
});

const member = (personId: string, patch: Partial<Member> = {}): Member => ({
  personId: personId as PersonId,
  accountId: null,
  displayName: `${personId.charAt(0).toUpperCase()}${personId.slice(1)}`,
  workEmail: `${personId}@acme.example`,
  managerPersonId: null,
  status: 'active',
  title: null,
  orgUnitId: null,
  locationId: null,
  legalEntityId: null,
  hiredOn: null,
  probationEnd: null,
  ...patch,
});

/** A running cycle, Adam's manager review with Marco, and whoever is in the projection. */
async function company(members: readonly Member[], review: Partial<Review> = {}) {
  const { uow } = memoryUnitOfWork();
  await uow.run(TENANT, async (tx) => {
    await tx.cycles.save(running);
    await tx.reviews.save(managerReview('marcos', 'adam', review));
    for (const m of members) await tx.members.upsert(m, `e-${m.personId}`);
  });
  let n = 0;
  const newId = () => `new-${String(++n)}`;
  const run = <T>(fn: (tx: Parameters<Parameters<typeof uow.run>[1]>[0]) => Promise<T>) =>
    uow.run(TENANT, fn);
  return { run, newId };
}

describe('a manager change as it reaches Performance (§8.8)', () => {
  const moved = (managerId: string, previousManagerId = 'marco') => ({
    personId: 'adam',
    previousManagerId,
    managerId,
    at: AT,
    today: day('2026-11-20'),
  });

  it('hands over only where HR chose it for this very change, and tells both', async () => {
    const w = await company([member('adam'), member('marco'), member('priya')], {
      status: 'in_progress',
    });
    // No choice kept: the old manager writes it as planned.
    expect(await w.run((tx) => onReportingLineMoved(tx, w.newId, moved('priya')))).toEqual([]);
    await w.run((tx) => tx.settings.set('manager-handover:adam', { managerId: 'priya', at: AT }));
    // A choice for someone else is not this change's.
    expect(await w.run((tx) => onReportingLineMoved(tx, w.newId, moved('zoe')))).toEqual([]);
    const told = await w.run((tx) => onReportingLineMoved(tx, w.newId, moved('priya')));
    expect(told.map((m) => m.to).toSorted()).toEqual(['marco@acme.example', 'priya@acme.example']);
    expect(told.find((m) => m.to === 'marco@acme.example')?.text).toContain('draft stays');
    // Carried out once: the choice is spent.
    expect(await w.run((tx) => tx.settings.get('manager-handover:adam'))).toBeNull();
  });

  it('hands over without asking when the old manager has left, telling only the new one', async () => {
    const w = await company(
      [member('adam'), member('marco', { status: 'terminated' }), member('priya')],
      { status: 'cancelled' },
    );
    const told = await w.run((tx) => onReportingLineMoved(tx, w.newId, moved('priya')));
    expect(told.map((m) => m.to)).toEqual(['priya@acme.example']);
    const priyas = await w.run((tx) => tx.reviews.find({ ownerId: 'priya' }));
    expect(priyas).toHaveLength(1);
    expect(priyas[0]?.handover?.from).toBe('marco');
  });

  it('gives a leaver’s cancelled review to the manager their report already moved to', async () => {
    const w = await company(
      [member('adam', { managerPersonId: 'priya' as PersonId }), member('marco'), member('priya')],
      { status: 'cancelled' },
    );
    const told = await w.run((tx) =>
      leaverManagerReviews(tx, w.newId, {
        leaverId: 'marco',
        cancelled: [{ subjectId: 'adam', cycleId: 'c1' }],
        at: AT,
        today: day('2026-11-20'),
      }),
    );
    expect(told.map((m) => m.to)).toEqual(['priya@acme.example']);
    expect(await w.run((tx) => tx.reviews.find({ ownerId: 'priya' }))).toHaveLength(1);
  });

  it('gives nothing to a new manager who has left', async () => {
    const w = await company([
      member('adam'),
      member('marco'),
      member('gone', { status: 'terminated' }),
    ]);
    await w.run((tx) => tx.settings.set('manager-handover:adam', { managerId: 'gone', at: AT }));
    await w.run((tx) => onReportingLineMoved(tx, w.newId, moved('gone')));
    expect(await w.run((tx) => tx.reviews.find({ ownerId: 'gone' }))).toEqual([]);
  });
});
