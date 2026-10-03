import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantId } from '@kithena/contracts';

import { httpNudgeMailer } from './messaging.js';

const TENANT = TenantId.parse('11111111-1111-7111-8111-111111111111');
const message = {
  email: 'adam@acme.example',
  url: 'https://acme.app.kithena.com/time-off/overview',
  companyName: 'Acme Corp',
  dedupeKey: 'nudge/p/2026-10-15',
  heading: 'Adam, you haven’t had a day off since June',
  lede: 'You have 25 days left this year.',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the nudge mailer (TOF-098)', () => {
  it('asks messaging for a rest_nudge notice with Time Off’s own secret', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 202 })));
    vi.stubGlobal('fetch', fetch);
    await httpNudgeMailer({ baseUrl: 'http://messaging:4100', token: 'pair-secret' }).send(
      TENANT,
      message,
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://messaging:4100/api/internal/messaging/notice');
    expect(init.headers).toMatchObject({ 'x-internal-token': 'pair-secret' });
    expect(JSON.parse(init.body as string)).toEqual({
      tenantId: TENANT,
      email: message.email,
      url: message.url,
      companyName: 'Acme Corp',
      dedupeKey: message.dedupeKey,
      notice: { kind: 'rest_nudge', heading: message.heading, lede: message.lede },
    });
  });

  it('rejects when messaging refuses, so the nudge is counted as failed', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 422 })));
    await expect(
      httpNudgeMailer({ baseUrl: 'http://messaging:4100', token: 't' }).send(TENANT, message),
    ).rejects.toThrow('422');
  });
});
