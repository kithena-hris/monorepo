import { afterEach, describe, expect, it } from 'vitest';

import { dateFormat, formatList, formatNumber, setLocale } from './intl';

describe('intl', () => {
  afterEach(() => {
    setLocale(null);
  });

  it('formats in the language the app says, each time it formats', () => {
    const month = dateFormat({ month: 'long', timeZone: 'UTC' });
    const october = Date.UTC(2026, 9, 24);
    expect(month.format(october)).toBe('October');
    setLocale(() => 'de');
    expect(month.format(october)).toBe('Oktober');
    expect(formatNumber(1234.5)).toBe('1.234,5');
    expect(formatList(['Ana', 'Ben', 'Cleo'])).toBe('Ana, Ben und Cleo');
    expect(formatList(['Ana', 'Ben'], 'or')).toBe('Ana oder Ben');
  });
});
