import { describe, expect, it } from 'vitest';
import type { PersonId, TenantId } from '@kithena/contracts';

import { member, people, TENANT, world } from '../application/testing/world.js';
import { syncingTuples, type TimeOffFga } from './openfga.js';

/**
 * TOF-050a: the member tuples follow the projection. Against a recording
 * graph; `openfga.integration.test.ts` holds what the tuples then answer.
 */

function boot() {
  const app = world();
  const synced: { tenantId: TenantId; personId: PersonId; managerPersonId: PersonId | null }[] = [];
  const fga: Pick<TimeOffFga, 'syncMember' | 'setHrAdmin'> = {
    syncMember: (tenantId, m) => {
      synced.push({ tenantId, personId: m.personId, managerPersonId: m.managerPersonId });
      return Promise.resolve('applied');
    },
    setHrAdmin: () => Promise.resolve(),
  };
  return { app, synced, ...syncingTuples(app.deps.uow, fga) };
}

describe('the member tuples', () => {
  it('follow a saved member once its transaction commits, read back from the row', async () => {
    const { uow, synced } = boot();
    let duringTransaction = -1;
    await uow.run(TENANT, async (tx) => {
      await tx.members.save(member(people.adam, 'Adam Novak', { managerPersonId: people.omar }));
      duringTransaction = synced.length;
    });
    expect(duringTransaction).toBe(0);
    expect(synced).toEqual([
      { tenantId: TENANT, personId: people.adam, managerPersonId: people.omar },
    ]);
  });

  it('are left alone when the transaction rolls back', async () => {
    const { uow, synced } = boot();
    await expect(
      uow.run(TENANT, async (tx) => {
        await tx.members.save(member(people.adam, 'Adam Novak', { managerPersonId: people.omar }));
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    expect(synced).toEqual([]);
  });

  it('are not touched by a transaction that only reads', async () => {
    const { uow, synced } = boot();
    await uow.run(TENANT, (tx) => tx.members.list());
    expect(synced).toEqual([]);
  });

  it('resync from the row on demand, and not for somebody unknown', async () => {
    const { tuples, synced } = boot();
    await tuples.resync(TENANT, people.yuki);
    await tuples.resync(TENANT, '00000000-0000-7000-8000-0000000000ff' as PersonId);
    expect(synced).toEqual([
      { tenantId: TENANT, personId: people.yuki, managerPersonId: people.marco },
    ]);
  });
});
