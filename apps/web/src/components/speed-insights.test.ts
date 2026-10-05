import { describe, expect, it } from 'vitest';

import { vitalUrl } from './speed-insights';

describe('the address a vital is filed under', () => {
  it('keeps the screen and drops anything about a person', () => {
    expect(
      vitalUrl(
        'https://acme.app.kithena.com/people/0192f3a4-5b6c-7d8e-9f01-23456789abcd/history?asOf=2026-01-01',
      ),
    ).toBe('https://acme.app.kithena.com/people/:id/history');
    expect(vitalUrl('https://acme.app.kithena.com/people/directory/list?q=Ada&filters=open')).toBe(
      'https://acme.app.kithena.com/people/directory/list',
    );
    expect(vitalUrl('https://acme.app.kithena.com/people/reports/42')).toBe(
      'https://acme.app.kithena.com/people/reports/:id',
    );
  });
});
