import { describe, expect, it } from 'vitest';

import { inReaderLanguage, readerLanguage } from './reader-language.js';

describe('the reader’s language, held for a request', () => {
  it('is the language the headers name, through every await of the request', async () => {
    const seen = await inReaderLanguage({ 'x-kithena-language': 'de' }, async () => {
      await Promise.resolve();
      return readerLanguage();
    });
    expect(seen).toBe('de');
    expect(readerLanguage()).toBeNull();
  });

  it('is nothing for no header or one that is not a language tag', () => {
    expect(inReaderLanguage({}, readerLanguage)).toBeNull();
    expect(inReaderLanguage({ 'x-kithena-language': '../de' }, readerLanguage)).toBeNull();
    expect(inReaderLanguage({ 'x-kithena-language': 'en-GB' }, readerLanguage)).toBe('en-GB');
  });
});
