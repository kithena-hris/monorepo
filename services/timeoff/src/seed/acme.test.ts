import { describe, expect, it } from 'vitest';
import { CalendarDate, LeaveTypeKey } from '@kithena/contracts';

import { balanceFor } from '../application/shared.js';
import { inMemoryTimeOff, sequentialIds } from '../application/testing/in-memory.js';
import { TENANT } from '../application/testing/world.js';
import { SEEDED_AT, seedAcme, team } from './acme.js';

/** TOF-049's "done when", short of a browser: T1's numbers for Adam on 1 October. */
describe('the Acme seed', () => {
  it('gives Adam the balances T1 shows, and runs once', async () => {
    const app = inMemoryTimeOff(SEEDED_AT);
    const seeded = await seedAcme(app.deps.uow, TENANT, sequentialIds());
    expect(seeded).toEqual({ ok: true, value: { members: 7, requests: 11 } });

    const on = CalendarDate.parse('2026-10-01');
    const balance = (key: string) =>
      app.deps.uow.run(TENANT, async (tx) => {
        const adam = await tx.members.get(team.adam);
        if (adam === null) throw new Error('no Adam');
        return balanceFor(tx, adam, LeaveTypeKey.parse(key), on);
      });
    expect(await balance('vacation')).toMatchObject({
      left: '11.500',
      used: '10.500',
      booked: '3.000',
    });
    expect(await balance('personal')).toMatchObject({ left: '2.000', used: '1.000' });
    expect((await balance('comp')).left).toBe('6.000');

    const s = app.state(TENANT);
    expect(s.punches.get(team.adam)).toHaveLength(12);
    // Wednesday: in, a break, and no clock-out.
    expect(
      s.punches
        .get(team.adam)
        ?.filter((p) => p.at.startsWith('2026-09-30'))
        .map((p) => p.kind),
    ).toEqual(['in', 'break_start', 'break_end']);
    expect(s.minimums.get('platform')).toEqual({ atLeast: 5, unit: 'people' });

    const events = s.events.length;
    expect(await seedAcme(app.deps.uow, TENANT, sequentialIds())).toEqual({
      ok: true,
      value: null,
    });
    expect(s.events).toHaveLength(events);
  });
});
