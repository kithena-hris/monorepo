import { describe, expect, it } from 'vitest';

import { openApproval, type Approval } from './approval.js';
import {
  approversOf,
  declineForReview,
  decideChange,
  mayApproveAlone,
  withdrawChange,
} from './pending-change.js';

const EMPLOYEE = '00000000-0000-4000-8000-000000000001';
const HR = '00000000-0000-4000-8000-0000000000ff';
const OTHER_HR = '00000000-0000-4000-8000-0000000000fe';
const AT = '2026-09-22T09:00:00.000Z';
const WEEK_LATER = '2026-09-29T09:00:00.000Z';

function asked(by: string): Approval {
  const opened = openApproval({
    id: '00000000-0000-4000-9000-000000000001',
    requestedBy: by,
    reason: null,
    reasonOptional: true,
    at: AT,
    expiresAt: WEEK_LATER,
  });
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value;
}

describe('deciding a pending change (PEO-077)', () => {
  it('is HR’s alone', () => {
    const refused = decideChange(asked(EMPLOYEE), {
      by: OTHER_HR,
      isHr: false,
      subjectAccountId: EMPLOYEE,
      approve: true,
      at: AT,
      hr: [HR, OTHER_HR],
    });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });

  it('is never the requester’s, HR or not: HR’s own change needs a second HR', () => {
    const own = decideChange(asked(HR), {
      by: HR,
      isHr: true,
      subjectAccountId: EMPLOYEE,
      approve: true,
      at: AT,
      hr: [HR, OTHER_HR],
    });
    expect(!own.ok && own.error.code).toBe('FORBIDDEN');
    const second = decideChange(asked(HR), {
      by: OTHER_HR,
      isHr: true,
      subjectAccountId: EMPLOYEE,
      approve: true,
      at: AT,
      hr: [HR, OTHER_HR],
    });
    expect(second.ok && second.value).toMatchObject({
      approval: { state: 'approved' },
      decidedAs: 'approver',
    });
  });

  it('is never the subject’s, even when somebody else asked', () => {
    const mine = decideChange(asked(OTHER_HR), {
      by: HR,
      isHr: true,
      subjectAccountId: HR,
      approve: true,
      at: AT,
      hr: [HR, OTHER_HR],
    });
    expect(!mine.ok && mine.error.code).toBe('FORBIDDEN');
  });

  it('keeps the approval rules: expired is refused, a rejection keeps its note', () => {
    const late = decideChange(asked(EMPLOYEE), {
      by: HR,
      isHr: true,
      subjectAccountId: EMPLOYEE,
      approve: true,
      at: WEEK_LATER,
      hr: [HR],
    });
    expect(!late.ok && late.error.code).toBe('APPROVAL_EXPIRED');
    const rejected = decideChange(asked(EMPLOYEE), {
      by: HR,
      isHr: true,
      subjectAccountId: null,
      approve: false,
      at: AT,
      note: 'Wrong IBAN',
      hr: [HR],
    });
    expect(rejected.ok && rejected.value.approval).toMatchObject({
      state: 'rejected',
      note: 'Wrong IBAN',
    });
  });
});

describe('the only HR member approving their own change (PEO-077)', () => {
  const alone = (over: Partial<Parameters<typeof decideChange>[1]> = {}) =>
    decideChange(asked(HR), {
      by: HR,
      isHr: true,
      subjectAccountId: HR,
      approve: true,
      at: AT,
      hr: [HR],
      soleApprover: true,
      ...over,
    });

  it('is allowed once they confirm it, and is recorded as theirs alone', () => {
    const own = alone();
    expect(own.ok && own.value).toMatchObject({
      approval: { state: 'approved', decidedBy: HR },
      decidedAs: 'sole_hr',
    });
    // An employee's record, typed by the only HR member, the same way.
    const theirs = alone({ subjectAccountId: EMPLOYEE });
    expect(theirs.ok && theirs.value.decidedAs).toBe('sole_hr');
  });

  it('is refused without the confirmation, as before', () => {
    const unconfirmed = alone({ soleApprover: false });
    expect(!unconfirmed.ok && unconfirmed.error.code).toBe('FORBIDDEN');
  });

  it('is refused the moment a second HR member exists: they decide', () => {
    const second = alone({ hr: [HR, OTHER_HR] });
    expect(!second.ok && second.error.code).toBe('FORBIDDEN');
    // Even when that member is the person the change is about.
    const aboutThem = decideChange(asked(HR), {
      by: HR,
      isHr: true,
      subjectAccountId: OTHER_HR,
      approve: true,
      at: AT,
      hr: [HR, OTHER_HR],
      soleApprover: true,
    });
    expect(!aboutThem.ok && aboutThem.error.code).toBe('FORBIDDEN');
  });

  it('is never let in by a missing list of who holds HR', () => {
    const unknown = alone({ hr: [] });
    expect(!unknown.ok && unknown.error.code).toBe('FORBIDDEN');
  });

  it('is only ever the requester’s, and only to approve', () => {
    // Somebody else asked for a change to the only HR member's record.
    const subject = decideChange(asked(EMPLOYEE), {
      by: HR,
      isHr: true,
      subjectAccountId: HR,
      approve: true,
      at: AT,
      hr: [HR],
      soleApprover: true,
    });
    expect(!subject.ok && subject.error.code).toBe('FORBIDDEN');
    const reject = alone({ approve: false });
    expect(!reject.ok && reject.error.code).toBe('FORBIDDEN');
    const notHr = alone({ isHr: false });
    expect(!notHr.ok && notHr.error.code).toBe('FORBIDDEN');
  });

  it('says whether the requester may, before they ask', () => {
    expect(mayApproveAlone([HR], { requestedBy: HR }, HR)).toBe(true);
    expect(mayApproveAlone([HR, OTHER_HR], { requestedBy: HR }, HR)).toBe(false);
    expect(mayApproveAlone([HR], { requestedBy: EMPLOYEE }, HR)).toBe(false);
    expect(mayApproveAlone([], { requestedBy: HR }, HR)).toBe(false);
  });
});

describe('a doubted identifier held for approval (PEO-077, PEO-125)', () => {
  it('is not approved while its review is open, by anybody', () => {
    const early = decideChange(asked(EMPLOYEE), {
      by: HR,
      isHr: true,
      subjectAccountId: EMPLOYEE,
      approve: true,
      at: AT,
      hr: [HR],
      awaitingReview: true,
    });
    expect(!early.ok && early.error.code).toBe('AWAITING_REVIEW');
    const alone = decideChange(asked(HR), {
      by: HR,
      isHr: true,
      subjectAccountId: HR,
      approve: true,
      at: AT,
      hr: [HR],
      soleApprover: true,
      awaitingReview: true,
    });
    expect(!alone.ok && alone.error.code).toBe('AWAITING_REVIEW');
    // Rejecting it needs no review.
    const rejected = decideChange(asked(EMPLOYEE), {
      by: HR,
      isHr: true,
      subjectAccountId: EMPLOYEE,
      approve: false,
      at: AT,
      hr: [HR],
      awaitingReview: true,
    });
    expect(rejected.ok && rejected.value.approval.state).toBe('rejected');
  });

  it('is declined by a review that found errors, with its reason, even the reviewer’s own', () => {
    const declined = declineForReview(asked(HR), { by: HR, at: AT, note: ' Wrong letter ' });
    expect(declined.ok && declined.value).toMatchObject({
      approval: { state: 'rejected', decidedBy: HR, note: 'Wrong letter' },
      decidedAs: 'identifier_review',
    });
    const silent = declineForReview(asked(EMPLOYEE), { by: HR, at: AT, note: '' });
    expect(!silent.ok && silent.error.code).toBe('REASON_REQUIRED');
    const late = declineForReview(asked(EMPLOYEE), { by: HR, at: WEEK_LATER, note: 'x' });
    expect(!late.ok && late.error.code).toBe('APPROVAL_EXPIRED');
  });
});

describe('who may decide, before anybody asks (PEO-077)', () => {
  it('is every HR holder but the requester and the subject', () => {
    expect(
      approversOf([HR, OTHER_HR, EMPLOYEE], { requestedBy: HR, subjectAccountId: EMPLOYEE }),
    ).toEqual([OTHER_HR]);
    expect(approversOf([HR], { requestedBy: HR, subjectAccountId: null })).toEqual([]);
  });
});

describe('withdrawing a pending change (PEO-077)', () => {
  it('is the requester’s alone', () => {
    const hr = withdrawChange(asked(EMPLOYEE), { by: HR, at: AT });
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    const own = withdrawChange(asked(EMPLOYEE), { by: EMPLOYEE, at: AT });
    expect(own.ok && own.value.state).toBe('withdrawn');
  });
});
