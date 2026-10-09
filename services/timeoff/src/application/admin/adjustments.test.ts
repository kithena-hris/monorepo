import { describe, expect, it } from 'vitest';
import { LeaveTypeKey } from '@kithena/contracts';

import { balanceFor, live } from '../shared.js';
import { caller, d, hr, people, TENANT, world } from '../testing/world.js';
import { adjustBalance, balanceAdjustments, decideBalanceAdjustment } from './adjustments.js';

const vacation = LeaveTypeKey.parse('vacation');
const give = (personId: string, over: Record<string, unknown> = {}) => ({
  personId: personId as never,
  leaveTypeKey: vacation,
  amount: '2.000',
  effectiveOn: d('2026-10-01'),
  reason: 'Worked the offsite weekend',
  ...over,
});

describe('adjusting a balance by hand (PRD §7.1)', () => {
  it('HR’s goes into the ledger at once, with the reason', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const done = await adjustBalance(app.deps)(hr, give(people.adam));
    expect(done).toMatchObject({ ok: true, value: { status: 'approved' } });

    const s = app.state(TENANT);
    const rows = live(s.ledger.filter((e) => e.personId === people.adam));
    expect(rows.map((e) => [e.kind, e.amount, e.reason])).toEqual([
      ['grant', '25.000', null],
      ['adjustment', '2.000', 'Worked the offsite weekend'],
    ]);
    expect(s.events.map((e) => e.eventName)).toEqual(['timeoff.balance.adjusted']);
  });

  it('always says why', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    expect(await adjustBalance(app.deps)(hr, give(people.adam, { reason: '' }))).toMatchObject({
      ok: false,
      error: { code: 'REASON_REQUIRED' },
    });
  });

  it('a manager’s waits for HR, then counts once approved', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const marco = caller(people.marco);
    const asked = await adjustBalance(app.deps)(marco, give(people.adam, { amount: '-1.000' }));
    expect(asked).toMatchObject({ ok: true, value: { status: 'pending', entryId: null } });
    if (!asked.ok) throw new Error('not asked');
    const s = app.state(TENANT);
    expect(s.ledger.filter((e) => e.kind === 'adjustment')).toEqual([]);

    // Marco cannot approve his own, and sees it in his list.
    expect(
      await decideBalanceAdjustment(app.deps)(marco, {
        adjustmentId: asked.value.adjustmentId,
        approve: true,
        note: null,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const mine = await balanceAdjustments(app.deps)(marco);
    expect(mine.ok && mine.value.items.map((i) => [i.displayName, i.canDecide])).toEqual([
      ['Adam Novak', false],
    ]);

    const queue = await balanceAdjustments(app.deps)(hr);
    expect(queue.ok && queue.value.items.map((i) => i.canDecide)).toEqual([true]);
    expect(
      await decideBalanceAdjustment(app.deps)(hr, {
        adjustmentId: asked.value.adjustmentId,
        approve: true,
        note: null,
      }),
    ).toMatchObject({ ok: true, value: { status: 'approved' } });
    const member = s.members.get(people.adam);
    if (member === undefined) throw new Error('no member');
    expect(
      (await app.deps.uow.run(TENANT, (tx) => balanceFor(tx, member, vacation, d('2026-10-01'))))
        .left,
    ).toBe('24.000');
  });

  it('is nobody else’s to ask, and nobody adjusts their own', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    expect(await adjustBalance(app.deps)(caller(people.omar), give(people.adam))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await adjustBalance(app.deps)(caller(people.adam), give(people.adam))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
