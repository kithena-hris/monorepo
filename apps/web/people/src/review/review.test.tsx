import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApprovalItem } from '../approvals/approvals';
import type { ShareRequest } from '../export/export-done';
import { done, renderReview } from './review.fixture';

/** A request to send an export, waiting for this administrator (E5). */
const share: ShareRequest = {
  id: 's1',
  state: 'pending',
  requestedBy: { accountId: 'a-marco', name: 'Marco Ruiz' },
  recipient: { accountId: 'a-nora', name: 'Nora Becker' },
  reason: 'Headcount plan for the 2027 budget.',
  requestedAt: '2026-09-21T09:00:00.000Z',
  expiresAt: '2026-09-28T09:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  note: null,
  fields: ['Name', 'Salary'],
  gap: { fields: [{ key: 'base_salary', label: 'Salary', people: 6 }], unlisted: 0 },
  asOf: null,
  format: 'xlsx',
  audience: null,
  exportId: null,
  mine: false,
  canDecide: true,
  approvers: [],
};

describe('Review', () => {
  it('lists the exports waiting for this administrator under Exports (E5)', () => {
    renderReview(
      { roles: { hr: true, admin: true, finance: false }, shares: [share] },
      { onDecideShare: done },
    );
    expect(screen.getByRole('radio', { name: /Exports 1/u })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
    expect(within(list).getByText('Marco Ruiz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeInTheDocument();
  });

  it('counts and lists lapsed changes and decided ID checks on Decided (E9)', () => {
    renderReview(
      {
        approvals: {
          isHr: true,
          items: [],
          decided: [
            {
              ...change,
              state: 'lapsed',
              decidedBy: null,
              decidedAt: '2026-09-20T09:00:00.000Z',
              flagSummary: null,
              flags: [],
            },
          ],
        },
        identifiers: {
          items: [],
          decided: [
            {
              personId: 'p2',
              name: 'Adam Novak',
              label: 'National ID',
              outcome: 'sent_back',
              decidedBy: 'Ada Lovelace',
              decidedAt: '2026-09-22T09:00:00.000Z',
              note: 'The check letter is wrong.',
            },
          ],
        },
      },
      { tab: 'decided' },
    );
    expect(screen.getByRole('radio', { name: /All 2/u })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /ID checks 1/u })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Decided in the last 90 days' });
    expect(within(table).getByText('Lapsed')).toBeInTheDocument();
    expect(within(table).getByText('Nobody, in 7 days')).toBeInTheDocument();
    expect(within(table).getByText('Sent back')).toBeInTheDocument();
    expect(within(table).getByText('Ada Lovelace')).toBeInTheDocument();
  });
});

const change: ApprovalItem = {
  id: 'c1',
  key: 'base_salary',
  label: 'Base salary',
  kind: 'value',
  value: { amountMinor: '8400000', currency: 'EUR' },
  current: { amountMinor: '6100000', currency: 'EUR' },
  effectiveFrom: '2026-10-01',
  requestedAt: '2026-09-22T09:40:00.000Z',
  expiresAt: '2026-09-29T09:40:00.000Z',
  requestedBy: 'Marco Ruiz',
  reason: 'Matching a competing offer',
  mine: false,
  canDecide: true,
  personId: 'p1',
  name: 'Tom Fischer',
  readable: true,
};
