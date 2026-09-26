import { describe, expect, it } from 'vitest';

import { define, inMemoryPeople, noTransaction as tx, TENANT, versionOf } from './in-memory.js';
import { personAccess, relationsToMany } from './person-access.js';
import type { RelationsResolver, Viewer } from './ports.js';
import { factsOf, withSubjects } from './subject.js';

/**
 * Custom visibility rules (PEO-066; PRD §6.6), through the application layer
 * every transport calls. A manager may read a contractor's contract end date
 * and nobody else's: on the profile, in a list and in history — and never as
 * a filter, which would answer for everybody.
 */

const MARCO = '00000000-0000-4000-8000-0000000000a2';
const ANA = '00000000-0000-4000-8000-0000000000a3';
const BEN = '00000000-0000-4000-8000-0000000000a4';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

const contractEnd = define({
  key: 'contract_end',
  dataType: 'date',
  typeConfig: { kind: 'date' },
  visibility: ['hr'],
  visibilityRules: [
    {
      scopes: ['manager'],
      when: { combine: 'all', clauses: [{ operand: 'employmentType', in: ['contractor'] }] },
    },
  ],
  requiredness: {
    mode: 'conditional',
    when: { combine: 'all', clauses: [{ operand: 'employmentType', in: ['contractor'] }] },
  },
});

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const asking = (v: Viewer) => ({
  tenantId: TENANT,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});
const hr = asking(viewer(HR_ACCOUNT, 'hr'));
const marco = asking(viewer(MARCO_ACCOUNT));

async function setup() {
  const store = inMemoryPeople([versionOf(1, [contractEnd])]);
  store.seed(MARCO, { account: MARCO_ACCOUNT });
  store.seed(ANA, { fields: { managerId: MARCO, employmentType: 'contractor' } });
  store.seed(BEN, { fields: { managerId: MARCO, employmentType: 'permanent' } });
  const people = personAccess(store.deps);
  for (const personId of [ANA, BEN]) {
    const written = await people.update(tx, {
      ...hr,
      personId,
      changes: { contract_end: '2027-03-31' },
    });
    expect(written.ok).toBe(true);
  }
  return people;
}

describe('a custom visibility rule', () => {
  it('shows the field on the profile of a record it holds for, and leaves it absent on the rest', async () => {
    const people = await setup();
    const ana = await people.read(tx, { ...marco, personId: ANA });
    const ben = await people.read(tx, { ...marco, personId: BEN });
    expect(ana.ok && ana.value.attributes['contract_end']).toBe('2027-03-31');
    expect(ben.ok && Object.hasOwn(ben.value.attributes, 'contract_end')).toBe(false);
  });

  it('holds per record in a list too', async () => {
    const people = await setup();
    const page = await people.list(tx, { ...marco, limit: 10 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const seen = Object.fromEntries(
      page.value.items.map((p) => [p.id, Object.hasOwn(p.attributes, 'contract_end')]),
    );
    expect(seen).toEqual({ [MARCO]: false, [ANA]: true, [BEN]: false });
  });

  it('decides history the same way', async () => {
    const people = await setup();
    const anaHistory = await people.history(tx, { ...marco, personId: ANA });
    const benHistory = await people.history(tx, { ...marco, personId: BEN });
    expect(anaHistory.ok && anaHistory.value.map((e) => e.attributeKey)).toContain('contract_end');
    expect(benHistory.ok && benHistory.value).toEqual([]);
  });

  it('is never something to filter by: a filter answers for the records it does not hold for', async () => {
    const people = await setup();
    const filtered = await people.list(tx, {
      ...marco,
      limit: 10,
      where: { contract_end: '2027-03-31' },
    });
    expect(!filtered.ok && filtered.error.code).toBe('FIELD_NOT_FILTERABLE');
  });

  it('widens nothing for HR, who read it by preset everywhere', async () => {
    const people = await setup();
    const ben = await people.read(tx, { ...hr, personId: BEN });
    expect(ben.ok && ben.value.attributes['contract_end']).toBe('2027-03-31');
  });
});

describe('the facts a rule reads', () => {
  const nobody = {
    isSelf: false,
    isManager: false,
    isInManagerChain: false,
    isHr: false,
    isFinance: false,
    isAdmin: false,
  };
  const reaching: RelationsResolver = {
    relations: () => Promise.resolve(nobody),
    reach: () =>
      Promise.resolve({
        self: new Set(),
        direct: new Set([ANA]),
        chain: new Set(),
        complete: true,
      }),
  };

  it('ride on a page of relations only for the records the caller read', async () => {
    const store = inMemoryPeople([versionOf(1, [contractEnd])]);
    store.seed(ANA, { fields: { employmentType: 'contractor' } });
    const record = await store.deps.reader.record(tx, TENANT, ANA);
    if (record === null) throw new Error('seeded');
    const viewer = { accountId: MARCO_ACCOUNT, roles: new Set<string>() };
    const read = await relationsToMany(
      reaching,
      tx,
      TENANT,
      viewer,
      [ANA, BEN],
      new Map([[ANA, factsOf(record)]]),
    );
    expect(read.get(ANA)?.subject?.employmentType).toBe('contractor');
    expect(read.get(BEN)?.subject).toBeUndefined();
  });

  it('are what the wired resolver adds to one person, and nothing for nobody', async () => {
    const store = inMemoryPeople([versionOf(1, [contractEnd])]);
    store.seed(ANA, { fields: { employmentType: 'contractor' } });
    const wired = withSubjects(reaching, store.deps.reader);
    const viewer = { accountId: MARCO_ACCOUNT, roles: new Set<string>() };
    expect((await wired.relations(tx, TENANT, viewer, ANA)).subject?.employmentType).toBe(
      'contractor',
    );
    expect((await wired.relations(tx, TENANT, viewer, BEN)).subject).toBeUndefined();
    expect(wired.reach).toBeDefined();
  });
});
