import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { adChecks, adPasses, type AdPlace, type AdText } from './checks.js';

const on = CalendarDate.parse('2026-10-15');
const settings = { federalContractor: false, asksPayHistory: false };
const ad: AdText = {
  title: 'Senior Backend Engineer (m/w/d)',
  language: 'en',
  body: 'You will build payment services. You bring five years in production and Spanish at C1.',
  salaryShown: true,
  hasEqualOpportunityStatement: true,
};
const codes = (
  text: AdText,
  places: readonly AdPlace[] = [{ country: 'DE', region: 'BE' }],
  s = settings,
) => adChecks(text, places, s, on).map((c) => `${c.severity}:${c.code}`);

describe('ad checks (PRD §8.3)', () => {
  it('passes a clean German ad', () => {
    expect(codes(ad)).toEqual([]);
  });

  it('needs a neutral marker on a German title, and accepts the usual ones', () => {
    expect(codes({ ...ad, title: 'Senior Backend Engineer' })).toEqual([
      'error:gender_neutral_title',
    ]);
    for (const title of [
      'Entwickler*in',
      'Engineer (w/m/d)',
      'Engineer (all genders)',
      'Projektleiter:in',
    ]) {
      expect(codes({ ...ad, title })).toEqual([]);
    }
  });

  it('requires the range in a Californian ad and asks for it in an EU one', () => {
    expect(
      codes({ ...ad, title: 'Account Executive', salaryShown: false }, [
        { country: 'US', region: 'CA' },
      ]),
    ).toEqual(['error:pay_range_required']);
    expect(codes({ ...ad, salaryShown: false })).toEqual(['warning:pay_range_before_interview']);
    expect(
      codes({ ...ad, title: 'Account Executive', salaryShown: false }, [
        { country: 'US', region: 'TX' },
      ]),
    ).toEqual([]);
  });

  it('refuses a pay history question in the EU and in a US ban state', () => {
    const asks = { ...settings, asksPayHistory: true };
    expect(codes(ad, [{ country: 'ES', region: 'MD' }], asks)).toEqual([
      'error:pay_history_banned',
    ]);
    expect(codes(ad, [{ country: 'GB', region: 'ENG' }], asks)).toEqual([]);
  });

  it('flags protected characteristics where it finds them', () => {
    const checks = adChecks(
      { ...ad, body: 'Join our young team. Please send a photo. Native speaker preferred.' },
      [{ country: 'GB', region: 'ENG' }],
      settings,
      on,
    );
    expect(checks.map((c) => [c.severity, c.match?.text])).toEqual([
      ['error', 'photo'],
      ['warning', 'Native speaker'],
      ['warning', 'young'],
    ]);
    expect(adPasses(checks)).toBe(false);
  });

  it('reads a German and a Spanish ad in their own words', () => {
    expect(
      codes({ ...ad, language: 'de', body: 'Bewerbung mit Lichtbild, zwischen 25 und 35 Jahren.' }),
    ).toEqual(['error:protected_characteristic', 'error:protected_characteristic']);
    expect(
      codes({ ...ad, language: 'es', body: 'Buscamos persona con buena presencia.' }, [
        { country: 'ES', region: 'MD' },
      ]),
    ).toEqual(['error:protected_characteristic']);
  });

  it('asks a US federal contractor for the EEO statement', () => {
    const us: AdPlace[] = [{ country: 'US', region: 'TX' }];
    const text = { ...ad, title: 'Account Executive', hasEqualOpportunityStatement: false };
    expect(codes(text, us)).toEqual(['warning:eeo_statement_offered']);
    expect(codes(text, us, { ...settings, federalContractor: true })).toEqual([
      'error:eeo_statement_required',
    ]);
  });

  it('warns about an ad in a language the place does not use', () => {
    expect(codes({ ...ad, language: 'fr' })).toEqual(['warning:language_not_local']);
  });
});
