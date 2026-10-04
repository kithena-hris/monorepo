import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
