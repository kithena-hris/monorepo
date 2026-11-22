import { describe, expect, it } from 'vitest';

import { homeAway, homeLeave } from './home-time-off';

const span = (from: string, to: string) => ({ from, to });

describe('Time Off on Home', () => {
  const today = '2026-09-28';

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
