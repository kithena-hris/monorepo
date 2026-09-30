import { describe, expect, it } from 'vitest';

import { unusual, type ChangeSeen, type OtherChange } from './unusual.js';

const HR = 'acct-hr';
const ADA = 'acct-ada';
// A Tuesday, 10:00 in Madrid.
const WORKDAY = '2026-09-22T08:00:00.000Z';

function change(over: Partial<ChangeSeen> = {}): ChangeSeen {
  return {
    id: 'c1',
    label: 'Base salary',
    dataType: 'money',
    requestedAt: WORKDAY,
    requestedBy: HR,
    subjectAccountId: ADA,
    effectiveFrom: '2026-10-01',
    pay: null,
    findings: [],
    ...over,
  };
}

const around = (others: readonly OtherChange[] = []) => ({ others, zone: 'Europe/Madrid' });
const codes = (c: ChangeSeen, others: readonly OtherChange[] = []) =>
  unusual(c, around(others)).map((f) => f.code);

describe('an ordinary change', () => {
  it('raises nothing', () => {
    expect(unusual(change(), around())).toEqual([]);
  });
});

describe('pay', () => {
  const pay = (before: string, after: string, currency = 'EUR') => ({
    before: { amountMinor: before, currency },
    after: { amountMinor: after, currency },
  });

  it('flags a rise over the threshold, with the percentage', () => {
    const [flag] = unusual(change({ pay: pay('5000000', '6250000') }), around());
    expect(flag).toEqual({ code: 'pay_change_large', reason: 'Pay goes up 25% on what is in force.' });
  });

  it('flags a cut over the threshold', () => {
    expect(unusual(change({ pay: pay('5000000', '3000000') }), around())[0]?.reason).toBe(
      'Pay goes down 40% on what is in force.',
    );
  });

  it('leaves a change at or under the threshold alone', () => {
    expect(codes(change({ pay: pay('5000000', '6000000') }))).toEqual([]);
    expect(codes(change({ pay: pay('5000000', '5100000') }))).toEqual([]);
  });

  it('compares nothing across currencies, or against no pay at all', () => {
    expect(
      codes(
        change({
          pay: {
            before: { amountMinor: '5000000', currency: 'EUR' },
            after: { amountMinor: '9000000', currency: 'GBP' },
          },
        }),
      ),
    ).toEqual([]);
    expect(codes(change({ pay: pay('0', '9000000') }))).toEqual([]);
  });
});

describe('dates', () => {
  it('flags a change taking effect long before it was asked for', () => {
    const [flag] = unusual(change({ effectiveFrom: '2026-07-01' }), around());
    expect(flag?.code).toBe('backdated');
    expect(flag?.reason).toBe('Takes effect 83 days before it was asked for, so payroll corrects the months between.');
  });

  it('leaves a change dated to the start of the month alone', () => {
    expect(codes(change({ effectiveFrom: '2026-09-01' }))).toEqual([]);
  });

  it('flags a change taking effect far in the future', () => {
    expect(codes(change({ effectiveFrom: '2027-06-01' }))).toEqual(['far_future']);
    expect(codes(change({ effectiveFrom: '2027-01-01' }))).toEqual([]);
  });
});

describe('identifiers', () => {
  it('flags what the checks doubted, in their words', () => {
    const flags = unusual(
      change({
        dataType: 'national_id',
        label: 'NIF',
        findings: [
          { level: 'ok', message: 'Format is right' },
          { level: 'mismatch', message: 'The check letter does not match' },
        ],
      }),
      around(),
    );
    expect(flags).toEqual([
      { code: 'identifier_checks', reason: 'NIF fails its checks: The check letter does not match.' },
    ]);
  });
});

describe('bank details', () => {
  const bank = (over: Partial<ChangeSeen> = {}) =>
    change({ dataType: 'bank_account', label: 'IBAN', requestedBy: ADA, ...over });

  it('flags a second change within the window, whatever the first became but withdrawn', () => {
    const earlier: OtherChange = {
      id: 'c0',
      dataType: 'bank_account',
      requestedAt: '2026-09-02T08:00:00.000Z',
      requestedBy: ADA,
      state: 'approved',
    };
    expect(codes(bank(), [earlier])).toEqual(['bank_repeat']);
    expect(codes(bank(), [{ ...earlier, state: 'withdrawn' }])).toEqual([]);
    expect(codes(bank(), [{ ...earlier, requestedAt: '2026-08-01T08:00:00.000Z' }])).toEqual([]);
  });

  it('flags bank details changed by someone other than the employee', () => {
    expect(codes(bank({ requestedBy: HR }))).toEqual(['bank_by_other']);
    // Nobody signs in as them yet: HR entering them at hire is the ordinary case.
    expect(codes(bank({ requestedBy: HR, subjectAccountId: null }))).toEqual([]);
  });
});

describe('several fields at once', () => {
  const sibling = (id: string, minutes: number): OtherChange => ({
    id,
    dataType: 'text',
    requestedAt: new Date(Date.parse(WORKDAY) + minutes * 60_000).toISOString(),
    requestedBy: HR,
    state: 'pending',
  });

  it('flags three or more sensitive fields changed together by one person', () => {
    const flags = unusual(change(), around([sibling('c2', 1), sibling('c3', 4)]));
    expect(flags).toEqual([
      { code: 'many_at_once', reason: '3 sensitive fields were changed together for this person.' },
    ]);
  });

  it('does not count changes far apart, or by someone else', () => {
    expect(codes(change(), [sibling('c2', 1), sibling('c3', 60)])).toEqual([]);
    expect(codes(change(), [sibling('c2', 1), { ...sibling('c3', 2), requestedBy: ADA }])).toEqual([]);
  });
});

describe('working hours', () => {
  it('flags a change asked for at night by someone other than the employee', () => {
    const [flag] = unusual(change({ requestedAt: '2026-09-22T21:40:00.000Z' }), around());
    expect(flag).toEqual({
      code: 'outside_hours',
      reason: 'Asked for at 23:40 on a Tuesday, Europe/Madrid time, outside working hours, by someone other than the employee.',
    });
  });

  it('flags a weekend', () => {
    expect(codes(change({ requestedAt: '2026-09-26T09:00:00.000Z' }))).toEqual(['outside_hours']);
  });

  it('leaves the employee changing their own record at night alone', () => {
    expect(codes(change({ requestedAt: '2026-09-22T21:40:00.000Z', requestedBy: ADA }))).toEqual([]);
  });
});
