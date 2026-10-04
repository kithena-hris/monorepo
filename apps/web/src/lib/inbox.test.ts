import { describe, expect, it } from 'vitest';

import { flaggedInboxRows, flaggedRows, inboxView, todoRows } from './inbox';
import { EMPTY_SHELL } from './shell-data';

const salary = {
  id: 'c1',
  name: 'Tom Fischer',
  label: 'Salary',
  readable: true,
  canDecide: true,
  flagSummary: 'A 38% raise, above the band',
  value: { amountMinor: '8400000', currency: 'EUR' },
  current: { amountMinor: '6100000', currency: 'EUR' },
};

describe('the Inbox (MA6)', () => {
  it('keeps its view in the address, to do unless it names another', () => {
    expect(inboxView('flagged')).toBe('flagged');
    expect(inboxView(undefined)).toBe('todo');
    expect(inboxView('anything')).toBe('todo');
  });

  it('lists the flagged changes the viewer decides, with the reason on the row', () => {
    expect(
      flaggedRows([
        salary,
        {
          ...salary,
          id: 'c2',
          name: 'Lucía Fernández',
          label: 'Bank account',
          value: { last4: '1332' },
          current: { last4: '3000' },
          flagSummary: '2 days after a new address',
        },
        { ...salary, id: 'c3', flagSummary: null },
        { ...salary, id: 'c4', canDecide: false },
        { ...salary, id: 'c5', readable: false },
      ]),
    ).toEqual([
      {
        id: 'c1',
        name: 'Tom Fischer',
        change: 'Salary €61k → €84k',
        why: 'A 38% raise, above the band',
        href: '/people/review/flagged?kind=changes&item=change-c1',
      },
      {
        id: 'c2',
        name: 'Lucía Fernández',
        change: 'Bank account',
        why: '2 days after a new address',
        href: '/people/review/flagged?kind=changes&item=change-c2',
      },
      {
        id: 'c5',
        name: 'Tom Fischer',
        change: 'Salary',
        why: 'A 38% raise, above the band',
        href: '/people/review/flagged?kind=changes&item=change-c5',
      },
    ]);
  });
});

describe('the Inbox’s rows, on the bell and the phone alike (B3)', () => {
  const shell = {
    ...EMPTY_SHELL,
    now: '2026-09-29T09:00:00Z',
    notices: [
      {
        id: 'approval:c1',
        title: 'Approve a salary change',
        detail: 'Tom Fischer · asked by Marco Ruiz',
        at: '2026-09-29T07:00:00Z',
        href: '/people/review/waiting?kind=changes&item=change-c1',
        person: 'Tom Fischer',
        kind: 'approval' as const,
      },
      {
        id: 'viewed:v1',
        title: 'Grace Hopper viewed Kithena as you',
        detail: 'For 12 min',
        at: '2026-09-28T07:00:00Z',
        href: '/inbox',
        person: 'Grace Hopper',
        kind: 'viewed' as const,
      },
    ],
    waiting: {
      identifiers: 3,
      duplicates: 0,
      accessRequests: 1,
      exports: 1,
      identifiersBy: ['Adam Novak', 'You'],
      accessRequestsBy: ['Sofia Lindqvist'],
      exportsBy: ['Marco Ruiz'],
    },
  };

  it('lists what to do, each other queue of Review a row to its chip, and leaves news to Updates', () => {
    const rows = todoRows(shell);
    expect(rows.map((r) => r.name)).toEqual([
      'Tom Fischer',
      '3 identifiers to check',
      '1 request for full values',
      '1 export to send',
    ]);
    expect(rows[0]).toMatchObject({
      person: true,
      summary: 'Approve a salary change · Tom Fischer · asked by Marco Ruiz',
    });
    expect(rows[1]).toMatchObject({ person: false, href: '/people/review/waiting?kind=ids' });
  });

  it('names who asked on every row that counts requests', () => {
    const rows = todoRows(shell);
    expect(rows.map((r) => r.summary).slice(1)).toEqual([
      'Failed a check, or couldn’t be verified · entered by Adam Novak and you',
      'Sofia Lindqvist asked to see unmasked values',
      'Marco Ruiz asked to send an export',
    ]);
    expect(rows[3]).toMatchObject({ href: '/people/review/waiting?kind=exports' });
  });

  it('puts a flag’s reason under its change', () => {
    const [row] = flaggedInboxRows(flaggedRows([salary]));
    expect(row).toMatchObject({ name: 'Tom Fischer', flag: 'A 38% raise, above the band' });
  });
});
