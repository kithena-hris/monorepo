import { afterEach, describe, expect, it } from 'vitest';

import { interpolate, setTranslate, translator } from './i18n';

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
      ns === 'people' && key === 'greeting' ? interpolate('Hallo {{name}}', vars) : fallback,
    );
    expect(translator('people')('greeting', 'Hello {{name}}', { name: 'Ada' })).toBe('Hallo Ada');
    expect(translator('reach')('greeting', 'Hello')).toBe('Hello');
  });

  it('leaves a placeholder with no value as it is', () => {
    expect(interpolate('{{a}} and {{b}}', { a: 1 })).toBe('1 and {{b}}');
  });
});
