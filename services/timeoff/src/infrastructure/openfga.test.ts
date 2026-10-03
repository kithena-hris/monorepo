import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, type PersonId, type TenantId } from '@kithena/contracts';

import { decideRequest } from '../application/approval/decide.js';
import { setDelegation } from '../application/approval/escalation.js';
import { cancelRequest, sendRequest } from '../application/request/request.js';
import { caller, d, member, people, TENANT, world } from '../application/testing/world.js';
import type { DateRange } from '../domain/days.js';
import { syncingTuples, type TimeOffFga } from './openfga.js';

/**
 * TOF-050a and TOF-050b: the member and cover tuples follow the rows. Against
 * a recording graph; `openfga.integration.test.ts` holds what the tuples then
 * answer.
 */

function boot() {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const synced: { tenantId: TenantId; personId: PersonId; managerPersonId: PersonId | null }[] = [];
  const covers: {
    approverId: PersonId;
    cover: { delegateId: PersonId; ranges: readonly DateRange[] } | null;
  }[] = [];
  const fga: Pick<TimeOffFga, 'syncMember' | 'syncCover' | 'setHrAdmin'> = {
    syncMember: (tenantId, m) => {
      synced.push({ tenantId, personId: m.personId, managerPersonId: m.managerPersonId });
      return Promise.resolve('applied');
    },
    syncCover: (_tenantId, approverId, cover) => {
      covers.push({ approverId, cover });
      return Promise.resolve('applied');
    },
    setHrAdmin: () => Promise.resolve(),
  };
  const wrapped = syncingTuples(app.deps.uow, fga);
  return { app, synced, covers, deps: { ...app.deps, uow: wrapped.uow }, ...wrapped };
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

describe('the cover tuples', () => {
  const vacation = LeaveTypeKey.parse('vacation');

  it('follow a delegation set with a range, and clear when it is removed', async () => {
    const { deps, covers } = boot();
    const range = { from: d('2026-10-05'), to: d('2026-10-09') };
    const set = await setDelegation(deps)(caller(people.marco), {
      approverId: people.marco,
      delegateId: people.omar,
      range,
      automatic: false,
      salaryRelated: false,
    });
    expect(set.ok).toBe(true);
    expect(covers).toEqual([
      { approverId: people.marco, cover: { delegateId: people.omar, ranges: [range] } },
    ]);

    await setDelegation(deps)(caller(people.marco), { approverId: people.marco, remove: true });
    expect(covers.at(-1)).toEqual({ approverId: people.marco, cover: null });
  });

  it("follow an automatic delegation through the approver's own time off, approved then cancelled", async () => {
    const { deps, covers } = boot();
    // Omar approves nobody here, but the rule is the same for any approver: Marco decides his.
    await setDelegation(deps)(caller(people.omar), {
      approverId: people.omar,
      delegateId: people.yuki,
      range: null,
      automatic: true,
      salaryRelated: false,
    });
    expect(covers).toEqual([
      { approverId: people.omar, cover: { delegateId: people.yuki, ranges: [] } },
    ]);

    const sent = await sendRequest(deps)(caller(people.omar), {
      leaveTypeKey: vacation,
      span: DateSpan.parse({ from: '2026-11-02', to: '2026-11-06' }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    expect(covers.at(-1)?.cover?.ranges).toEqual([]);

    await decideRequest(deps)(caller(people.marco), {
      requestId: sent.value.requestId,
      decision: 'approve',
    });
    expect(covers.at(-1)).toEqual({
      approverId: people.omar,
      cover: { delegateId: people.yuki, ranges: [{ from: d('2026-11-02'), to: d('2026-11-06') }] },
    });

    await cancelRequest(deps)(caller(people.omar), sent.value.requestId);
    expect(covers.at(-1)).toEqual({
      approverId: people.omar,
      cover: { delegateId: people.yuki, ranges: [] },
    });
  });

  it('leave the graph alone for a request by somebody who has no delegation', async () => {
    const { deps, covers } = boot();
    const sent = await sendRequest(deps)(caller(people.adam), {
      leaveTypeKey: vacation,
      span: DateSpan.parse({ from: '2026-11-02', to: '2026-11-06' }),
    });
    expect(sent.ok).toBe(true);
    expect(covers).toEqual([]);
  });
});
