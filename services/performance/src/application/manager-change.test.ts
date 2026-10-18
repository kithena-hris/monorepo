import { describe, expect, it } from 'vitest';
import type { CalendarDate, TenantId } from '@kithena/contracts';

import { draftCycle, type Cycle } from '../domain/cycle.js';
import { newReview, type Review } from '../domain/review.js';
import { memoryUnitOfWork } from '../testing/memory.js';
import { managerChanged } from './cycles.js';

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
