import { describe, expect, it } from 'vitest';

import { light } from './palette.js';
import { renderNotice } from './notice.js';

const PROFILE = 'https://app.kithena.com/people';

describe('renderNotice: webhook_disabled', () => {
  it('names the host and nothing after it', () => {
    const result = renderNotice(
      { kind: 'webhook_disabled', host: 'hooks.example.com' },
      'https://app.kithena.com/people',
    );
    if (!result.ok) throw new Error('expected a message');
    expect(result.value.subject).toBe('A People webhook was turned off');
    expect(result.value.text).toContain('hooks.example.com');
    expect(result.value.html).toContain(light['accent-solid']);
  });

  it('refuses anything that is not a bare hostname', () => {
    for (const host of ['hooks.example.com/path?token=x', '<b>x</b>', '', 'a b']) {
      expect(
        renderNotice({ kind: 'webhook_disabled', host }, 'https://app.kithena.com/people').ok,
      ).toBe(false);
    }
  });
});

describe('renderNotice: profile_reminder', () => {
  it('counts what is missing and links to the profile, in both bodies', () => {
    const result = renderNotice({ kind: 'profile_reminder', missing: 3 }, PROFILE);
    if (!result.ok) throw new Error('expected a message');
    const { subject, html, text } = result.value;

    expect(subject).toBe('A few details are missing from your profile');
    expect(html).toContain('3 details');
    expect(text).toContain('3 details');
    expect(html).toContain(`href="${PROFILE}"`);
    expect(text).toContain(PROFILE);
    // Reach, resolved: the button is accent-solid on fg-on-accent.
    expect(html).toContain(light['accent-solid']);
    expect(html).toContain(light['fg-on-accent']);
  });

  it('says "one detail" rather than "1 details"', () => {
    const result = renderNotice({ kind: 'profile_reminder', missing: 1 }, PROFILE);
    expect(result.ok && result.value.text).toContain('one detail');
  });

  it('refuses a count that is not a positive whole number', () => {
    for (const missing of [0, -1, 1.5, Number.NaN, 5000]) {
      expect(renderNotice({ kind: 'profile_reminder', missing }, PROFILE).ok).toBe(false);
    }
  });

  it('refuses a link that is not http(s)', () => {
    expect(renderNotice({ kind: 'profile_reminder', missing: 2 }, 'javascript:alert(1)').ok).toBe(
      false,
    );
  });
});
