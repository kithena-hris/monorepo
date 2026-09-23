import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpWebhookAlertMailer } from './alert-mailer.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const acme = { name: 'Acme Corp', origin: 'https://acme.app.kithena.com' };

const disabled = {
  endpointId: '00000000-0000-4000-8000-0000000000e1',
  url: 'https://hooks.example.com/people?token=receiver-secret',
  alertEmail: 'integrations@acme.example',
  lastResponse: 503,
};

describe('httpWebhookAlertMailer', () => {
  it('asks messaging for one notice naming the host, never the path or query', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return Promise.resolve(new Response('{}', { status: 202 }));
    });

    const mailer = httpWebhookAlertMailer({ baseUrl: 'http://messaging:4101', token: 't' });
    await mailer.send('00000000-0000-4000-8000-00000000000a', acme, disabled);

    const body = bodies[0] ?? '';
    expect(JSON.parse(body)).toMatchObject({
      email: 'integrations@acme.example',
      url: 'https://acme.app.kithena.com/people',
      companyName: 'Acme Corp',
      notice: { kind: 'webhook_disabled', host: 'hooks.example.com' },
    });
    expect(body).not.toContain('receiver-secret');
  });

  it('sends nothing when the endpoint names no alert address', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const mailer = httpWebhookAlertMailer({ baseUrl: 'http://m', token: 't' });
    await mailer.send('t', acme, { ...disabled, alertEmail: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});
