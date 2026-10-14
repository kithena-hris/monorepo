import { describe, expect, it } from 'vitest';

import { figuresToCheck, matchName, merge, placeholders, signingBlock } from './letter.js';

const template = 'Dear {{Preferred name}},\n\nFrom {{ Start date }} your title is {{Job title}}. {{Preferred name}}, welcome.';

describe('a letter from a template (G3)', () => {
  it('names each placeholder once, in order', () => {
    expect(placeholders(template)).toEqual(['Preferred name', 'Start date', 'Job title']);
  });

  it('fills each from the values, and says which it could not', () => {
    const out = merge(template, { 'Preferred name': 'Adam', 'Job title': 'Senior engineer' });
    expect(out.text).toBe(
      'Dear Adam,\n\nFrom {{Start date}} your title is Senior engineer. Adam, welcome.',
    );
    expect(out.missing).toEqual(['Start date']);
  });
});

describe('a document drafted with Kithena', () => {
  it('ends with a line to sign for each signer, in signing order', () => {
    expect(signingBlock(['Omar Lewis', 'Ashu Venugopal'])).toBe(
      '\n\n\nSignature:\nName: Omar Lewis\n\n\nSignature:\nName: Ashu Venugopal',
    );
  });

  it('names every figure in the draft that nobody said, however it was written', () => {
    const said = 'Offer Omar 85,000 a year from 1 November 2026, 25 days off.';
    const draft =
      'Your salary is €85000 per year, from 1 November 2026, with 25 days of leave and a 10% bonus after 3 months.';
    expect(figuresToCheck(draft, said)).toEqual(['10', '3']);
  });

  it('finds a person by their name, and not when two could be meant', () => {
    const people = [
      { displayName: 'Omar Lewis' },
      { displayName: 'Omar Jackson' },
      { displayName: 'Liz Okafor' },
    ];
    expect(matchName('omar  lewis', people)).toEqual({ displayName: 'Omar Lewis' });
    expect(matchName('Okafor', people)).toEqual({ displayName: 'Liz Okafor' });
    expect(matchName('Omar', people)).toBe('ambiguous');
    expect(matchName('Grace Hopper', people)).toBeNull();
  });
});
