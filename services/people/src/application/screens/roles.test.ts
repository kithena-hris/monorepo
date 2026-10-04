import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import { tenantRoles, type RoleCandidate, type RoleStore } from '../roles/roles.js';
import { ROLES_PAGE, rolesView } from './roles.js';

/**
 * Settings › Roles: the table of everybody who signs in, a keyset page at a
 * time and searched by People; the role cards' holders whole, whoever is on
 * the page.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADMIN = '00000000-0000-4000-8000-0000000000b1';
const GHOST = '00000000-0000-4000-8000-0000000000b9';
const pad = (n: number) => String(n).padStart(4, '0');
const everyone: RoleCandidate[] = Array.from({ length: ROLES_PAGE + 5 }, (_, i) => ({
  accountId: i === 0 ? ADMIN : `00000000-0000-4000-8000-00000001${pad(i)}`,
  personId: `00000000-0000-4000-8000-00000002${pad(i)}`,
  name: i === 0 ? 'Ada Admin' : `Person ${pad(i)}`,
  workEmail: null,
}));

/** People's candidates as the store pages them: in order, from after, the search a substring. */
function store(): RoleStore {
  return {
    lock: () => Promise.resolve(),
    holdings: () =>
      Promise.resolve(
        new Map([
          [ADMIN, new Set(['people_admin', 'hr'])],
          [GHOST, new Set(['finance'])],
        ]),
      ),
    grant: () => Promise.resolve(),
    revoke: () => Promise.resolve(),
    releaseLastAdministrator: () => Promise.resolve(),
    candidates: (_tx, _tenant, where) => {
      let rows = everyone;
      if (where?.accounts !== undefined)
        rows = rows.filter((c) => where.accounts?.includes(c.accountId));
      const q = where?.search?.toLowerCase();
      if (q) rows = rows.filter((c) => c.name?.toLowerCase().includes(q) === true);
      const from = where?.after == null ? 0 : rows.findIndex((c) => c.personId === where.after) + 1;
      return Promise.resolve(
        rows.slice(from, where?.limit === undefined ? undefined : from + where.limit),
      );
    },
    publish: () => Promise.resolve(),
  };
}

const deps = {
  service: {
    roles: tenantRoles({
      store: store(),
      clock: fixedClock('2026-10-04T12:00:00.000Z'),
      newId: () => 'e',
    }),
    inTenant: (_tenant: string, fn: (scope: { tx: never }) => unknown) => fn({ tx: {} as never }),
  },
} as never;
const asking = {
  tenantId: ACME,
  viewer: { accountId: ADMIN, roles: new Set(['people_admin', 'hr']) },
  correlationId: 'c',
};

describe('Settings › Roles, a page at a time', () => {
  it('pages the table from the last one’s place, and names every holder whatever the page', async () => {
    const first = await rolesView(deps, asking);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.people).toHaveLength(ROLES_PAGE);
    expect(first.value.next).toBe(first.value.people.at(-1)?.personId);
    // The holders: Ada by name, and an account People has no person for yet.
    expect(first.value.holders.map((h) => [h.accountId, h.name, h.roles])).toEqual([
      [ADMIN, 'Ada Admin', ['hr', 'people_admin']],
      [GHOST, null, ['finance']],
    ]);
    const second = await rolesView(deps, asking, { after: first.value.next });
    if (!second.ok) throw new Error(second.error.message);
    // The last page: the five left, then the holder with no person, so nothing is held unseen.
    expect(second.value.people.map((p) => p.accountId).slice(-1)).toEqual([GHOST]);
    expect(second.value.people).toHaveLength(6);
    expect(second.value.next).toBeNull();
  });

  it('searches on People’s side', async () => {
    const found = await rolesView(deps, asking, { search: 'ada' });
    expect(found.ok && found.value.people.map((p) => p.name)).toEqual(['Ada Admin']);
    expect(found.ok && found.value.next).toBeNull();
  });
});
