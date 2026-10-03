import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey } from '@kithena/contracts';

import { decideRequest } from '../approval/decide.js';
import type { CalendarEntry, CalendarPort, Deps } from '../ports.js';
import { cancelRequest, sendRequest } from '../request/request.js';
import { caller, hr, people, TENANT, world } from '../testing/world.js';
import { calendarForRequest, calendarHolidays } from './calendar.js';
import { reachOnEvent } from './events.js';

/** A calendar that records what it was asked to do. */
function recording(configured = true) {
  const puts: CalendarEntry[] = [];
  const removed: string[] = [];
  const port: CalendarPort = {
    provider: 'google',
    configured,
    connectUrl: () => null,
    complete: () => Promise.resolve({ config: {}, secret: null }),
    put: (_i, entry) => {
      if (entry.email === 'broken@acme.example') return Promise.reject(new Error('mailbox gone'));
      puts.push(entry);
      return Promise.resolve();
    },
    remove: (_i, entry) => {
      removed.push(entry.key);
      return Promise.resolve();
    },
  };
  return { port, puts, removed };
}

function setup(connected = true) {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const calendar = recording();
  const deps: Deps = {
    ...app.deps,
    reach: { calendars: [calendar.port], chats: [], publicUrl: 'https://to.example' },
  };
  if (connected) {
    app.state(TENANT).integrations.set('google', {
      provider: 'google',
      config: {},
      secret: null,
      connectedAt: '2026-09-01T00:00:00.000Z' as never,
      connectedBy: hr.accountId,
    });
  }
  const approved = async () => {
    const sent = await sendRequest(deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from: '2026-10-19', to: '2026-10-23' }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    await decideRequest(deps)(caller(people.marco), {
      requestId: sent.value.requestId,
      decision: 'approve',
    });
    return sent.value.requestId;
  };
  return { app, deps, calendar, approved };
}

describe('time off on people’s calendars (TOF-110)', () => {
  it('puts an approved request on the member’s calendar as Out of office, and nothing more', async () => {
    const { deps, calendar, approved } = setup();
    const id = await approved();
    const done = await calendarForRequest(deps)(TENANT, id, 'approved');
    expect(done).toEqual({ ok: true, value: { sent: 1, failed: [] } });
    expect(calendar.puts).toEqual([
      {
        key: `request-${id}-0`,
        email: 'adam@acme.example',
        title: 'Out of office',
        from: '2026-10-19',
        to: '2026-10-23',
        kind: 'out_of_office',
        timeZone: 'Europe/Madrid',
      },
    ]);
    expect(calendar.removed).toEqual([]);
  });

  it('reacts to Time Off’s own approval event, and ignores anything else', async () => {
    const { app, deps, calendar, approved } = setup();
    await approved();
    const event = app.state(TENANT).events.find((e) => e.eventName === 'timeoff.request.approved');
    expect((await reachOnEvent(deps)(event)).ok).toBe(true);
    expect(calendar.puts).toHaveLength(1);
    expect(
      await reachOnEvent(deps)({ eventName: 'people.person.hired', tenantId: TENANT }),
    ).toEqual({ ok: true, value: { sent: 0, failed: [] } });
    expect(await reachOnEvent(deps)('not an envelope')).toEqual({
      ok: true,
      value: { sent: 0, failed: [] },
    });
  });

  it('takes a cancelled request away', async () => {
    const { deps, calendar, approved } = setup();
    const id = await approved();
    await cancelRequest(deps)(caller(people.adam), id);
    await calendarForRequest(deps)(TENANT, id, 'cancelled');
    expect(calendar.puts).toEqual([]);
    expect(calendar.removed).toContain(`request-${id}-0`);
  });

  it('does nothing without a connected calendar, or one without credentials', async () => {
    const { deps, calendar, approved } = setup(false);
    const id = await approved();
    expect(await calendarForRequest(deps)(TENANT, id, 'approved')).toEqual({
      ok: true,
      value: { sent: 0, failed: [] },
    });
    expect(calendar.puts).toEqual([]);
  });

  it('puts each member’s holidays for this year and next, from where they work', async () => {
    const { app, deps, calendar } = setup();
    const ravi = app.state(TENANT).members.get(people.ravi);
    if (ravi === undefined) throw new Error('no Ravi');
    app.state(TENANT).members.set(people.ravi, { ...ravi, workEmail: 'broken@acme.example' });
    const done = await calendarHolidays(deps)(TENANT);
    if (!done.ok) throw new Error(done.error.message);
    const adams = calendar.puts.filter((e) => e.email === 'adam@acme.example');
    expect(adams.map((e) => e.key)).toContain('holiday-madrid-2026-05-15');
    expect(adams.find((e) => e.key === 'holiday-es-2026-10-12')).toMatchObject({
      title: 'Fiesta Nacional',
      kind: 'holiday',
      from: '2026-10-12',
      to: '2026-10-12',
    });
    // One mailbox refusing is reported, and everybody else's holidays still go.
    expect(done.value.failed.length).toBeGreaterThan(0);
    expect(done.value.failed[0]).toEqual({ provider: 'google', message: 'mailbox gone' });
    expect(new Set(calendar.puts.map((e) => e.email)).size).toBe(6);
  });
});
