import { describe, expect, it } from 'vitest';

import { wordsIn } from './words.js';

const days = { one: '{{count}} day', other: '{{count}} days' };

describe('wordsIn', () => {
  it('takes the plural form the language gives the number', () => {
    const t = wordsIn('pl', {
      d_one: '{{count}} dzień',
      d_few: '{{count}} dni',
      d_many: '{{count}} dni',
      d_other: '{{count}} dnia',
    });
    expect([1, 3, 5, 1.5].map((count) => t('d', days, { count }))).toEqual([
      '1 dzień',
      '3 dni',
      '5 dni',
      '1,5 dnia',
    ]);
  });

  it('reads in English what the language has no words for', () => {
    const t = wordsIn('de', { hi: 'Hallo {{name}}' });
    expect(t('hi', 'Hello {{name}}', { name: 'Ada' })).toBe('Hallo Ada');
    expect(t('missing', 'Not translated')).toBe('Not translated');
    expect(t('d', days, { count: 1 })).toBe('1 day');
  });
});
