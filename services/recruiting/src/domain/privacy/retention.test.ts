import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { poolConsent, retentionAction, retentionFor, type Retained } from './retention.js';

const d = (s: string) => CalendarDate.parse(s);
const base: Retained = {
  candidateId: 'c1',
  decidedOn: d('2026-03-10'),
  countries: ['DE'],
  hired: false,
  legalHold: false,
  poolConsentUntil: null,
};

describe('retention (PRD §24.2)', () => {
  it('anonymises six months after a German rejection, and a year after a US one', () => {
    expect(retentionAction(base, d('2026-09-09'))).toEqual({ kind: 'keep', until: '2026-09-10' });
    expect(retentionAction(base, d('2026-09-10'))).toEqual({ kind: 'anonymise' });
    expect(retentionAction({ ...base, countries: ['US'] }, d('2026-09-10'))).toEqual({
      kind: 'keep',
      until: '2027-03-10',
    });
  });

  it('keeps hires, legal holds, active candidates and pool members with consent', () => {
    expect(retentionAction({ ...base, hired: true }, d('2030-01-01')).kind).toBe('keep');
    expect(retentionAction({ ...base, legalHold: true }, d('2030-01-01')).kind).toBe('keep');
    expect(retentionAction({ ...base, decidedOn: null }, d('2030-01-01')).kind).toBe('keep');
    expect(
      retentionAction({ ...base, poolConsentUntil: d('2027-03-10') }, d('2026-12-01')),
    ).toEqual({ kind: 'keep', until: '2027-03-10' });
  });

  it('takes the strictest rule across countries', () => {
    expect(retentionFor(['DE', 'US'])).toMatchObject({ rejectedMonths: 12, poolMonths: 12 });
  });

  it('asks for pool renewal thirty days before the consent ends', () => {
    expect(poolConsent(d('2026-10-15'), ['ES'])).toEqual({
      expiresOn: '2027-10-15',
      askRenewalOn: '2027-09-15',
    });
  });
});
