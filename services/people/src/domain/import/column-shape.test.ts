import { describe, expect, it } from 'vitest';

import { defaultFieldFor, shapeOf } from './column-shape.js';

/**
 * A spreadsheet column that matches no field, described by the shape of its
 * values — never the values — and given a sensible field to start from.
 */

describe('the shape of a column', () => {
  it.each([
    [['ana@acme.es', 'bo@acme.es'], 'email-like', 'email'],
    [
      ['ES91 2100 0418 4502 0005 1332', 'ES7921000813610123456789'],
      'IBAN-like, country ES',
      'bank_account',
    ],
    [['01/02/1990', '31/12/1985'], 'dates, dd/mm/yyyy', 'date'],
    [['1990-02-01', '1985-12-31'], 'dates, yyyy-mm-dd', 'date'],
    [['+34 600 123 456', '612 345 678'], 'phone-like', 'phone'],
    [['12', '7', '40'], 'whole numbers', 'number'],
    [['37.50', '40.00'], 'numbers with 2 decimals', 'decimal'],
    [['yes', 'No', 'yes'], 'yes or no', 'boolean'],
    [['12345678Z', '87654321X', '11111111H'], '8 digits + letter', 'text'],
    [['S', 'M', 'L', 'M', 'XL', 'S'], '4 distinct short values', 'select'],
    [['', ' '], 'empty', 'text'],
  ])('%j reads as %s', (values, shape, dataType) => {
    expect(shapeOf(values)).toMatchObject({ shape, dataType });
  });

  it('keeps a short list’s choices, in first-seen order, for the review only', () => {
    expect(shapeOf(['S', 'M', 'L', 'M', 'XL', 'S']).options).toEqual(['S', 'M', 'L', 'XL']);
    expect(shapeOf(['12345678Z', '87654321X', '11111111H']).options).toEqual([]);
  });

  it('never repeats a value in the shape', () => {
    const shape = shapeOf(['ES91 2100 0418 4502 0005 1332']).shape;
    expect(shape).not.toMatch(/\d{3}/u);
  });
});

describe('a sensible field for a column', () => {
  it('an IBAN: financial, sealed, not for the assistant, filled by the employee, seen by them and HR', () => {
    expect(defaultFieldFor('IBAN', shapeOf(['ES91 2100 0418 4502 0005 1332']))).toMatchObject({
      label: 'IBAN',
      dataType: 'bank_account',
      country: 'ES',
      classification: 'confidential',
      piiKind: 'financial',
      encrypted: true,
      aiEligible: false,
      ownership: ['employee'],
      visibility: ['self', 'hr'],
      requiredness: 'never',
    });
  });

  it('an emergency contact: contact data the employee fills in and HR sees', () => {
    expect(defaultFieldFor('Emergency contact', shapeOf(['Ana López', 'Bo Chen']))).toMatchObject({
      piiKind: 'contact',
      classification: 'confidential',
      ownership: ['employee'],
      visibility: ['self', 'hr'],
      aiEligible: false,
    });
  });

  it('a T-shirt size: a choice, not sensitive, shared with the assistant', () => {
    expect(defaultFieldFor('T-shirt size', shapeOf(['S', 'M', 'L', 'M']))).toMatchObject({
      dataType: 'select',
      options: ['S', 'M', 'L'],
      classification: 'internal',
      piiKind: 'none',
      aiEligible: true,
      encrypted: false,
    });
  });

  it('health data is special category, and an identifier is sealed', () => {
    expect(defaultFieldFor('Allergies', shapeOf(['nuts']))).toMatchObject({
      classification: 'special-category',
      piiKind: 'health',
      aiEligible: false,
    });
    expect(defaultFieldFor('NIF', shapeOf(['12345678Z']))).toMatchObject({
      classification: 'confidential',
      piiKind: 'identity',
      encrypted: true,
    });
  });
});
