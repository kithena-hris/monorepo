import { describe, expect, it } from 'vitest';

import { flaggedRows, inboxView } from './inbox';

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
        { ...salary, id: 'c2', name: 'Lucía Fernández', label: 'Bank account', value: { last4: '1332' }, current: { last4: '3000' }, flagSummary: '2 days after a new address' },
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
        href: '/people/approvals?tab=flagged&change=c1',
      },
      {
        id: 'c2',
        name: 'Lucía Fernández',
        change: 'Bank account',
        why: '2 days after a new address',
        href: '/people/approvals?tab=flagged&change=c2',
      },
      {
        id: 'c5',
        name: 'Tom Fischer',
        change: 'Salary',
        why: 'A 38% raise, above the band',
        href: '/people/approvals?tab=flagged&change=c5',
      },
    ]);
  });
});
