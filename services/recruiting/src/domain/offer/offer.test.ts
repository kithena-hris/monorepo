import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import {
  acceptOffer,
  declineOffer,
  draftOffer,
  expireOffer,
  latest,
  offerChecks,
  reviseOffer,
  sendOffer,
  submitOffer,
  versionHash,
  type OfferFacts,
  type OfferVersion,
} from './offer.js';

const d = (s: string) => CalendarDate.parse(s);
const today = d('2026-10-15');

const first: Omit<OfferVersion, 'version' | 'supersededAt'> = {
  terms: { weeklyMinutes: 2400 },
  pay: {
    baseMinor: 8_000_000,
    currency: 'EUR',
    frequency: 'year',
    variableTargetMinor: 0,
    signOnMinor: 0,
    relocationMinor: 0,
    equity: null,
  },
  benefitIds: [],
  startDate: d('2026-12-01'),
  expiresOn: d('2026-10-22'),
  letterTemplateId: null,
};
const facts: OfferFacts = {
  today,
  band: { minMinor: 7_000_000, maxMinor: 9_000_000, currency: 'EUR' },
  advertised: { minMinor: 7_200_000, maxMinor: 8_800_000, currency: 'EUR' },
  payTransparency: true,
  budgetMaxMinor: 8_800_000,
  currency: 'EUR',
  outsideBandReason: null,
};
const codes = (version: Omit<OfferVersion, 'version' | 'supersededAt'>, f = facts) =>
  offerChecks({ ...version, version: 1, supersededAt: null }, f).map(
    (c) => `${c.severity}:${c.code}`,
  );
const pay = (baseMinor: number) => ({ ...first.pay, baseMinor });

describe('checks before anyone sees an offer (PRD §18.2)', () => {
  it('passes an offer inside the band, range and budget', () => {
    expect(codes(first)).toEqual([]);
  });

  it('needs a reason outside the band, then sends it to approval', () => {
    expect(codes({ ...first, pay: pay(9_500_000) })).toEqual([
      'error:outside_band_reason',
      'approval:above_budget',
    ]);
    expect(
      codes({ ...first, pay: pay(9_500_000) }, { ...facts, outsideBandReason: 'Rare skills' }),
    ).toEqual(['approval:outside_band', 'approval:above_budget']);
  });

  it('refuses pay below the advertised range where the directive applies', () => {
    expect(codes({ ...first, pay: pay(7_100_000) })).toEqual(['error:below_advertised']);
    expect(codes({ ...first, pay: pay(7_100_000) }, { ...facts, payTransparency: false })).toEqual(
      [],
    );
  });

  it('refuses an expiry after the start and the wrong currency', () => {
    expect(
      codes({ ...first, expiresOn: d('2026-12-05'), pay: { ...first.pay, currency: 'USD' } }),
    ).toEqual(['error:currency', 'error:expiry_after_start']);
  });
});

describe('an offer’s life (PRD §18.3, §18.4)', () => {
  const submitted = submitOffer(draftOffer('o1', 'a1', first), [], 0, false);

  it('goes straight to approved with nothing to approve, and to approval otherwise', () => {
    expect(submitted).toMatchObject({ ok: true, value: { state: 'approved' } });
    expect(
      submitOffer(
        draftOffer('o1', 'a1', first),
        [{ code: 'above_budget', severity: 'approval', message: '' }],
        0,
        false,
      ),
    ).toMatchObject({
      ok: true,
      value: { state: 'pending_approval', approvalReasons: ['above_budget'] },
    });
    expect(submitOffer(draftOffer('o1', 'a1', first), [], 2, false)).toMatchObject({
      ok: false,
      error: { code: 'TERMS' },
    });
  });

  it('is accepted against the hash of the version the candidate read', () => {
    if (!submitted.ok) throw new Error();
    const sent = sendOffer(submitted.value, today, true);
    if (!sent.ok) throw new Error();
    const hash = versionHash(latest(sent.value));
    expect(
      acceptOffer(sent.value, 'stale', '2026-10-16T10:00:00Z', '203.0.113.9', d('2026-10-16')),
    ).toMatchObject({ ok: false, error: { code: 'CHANGED' } });
    expect(
      acceptOffer(sent.value, hash, '2026-10-16T10:00:00Z', '203.0.113.9', d('2026-10-16')),
    ).toMatchObject({
      ok: true,
      value: {
        state: 'accepted',
        acceptance: { version: 1, ip: '203.0.113.9', versionHash: hash },
      },
    });
    expect(acceptOffer(sent.value, hash, 'x', 'ip', d('2026-10-23'))).toMatchObject({
      ok: false,
      error: { code: 'EXPIRED' },
    });
    expect(expireOffer(sent.value, d('2026-10-23')).state).toBe('expired');
  });

  it('is not sent before the works council consents', () => {
    if (!submitted.ok) throw new Error();
    expect(sendOffer(submitted.value, today, false)).toMatchObject({
      ok: false,
      error: { code: 'WORKS_COUNCIL' },
    });
  });

  it('keeps the declined version when a counter-offer is made', () => {
    if (!submitted.ok) throw new Error();
    const sent = sendOffer(submitted.value, today, true);
    if (!sent.ok) throw new Error();
    const declined = declineOffer(sent.value, 'Salary');
    if (!declined.ok) throw new Error();
    const revised = reviseOffer(declined.value, '2026-10-17T09:00:00Z', {
      ...first,
      pay: pay(8_500_000),
    });
    expect(revised).toMatchObject({ ok: true, value: { state: 'draft' } });
    if (!revised.ok) return;
    expect(revised.value.versions.map((v) => [v.version, v.supersededAt, v.pay.baseMinor])).toEqual(
      [
        [1, '2026-10-17T09:00:00Z', 8_000_000],
        [2, null, 8_500_000],
      ],
    );
  });
});
