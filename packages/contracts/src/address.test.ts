import { describe, expect, it } from 'vitest';

import {
  COUNTRIES,
  PostalAddress,
  checkAddress,
  countryRules,
  isUsableAddress,
} from './address.js';

const madrid = {
  country: 'ES',
  line1: 'Calle de Alcalá 45',
  line2: '3º izquierda',
  city: 'Madrid',
  subdivision: '28',
  postcode: '28013',
};

describe('postal address', () => {
  it('accepts a complete Spanish address', () => {
    expect(isUsableAddress(madrid)).toBe(true);
  });

  it('needs a street line and a city', () => {
    expect(PostalAddress.safeParse({ ...madrid, line1: '  ' }).success).toBe(false);
    expect(PostalAddress.safeParse({ ...madrid, city: '' }).success).toBe(false);
  });

  it('treats the door line as optional', () => {
    expect(isUsableAddress({ ...madrid, line2: null })).toBe(true);
  });

  it('refuses a country nobody has checked the rules for', () => {
    const problems = checkAddress({ ...madrid, country: 'ZZ' });
    expect(problems).toEqual([{ field: 'country', message: 'that country is not supported yet' }]);
  });
});

describe('postcodes', () => {
  it.each([
    ['ES', '28013', true],
    ['ES', '99999', false], // no province 99
    ['ES', '2801', false],
    ['NL', '1012 AB', true],
    ['NL', '1012SA', false], // deliberately never issued
    ['IE', 'D02 AF30', true],
    ['IE', 'B02 AF30', false], // B is not an Eircode routing letter
    ['GB', 'SW1A 1AA', true],
    ['GB', '12345', false],
    ['US', '94107-1234', true],
    ['US', '9410', false],
    ['IN', '560001', true],
    ['IN', '060001', false], // never starts zero
    ['CA', 'K1A 0B1', true],
    ['PT', '1000-001', true],
    ['PT', '1000', false],
  ])('%s %s', (country, postcode, valid) => {
    const rules = countryRules(country);
    expect(rules?.postcode?.test(postcode) ?? false).toBe(valid);
  });
});

describe('the country decides the other fields', () => {
  it('requires a subdivision the country actually has', () => {
    const problems = checkAddress({ ...madrid, subdivision: '99' });
    expect(problems.map((p) => p.field)).toContain('subdivision');
  });

  it('catches a postcode that contradicts its province', () => {
    // 08 is Barcelona; 28013 is Madrid. Neither field is wrong on its own,
    // which is the whole reason this check exists.
    const problems = checkAddress({ ...madrid, subdivision: '08' });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe('postcode');
    expect(problems[0]?.message).toContain('Barcelona');
  });

  it('reports a missing postcode where the country uses them', () => {
    const problems = checkAddress({ ...madrid, postcode: null });
    expect(problems.map((p) => p.field)).toContain('postcode');
  });
});

describe('the country table itself', () => {
  it('has no duplicate country codes', () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
  });

  it.each(COUNTRIES.map((c) => [c.code, c] as const))(
    '%s labels its own subdivision and postcode',
    (_code, country) => {
      // A Spanish form saying "State" is the small wrongness that tells a
      // customer the software was not built for them.
      expect(country.subdivisionLabel).not.toBe('');
      expect(country.postcodeLabel).not.toBe('');
    },
  );

  it.each(COUNTRIES.map((c) => [c.code, c] as const))(
    '%s has an example that matches its own pattern',
    (_code, country) => {
      if (country.postcode) {
        expect(country.postcode.test(country.postcodeExample)).toBe(true);
      }
    },
  );

  it.each(COUNTRIES.map((c) => [c.code, c] as const))(
    '%s has no duplicate subdivision codes',
    (_code, country) => {
      expect(new Set(country.subdivisions.map((s) => s.code)).size).toBe(
        country.subdivisions.length,
      );
    },
  );
});
