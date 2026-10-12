import { describe, expect, it } from 'vitest';

import { merge, placeholders } from './letter.js';

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
