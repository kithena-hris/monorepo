import { describe, expect, it } from 'vitest';

import { asLabel, companyOrigin, greetingFor } from './address';

describe('asLabel', () => {
  it('keeps only what a company label can hold, in lower case', () => {
    expect(asLabel('Dunder Mifflin!')).toBe('dundermifflin');
    expect(asLabel('acme-co.app')).toBe('acme-coapp');
  });
});

describe('companyOrigin', () => {
  it('puts the label in front of the fixed suffix', () => {
    expect(companyOrigin('dunder-mifflin')).toBe('https://dunder-mifflin.app.kithena.com');
  });

  it('refuses an empty label and a hyphen at either end', () => {
    expect(companyOrigin('')).toBeNull();
    expect(companyOrigin('-acme')).toBeNull();
    expect(companyOrigin('acme-')).toBeNull();
  });
});

describe('greetingFor', () => {
  it('prefers the preferred name, then the given one, then the address', () => {
    expect(greetingFor({ given: 'Margaret', family: 'Hamilton', preferred: 'Maggie' }, null)).toBe(
      'Maggie',
    );
    expect(greetingFor({ given: 'Margaret', family: 'Hamilton', preferred: null }, null)).toBe(
      'Margaret',
    );
    expect(greetingFor(null, 'ada.lovelace@acme.example')).toBe('Ada Lovelace');
    expect(greetingFor(null, null)).toBe('there');
  });
});
