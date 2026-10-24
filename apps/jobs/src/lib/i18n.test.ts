import { describe, expect, it } from 'vitest';

import { languageOf } from './i18n';

describe('languageOf', () => {
  it('keeps a chosen language over the browser’s', () => {
    expect(languageOf('fr', 'de-DE,de;q=0.9')).toBe('fr');
  });
  it('reads the browser’s first language Kithena speaks', () => {
    expect(languageOf(undefined, 'ja;q=1,de-AT;q=0.8,en;q=0.5')).toBe('de');
    expect(languageOf(null, 'en-GB,en;q=0.9')).toBe('en-GB');
    expect(languageOf(null, 'ta-IN')).toBe('ta');
  });
  it('falls back to US English', () => {
    expect(languageOf('xx', 'ja,zh;q=0.8')).toBe('en-US');
    expect(languageOf(null, null)).toBe('en-US');
  });
});
