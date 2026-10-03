import { describe, expect, it } from 'vitest';
import { DayAmount, PolicyDefinition } from '@kithena/contracts';

import { ADAM, MARCO, OMAR, context, date } from '../fixtures.js';
import { previewChange, shadowBalances } from './preview.js';

const policy = (overrides: Record<string, unknown> = {}) =>
  PolicyDefinition.parse({
    leaveTypeKey: 'vacation',
    allowance: [{ fromYears: 0, days: '25.000' }],
    carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } },
    ...overrides,
  });

/** T30's tenure bands: 0–2 years 25, 3–5 26, 6–9 27, 10+ 28. */
const tenure = policy({
  allowance: [
    { fromYears: 0, days: '25.000' },
    { fromYears: 3, days: '26.000' },
    { fromYears: 6, days: '27.000' },
    { fromYears: 10, days: '28.000' },
  ],
});

const member = (personId: typeof ADAM, hireDate: string) => ({
  personId,
  hireDate: date(hireDate),
  terminationDate: null,
});
const d = (value: string) => DayAmount.parse(value);

describe('previewChange', () => {
  it('folds both versions over a member and says what each grants and leaves', () => {
    // Marco has been here since 2020: six years, so 27 under the bands.
    const [marco] = previewChange(
      [
        {
          member: member(MARCO, '2020-01-01'),
          current: policy(),
          draft: tenure,
          spent: d('10.000'),
          carried: d('2.000'),
        },
      ],
      2026,
      context(),
    );
    expect(marco).toEqual({
      personId: MARCO,
      allowance: { current: '25.000', draft: '27.000' },
      left: { current: '17.000', draft: '19.000' },
      lostAtYearEnd: { current: '12.000', draft: '14.000' },
    });
  });

  it('gives a member the draft does not reach nothing under it, and one it newly reaches all of it', () => {
    const [left, joined] = previewChange(
      [
        {
          member: member(ADAM, '2024-01-01'),
          current: policy(),
          draft: null,
          spent: d('0.000'),
          carried: d('0.000'),
        },
        {
          member: member(OMAR, '2024-01-01'),
          current: null,
          draft: policy(),
          spent: d('0.000'),
          carried: d('0.000'),
        },
      ],
      2026,
      context(),
    );
    expect(left?.allowance).toEqual({ current: '25.000', draft: '0.000' });
    expect(joined?.allowance).toEqual({ current: '0.000', draft: '25.000' });
  });

  it('counts what a lower carry-over cap would take at the year end', () => {
    const [adam] = previewChange(
      [
        {
          member: member(ADAM, '2024-01-01'),
          current: policy(),
          draft: policy({ carryOver: { maxDays: '3.000', useBy: { month: 3, day: 31 } } }),
          spent: d('18.000'),
          carried: d('0.000'),
        },
      ],
      2026,
      context(),
    );
    // 7 left either way; 5 carry today, 3 under the draft.
    expect(adam?.lostAtYearEnd).toEqual({ current: '2.000', draft: '4.000' });
  });

  it('loses everything left without a carry-over, and never less than nothing', () => {
    const [adam] = previewChange(
      [
        {
          member: member(ADAM, '2024-01-01'),
          current: policy({ carryOver: null }),
          draft: policy({ carryOver: null }),
          spent: d('30.000'),
          carried: d('0.000'),
        },
      ],
      2026,
      context(),
    );
    expect(adam?.left).toEqual({ current: '-5.000', draft: '-5.000' });
    expect(adam?.lostAtYearEnd).toEqual({ current: '0.000', draft: '0.000' });
  });

  it('pro-rates a joiner the same way the ledger will', () => {
    const [joiner] = previewChange(
      [
        {
          member: member(OMAR, '2026-07-01'),
          current: policy(),
          draft: policy({ allowance: [{ fromYears: 0, days: '30.000' }] }),
          spent: d('0.000'),
          carried: d('0.000'),
        },
      ],
      2026,
      context(),
    );
    expect(joiner?.allowance).toEqual({ current: '12.500', draft: '15.000' });
  });
});

describe('shadowBalances (TOF-093)', () => {
  it('says what each version would have credited by a day, not by the year end', () => {
    // A monthly draft beside today's upfront grant, on 15 October: ten months of 25/12.
    const [adam] = shadowBalances(
      [
        {
          member: member(ADAM, '2024-01-01'),
          current: policy(),
          draft: policy({ earning: 'monthly' }),
          spent: d('5.000'),
          carried: d('1.000'),
        },
      ],
      2026,
      date('2026-10-15'),
      context(),
    );
    expect(adam).toEqual({
      personId: ADAM,
      credited: { current: '25.000', draft: '20.833' },
      balance: { current: '21.000', draft: '16.833' },
    });
  });

  it('credits nothing under a version that does not reach the member', () => {
    const [omar] = shadowBalances(
      [
        {
          member: member(OMAR, '2024-01-01'),
          current: null,
          draft: policy(),
          spent: d('0.000'),
          carried: d('0.000'),
        },
      ],
      2026,
      date('2026-10-15'),
      context(),
    );
    expect(omar?.balance).toEqual({ current: '0.000', draft: '25.000' });
  });
});
