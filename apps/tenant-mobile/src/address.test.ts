import { describe, expect, it } from 'vitest';

import { companyOrigin, greetingFor } from './address';

describe('companyOrigin', () => {
  it('takes a company name alone as one under app.kithena.com', () => {
    expect(companyOrigin('dunder-mifflin')).toBe('https://dunder-mifflin.app.kithena.com');
  });

  it('takes the address as a browser shows it, scheme, path and capitals included', () => {
    expect(companyOrigin(' Acme.App.Kithena.com ')).toBe('https://acme.app.kithena.com');
    expect(companyOrigin('https://acme.app.kithena.com/login')).toBe(
      'https://acme.app.kithena.com',
    );
  });

  it('refuses plain HTTP and anything that is not a hostname', () => {
    expect(companyOrigin('http://acme.app.kithena.com')).toBeNull();
    expect(companyOrigin('')).toBeNull();
    expect(companyOrigin('acme corp')).toBeNull();
    expect(companyOrigin('acme..app.kithena.com')).toBeNull();
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
