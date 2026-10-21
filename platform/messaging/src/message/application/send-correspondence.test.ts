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

  it('draws times by day, facts and a button in the company’s colour, escaping every value', () => {
    const rendered = renderCorrespondence('Your times', 'Thank you.', 'Acme', {
      heading: 'We have your <times>',
      times: {
        title: 'Your 2 times',
        days: [{ day: 'Tuesday 4 November', times: ['10:00 – 10:45', '<script>'] }],
      },
      facts: [{ label: 'Where', value: 'Google Meet' }],
      action: { label: 'Change my times', href: 'https://jobs.example/schedule/acme#t' },
      secondary: { label: 'Bad', href: 'javascript:alert(1)' },
      themeId: 'emerald',
    });
    if (!rendered.ok) throw new Error('not rendered');
    const { html, text } = rendered.value;
    expect(html).toContain('We have your &lt;times&gt;');
    expect(html).toContain('Tuesday 4 November');
    expect(html).toContain('10:00 – 10:45');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://jobs.example/schedule/acme#t"');
    // A link that is not https is dropped, not rendered.
    expect(html).not.toContain('javascript:');
    expect(text).toContain('Tuesday 4 November: 10:00 – 10:45');
    expect(text).toContain('Change my times:\nhttps://jobs.example/schedule/acme#t');
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

  it('carries an invitation it is given, and records nothing of it', async () => {
    const sent: OutgoingEmail[] = [];
    const recorded: DeliveryRecord[] = [];
    const send = sendCorrespondence({
      transport: {
        name: 'fake',
        send: (email) => {
          sent.push(email);
          return Promise.resolve(ok({ id: 'm2' }));
        },
      },
      deliveries: {
        record: (r: DeliveryRecord) => {
          recorded.push(r);
          return Promise.resolve();
        },
      } as never,
    });
    const invite = {
      filename: 'invite.ics',
      base64: Buffer.from('BEGIN:VCALENDAR').toString('base64'),
    };
    await send({
      tenantId: '00000000-0000-4000-8000-000000000001',
      to: 'ada@example.com',
      subject: 'Invitation',
      text: 'Body',
      replyTo: null,
      companyName: 'Acme',
      dedupeKey: 'invite:1',
      attachments: [invite],
    });
    expect(sent[0]?.attachments).toEqual([invite]);
    expect(JSON.stringify(recorded[0])).not.toContain('invite.ics');
  });
});
