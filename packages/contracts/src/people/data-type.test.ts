import { describe, expect, it } from 'vitest';

import { AttributeDataType, AttributeTypeConfig, configMatchesType } from './data-type.js';

/**
 * What a field's configuration is allowed to say.
 *
 * The two tests the ticket names are the two failures that cost money. A
 * `select` with no options renders as a dropdown nobody can answer, which is
 * discovered by an employee on their first morning. A `money` config that can
 * express a float is the repository's oldest rule broken in the one place
 * where nobody would look for it — a settings screen.
 */
describe('a select', () => {
  it('cannot exist without options', () => {
    expect(AttributeTypeConfig.safeParse({ kind: 'select', options: [] }).success).toBe(false);
    expect(AttributeTypeConfig.safeParse({ kind: 'select' }).success).toBe(false);
  });

  it('cannot have two options sharing a value', () => {
    // Which record means which is then unanswerable, and an export cannot
    // round-trip either of them.
    const duplicated = {
      kind: 'select',
      options: [
        { value: 'part_time', label: { default: 'Part time' } },
        { value: 'part_time', label: { default: 'Part-time' } },
      ],
    };
    expect(AttributeTypeConfig.safeParse(duplicated).success).toBe(false);
  });

  it('keeps the value and the label apart, so a relabel is not a rewrite', () => {
    const parsed = AttributeTypeConfig.parse({
      kind: 'select',
      options: [{ value: 'part_time', label: { default: 'Part time' } }],
    });
    expect(parsed).toMatchObject({ options: [{ value: 'part_time', retiredAt: null }] });
  });

  it('refuses an option value that could not be a key', () => {
    expect(
      AttributeTypeConfig.safeParse({
        kind: 'select',
        options: [{ value: 'Part Time', label: { default: 'Part time' } }],
      }).success,
    ).toBe(false);
  });
});

describe('money', () => {
  it('cannot express a float', () => {
    // Minor units, because money is never a float. There is no `decimals` on
    // this config to set to 2 and no amount field that would accept 1234.56.
    const config = AttributeTypeConfig.parse({ kind: 'money' });
    expect(config).not.toHaveProperty('decimals');
    expect(
      AttributeTypeConfig.safeParse({ kind: 'money', minMinor: 1234.56 }).success,
    ).toBe(false);
  });

  it('lets the record decide its own currency', () => {
    // A salary in a multi-country tenant is not one currency.
    expect(AttributeTypeConfig.parse({ kind: 'money' })).toMatchObject({ currency: null });
    expect(AttributeTypeConfig.safeParse({ kind: 'money', currency: 'EURO' }).success).toBe(false);
  });
});

describe('a number', () => {
  it('refuses a minimum above its maximum', () => {
    expect(AttributeTypeConfig.safeParse({ kind: 'number', min: 10, max: 1 }).success).toBe(false);
  });

  it('accepts a bound on one side only', () => {
    expect(AttributeTypeConfig.safeParse({ kind: 'number', min: 0 }).success).toBe(true);
  });
});

describe('the country-dependent types', () => {
  it('make a national identifier name its country and its scheme', () => {
    expect(AttributeTypeConfig.safeParse({ kind: 'national_id' }).success).toBe(false);
    expect(
      AttributeTypeConfig.safeParse({ kind: 'national_id', country: 'ES', scheme: 'nif' }).success,
    ).toBe(true);
  });

  it('refuse a country nothing knows the rules for', () => {
    // Better here than at the moment an employee types their identifier and is
    // told it is valid by a check that does not exist.
    expect(
      AttributeTypeConfig.safeParse({ kind: 'national_id', country: 'ZZ', scheme: 'nif' }).success,
    ).toBe(false);
  });

  it('leave an address with nothing to configure', () => {
    // The country on the value decides the subdivision label, the postcode
    // label and the postcode rule, and `checkAddress` already knows all three.
    expect(AttributeTypeConfig.parse({ kind: 'address' })).toEqual({ kind: 'address' });
  });
});

describe('the catalogue and the configuration', () => {
  it('covers every data type, so nothing falls back to long_text', () => {
    for (const kind of AttributeDataType.options) {
      const minimal: Record<string, unknown> = { kind };
      if (kind === 'select' || kind === 'multi_select') {
        minimal['options'] = [{ value: 'one', label: { default: 'One' } }];
      }
      if (kind === 'national_id') Object.assign(minimal, { country: 'ES', scheme: 'nif' });
      if (kind === 'bank_account') Object.assign(minimal, { country: 'ES' });

      expect(AttributeTypeConfig.safeParse(minimal).success, kind).toBe(true);
    }
  });

  it('notices a config that describes a different type', () => {
    // Two fields naming the same thing can disagree, and this is what keeps
    // them honest: a `select` config on a `text` attribute would render a
    // dropdown over a field that stores free text.
    const select = AttributeTypeConfig.parse({
      kind: 'select',
      options: [{ value: 'one', label: { default: 'One' } }],
    });
    expect(configMatchesType('select', select)).toBe(true);
    expect(configMatchesType('text', select)).toBe(false);
  });
});
