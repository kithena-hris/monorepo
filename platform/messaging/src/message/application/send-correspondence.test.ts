import { ok } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import { renderCorrespondence } from '../domain/correspondence.js';
import type { DeliveryRecord } from './delivery-log.js';
import type { OutgoingEmail } from './email-transport.js';
import { sendCorrespondence } from './send-correspondence.js';

describe('correspondence (Recruiting PRD §12.7)', () => {
  it('escapes the words it is given and keeps the paragraphs', () => {
    const rendered = renderCorrespondence(
      'Your interview',
      'Hello Yuki,\n\nSee you <b>Thursday</b>.',
      'Acme',
    );
    expect(rendered.ok && rendered.value.html).toContain('See you &lt;b&gt;Thursday&lt;/b&gt;.');
    expect(rendered.ok && rendered.value.text).toBe(
      'Hello Yuki,\n\nSee you <b>Thursday</b>.\n\nAcme',
    );
    expect(renderCorrespondence('Two\nlines', 'x', 'Acme').ok).toBe(false);
  });

  it('sends with the company’s reply address and records the outcome, never the body', async () => {
    const sent: OutgoingEmail[] = [];
    const recorded: DeliveryRecord[] = [];
    const send = sendCorrespondence({
      transport: {
        name: 'fake',
        send: (email) => {
          sent.push(email);
          return Promise.resolve(ok({ id: 'm1' }));
        },
      },
      deliveries: {
        record: (r: DeliveryRecord) => {
          recorded.push(r);
          return Promise.resolve();
        },
      } as never,
    });
    const result = await send({
      tenantId: '00000000-0000-4000-8000-000000000001',
      to: 'yuki@example.com',
      subject: 'Hello',
      text: 'Body',
      replyTo: 'jobs@acme.example',
      companyName: 'Acme',
      dedupeKey: 'message:1',
    });
    expect(result.ok).toBe(true);
    expect(sent[0]?.replyTo).toBe('jobs@acme.example');
    expect(recorded[0]).toMatchObject({ kind: 'correspondence', status: 'accepted' });
    expect(JSON.stringify(recorded[0])).not.toContain('Body');
  });
});
