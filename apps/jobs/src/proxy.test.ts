import { describe, expect, it } from 'vitest';

import { companyOf } from './proxy';

describe('which company a page is for', () => {
  it('reads the company from its pages, so they wear its name and logo', () => {
    expect(companyOf('/meridien-freight')).toBe('meridien-freight');
    expect(companyOf('/meridien-freight/driver-ab12/apply')).toBe('meridien-freight');
    expect(companyOf('/preview/meridien-freight/token')).toBe('meridien-freight');
    expect(companyOf('/schedule/meridien-freight')).toBe('meridien-freight');
    expect(companyOf('/me/meridien-freight')).toBe('meridien-freight');
  });

  it('leaves Kithena Jobs’ own pages its own', () => {
    expect(companyOf('/')).toBeNull();
    expect(companyOf('/search')).toBeNull();
    expect(companyOf('/sign-in')).toBeNull();
    expect(companyOf('/me')).toBeNull();
    expect(companyOf('/me/cv')).toBeNull();
  });
});
