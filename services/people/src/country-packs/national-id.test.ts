import { describe, expect, it } from 'vitest';

import { checkNationalId } from './national-id.js';

/**
 * Real-shaped identifiers, one country at a time.
 *
 * The accepted values are the ones a checksum or a published allocation rule
 * says are well-formed; the refused ones are each wrong for one named reason,
 * so a failure here says which rule moved.
 */

const accepts = (country: string, scheme: string, value: string) => {
  const result = checkNationalId(country, scheme, value);
  expect(result.ok, `${country}/${scheme} ${value}`).toBe(true);
  return result.ok ? result.value : undefined;
};

const refuses = (country: string, scheme: string, value: string) => {
  const result = checkNationalId(country, scheme, value);
  expect(result.ok, `${country}/${scheme} ${value}`).toBe(false);
};

describe('Spain: NIF', () => {
  it('accepts a DNI whose letter is the mod-23 control', () => {
    expect(accepts('ES', 'nif', '12345678Z')).toEqual({ normalised: '12345678Z', checked: 'rule' });
    accepts('ES', 'nif', '87654321X');
  });

  it('accepts a NIE, because a foreign employee has a NIE where a Spaniard has a DNI', () => {
    accepts('ES', 'nif', 'X1234567L');
    accepts('ES', 'nif', 'Y1234567X');
    accepts('ES', 'nif', 'Z1234567R');
  });

  it('accepts the K, L and M personal NIFs', () => {
    accepts('ES', 'nif', 'M1234567L');
    accepts('ES', 'nif', 'K1234567L');
  });

  it('forgives the spacing and case a person types', () => {
    expect(accepts('ES', 'nif', ' 12.345.678-z ')?.normalised).toBe('12345678Z');
    expect(accepts('ES', 'nif', 'x-1234567-l')?.normalised).toBe('X1234567L');
  });

  it('refuses a wrong control letter', () => {
    refuses('ES', 'nif', '12345678A');
    refuses('ES', 'nif', 'X1234567A');
  });

  it('refuses the wrong shape, and a company CIF', () => {
    refuses('ES', 'nif', '1234567Z');
    refuses('ES', 'nif', 'B12345678');
    refuses('ES', 'nif', '');
  });

  it('checks a Social Security affiliation number for shape', () => {
    accepts('ES', 'naf', '28 12345678 40');
    refuses('ES', 'naf', '28123456');
  });
});

describe('United Kingdom: National Insurance number', () => {
  it('accepts a number with an A to D suffix', () => {
    expect(accepts('GB', 'nino', 'AB123456C')).toEqual({ normalised: 'AB123456C', checked: 'rule' });
    accepts('GB', 'nino', 'jg 10 37 59 a');
    accepts('GB', 'nino', 'OA123456D');
  });

  it('accepts a number whose suffix was never recorded', () => {
    // HMRC's own RTI schema allows a blank suffix.
    expect(accepts('GB', 'nino', 'SN123456')?.normalised).toBe('SN123456');
  });

  it('refuses the prefix letters HMRC never allocates', () => {
    refuses('GB', 'nino', 'QQ123456C'); // HMRC's own example, invalid on purpose
    refuses('GB', 'nino', 'DA123456A');
    refuses('GB', 'nino', 'AO123456A');
    refuses('GB', 'nino', 'AV123456A');
  });

  it('refuses the reserved prefix pairs', () => {
    for (const prefix of ['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']) {
      refuses('GB', 'nino', `${prefix}123456A`);
    }
  });

  it('refuses a suffix beyond D and the wrong number of digits', () => {
    refuses('GB', 'nino', 'AB123456E');
    refuses('GB', 'nino', 'AB12345C');
  });
});

describe('Germany', () => {
  it('accepts a Steuer-ID whose last digit is the ISO 7064 check', () => {
    accepts('DE', 'steuer_id', '86095742719');
    accepts('DE', 'steuer_id', '47 036 892 816');
    accepts('DE', 'steuer_id', '65929970489');
  });

  it('refuses a wrong check digit and a leading zero', () => {
    refuses('DE', 'steuer_id', '86095742718');
    refuses('DE', 'steuer_id', '06095742719');
    refuses('DE', 'steuer_id', '8609574271');
  });

  it('checks a Sozialversicherungsnummer for shape', () => {
    accepts('DE', 'sv_nummer', '65 170839 J 003');
    refuses('DE', 'sv_nummer', '651708390003');
  });
});

describe('India: PAN', () => {
  it('accepts an individual PAN', () => {
    expect(accepts('IN', 'pan', 'AFZPK7190K')).toEqual({ normalised: 'AFZPK7190K', checked: 'rule' });
    accepts('IN', 'pan', 'abcpd1234e');
  });

  it('accepts a PAN whose fourth letter is not P', () => {
    // A contractor invoicing through a firm or a company quotes that PAN. The
    // entity codes are not a closed list we can vouch for, so none is refused.
    accepts('IN', 'pan', 'AAACB1234C');
    accepts('IN', 'pan', 'AAAFH1234K');
    accepts('IN', 'pan', 'AAAEL1234F');
  });

  it('refuses the wrong shape', () => {
    refuses('IN', 'pan', 'ABCP1234E');
    refuses('IN', 'pan', 'ABCPD12345');
    refuses('IN', 'pan', '1BCPD1234E');
  });

  it('checks a UAN for shape', () => {
    accepts('IN', 'uan', '100123456789');
    refuses('IN', 'uan', '10012345678');
  });
});

describe('United States: SSN', () => {
  it('accepts a number with or without dashes', () => {
    expect(accepts('US', 'ssn', '536-22-1234')).toEqual({ normalised: '536221234', checked: 'rule' });
    accepts('US', 'ssn', '536221234');
  });

  it('refuses the areas, groups and serials SSA never issues', () => {
    refuses('US', 'ssn', '000-22-1234');
    refuses('US', 'ssn', '666-22-1234');
    refuses('US', 'ssn', '900-22-1234');
    refuses('US', 'ssn', '536-00-1234');
    refuses('US', 'ssn', '536-22-0000');
    refuses('US', 'ssn', '536-22-123');
  });
});

describe('a scheme there is no rule for', () => {
  it('validates on length only and says so', () => {
    expect(accepts('FR', 'nir', '1 85 05 78 006 084 36')).toEqual({
      normalised: '185057800608436',
      checked: 'length_only',
    });
    expect(accepts('ES', 'passport', 'PAA123456')?.checked).toBe('length_only');
    refuses('FR', 'nir', '');
    refuses('FR', 'nir', 'X'.repeat(33));
  });
});
