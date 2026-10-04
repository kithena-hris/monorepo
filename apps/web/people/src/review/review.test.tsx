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
  people: 6,
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
    expect(within(list).getByText('Export to Nora Becker · 6 people')).toBeInTheDocument();
    expect(screen.getByText('Everybody Marco can see · 6 people')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeInTheDocument();
  });

  it('names who asked on every row waiting: a change, an ID check, a pair (E1–E3)', () => {
    renderReview({
      approvals: { isHr: true, items: [change] },
      identifiers: {
        items: [
          {
            personId: 'p2',
            name: 'Adam Novak',
            attributeKey: 'national_id',
            label: 'National ID',
            last4: '123Y',
            findings: [{ level: 'mismatch', code: 'checksum', message: 'does not compute' }],
            enteredAt: '2026-09-23T09:00:00.000Z',
            enteredBy: 'Adam Novak',
          },
        ],
      },
      duplicates: {
        items: [
          {
            personIds: ['p3', 'p4'],
            names: ['Priya Shah', 'Priya S. Shah'],
            reasons: ['Same work email'],
            match: 'strong',
            flaggedBy: 'SCIM provisioning',
          },
        ],
        merges: [],
        comparison: null,
      },
    });
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
    expect(within(list).getByText('Asked by Marco Ruiz')).toBeInTheDocument();
    expect(within(list).getByText('Entered by Adam Novak')).toBeInTheDocument();
    expect(within(list).getByText('Flagged by SCIM provisioning')).toBeInTheDocument();
  });

  it('says nothing of how many people an older, uncounted request covers', () => {
    renderReview(
      { roles: { hr: true, admin: true, finance: false }, shares: [{ ...share, people: null }] },
      { onDecideShare: done },
    );
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
    expect(within(list).getByText(/Export to Nora Becker · Headcount plan/u)).toBeInTheDocument();
    expect(screen.getByText('Everybody Marco can see')).toBeInTheDocument();
  });

  it('says whose values a request for full values would show (E4)', () => {
    renderReview({
      fullValues: {
        canRequest: false,
        canDecide: true,
        fields: [],
        requests: [
          {
            id: 'r1',
            state: 'pending',
            mine: false,
            requestedBy: 'Sofia Lindqvist',
            reason: 'October payroll reconciliation.',
            fields: ['Salary'],
            people: 'Everybody · 96',
            requestedAt: '2026-09-22T09:00:00.000Z',
            expiresAt: '2026-09-29T09:00:00.000Z',
            note: null,
            link: null,
          },
        ],
      },
    });
    expect(screen.getByText('Everybody · 96')).toBeInTheDocument();
  });

  it('fills an employee’s Decided with their own requests, the value before beside the one asked for (E10)', () => {
    const own: ApprovalItem = {
      ...change,
      key: 'home_address',
      label: 'Home address',
      name: 'Tom Fischer',
      requestedBy: 'You',
      mine: true,
      canDecide: false,
      value: 'Calle de Alcalá 48',
      current: 'Calle de Alcalá 48',
      before: 'Calle Mayor 12',
      state: 'approved',
      decidedBy: 'Ada Lovelace',
      decidedAt: '2026-09-23T09:00:00.000Z',
      note: null,
    };
    renderReview(
      {
        roles: { hr: false, admin: false, finance: false },
        approvals: { isHr: false, items: [] },
        ownDecided: {
          changes: [
            own,
            {
              ...own,
              id: 'c2',
              value: 'Gran Vía 1',
              state: 'rejected',
              note: 'That is the office',
              decidedAt: '2026-09-21T09:00:00.000Z',
            },
            {
              ...own,
              id: 'c3',
              value: 'Plaza Mayor 3',
              state: 'withdrawn',
              decidedBy: 'You',
              decidedAt: '2026-09-20T09:00:00.000Z',
            },
          ],
          identifiers: [
            {
              personId: 'p1',
              name: 'Tom Fischer',
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
    const table = screen.getByRole('table', { name: 'Decided in the last 90 days' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2]?.textContent)).toEqual([
      'Approved',
      'Sent back',
      'Rejected',
      'Withdrawn',
    ]);
    expect(rows[0]).toHaveTextContent(
      'Home address: Calle Mayor 12 → Calle de Alcalá 48 · from 1 Oct',
    );
    expect(rows[0]).toHaveTextContent('Ada Lovelace');
    expect(rows[2]).toHaveTextContent('Note: “That is the office”');
    expect(rows[3]).toHaveTextContent('You');
    // The identifier by its label, never its value.
    expect(rows[1]).toHaveTextContent('ID check: National ID · Note: “The check letter is wrong.”');
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
