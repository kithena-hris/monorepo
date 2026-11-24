import { describe, expect, it } from 'vitest';

import { awayScope, homeAway, homeLeave } from './home-time-off';

const span = (from: string, to: string) => ({ from, to });

describe('Time Off on Home', () => {
  const today = '2026-09-28';

  it('offers the reader’s team, the whole company and each department by name, and names a team People knows', () => {
    const away = homeAway(
      {
        people: [{ personId: 'a', displayName: 'Ada Lovelace', teamKey: 'u_1', teamName: null }],
        entries: [{ personId: 'a', status: 'approved', span: span('2026-09-28', '2026-09-28') }],
      },
      today,
      null,
      'unit:u_1',
      [
        { teamKey: 'u_2', name: 'Sales' },
        { teamKey: 'u_1', name: 'Research' },
      ],
    );
    expect(away.scope).toBe('unit:u_1');
    expect(away.scopes.map((s) => [s.key, s.label])).toEqual([
      ['team', 'My team'],
      ['company', 'Whole company'],
      ['unit:u_1', 'Research'],
      ['unit:u_2', 'Sales'],
    ]);
    expect(away.people[0]?.team).toBe('Research');
  });

  it('answers a later page: the total is everyone, the people those after the ones passed over', () => {
    const timeline = {
      people: ['a', 'b', 'c'].map((id) => ({ personId: id, displayName: id, teamName: null })),
      entries: ['a', 'b', 'c'].map((id, i) => ({
        personId: id,
        status: 'approved',
        span: span(`2026-09-2${String(8 + (i > 1 ? 1 : 0))}`, '2026-09-30'),
      })),
    };
    const page = homeAway(timeline, today, null, 'company', [], 2);
    expect(page.total).toBe(3);
    expect(page.people.map((p) => p.id)).toEqual(['c']);
  });

  it('reads a scope a browser sent: anything it does not know is the reader’s team', () => {
    expect(awayScope('company')).toBe('company');
    expect(awayScope('unit:u_0a1b')).toBe('unit:u_0a1b');
    expect(awayScope('unit:../x')).toBe('team');
    expect(awayScope(undefined)).toBe('team');
  });

  it('lists who is away today first, then who is next, one row a person, never the reader', () => {
    const away = homeAway(
      {
        people: [
          { personId: 'a', displayName: 'Ada Lovelace', teamName: 'Research' },
          { personId: 'g', displayName: 'Grace Hopper', teamName: null },
          { personId: 't', displayName: 'Alan Turing', teamName: 'Research' },
          { personId: 'me', displayName: 'Me', teamName: 'Research' },
        ],
        entries: [
          { personId: 't', status: 'approved', span: span('2026-10-05', '2026-10-09') },
          { personId: 'a', status: 'approved', span: span('2026-09-25', '2026-09-30') },
          // A second absence of somebody already listed, and what does not count.
          { personId: 'a', status: 'approved', span: span('2026-10-12', '2026-10-13') },
          { personId: 'g', status: 'pending', span: span('2026-09-29', '2026-09-29') },
          { personId: 'g', status: 'approved', span: span('2026-09-01', '2026-09-02') },
          { personId: 'me', status: 'approved', span: span('2026-09-28', '2026-09-28') },
        ],
      },
      today,
      'me',
    );
    expect(away.people).toEqual([
      {
        id: 'a',
        name: 'Ada Lovelace',
        team: 'Research',
        when: 'Today – Wed, Sep 30',
        detail: 'Back Thu, Oct 1',
        now: true,
      },
      {
        id: 't',
        name: 'Alan Turing',
        team: 'Research',
        when: 'Mon, Oct 5 – Fri, Oct 9',
        detail: 'In 7 days',
        now: false,
      },
    ]);
  });

  it('words their balances and what is coming up, with where each request stands', () => {
    const leave = homeLeave(
      {
        member: { personId: 'me' },
        balances: [
          { leaveTypeKey: 'vacation', name: 'Vacation', unit: 'day', left: '11.500' },
          { leaveTypeKey: 'toil', name: 'Time in lieu', unit: 'hour', left: '4.000' },
          { leaveTypeKey: 'sick', name: 'Sick leave', unit: 'day', left: '10.000' },
        ],
        comingUp: [
          {
            requestId: 'r1',
            leaveTypeName: 'Vacation',
            status: 'pending',
            span: span('2026-10-12', '2026-10-16'),
            workingDays: '5.000',
            waitingOn: 'manager',
          },
          {
            requestId: 'r2',
            leaveTypeName: 'Vacation',
            status: 'approved',
            span: span('2026-11-02', '2026-11-02'),
            workingDays: '1.000',
            waitingOn: null,
          },
        ],
      },
      today,
    );
    expect(leave.balances.map((b) => `${b.name}: ${b.left} ${b.unit}`)).toEqual([
      'Vacation: 11.5 days left',
      'Time in lieu: 4 hours left',
    ]);
    expect(leave.requests).toEqual([
      {
        id: 'r1',
        title: 'Vacation',
        when: 'Mon, Oct 12 – Fri, Oct 16',
        detail: '5 working days · waiting for your manager',
        status: 'Pending',
        tone: 'warning',
        href: '/time-off/requests/r1',
      },
      {
        id: 'r2',
        title: 'Vacation',
        when: 'Mon, Nov 2',
        detail: '1 working day',
        status: 'Approved',
        tone: 'success',
        href: '/time-off/requests/r2',
      },
    ]);
  });
});
