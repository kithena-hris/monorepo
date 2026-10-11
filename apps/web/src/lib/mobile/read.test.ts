import { describe, expect, it } from 'vitest';

import { nifIn, offerFacts } from './read';

describe('reading what the phone sends', () => {
  it('finds a NIF whose letter checks out, through OCR noise', () => {
    expect(nifIn('DNI\nESPAÑA\n1234 5678-Z\nNOMBRE')).toBe('12345678Z');
    expect(nifIn('IDESPCAA123456<12345678Z<<<<<')).toBe('12345678Z');
    expect(nifIn('NUM 1234567O A')).toBeNull();
    expect(nifIn('X1234567L')).toBe('X1234567L');
    // Tesseract's own reading of a rendered card: the Z came back a 2.
    expect(nifIn('DOCUMENTO NACIONAL\nDNI 123456782\n')).toBe('12345678Z');
    expect(nifIn('no numbers here')).toBeNull();
  });

  it('reads an offer letter’s name, email, start date and manager', () => {
    const letter = `Dear Lena Weiss,
We are delighted to offer you the role of Data Analyst. You will be reporting to Marco Ruiz.
Your start date will be 16 November 2026. Your work email is lena@acme.com.`;
    expect(offerFacts(letter)).toEqual({
      given: 'Lena',
      family: 'Weiss',
      email: 'lena@acme.com',
      start: '2026-11-16',
      manager: 'Marco Ruiz',
    });
    expect(offerFacts('Hello, see you soon').given).toBeNull();
  });
});
