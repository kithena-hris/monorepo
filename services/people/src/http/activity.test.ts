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
    ).toEqual({
      action: 'Added a field',
      subject: 'Hometown',
      detail: 'Optional. In the draft until published.',
      area: 'fields',
    });
    expect(
      settingsActivity('POST', '/v1/roles/grants', JSON.stringify({ role: 'hr', accountId: 'x' })),
    ).toEqual({
      action: 'Granted a role',
      subject: 'HR',
      area: 'roles',
    });
    expect(
      settingsActivity('PATCH', '/v1/settings', JSON.stringify({ photoAtSignup: 'required' })),
    ).toEqual({
      action: 'Changed the company settings',
      subject: 'photo at sign-up',
      detail: 'Everyone signing up must add a photo.',
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

const said = (method: string, path: string, body: unknown) =>
  settingsActivity(method, path, JSON.stringify(body));

describe('the Settings activity log, in words', () => {
  it('says what a field now is: who fills it in, who sees it, whether it is required', () => {
    expect(
      said('POST', '/v1/schema/draft/attributes', {
        editing: 'job_title',
        input: {
          label: 'Job title',
          ownership: ['hr', 'manager'],
          visibility: ['self', 'manager', 'hr'],
          requiredness: 'always',
        },
      }),
    ).toMatchObject({
      action: 'Changed a field',
      subject: 'Job title',
      detail:
        'Filled in by HR and their manager. Seen by the employee, their manager and HR. Required. In the draft until published.',
    });
  });

  it('explains sharing with the assistant, and sign-up, rather than naming a setting', () => {
    expect(said('POST', '/v1/schema/draft/attributes/manager_id/assistant', { share: true })?.detail).toMatch(
      /^The assistant can answer questions about it/,
    );
    expect(said('POST', '/v1/schema/draft/attributes/phone/signup', { ask: 'required' })?.detail).toBe(
      'Everyone signing up must fill it in.',
    );
  });

  it('names a role as people say it', () => {
    expect(said('POST', '/v1/roles/grants', { role: 'people_admin', accountId: 'x' })?.subject).toBe(
      'People administrator',
    );
  });
});
