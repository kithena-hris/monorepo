import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import type { EmailTransport, OutgoingEmail } from './email-transport.js';
import type { DeliveryLog, DeliveryRecord } from './delivery-log.js';
import { sendNotice } from './send-notice.js';

const APP = 'https://app.kithena.com';
const request = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  email: 'Ada@Acme.Example',
  url: `${APP}/people`,
  notice: { kind: 'profile_reminder', missing: 4 } as const,
  dedupeKey: 'person-1/2026-09-23T09:00:00.000Z',
};

function harness() {
  const sent: OutgoingEmail[] = [];
  const recorded: DeliveryRecord[] = [];
  const transport: EmailTransport = {
    name: 'recorder',
    send: (email) => {
      sent.push(email);
      return Promise.resolve(ok({ id: 'msg_1' }));
    },
  };
  const deliveries: DeliveryLog = {
    record: (entry) => {
      recorded.push(entry);
      return Promise.resolve('row-1');
    },
    settle: () => Promise.resolve(true),
  };
  return { sent, recorded, send: sendNotice({ transport, deliveries, trustedLinkOrigin: APP }) };
}

describe('sendNotice', () => {
  it('sends the reminder and records the outcome under its own kind', async () => {
    const h = harness();
    expect((await h.send(request)).ok).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.to).toBe('ada@acme.example');
    expect(h.recorded).toEqual([
      {
        tenantId: request.tenantId,
        kind: 'profile_reminder',
        to: 'ada@acme.example',
        provider: 'recorder',
        providerMessageId: 'msg_1',
        status: 'accepted',
        reason: null,
      },
    ]);
  });

  it('records no body, subject or link', async () => {
    const h = harness();
    await h.send(request);
    const stored = JSON.stringify(h.recorded);
    const email = h.sent[0];
    if (email === undefined) throw new Error('expected a send');
    expect(stored).not.toContain(request.url);
    expect(stored).not.toContain(email.subject);
    expect(stored).not.toContain('details');
  });

  it('keys a retry of the same claim to the same message, and hides what the key names', async () => {
    const h = harness();
    await h.send(request);
    await h.send(request);
    await h.send({ ...request, dedupeKey: 'person-1/2026-09-30T09:00:00.000Z' });
    const keys = h.sent.map((e) => e.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]).toMatch(/^profile_reminder\//);
    expect(keys[0]).not.toContain('person-1');
  });

  it('refuses a link outside the app origin and sends nothing', async () => {
    const h = harness();
    const result = await h.send({ ...request, url: 'https://evil.example/people' });
    expect(result.ok ? null : result.error.path?.[0]).toBe('untrusted_link');
    expect(h.sent).toHaveLength(0);
    expect(h.recorded).toHaveLength(0);
  });
});
