import { describe, expect, it } from 'vitest';

import { addressText, detailsText } from './contract-draft.js';

/* What a candidate gave before the contract, as the contract states it for them to check. */

describe('a candidate’s details in the contract', () => {
  const home = {
    country: 'ES',
    line1: 'Calle Mayor 5',
    line2: '3º izquierda',
    city: 'Madrid',
    subdivision: 'Madrid',
    postcode: '28013',
  };

  it('writes an address on one line, the country by its name', () => {
    expect(addressText(home)).toBe('Calle Mayor 5, 3º izquierda, 28013 Madrid, Madrid, Spain');
  });

  it('states only what they gave', () => {
    expect(
      detailsText({
        preferredName: null,
        dateOfBirth: '1994-03-08',
        personalEmail: 'yuki@example.com',
        mobilePhone: null,
        homeAddress: home,
      }),
    ).toBe(
      'born 1994-03-08; living at Calle Mayor 5, 3º izquierda, 28013 Madrid, Madrid, Spain; personal email yuki@example.com',
    );
    expect(
      detailsText({
        preferredName: null,
        dateOfBirth: null,
        personalEmail: null,
        mobilePhone: null,
        homeAddress: null,
      }),
    ).toBeNull();
  });
});
