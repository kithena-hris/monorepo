import { describe, expect, it } from 'vitest';

import { settingsActivity } from './activity.js';

describe('the settings activity log’s words', () => {
  it('describes a settings command from its path and what was typed', () => {
    expect(
      settingsActivity(
        'POST',
        '/v1/schema/draft/attributes',
        JSON.stringify({ input: { label: 'Hometown' }, editing: null }),
      ),
    ).toEqual({ action: 'Added a field', subject: 'Hometown', area: 'fields' });
    expect(
      settingsActivity('POST', '/v1/roles/grants', JSON.stringify({ role: 'hr', accountId: 'x' })),
    ).toEqual({
      action: 'Granted a role',
      subject: 'hr',
      area: 'roles',
    });
    expect(
      settingsActivity('PATCH', '/v1/settings', JSON.stringify({ photoAtSignup: 'required' })),
    ).toEqual({
      action: 'Changed the company settings',
      subject: 'photo at sign-up',
      area: 'organisation',
    });
  });

  it('never logs a read, a person’s record, or a webhook’s URL', () => {
    expect(settingsActivity('GET', '/v1/settings', '')).toBeNull();
    expect(settingsActivity('PATCH', '/v1/people/1', '{}')).toBeNull();
    const webhook = settingsActivity(
      'POST',
      '/v1/webhooks/endpoints',
      JSON.stringify({ url: 'https://x.test/secret' }),
    );
    expect(webhook).toEqual({ action: 'Added a webhook', area: 'integrations' });
  });
});
