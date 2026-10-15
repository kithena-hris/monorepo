import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { bonusDueOn, feeMinor, ownership, referralOutcome } from './referral.js';

const d = (s: string) => CalendarDate.parse(s);

describe('referrals and agencies (PRD §9.3, §9.4)', () => {
  it('tells a referrer only hired or not', () => {
    expect([
      referralOutcome('active'),
      referralOutcome('rejected'),
      referralOutcome('hired'),
    ]).toEqual(['in_progress', 'not_hired', 'hired']);
  });

  it('pays a bonus after probation', () => {
    expect(
      bonusDueOn(
        { amountMinor: 200_000, currency: 'EUR', after: { kind: 'probation' } },
        d('2026-12-01'),
        d('2027-05-31'),
      ),
    ).toBe('2027-05-31');
    expect(
      bonusDueOn(
        { amountMinor: 200_000, currency: 'EUR', after: { kind: 'months', months: 3 } },
        d('2026-12-01'),
        null,
      ),
    ).toBe('2027-03-01');
  });

  it('gives the first agency the candidate for six months and refuses a duplicate with its date', () => {
    const first = { agencyId: 'ag1', email: 'Yuki@example.com', submittedOn: d('2026-05-01') };
    expect(
      ownership({ agencyId: 'ag2', email: 'yuki@example.com', submittedOn: d('2026-10-31') }, [
        first,
      ]),
    ).toEqual({ accepted: false, ownedBy: 'ag1', since: '2026-05-01' });
    expect(
      ownership({ agencyId: 'ag2', email: 'yuki@example.com', submittedOn: d('2026-11-01') }, [
        first,
      ]),
    ).toEqual({ accepted: true });
  });

  it('computes a percentage fee on first-year base', () => {
    expect(feeMinor({ kind: 'percent', basisPoints: 2000 }, 8_000_000)).toBe(1_600_000);
  });
});
