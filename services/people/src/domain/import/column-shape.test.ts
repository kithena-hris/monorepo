import { describe, expect, it } from 'vitest';

import { kindOf, shapeOf } from './column-shape.js';

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
    // Codes that repeat are a list, whatever their pattern; ones that never repeat are identifiers.
    [['CC-100', 'CC-110', 'CC-100', 'CC-120'], '3 distinct short values', 'select'],
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

describe('the kind of data in a column', () => {
  it.each([
    ['IBAN', 'financial'],
    ['NIF', 'identifier'],
    ['Allergies', 'special'],
    // A diet can say a religion or a condition: special category, never ordinary.
    ['Dietary requirements', 'special'],
    ['Religion', 'special'],
    ['Emergency contact', 'contact'],
    ['Date of birth', 'birth'],
    ['Cost centre', 'business'],
    ['T-shirt size', 'plain'],
  ])('%s is %s', (header, kind) => {
    expect(kindOf(header, shapeOf(['x']))).toBe(kind);
  });
});
