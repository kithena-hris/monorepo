import { describe, expect, it } from 'vitest';

import { pseudonymise } from './private.js';

const people = ['Omar Lewis', 'Liz Okafor', 'May Chen'];

describe('what a model is shown of a private value (PRD §14.1)', () => {
  it('replaces each person and identifier with a stand-in, and puts each back', () => {
    const p = pseudonymise(people);
    const text =
      'Omar Lewis (omar.lewis@acme.com, +1 (312) 555-0100) reports to Liz. ' +
      'IBAN ES91 2100 0418 4502 0005 1332, SSN 992-83-8749, passport M9109171. ' +
      'Salary 85,000 from 14/10/2026 to 2026-10-21. Omar signs in May.';
    const masked = p.mask({ pages: [{ page: 1, text }] }) as { pages: { text: string }[] };
    const shown = masked.pages[0]?.text ?? '';
    for (const secret of [
      'Omar',
      'Lewis',
      'Liz',
      'omar.lewis@acme.com',
      '555-0100',
      'ES91',
      '992-83-8749',
      'M9109171',
    ]) {
      expect(shown).not.toContain(secret);
    }
    // What a summary needs stays: amounts, dates, and a month that is also a name.
    expect(shown).toContain('85,000');
    expect(shown).toContain('14/10/2026');
    expect(shown).toContain('2026-10-21');
    expect(shown).toContain('signs in May');
    expect(shown).toMatch(
      /^\[\[Person 1\]\] \(\[\[Email 1\]\], \[\[Number 1\]\]\) reports to \[\[Person 2\]\]\./u,
    );
    expect(p.unmask({ summary: [{ text: shown }] })).toEqual({ summary: [{ text }] });
  });

  it('gives one value one stand-in, and leaves a stand-in it never made alone', () => {
    const p = pseudonymise(people);
    expect(p.mask('Liz Okafor and Liz Okafor')).toBe('[[Person 1]] and [[Person 1]]');
    expect(p.unmask('[[Person 1]] met [[Person 9]]')).toBe('Liz Okafor met [[Person 9]]');
  });
});
