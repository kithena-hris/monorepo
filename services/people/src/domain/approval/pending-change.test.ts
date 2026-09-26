import { describe, expect, it } from 'vitest';

import { openApproval, type Approval } from './approval.js';
import { approversOf, decideChange, withdrawChange } from './pending-change.js';

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
    });
    expect(!own.ok && own.error.code).toBe('FORBIDDEN');
    const second = decideChange(asked(HR), {
      by: OTHER_HR,
      isHr: true,
      subjectAccountId: EMPLOYEE,
      approve: true,
      at: AT,
    });
    expect(second.ok && second.value.state).toBe('approved');
  });

  it('is never the subject’s, even when somebody else asked', () => {
    const mine = decideChange(asked(OTHER_HR), {
      by: HR,
      isHr: true,
      subjectAccountId: HR,
      approve: true,
      at: AT,
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
    });
    expect(!late.ok && late.error.code).toBe('APPROVAL_EXPIRED');
    const rejected = decideChange(asked(EMPLOYEE), {
      by: HR,
      isHr: true,
      subjectAccountId: null,
      approve: false,
      at: AT,
      note: 'Wrong IBAN',
    });
    expect(rejected.ok && rejected.value).toMatchObject({ state: 'rejected', note: 'Wrong IBAN' });
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
