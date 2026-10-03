import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, PunchInput, type PersonId } from '@kithena/contracts';

import { decideRequest } from '../approval/decide.js';
import { decideOvertime, punch } from '../attendance/attendance.js';
import { sendRequest } from '../request/request.js';
import { caller, d, people, world } from '../testing/world.js';
import { attendanceRequestsScreen, calendar, delegation, requestDecision } from './manager.js';

const vacation = LeaveTypeKey.parse('vacation');

/**
 * T15, T17, T18: what an approver weighs, on the design's October. Omar and
 * Yuki are off on Wed 21 Oct, so Adam's 19–23 Oct leaves 4 of Platform's 7
 * in against a minimum of 5.
 */
async function october() {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const ask = async (who: PersonId, from: string, to: string) => {
    const sent = await sendRequest(app.deps)(caller(who), {
      leaveTypeKey: vacation,
      span: DateSpan.parse({ from, to }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    return sent.value.requestId;
  };
  const approve = async (id: string) => {
    const done = await decideRequest(app.deps)(caller(people.marco), {
      requestId: id as never,
      decision: 'approve',
    });
    if (!done.ok) throw new Error(done.error.message);
  };
  const august = await ask(people.adam, '2026-08-03', '2026-08-14');
  await approve(august);
  await approve(await ask(people.omar, '2026-10-19', '2026-10-21'));
  await approve(await ask(people.yuki, '2026-10-21', '2026-10-21'));
  const adam = await ask(people.adam, '2026-10-19', '2026-10-23');
  return { app, adam };
}

describe('deciding one request (T17)', () => {
  it('carries the domain’s ranked fixes for the clash, and the last time off taken', async () => {
    const { app, adam } = await october();
    const view = await requestDecision(app.deps)(caller(people.marco), {
      requestId: adam,
    });
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.lastTaken).toEqual({ from: '2026-08-03', to: '2026-08-14' });
    const options = view.value.alternatives;
    expect(options.map((o) => o.kind)).toEqual([
      'swap_days',
      'next_clean_week',
      'approve_as_asked',
      'ask_teammate',
      'ask_teammate',
    ]);
    expect(options[0]).toMatchObject({
      affects: 'requester',
      swapped: { out: ['2026-10-21'], in: ['2026-10-26'] },
      spans: [
        { from: '2026-10-19', to: '2026-10-20' },
        { from: '2026-10-22', to: '2026-10-26' },
      ],
      teammate: null,
    });
    expect(options[0]?.coverage.every((day) => !day.below)).toBe(true);
    expect(options[2]?.coverage.find((day) => day.date === '2026-10-21')).toMatchObject({
      in: 4,
      of: 7,
      below: true,
    });
    expect(options[3]).toMatchObject({
      affects: 'teammate',
      teammate: { personId: people.yuki, displayName: 'Yuki Tanaka' },
      absence: { from: '2026-10-21', to: '2026-10-21' },
    });
    // The smallest ask first: Yuki's one day before Omar's three.
    expect(options[4]?.teammate?.displayName).toBe('Omar Haddad');
  });

  it('offers nothing to fix once the request is decided', async () => {
    const { app, adam } = await october();
    await decideRequest(app.deps)(caller(people.marco), {
      requestId: adam,
      decision: 'approve',
    });
    const view = await requestDecision(app.deps)(caller(people.marco), {
      requestId: adam,
    });
    expect(view.ok && view.value.alternatives).toEqual([]);
  });
});

describe('the calendar (T12)', () => {
  it('names each person’s team, for the team filter', async () => {
    const app = world();
    const view = await calendar(app.deps)(caller(people.marco), {
      scope: 'company',
      from: '2026-10-01' as never,
      to: '2026-10-31' as never,
    });
    expect(view.ok && view.value.people[0]).toMatchObject({
      teamKey: 'platform',
      teamName: 'Platform',
    });
  });
});

describe('delegation (T19)', () => {
  it('says whose delegate it is and where an undecided request goes', async () => {
    const app = world();
    const view = await delegation(app.deps)(caller(people.adam));
    expect(view.ok && view.value).toMatchObject({
      approverId: people.adam,
      escalatesTo: { personId: people.marco, displayName: 'Marco Ruiz' },
      delegation: null,
    });
  });
});

describe('the attendance Requests tab (TOF-099)', () => {
  it('gives Marco his reports’ overtime to decide, and Adam his own and where it stands', async () => {
    const app = world('2026-10-05T07:00:00.000Z');
    const adam = caller(people.adam);
    const at = async (iso: string, kind: 'in' | 'out') => {
      app.clock.set(iso);
      await punch(app.deps)(adam, PunchInput.parse({ kind, source: 'web', workModel: 'office' }));
    };
    // Monday and Tuesday, 09:00–18:00: an hour over each.
    await at('2026-10-05T07:00:00.000Z', 'in');
    await at('2026-10-05T16:00:00.000Z', 'out');
    await at('2026-10-06T07:00:00.000Z', 'in');
    await at('2026-10-06T16:00:00.000Z', 'out');
    app.clock.set('2026-10-07T07:00:00.000Z');
    await decideOvertime(app.deps)(caller(people.marco), {
      personId: people.adam,
      date: d('2026-10-05'),
      approve: true,
      choice: 'paid',
    });

    const marco = await attendanceRequestsScreen(app.deps)(caller(people.marco));
    if (!marco.ok) throw new Error(marco.error.message);
    expect(marco.value.overtime).toEqual({ becomes: 'choose', multiplier: '1.25' });
    expect(marco.value.needsYou).toEqual([
      expect.objectContaining({
        kind: 'overtime',
        personId: people.adam,
        displayName: 'Adam Novak',
        date: '2026-10-06',
        minutes: 60,
      }),
    ]);

    const mine = await attendanceRequestsScreen(app.deps)(adam);
    expect(mine.ok && mine.value.mine).toEqual([
      { date: '2026-10-06', minutes: 60, status: 'waiting' },
      { date: '2026-10-05', minutes: 60, status: 'paid' },
    ]);
  });
});
