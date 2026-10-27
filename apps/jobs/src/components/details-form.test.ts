import { describe, expect, it } from 'vitest';

import { detailsOf, draftOf } from './details-form';

/* What a candidate typed, as the company keeps it: only what was given. */

describe('a candidate’s details', () => {
  const typed = {
    ...draftOf(null),
    dateOfBirth: '1994-03-08',
    mobilePhone: '+34 612 34 56 78',
    country: 'ES',
    line1: ' Calle Mayor 5 ',
    city: 'Madrid',
  };

  it('keeps the number without its spaces and the address once it has a street and a town', () => {
    expect(detailsOf(typed)).toEqual({
      preferredName: null,
      dateOfBirth: '1994-03-08',
      personalEmail: null,
      mobilePhone: '+34612345678',
      homeAddress: {
        country: 'ES',
        line1: 'Calle Mayor 5',
        line2: null,
        city: 'Madrid',
        subdivision: null,
        postcode: null,
      },
    });
  });

  it('leaves out an address with no town, and a number that is not one', () => {
    const given = detailsOf({ ...typed, city: '', mobilePhone: '612' });
    expect([given.homeAddress, given.mobilePhone]).toEqual([null, null]);
  });

  it('opens on what they gave before', () => {
    expect(draftOf(detailsOf(typed))).toMatchObject({ city: 'Madrid', mobilePhone: '+34612345678' });
  });
});
