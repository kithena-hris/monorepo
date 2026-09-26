import { describe, expect, it } from 'vitest';
import { err, failure, fixedClock, ok } from '@kithena/domain-kit';
import type { FieldPolicy } from '@kithena/contracts';

import type { AnonymiseRequest, RetentionStore } from './anonymise.js';
import { sweepRetention, upcomingErasures } from './sweep.js';

const TENANT = '00000000-0000-4000-8000-00000000000a';
const clock = fixedClock('2026-09-27T09:00:00.000Z');
const policy = (monthsAfterTermination: number, statutoryFloor?: 'es-labour'): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
  retention: { monthsAfterTermination, ...(statutoryFloor ? { statutoryFloor } : {}) },
});

function store(people: readonly string[], held: Record<string, readonly string[]> = {}) {
  const asked: unknown[] = [];
  const fake: RetentionStore = {
    leaver: (_tx, _t, id) =>
      Promise.resolve({
        status: 'terminated',
        lastWorkingDay: '2020-01-31',
        placement: { legalEntityId: null, locationId: null, ownZone: null },
        held: new Set(held[id] ?? []),
      }),
    tombstones: (_tx, _t, id) => Promise.resolve(id === 'p1' ? ['t1'] : []),
    candidates: (_tx, _t, query) => {
      asked.push(query);
      return Promise.resolve(
        people
          .filter((p) => query.after === null || p > query.after)
          .slice(0, query.limit)
          .map((personId) => ({ personId, name: personId.toUpperCase(), lastWorkingDay: '2020-01-31' })),
      );
    },
    policies: () =>
      Promise.resolve([
        { key: 'phone', policy: policy(6) },
        { key: 'payslip', policy: policy(12, 'es-labour') },
        { key: 'hobby', policy: { classification: 'internal', piiKind: 'none', exportable: true, aiEligible: false } },
      ]),
    clear: () => Promise.resolve(),
  };
  return { fake, asked };
}

const inTenant = async <R>(_t: string, fn: (scope: { tx: never }) => Promise<R>) => fn({ tx: undefined as never });

describe('the retention sweep (PEO-075)', () => {
  it('erases each person on their own, as system:retention, and counts who waits for legal review', async () => {
    const requests: AnonymiseRequest[] = [];
    const { fake, asked } = store(['p1', 'p2', 'p3', 'p4']);
    const sweep = sweepRetention({
      inTenant,
      store: fake,
      clock,
      newId: () => 'c',
      anonymise: (_tx, request) => {
        requests.push(request);
        if (request.personId === 'p2') {
          return Promise.resolve(err(failure('RETENTION_FLOOR_UNREVIEWED', 'pending legal review')));
        }
        if (request.personId === 'p3') return Promise.reject(new Error('boom'));
        return Promise.resolve(ok({ cleared: request.personId === 'p1' ? ['phone'] : [] }));
      },
    });

    const run = await sweep(TENANT, null);
    expect(run).toMatchObject({ erased: 1, waiting: 1, next: null });
    expect(run.failed.map((f) => f.personId)).toEqual(['p3']);
    expect(requests.every((r) => r.actor.kind === 'system' && r.actor.process === 'retention')).toBe(true);
    expect(requests.every((r) => r.mode.kind === 'automated')).toBe(true);
    // Nobody can be due sooner than the shortest period: the phone's six months.
    expect(asked[0]).toMatchObject({ today: '2026-09-27', shortestMonths: 6, keys: ['phone', 'payslip'] });
  });

  it('takes a bounded batch and resumes where it stopped', async () => {
    const { fake } = store(['p1', 'p2', 'p3']);
    const seen: string[] = [];
    const sweep = sweepRetention({
      inTenant,
      store: fake,
      clock,
      newId: () => 'c',
      batch: 2,
      anonymise: (_tx, r) => {
        seen.push(r.personId);
        return Promise.resolve(ok({ cleared: [] }));
      },
    });
    const first = await sweep(TENANT, null);
    expect(first.next).toBe('p2');
    const second = await sweep(TENANT, first.next);
    expect(second.next).toBeNull();
    expect(seen).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('upcoming automated erasures (PEO-075)', () => {
  it('lists what a leaver and their tombstones hold, and the floor it waits for; HR only', async () => {
    const { fake } = store(['p1', 'p2'], { p1: [], t1: ['payslip'], p2: [] });
    const upcoming = upcomingErasures({ store: fake, clock });
    const listed = await upcoming(undefined as never, { tenantId: TENANT, viewer: { roles: new Set(['hr']) } });
    // p1 holds nothing itself; its tombstone holds a payslip, due four years after 2020-01-31.
    expect(listed).toEqual(
      ok([{ personId: 'p1', name: 'P1', dueOn: '2024-01-31', floors: ['es-labour'], waitingForReview: ['es-labour'] }]),
    );
    const refused = await upcoming(undefined as never, { tenantId: TENANT, viewer: { roles: new Set(['people_admin']) } });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });
});
