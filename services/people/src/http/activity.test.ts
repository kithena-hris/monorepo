import { describe, expect, it } from 'vitest';

import { settingsActivity } from './activity.js';

describe('new fields from an import', () => {
  it('is not logged on approval: the run logs them once it has added them (`import/run.ts`)', () => {
    const said = settingsActivity(
      'POST',
      '/v1/imports/run',
      JSON.stringify({
        uploadId: '00000000-0000-4000-8000-0000000000f1',
        proposals: [{ include: true, field: { label: 'Cost centre' } }],
      }),
    );
    expect(said).toBeNull();
  });
});

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

  it('says what was done to an org unit', () => {
    const unit = '/v1/org-units/00000000-0000-4000-8000-0000000000a1';
    const said = (method: string, path: string, body: object) =>
      settingsActivity(method, path, JSON.stringify(body))?.action;
    expect(said('POST', '/v1/org-units', { name: 'Data', parentId: null })).toBe(
      'Added an org unit',
    );
    expect(said('PATCH', unit, { name: 'Platform' })).toBe('Renamed an org unit');
    expect(said('PATCH', unit, { parentId: null })).toBe('Moved an org unit');
    expect(said('PATCH', unit, { archived: true })).toBe('Archived an org unit');
    expect(said('PATCH', unit, { archived: false })).toBe('Restored an org unit');
  });

  it('hands over a key the path named, for the router to say as its label', () => {
    expect(
      settingsActivity(
        'PUT',
        '/v1/schema/draft/attributes/work_phone/signup',
        JSON.stringify({ ask: 'required' }),
      ),
    ).toMatchObject({ action: 'Required a field at sign-up', subjectKey: 'work_phone' });
    expect(
      settingsActivity('PUT', '/v1/schema/draft/sections/contact/order', '{"order":[]}'),
    ).toMatchObject({ subjectKey: 'contact' });
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

describe('what changed, from what', () => {
  it('names only what differs, from → to', async () => {
    const { changes } = await import('./activity.js');
    expect(
      changes(
        { 'Seen by': 'HR', Required: 'No', Name: 'Phone' },
        { 'Seen by': 'HR and their manager', Required: 'Yes', Name: 'Phone' },
      ),
    ).toBe('Seen by: HR → HR and their manager. Required: No → Yes.');
    expect(changes({ Name: 'Phone' }, { Name: 'Phone' })).toBe(null);
    expect(changes(null, { Name: 'Phone' })).toBe(null);
  });

  it('compares a field on its own routes and when edited, never when added', async () => {
    const { activityTarget } = await import('./activity.js');
    expect(activityTarget('POST', '/v1/schema/draft/attributes/phone/signup', '{}')).toEqual({ kind: 'field', key: 'phone' });
    expect(activityTarget('POST', '/v1/schema/draft/attributes', '{"editing":"phone"}')).toEqual({ kind: 'field', key: 'phone' });
    expect(activityTarget('POST', '/v1/schema/draft/attributes', '{"editing":null}')).toBe(null);
    expect(activityTarget('PATCH', '/v1/settings', '{}')).toEqual({ kind: 'settings' });
  });
});
