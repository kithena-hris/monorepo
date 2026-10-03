import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey } from '@kithena/contracts';

import { sendRequest } from '../request/request.js';
import { holidays, overview } from '../screens/employee.js';
import { recordingWriter, shown } from '../testing/assist.js';
import { caller, people, TENANT, world } from '../testing/world.js';

/**
 * Adam in Madrid on 1 October 2026. Madrid moves the Constitution to Monday 7
 * December, so 9–11 December buys nine days with the Tuesday; Easter 2027,
 * San José on the Friday before it, buys ten for three.
 */
describe('bridge days (TOF-085)', () => {
  it('finds them in Time Off, from Madrid’s holidays, and templates the line without a model', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const read = await overview(app.deps)(caller(people.adam));
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.bridges.map((b) => [b.from, b.used, b.away.days])).toEqual([
      ['2027-03-22', 3, 10],
      ['2026-12-09', 3, 9],
    ]);
    expect(read.value.bridges[1]).toMatchObject({
      to: '2026-12-11',
      away: { from: '2026-12-05', to: '2026-12-13' },
      holidays: [
        { date: '2026-12-07', name: 'Día de la Constitución (trasladado)' },
        { date: '2026-12-08', name: 'Inmaculada Concepción' },
      ],
      text: {
        text: '9 days off, 5–13 Dec, with Día de la Constitución (trasladado) and Inmaculada Concepción.',
        ai: false,
      },
    });
  });

  it('skips a day already asked for', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const sent = await sendRequest(app.deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from: '2026-12-10', to: '2026-12-10' }),
    });
    expect(sent.ok).toBe(true);
    const read = await overview(app.deps)(caller(people.adam));
    expect(read.ok && read.value.bridges.map((b) => b.from)).not.toContain('2026-12-09');
  });

  it('lets a model write the line from the days alone: no name, no balance, no team', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const writer = recordingWriter(() => 'Three days off buys you Fri 19 Mar to Sun 28 Mar.');
    const read = await overview({ ...app.deps, writer })(caller(people.adam));
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.bridges[0]?.text).toEqual({
      text: 'Three days off buys you Fri 19 Mar to Sun 28 Mar.',
      ai: true,
    });
    const prompt = shown(writer.asks);
    for (const never of ['Adam', 'Novak', people.adam, TENANT, '25.000', 'Omar', 'Marco']) {
      expect(prompt).not.toContain(never);
    }
  });

  it('lists the year’s still ahead on the holidays page, in date order', async () => {
    const app = world('2026-10-01T07:00:00.000Z');
    const read = await holidays(app.deps)(caller(people.adam), { year: 2026 });
    if (!read.ok) throw new Error(read.error.message);
    const froms = read.value.bridges.map((b) => b.from);
    expect(froms).toEqual(['2026-11-03', '2026-12-09']);
    expect(froms).toEqual(froms.toSorted());
    expect(froms.every((f) => f > '2026-10-01')).toBe(true);
  });
});
