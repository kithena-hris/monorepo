import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey, type PersonId } from '@kithena/contracts';

import { sendRequest } from '../request/request.js';
import { caller, d, hr, people, PLATFORM, world } from '../testing/world.js';
import { dayDetail, teamCalendar, yearHeatmap } from './calendar.js';
import { calendarFeed, issueFeedToken, revokeFeeds } from './ical.js';

async function setup() {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const send = (who: PersonId, key: string, from: string, to: string) =>
    sendRequest(app.deps)(caller(who), {
      leaveTypeKey: LeaveTypeKey.parse(key),
      span: DateSpan.parse({ from, to }),
    });
  await send(people.adam, 'sick', '2026-10-01', '2026-10-02');
  await send(people.omar, 'vacation', '2026-10-19', '2026-10-21');
  return app;
}

const october = { scope: 'team' as const, from: d('2026-10-01'), to: d('2026-10-31') };

describe('calendar queries (TOF-040)', () => {
  it('shows a teammate a sick day as "Off", with no type', async () => {
    const app = await setup();
    const view = await teamCalendar(app.deps)(caller(people.omar), october);
    if (!view.ok) throw new Error(view.error.message);
    const adams = view.value.entries.find((e) => e.personId === people.adam);
    expect(adams).toMatchObject({
      personId: people.adam,
      span: { from: '2026-10-01', to: '2026-10-02', startsHalfDay: false, endsHalfDay: false },
      status: 'approved',
      shows: 'off',
    });
    expect(adams).not.toHaveProperty('leaveTypeKey');
    // A vacation shows its type to a teammate.
    expect(view.value.entries.find((e) => e.personId === people.omar)).toMatchObject({
      shows: 'type',
      leaveTypeKey: 'vacation',
      status: 'pending',
    });
  });

  it('shows the manager, HR and the member the type', async () => {
    const app = await setup();
    for (const who of [caller(people.marco), hr, caller(people.adam)]) {
      const view = await teamCalendar(app.deps)(who, { ...october, teamKey: PLATFORM });
      expect(view.ok && view.value.entries.find((e) => e.personId === people.adam)).toMatchObject({
        shows: 'type',
        leaveTypeKey: 'sick',
      });
    }
  });

  it('carries holidays and the coverage row for the timeline', async () => {
    const app = await setup();
    const view = await teamCalendar(app.deps)(caller(people.adam), october);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.holidays.map((h) => h.date)).toEqual(['2026-10-12']);
    expect(view.value.coverage.find((c) => c.date === '2026-10-19')).toMatchObject({
      in: 6,
      of: 7,
    });
    expect(view.value.coverage).toHaveLength(31);
  });

  it('answers the day detail and the year', async () => {
    const app = await setup();
    const day = await dayDetail(app.deps)(caller(people.adam), {
      scope: 'team',
      date: d('2026-10-20'),
    });
    expect(day.ok && day.value.entries.map((e) => e.personId)).toEqual([people.omar]);

    const year = await yearHeatmap(app.deps)(caller(people.marco), { scope: 'team', year: 2026 });
    expect(year.ok && year.value.find((y) => y.date === '2026-10-01')).toEqual({
      date: '2026-10-01',
      off: 1,
    });
  });

  it('serves a signed feed, and stops once revoked', async () => {
    const app = await setup();
    const issued = await issueFeedToken(app.deps)(caller(people.omar), 'team');
    if (!issued.ok) throw new Error(issued.error.message);
    const feed = calendarFeed(app.deps);

    const ics = await feed(issued.value.token);
    if (!ics.ok) throw new Error(ics.error.message);
    expect(ics.value).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics.value).toContain('SUMMARY:Adam Novak · Off\r\n');
    expect(ics.value).toContain('DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261003');
    expect(ics.value).toContain('SUMMARY:Omar Haddad · Vacation (pending)');

    const forged = `${issued.value.token.split('.')[0] ?? ''}.AAAA`;
    expect(await feed(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_TOKEN' } });

    await revokeFeeds(app.deps)(caller(people.omar));
    expect(await feed(issued.value.token)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOKEN' },
    });
  });

  it('puts the holidays where you work in your own feed, and only there', async () => {
    const app = await setup();
    const feed = calendarFeed(app.deps);
    const mine = await issueFeedToken(app.deps)(caller(people.adam), 'me');
    const team = await issueFeedToken(app.deps)(caller(people.adam), 'team');
    if (!mine.ok || !team.ok) throw new Error('no token');
    const own = await feed(mine.value.token);
    const teams = await feed(team.value.token);
    if (!own.ok || !teams.ok) throw new Error('no feed');
    expect(own.value).toContain(
      'UID:holiday-madrid-2026-10-12\r\nDTSTAMP:20261001T070000Z\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013\r\nSUMMARY:Fiesta Nacional · public holiday\r\n',
    );
    expect(own.value).toContain('SUMMARY:Adam Novak · Sick');
    expect(teams.value).not.toContain('public holiday');
  });
});
