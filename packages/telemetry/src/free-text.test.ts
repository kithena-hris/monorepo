import { describe, expect, it } from 'vitest';

import { contains, haystack, valueNeedle } from './free-text.js';

const carries = (text: string, value: string, names: readonly string[] = []): boolean => {
  const n = valueNeedle(value, names);
  return n !== undefined && contains(haystack([text]), n);
};

describe('free text carrying a value', () => {
  it.each([
    ['IBAN', 'DE89370400440532013000', 'Pay DE89 3704 0044 0532 0130 00 on Friday'],
    ['IBAN, stored spaced', 'DE89 3704 0044 0532 0130 00', 'iban=de89370400440532013000'],
    ['NIF', '12345678Z', 'Her NIF is 12345678-Z.'],
    ['NI number', 'AB123456C', 'NI: ab 12 34 56 c'],
    ['PAN', 'ABCDE1234F', 'PAN abcde-1234-f attached'],
    ['SSN', '123-45-6789', 'ssn 123 45 6789'],
    ['SSN glued to its label', '123456789', 'ssn123456789'],
    ['SSN split by dots', '123456789', 'see 123.45.6789'],
  ])('finds a %s however it is separated', (_shape, value, text) => {
    expect(carries(text, value)).toBe(true);
  });

  it('finds a word value across case, accents, width and invisible characters', () => {
    expect(carries('Is she ROMAN-catholic?', 'Roman Catholic')).toBe(true);
    expect(carries('religion: romancatholic', 'Roman Catholic')).toBe(true);
    expect(carries('diagnosed with DIABETES', 'diabètes')).toBe(true);
    expect(carries('code ＡＢ１２３４５６Ｃ', 'AB123456C')).toBe(true);
    expect(carries('dia​betes', 'diabetes')).toBe(true);
  });

  it('does not find a word value inside another word', () => {
    expect(carries('Ask Christiansen about it', 'Christian')).toBe(false);
    expect(carries('nonetheless', 'none')).toBe(false);
  });

  it('ignores a value with nothing to match', () => {
    expect(valueNeedle(' -- ')).toBeUndefined();
  });
});

describe('a short value', () => {
  const bloodGroup = ['blood_type', 'Blood group', 'Grupo sanguíneo', 'Blutgruppe'];

  it('is ignored in ordinary prose', () => {
    expect(carries('Write a short note to a colleague about a party', 'A', bloodGroup)).toBe(false);
    expect(carries('The AB testing results are in', 'AB', bloodGroup)).toBe(false);
    expect(carries('Temperature is 20 F today', 'F', ['sex', 'Sex marker'])).toBe(false);
  });

  it('is found next to its own field’s name, in any locale', () => {
    expect(carries('blood group: A', 'A', bloodGroup)).toBe(true);
    expect(carries('Her blood type is AB, please note', 'AB', bloodGroup)).toBe(true);
    expect(carries('grupo sanguíneo AB', 'AB', bloodGroup)).toBe(true);
    expect(carries('Blutgruppe: A', 'A', bloodGroup)).toBe(true);
    expect(carries('sex marker F', 'F', ['sex', 'Sex marker'])).toBe(true);
  });

  it('is not found beyond the window, or next to another field’s name', () => {
    expect(carries('blood group was discussed at length and then a decision', 'A', bloodGroup)).toBe(false);
    expect(carries('department: A', 'A', bloodGroup)).toBe(false);
  });

  it('is ignored when its field has no names to anchor on', () => {
    expect(valueNeedle('A')).toBeUndefined();
  });
});

describe('a date', () => {
  const DOB = '1990-01-02';

  it.each([
    ['ISO', 'born 1990-01-02'],
    ['ISO, basic', 'born 19900102'],
    ['d/m/y', 'born 02/01/1990'],
    ['d-m-y, no leading zeros', 'born 2-1-1990'],
    ['d.m.y, two-digit year', 'born 2.1.90'],
    ['m/d/y', 'born 01/02/1990'],
    ['m-d-y, two-digit year', 'born 1-2-90'],
    ['glued d m y', 'born 02011990'],
    ['English, day first', 'born 2 January 1990'],
    ['English, month first', 'born Jan 2, 1990'],
    ['English, ordinal', 'born on the 2nd of January 1990'],
    ['Spanish', 'nació el 2 de enero de 1990'],
    ['Spanish, abbreviated', 'nacimiento: 2 ene 1990'],
    ['German', 'geboren am 2. Januar 1990'],
    ['German, Austrian', 'geboren am 2. Jänner 1990'],
    ['Catalan', 'nascut el 2 de gener de 1990'],
    ['Hindi', 'जन्म 2 जनवरी 1990'],
  ])('is found written as %s', (_form, text) => {
    expect(carries(text, DOB)).toBe(true);
  });

  it('matches both readings of an ambiguous numeric date', () => {
    expect(carries('01/02/1990', '1990-01-02')).toBe(true);
    expect(carries('01/02/1990', '1990-02-01')).toBe(true);
  });

  it('is not found in an unrelated date, or in digits that only look close', () => {
    expect(carries('hired 2 January 2019', DOB)).toBe(false);
    expect(carries('review due 03/01/1990', DOB)).toBe(false);
    expect(carries('invoice 21 1990', DOB)).toBe(false);
    expect(carries('born 2 February 1990', DOB)).toBe(false);
  });
});
