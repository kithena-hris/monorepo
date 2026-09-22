import { describe, expect, it } from 'vitest';

import { AttributeKey, KEY_MAX, LocalizedString, SectionKey, localized } from './primitives.js';

/**
 * What a tenant is allowed to call a field.
 *
 * These tests are all negative, and that is the shape of the risk. A key is
 * chosen once, by a customer, and then appears in a Kafka payload, a CSV
 * header, an OpenAPI schema, a generated column name and somebody else's
 * integration. Every character refused here is one that would have been
 * refused later by Postgres, by a spreadsheet, or by nobody at all — which is
 * worse, because then it is in production and cannot be renamed.
 */
describe('an attribute key', () => {
  it('accepts the ordinary shape', () => {
    expect(AttributeKey.safeParse('employee_number').success).toBe(true);
    expect(AttributeKey.safeParse('works_council_id_2').success).toBe(true);
  });

  it('refuses a hyphen', () => {
    // A minus sign in SQL and in every spreadsheet expression language.
    expect(AttributeKey.safeParse('employee-number').success).toBe(false);
  });

  it('refuses a leading digit', () => {
    // `2fa_enabled` as a generated column has to be quoted everywhere forever.
    expect(AttributeKey.safeParse('2fa_enabled').success).toBe(false);
  });

  it('refuses an uppercase letter', () => {
    // Postgres folds an unquoted identifier to lowercase, so this and
    // `employeenumber` would be two registry keys and one column.
    expect(AttributeKey.safeParse('employeeNumber').success).toBe(false);
  });

  it('refuses a space, a dot and everything else somebody might paste', () => {
    for (const bad of ['employee number', 'employee.number', 'employee/number', 'año', '']) {
      expect(AttributeKey.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('refuses a key longer than a CSV header should be', () => {
    expect(AttributeKey.safeParse('a'.repeat(KEY_MAX)).success).toBe(true);
    expect(AttributeKey.safeParse('a'.repeat(KEY_MAX + 1)).success).toBe(false);
  });

  it('says which rule refused, so a settings screen can point at the field', () => {
    const refused = AttributeKey.safeParse('Employee-Number');
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toContain('lowercase');
  });
});

describe('a section key', () => {
  it('follows the same rules', () => {
    expect(SectionKey.safeParse('personal_information').success).toBe(true);
    expect(SectionKey.safeParse('Personal Information').success).toBe(false);
  });
});

describe('a localized string', () => {
  it('needs a default, because a label with no default renders as nothing', () => {
    expect(LocalizedString.safeParse({ translations: { es: 'Número de empleado' } }).success).toBe(
      false,
    );
  });

  it('is complete with a default alone', () => {
    const parsed = LocalizedString.parse({ default: 'Employee number' });
    expect(parsed.translations).toEqual({});
  });

  it('refuses a blank translation rather than rendering an unnamed field', () => {
    expect(
      LocalizedString.safeParse({ default: 'Employee number', translations: { es: '' } }).success,
    ).toBe(false);
  });

  it('refuses something that is not a locale', () => {
    expect(
      LocalizedString.safeParse({ default: 'Employee number', translations: { spanish: 'Número' } })
        .success,
    ).toBe(false);
  });
});

describe('reading a label', () => {
  const label = LocalizedString.parse({
    default: 'Employee number',
    translations: { es: 'Número de empleado', 'es-MX': 'Número de empleado (MX)' },
  });

  it('prefers an exact locale', () => {
    expect(localized(label, 'es-MX')).toBe('Número de empleado (MX)');
  });

  it('falls back from a region to its language', () => {
    expect(localized(label, 'es-AR')).toBe('Número de empleado');
  });

  it('does not promote a regional variant to the whole language', () => {
    // `es-MX` is somebody's considered choice for Mexico, not a better default
    // for Spanish.
    const onlyRegional = LocalizedString.parse({
      default: 'Employee number',
      translations: { 'es-MX': 'Número de empleado (MX)' },
    });
    expect(localized(onlyRegional, 'es')).toBe('Employee number');
  });

  it('falls back to the default for a locale nobody translated', () => {
    expect(localized(label, 'de')).toBe('Employee number');
    expect(localized(label)).toBe('Employee number');
  });
});
