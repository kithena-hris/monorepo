import { afterEach, describe, expect, it } from 'vitest';

import { englishOf, interpolate, setTranslate, translator } from './i18n';

describe('i18n', () => {
  afterEach(() => {
    setTranslate(null);
  });

  it('shows the English, filled in, until an app looks keys up', () => {
    const t = translator('reach');
    expect(t('greeting', 'Hello {{name}}', { name: 'Ada' })).toBe('Hello Ada');
  });

  it('asks the app, by namespace and key', () => {
    setTranslate((ns, key, fallback, vars) =>
      ns === 'people' && key === 'greeting'
        ? interpolate('Hallo {{name}}', vars)
        : englishOf(fallback, vars),
    );
    expect(translator('people')('greeting', 'Hello {{name}}', { name: 'Ada' })).toBe('Hallo Ada');
    expect(translator('reach')('greeting', 'Hello')).toBe('Hello');
  });

  it('picks the English form for a count until a translation is there', () => {
    const t = translator('reach');
    const days = { one: '{{count}} day', other: '{{count}} days' };
    expect(t('days', days, { count: 1 })).toBe('1 day');
    expect(t('days', days, { count: 0 })).toBe('0 days');
    expect(t('days', days, { count: 5 })).toBe('5 days');
  });

  it('leaves a placeholder with no value as it is', () => {
    expect(interpolate('{{a}} and {{b}}', { a: 1 })).toBe('1 and {{b}}');
  });
});
