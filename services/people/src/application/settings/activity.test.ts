import { describe, expect, it } from 'vitest';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { withSupport } from '../person/subject.js';
import { historyView } from '../screens/people.js';
import type { ScreenDeps } from '../screens/record.js';
import { activityView, type ActivityEntry } from './activity.js';

/**
 * The settings log names Kithena support as itself, with the reason the
 * operator gave, and whoever else as it always did (decided 2026-09-29).
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const SUPPORT_ACCOUNT = '00000000-0000-4000-8000-0000000000c9';
const OPERATOR = '00000000-0000-4000-8000-0000000000e1';

const rows: ActivityEntry[] = [
  {
    id: '00000000-0000-4000-8000-000000000d02',
    at: '2026-09-29T11:00:00.000Z',
    actor: SUPPORT_ACCOUNT,
    action: 'Granted a role',
    subject: null,
    detail: null,
    area: 'roles',
    onBehalfOf: OPERATOR,
    reason: 'Ticket 4812',
  },
  {
    id: '00000000-0000-4000-8000-000000000d01',
    at: '2026-09-29T10:00:00.000Z',
    actor: ADA_ACCOUNT,
    action: 'Added a field',
    subject: null,
    detail: null,
    area: 'fields',
    onBehalfOf: null,
    reason: null,
  },
];

function world() {
  const everyone = ['self', 'hr', 'directory'] as const;
  const store = inMemoryPeople([
    versionOf(1, [
      define({ key: 'given_name', visibility: [...everyone] }),
      define({ key: 'family_name', visibility: [...everyone] }),
    ]),
  ]);
  store.seed(ADA, { account: ADA_ACCOUNT, custom: { given_name: 'Ada', family_name: 'Lovelace' } });
  const relations = withSupport(store.deps.relations);
  const deps: ScreenDeps = {
    service: {
      access: personAccess({ ...store.deps, relations }),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    },
    relations,
    clock: store.deps.clock,
    calendars: utcCalendars,
    personOf: (_tx, _tenant, account) =>
      Promise.resolve(
        [...store.rows.values()].find((r) => r.snapshot.identityAccountId === account)?.snapshot
          .id ?? null,
      ),
    gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
    activity: { record: () => Promise.resolve(), page: () => Promise.resolve(rows) },
  };
  const as = (viewer: Viewer) => ({
    tenantId: TENANT,
    viewer,
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  });
  return { deps, as };
}

const query = { before: null, area: null };

describe('the settings log and Kithena support', () => {
  it('names support as itself, with the reason, and a person as themselves', async () => {
    const { deps, as } = world();
    const seen = await activityView(
      deps,
      as({ accountId: '00000000-0000-4000-8000-0000000000b3', roles: new Set(['people_admin']) }),
      query,
    );
    expect(seen.ok && seen.value.entries.map((e) => [e.by, e.kind, e.reason])).toEqual([
      ['Kithena support', 'support', 'Ticket 4812'],
      ['Ada Lovelace', 'person', null],
    ]);
  });

  it('is open to support, which calls its own entries Kithena support rather than You', async () => {
    const { deps, as } = world();
    const seen = await activityView(
      deps,
      as({
        accountId: SUPPORT_ACCOUNT,
        roles: new Set(),
        support: { operatorId: OPERATOR, reason: 'Ticket 4812' },
      }),
      query,
    );
    expect(seen.ok && seen.value.entries[0]?.by).toBe('Kithena support');
  });

  it('stays closed to anybody who is neither HR nor an administrator', async () => {
    const { deps, as } = world();
    const refused = await activityView(
      deps,
      as({ accountId: ADA_ACCOUNT, roles: new Set() }),
      query,
    );
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });
});

describe('a person’s history and Kithena support', () => {
  it('names support’s change "Kithena support", drawn as the product, not a person', async () => {
    const { deps, as } = world();
    const support = as({
      accountId: SUPPORT_ACCOUNT,
      roles: new Set(),
      support: { operatorId: OPERATOR, reason: 'Ticket 4812' },
    });
    const wrote = await deps.service.inTenant(TENANT, ({ tx }) =>
      deps.service.access.update(tx, {
        ...support,
        personId: ADA,
        changes: { given_name: 'Adeline' },
      }),
    );
    expect(wrote.ok).toBe(true);
    for (const viewer of [
      support.viewer,
      { accountId: '00000000-0000-4000-8000-0000000000b3', roles: new Set(['hr']) },
    ]) {
      const seen = await historyView(deps, as(viewer), ADA, null);
      expect(seen.ok && seen.value.changes.map((c) => [c.by, c.actor.kind])).toEqual([
        ['Kithena support', 'support'],
      ]);
    }
  });
});
