import { describe, expect, it } from 'vitest';

import { decide, expire, openApproval, stateAt, useOnce, type Approval } from './approval.js';

const FINANCE = '00000000-0000-4000-8000-0000000000fe';
const HR = '00000000-0000-4000-8000-0000000000ff';
const AT = '2026-09-22T09:00:00.000Z';
const WEEK_LATER = '2026-09-29T09:00:00.000Z';

function pending(): Approval {
  const opened = openApproval({
    id: '00000000-0000-4000-9000-000000000001',
    requestedBy: FINANCE,
    reason: '  September payroll reconciliation  ',
    at: AT,
    expiresAt: WEEK_LATER,
  });
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value;
}

describe('opening a request', () => {
  it('needs a stated reason, and keeps it trimmed', () => {
    for (const reason of [undefined, null, '', '   ']) {
      const refused = openApproval({
        id: 'x',
        requestedBy: FINANCE,
        reason,
        at: AT,
        expiresAt: WEEK_LATER,
      });
      expect(!refused.ok && refused.error.code).toBe('REASON_REQUIRED');
    }
    expect(pending()).toMatchObject({
      state: 'pending',
      reason: 'September payroll reconciliation',
    });
  });

  it('refuses a reason over 500 characters and a deadline that is not in the future', () => {
    const long = openApproval({
      id: 'x',
      requestedBy: FINANCE,
      reason: 'x'.repeat(501),
      at: AT,
      expiresAt: WEEK_LATER,
    });
    expect(!long.ok && long.error.code).toBe('VALUE_INVALID');
    const past = openApproval({
      id: 'x',
      requestedBy: FINANCE,
      reason: 'r',
      at: AT,
      expiresAt: AT,
    });
    expect(!past.ok && past.error.code).toBe('VALUE_INVALID');
  });
});

describe('deciding', () => {
  it('approves or rejects once, recording who and when', () => {
    const approved = decide(pending(), { by: HR, approve: true, at: AT, note: 'ok' });
    expect(approved.ok && approved.value).toMatchObject({
      state: 'approved',
      decidedBy: HR,
      decidedAt: AT,
      note: 'ok',
    });
    if (!approved.ok) return;
    const again = decide(approved.value, { by: HR, approve: false, at: AT });
    expect(!again.ok && again.error.code).toBe('APPROVAL_DECIDED');

    const rejected = decide(pending(), { by: HR, approve: false, at: AT });
    expect(rejected.ok && rejected.value.state).toBe('rejected');
  });

  it('never lets the requester decide their own request', () => {
    const own = decide(pending(), { by: FINANCE, approve: true, at: AT });
    expect(!own.ok && own.error.code).toBe('FORBIDDEN');
  });

  it('refuses a decision that arrives at or after the deadline', () => {
    const late = decide(pending(), { by: HR, approve: true, at: WEEK_LATER });
    expect(!late.ok && late.error.code).toBe('APPROVAL_EXPIRED');
  });
});

describe('expiry', () => {
  it('is what a pending request reads as once its deadline passes, before anything records it', () => {
    expect(stateAt(pending(), '2026-09-29T08:59:59.999Z')).toBe('pending');
    expect(stateAt(pending(), WEEK_LATER)).toBe('expired');
  });

  it('is recorded only once due, and only for a pending request', () => {
    const early = expire(pending(), AT);
    expect(!early.ok && early.error.code).toBe('APPROVAL_PENDING');
    const due = expire(pending(), WEEK_LATER);
    expect(due.ok && due.value.state).toBe('expired');

    const approved = decide(pending(), { by: HR, approve: true, at: AT });
    if (!approved.ok) throw new Error('not approved');
    const decided = expire(approved.value, WEEK_LATER);
    expect(!decided.ok && decided.error.code).toBe('APPROVAL_DECIDED');
  });
});

describe('a grant', () => {
  const grant = { issuedAt: AT, expiresAt: '2026-09-23T09:00:00.000Z', usedAt: null };

  it('can be used exactly once', () => {
    const first = useOnce(grant, AT);
    expect(first.ok && first.value.usedAt).toBe(AT);
    if (!first.ok) return;
    const second = useOnce(first.value, AT);
    expect(!second.ok && second.error.code).toBe('GRANT_USED');
  });

  it('cannot be used once it has expired, even unused', () => {
    const late = useOnce(grant, '2026-09-23T09:00:00.000Z');
    expect(!late.ok && late.error.code).toBe('GRANT_EXPIRED');
  });
});
