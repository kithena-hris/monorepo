import { describe, expect, it } from 'vitest';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { namesView } from './names.js';
import type { ScreenDeps } from './record.js';

/**
 * The activity log's names: an account or a person id becomes a name, as the
 * viewer may read it, and an account nobody in People holds — Kithena support,
 * an operator — becomes nothing rather than a guess.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const GRACE = '00000000-0000-4000-8000-0000000000a2';
const NOBODY_ACCOUNT = '00000000-0000-4000-8000-0000000000c9';

function deps(): ScreenDeps {
  const store = inMemoryPeople([
    versionOf(1, [
      define({ key: 'given_name', visibility: ['self', 'hr', 'directory'] }),
      define({ key: 'family_name', visibility: ['self', 'hr', 'directory'] }),
    ]),
  ]);
  store.seed(ADA, { account: ADA_ACCOUNT, custom: { given_name: 'Ada', family_name: 'Lovelace' } });
  store.seed(GRACE, { custom: { given_name: 'Grace', family_name: 'Hopper' } });
  return {
    service: {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    },
    relations: store.deps.relations,
    clock: store.deps.clock,
    calendars: utcCalendars,
    personOf: (_tx, _tenant, account) =>
      Promise.resolve(
        [...store.rows.values()].find((r) => r.snapshot.identityAccountId === account)?.snapshot
          .id ?? null,
      ),
    gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
  };
}

describe('names for the activity log', () => {
  it('names accounts and people as HR reads them, and leaves out an account nobody holds', async () => {
    const seen = await namesView(
      deps(),
      {
        tenantId: TENANT,
        viewer: { accountId: '00000000-0000-4000-8000-0000000000b3', roles: new Set(['hr']) },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      },
      { accountIds: [ADA_ACCOUNT, NOBODY_ACCOUNT], personIds: [GRACE, ADA] },
    );
    expect(seen.ok ? seen.value.people : seen.error).toEqual([
      { accountId: ADA_ACCOUNT, personId: ADA, name: 'Ada Lovelace', avatarUrl: null },
      { accountId: null, personId: GRACE, name: 'Grace Hopper', avatarUrl: null },
    ]);
  });
});
