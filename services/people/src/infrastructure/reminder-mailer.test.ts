import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpReminderMailer, reminderMailerFrom } from './reminder-mailer.js';

const reminder = {
  personId: '00000000-0000-4000-8000-0000000000p1',
  workEmail: 'ada@acme.example',
  keys: ['emergency_contact', 'bank_holiday_region'],
  remindedAt: new Date('2026-09-23T09:00:00.000Z'),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpReminderMailer', () => {
  it('asks messaging for one profile reminder, counting the gaps and naming none', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response('{"messageId":"m"}', { status: 202 }));
    });

    const mailer = httpReminderMailer({
      baseUrl: 'http://messaging:4101',
      token: 'people-token',
      appOrigin: 'https://app.kithena.com',
    });
    await mailer.send('00000000-0000-4000-8000-00000000000a', reminder);

    const call = calls[0];
    if (call === undefined) throw new Error('expected a request');
    expect(call.url).toBe('http://messaging:4101/api/internal/messaging/notice');
    expect((call.init.headers as Record<string, string>)['x-internal-token']).toBe('people-token');
    const body = call.init.body as string;
    expect(JSON.parse(body)).toEqual({
      tenantId: '00000000-0000-4000-8000-00000000000a',
      email: 'ada@acme.example',
      url: 'https://app.kithena.com/people',
      dedupeKey: `${reminder.personId}/2026-09-23T09:00:00.000Z`,
      notice: { kind: 'profile_reminder', missing: 2 },
    });
    expect(body).not.toContain('emergency_contact');
  });

  it('rejects when messaging refuses, so the sweep counts it as failed', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 502 })));
    const mailer = httpReminderMailer({ baseUrl: 'http://m', token: 't', appOrigin: 'http://a' });
    await expect(mailer.send('t', reminder)).rejects.toThrow('502');
  });
});

describe('reminderMailerFrom', () => {
  it('is nothing until messaging, its token and the app origin are all configured', () => {
    expect(reminderMailerFrom({ MESSAGING_URL: 'http://m', MESSAGING_PEOPLE_TOKEN: 't' })).toBe(
      undefined,
    );
    expect(
      reminderMailerFrom({
        MESSAGING_URL: 'http://m',
        MESSAGING_PEOPLE_TOKEN: 't',
        APP_ORIGIN: 'http://a',
      }),
    ).toBeDefined();
  });
});
