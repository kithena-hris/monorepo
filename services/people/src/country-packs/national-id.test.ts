import { describe, expect, it } from 'vitest';

import { checkNationalId, needsReview, type FindingLevel } from './national-id.js';

/**
 * Real-shaped identifiers, one country at a time (PEO-125).
 *
 * Three outcomes, not two. A value that cannot be the identifier at all —
 * wrong length or characters once spacing is removed — is refused. Anything
 * else is accepted, carrying findings: `ok`, `attention` (it matches, but a
 * person should look) or `mismatch` (it has the shape, and a published rule
 * says it is wrong). HR's reviewer decides on the last two; nothing here does.
 */

const check = (country: string, scheme: string, value: string) => {
  const result = checkNationalId(country, scheme, value);
  expect(result.ok, `${country}/${scheme} ${value}`).toBe(true);
  if (!result.ok) throw new Error('refused');
  return result.value;
};

/** The worst level among the findings, and every code, for a value that is accepted. */
const judged = (country: string, scheme: string, value: string) => {
  const { findings } = check(country, scheme, value);
  const order: FindingLevel[] = ['ok', 'attention', 'mismatch'];
  const worst = findings.reduce<FindingLevel>(
    (w, f) => (order.indexOf(f.level) > order.indexOf(w) ? f.level : w),
    'ok',
  );
  return { worst, codes: findings.map((f) => f.code) };
};

const refuses = (country: string, scheme: string, value: string) => {
  const result = checkNationalId(country, scheme, value);
  expect(result.ok, `${country}/${scheme} ${value}`).toBe(false);
};

describe('Spain: NIF', () => {
  it('passes a DNI whose letter is the mod-23 control', () => {
    expect(check('ES', 'nif', '12345678Z')).toEqual({
      normalised: '12345678Z',
      checked: 'rule',
      findings: [expect.objectContaining({ level: 'ok', code: 'check_ok' })],
    });
    expect(judged('ES', 'nif', '87654321X').worst).toBe('ok');
  });

  it('passes a NIE, because a foreign employee has a NIE where a Spaniard has a DNI', () => {
    expect(judged('ES', 'nif', 'X1234567L').worst).toBe('ok');
    expect(judged('ES', 'nif', 'Y1234567X').worst).toBe('ok');
    expect(judged('ES', 'nif', 'Z1234567R').worst).toBe('ok');
  });

  it('passes the K, L and M personal NIFs', () => {
    expect(judged('ES', 'nif', 'M1234567L').worst).toBe('ok');
    expect(judged('ES', 'nif', 'K1234567L').worst).toBe('ok');
  });

  it('forgives the spacing and case a person types', () => {
    expect(check('ES', 'nif', ' 12.345.678-z ').normalised).toBe('12345678Z');
    expect(check('ES', 'nif', 'x-1234567-l').normalised).toBe('X1234567L');
  });

  it('accepts a wrong control letter, as a mismatch for review', () => {
    expect(judged('ES', 'nif', '12345678A')).toEqual({
      worst: 'mismatch',
      codes: ['check_mismatch'],
    });
    expect(judged('ES', 'nif', 'X1234567A').worst).toBe('mismatch');
  });

  it('accepts a company CIF as needing attention: a company is not a person', () => {
    expect(judged('ES', 'nif', 'B12345678')).toEqual({
      worst: 'attention',
      codes: ['holder_not_person'],
    });
  });

  it('accepts nine characters in no NIF pattern as a mismatch', () => {
    expect(judged('ES', 'nif', '1234Z5678').codes).toEqual(['format_mismatch']);
  });

  it('refuses what cannot be a NIF at all', () => {
    refuses('ES', 'nif', '1234567Z');
    refuses('ES', 'nif', '');
    refuses('ES', 'nif', '12345678ZZ');
    refuses('ES', 'nif', '1234567*Z');
  });
});

describe('Spain: Social Security affiliation number (NAF)', () => {
  it('passes the mod-97 control over province and number', () => {
    expect(judged('ES', 'naf', '28 12345678 40').worst).toBe('ok');
  });

  it('passes the short-number case: under ten million, the province is scaled by 10^7', () => {
    expect(judged('ES', 'naf', '08/01234567/74').worst).toBe('ok');
    expect(judged('ES', 'naf', '460000012330').worst).toBe('ok');
  });

  it('accepts wrong control digits as a mismatch', () => {
    expect(judged('ES', 'naf', '281234567841')).toEqual({
      worst: 'mismatch',
      codes: ['check_mismatch'],
    });
    // The long-number formula applied to a short number gives a different control.
    expect(judged('ES', 'naf', '080123456734').worst).toBe('mismatch');
  });

  it('refuses anything but twelve digits', () => {
    refuses('ES', 'naf', '28123456');
    refuses('ES', 'naf', '28123456784A');
  });
});

describe('United Kingdom: National Insurance number', () => {
  it('passes a number with an A to D suffix', () => {
    expect(judged('GB', 'nino', 'AB123456C').worst).toBe('ok');
    expect(judged('GB', 'nino', 'jg 10 37 59 a').worst).toBe('ok');
    expect(judged('GB', 'nino', 'OA123456D').worst).toBe('ok');
  });

  it('accepts a number without its suffix, asking for attention', () => {
    // HMRC's RTI schema allows a blank suffix, but the card always has one.
    expect(check('GB', 'nino', 'SN123456').normalised).toBe('SN123456');
    expect(judged('GB', 'nino', 'SN123456')).toEqual({
      worst: 'attention',
      codes: ['suffix_missing'],
    });
  });

  it('accepts the prefix letters HMRC never allocates, as a mismatch', () => {
    for (const v of ['QQ123456C', 'DA123456A', 'AO123456A', 'AV123456A']) {
      expect(judged('GB', 'nino', v)).toEqual({ worst: 'mismatch', codes: ['prefix_not_issued'] });
    }
  });

  it('accepts the reserved prefix pairs as a mismatch', () => {
    for (const prefix of ['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']) {
      expect(judged('GB', 'nino', `${prefix}123456A`).worst).toBe('mismatch');
    }
  });

  it('accepts a suffix beyond D as a mismatch', () => {
    expect(judged('GB', 'nino', 'AB123456E').codes).toEqual(['suffix_invalid']);
  });

  it('refuses the wrong number of digits', () => {
    refuses('GB', 'nino', 'AB12345C');
    refuses('GB', 'nino', 'A1123456C');
  });
});

describe('Germany: Steuer-ID', () => {
  it('passes a pre-2016 number: one digit twice, ISO 7064 check', () => {
    expect(judged('DE', 'steuer_id', '86095742719').worst).toBe('ok');
    expect(judged('DE', 'steuer_id', '47 036 892 816').worst).toBe('ok');
  });

  it('passes a post-2016 number: one digit three times, never all three adjacent', () => {
    expect(judged('DE', 'steuer_id', '11213456783').worst).toBe('ok');
    expect(judged('DE', 'steuer_id', '12131456787').worst).toBe('ok');
  });

  it('accepts three adjacent repeats as a mismatch, even with a good check digit', () => {
    expect(judged('DE', 'steuer_id', '11123456786')).toEqual({
      worst: 'mismatch',
      codes: ['digit_pattern'],
    });
  });

  it('accepts no repeated digit as a mismatch', () => {
    expect(judged('DE', 'steuer_id', '12345678903').codes).toContain('digit_pattern');
  });

  it('accepts a wrong check digit as a mismatch', () => {
    expect(judged('DE', 'steuer_id', '86095742718')).toEqual({
      worst: 'mismatch',
      codes: ['check_mismatch'],
    });
  });

  it('refuses a leading zero and the wrong length', () => {
    refuses('DE', 'steuer_id', '06095742719');
    refuses('DE', 'steuer_id', '8609574271');
  });
});

describe('Germany: Sozialversicherungsnummer', () => {
  it('passes the check digit with the letter weighted as its alphabet position', () => {
    expect(judged('DE', 'sv_nummer', '65 170839 J 003').worst).toBe('ok');
    expect(judged('DE', 'sv_nummer', '15070649C103').worst).toBe('ok');
    expect(judged('DE', 'sv_nummer', '12150785M041').worst).toBe('ok');
  });

  it('accepts a wrong check digit as a mismatch', () => {
    expect(judged('DE', 'sv_nummer', '65170839J004')).toEqual({
      worst: 'mismatch',
      codes: ['check_mismatch'],
    });
  });

  it('asks for attention when the birth date part is not a date', () => {
    expect(judged('DE', 'sv_nummer', '65171339J000').codes).toContain('birth_date_invalid');
  });

  it('refuses the wrong shape', () => {
    refuses('DE', 'sv_nummer', '651708390003');
    refuses('DE', 'sv_nummer', '65170839J03');
  });
});

describe('India: PAN', () => {
  it('passes an individual PAN, saying its check letter cannot be verified', () => {
    expect(check('IN', 'pan', 'AFZPK7190K')).toEqual({
      normalised: 'AFZPK7190K',
      checked: 'rule',
      findings: [expect.objectContaining({ level: 'ok', code: 'check_unavailable' })],
    });
    expect(judged('IN', 'pan', 'abcpd1234e').worst).toBe('ok');
  });

  it('accepts a company, firm or trust PAN, asking for attention', () => {
    for (const v of ['AAACB1234C', 'AAAFH1234K', 'AAATL1234F', 'AAAHK1234Q']) {
      expect(judged('IN', 'pan', v).codes).toContain('holder_not_person');
      expect(judged('IN', 'pan', v).worst).toBe('attention');
    }
  });

  it('accepts a fourth letter that is no holder type, as a mismatch', () => {
    expect(judged('IN', 'pan', 'AAAEL1234F').codes).toContain('holder_unknown');
    expect(judged('IN', 'pan', 'AAAEL1234F').worst).toBe('mismatch');
  });

  it('refuses the wrong shape', () => {
    refuses('IN', 'pan', 'ABCP1234E');
    refuses('IN', 'pan', 'ABCPD12345');
    refuses('IN', 'pan', '1BCPD1234E');
  });
});

describe('India: UAN', () => {
  it('passes twelve digits, saying there is no public check to verify', () => {
    expect(judged('IN', 'uan', '100123456789')).toEqual({
      worst: 'ok',
      codes: ['check_unavailable'],
    });
  });

  it('refuses anything else', () => {
    refuses('IN', 'uan', '10012345678');
    refuses('IN', 'uan', '10012345678A');
  });
});

describe('United States: SSN', () => {
  it('passes a number with or without dashes', () => {
    expect(check('US', 'ssn', '536-22-1234').normalised).toBe('536221234');
    expect(judged('US', 'ssn', '536221234').worst).toBe('ok');
  });

  it('accepts the areas, groups and serials SSA never issues, as a mismatch', () => {
    for (const v of ['000-22-1234', '666-22-1234', '900-22-1234', '536-00-1234', '536-22-0000']) {
      expect(judged('US', 'ssn', v)).toEqual({ worst: 'mismatch', codes: ['not_issued'] });
    }
  });

  it('refuses the wrong length', () => {
    refuses('US', 'ssn', '536-22-123');
  });
});

describe('a scheme there is no rule for', () => {
  it('validates on length only and says so', () => {
    expect(check('FR', 'nir', '1 85 05 78 006 084 36')).toEqual({
      normalised: '185057800608436',
      checked: 'length_only',
      findings: [expect.objectContaining({ level: 'ok', code: 'check_unavailable' })],
    });
    expect(check('ES', 'passport', 'PAA123456').checked).toBe('length_only');
    refuses('FR', 'nir', '');
    refuses('FR', 'nir', 'X'.repeat(33));
  });
});

describe('what goes to review', () => {
  it('is anything worse than ok', () => {
    expect(needsReview(check('ES', 'nif', '12345678Z').findings)).toBe(false);
    expect(needsReview(check('IN', 'pan', 'AFZPK7190K').findings)).toBe(false);
    expect(needsReview(check('GB', 'nino', 'SN123456').findings)).toBe(true);
    expect(needsReview(check('ES', 'nif', '12345678A').findings)).toBe(true);
  });

  it('never repeats the value in a message', () => {
    for (const [c, s, v] of [
      ['ES', 'nif', '12345678A'],
      ['GB', 'nino', 'QQ123456C'],
      ['IN', 'pan', 'AAACB1234C'],
      ['DE', 'steuer_id', '86095742718'],
    ] as const) {
      for (const f of check(c, s, v).findings) expect(f.message).not.toContain(v);
    }
  });
});
