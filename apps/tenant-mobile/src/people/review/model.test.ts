import { describe, expect, it } from 'vitest';

import {
  ago,
  newestFirst,
  rowsOf,
  viewerOf,
  type ApprovalItem,
  type ReviewData,
  type Row,
} from './model';

const change = (id: string, extra: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id,
  personId: `p-${id}`,
  name: `Person ${id}`,
  key: 'salary',
  label: 'Salary',
  kind: 'value',
  readable: true,
  effectiveFrom: '2026-11-01',
  requestedAt: '2026-10-01T09:00:00Z',
  expiresAt: '2026-10-08T09:00:00Z',
  requestedBy: 'Marco Ruiz',
  reason: null,
  mine: false,
  canDecide: true,
  canSelfApprove: null,
  awaitingReview: null,
  findings: null,
  flags: null,
  comparisons: null,
  flagNote: null,
  flagSummary: null,
  canAsk: null,
  canMark: null,
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
  note: null,
  questions: null,
  value: null,
  current: null,
  ...extra,
});

const data = (items: ApprovalItem[], hr = true): ReviewData => ({
  roles: { hr, admin: false, finance: false },
  approvals: {
    isHr: hr,
    canTune: null,
    items,
    itemsNext: null,
    decided: [],
    decidedNext: null,
    checks: null,
    last90: null,
  },
  identifiers: null,
  duplicates: null,
  access: null,
  completeness: null,
  complete: null,
  shares: null,
  ownDecided: null,
  counts: null,
});

describe('rowsOf', () => {
  it('puts what HR decides in Waiting, a flagged one in Flagged too, and their own ask in I asked', () => {
    const items = [
      change('a'),
      change('b', { flags: [{ code: 'raise', title: 'A 38% raise', detail: '' }] }),
      change('c', { canDecide: false, mine: true }),
    ];
    expect(rowsOf(data(items), 'waiting').map((r) => r.id)).toEqual(['change-a', 'change-b']);
    expect(rowsOf(data(items), 'flagged').map((r) => r.id)).toEqual(['change-b']);
    expect(rowsOf(data(items), 'asked').map((r) => r.id)).toEqual(['change-c']);
  });

  it('gives an employee their own changes and nothing else', () => {
    const own = data([change('a', { canDecide: false, mine: true })], false);
    expect(viewerOf(own)).toBe('employee');
    expect(rowsOf(own, 'waiting').map((r) => r.id)).toEqual(['change-a']);
  });
});

describe('newestFirst', () => {
  it('puts an undated pair after everything dated', () => {
    const row = (id: string, at: string | null): Row => ({
      id,
      kind: 'changes',
      name: id,
      personId: null,
      avatarUrl: null,
      summary: '',
      by: null,
      at,
      flag: null,
      badge: null,
    });
    expect(
      newestFirst([row('pair', null), row('old', '2026-01-01'), row('new', '2026-02-01')]).map(
        (r) => r.id,
      ),
    ).toEqual(['new', 'old', 'pair']);
  });
});

describe('ago', () => {
  it('says how long ago in the words a queue uses', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(ago('2026-10-03T11:50:00Z', now)).toBe('10m');
    expect(ago('2026-10-03T09:00:00Z', now)).toBe('3h');
    expect(ago('2026-10-02T09:00:00Z', now)).toBe('Yesterday');
    expect(ago('2026-09-29T09:00:00Z', now)).toBe('4 days');
  });
});
