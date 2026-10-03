import { describe, expect, it } from 'vitest';

import {
  deliver,
  nextAttempt,
  signatureHeader,
  verifySignature,
  webhookRequest,
} from './webhooks.js';

const approved = {
  eventId: '01890000-0000-7000-8000-000000000001',
  eventName: 'timeoff.request.approved',
  eventVersion: 1,
  payload: { requestId: '01890000-0000-7000-8000-0000000000aa' },
};
const endpoint = {
  id: 'e1',
  url: 'https://hooks.example.com/timeoff',
  secrets: ['live-secret'],
  events: ['timeoff.request.approved'],
};

describe('signed webhooks', () => {
  it('signs each published event so the receiver can verify it', async () => {
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    const results = await deliver(
      approved,
      [endpoint, { ...endpoint, id: 'e2', events: ['timeoff.period.closed'] }],
      (url, request) => {
        sent.push({ url, ...request });
        return Promise.resolve({ status: 204 });
      },
      () => 'd1',
    );
    expect(results).toEqual([{ endpointId: 'e1', status: 204 }]);
    const [only] = sent;
    expect(only?.headers['kithena-event-id']).toBe(approved.eventId);
    expect(JSON.parse(only?.body ?? '')).toEqual(approved);
    expect(
      verifySignature(only?.body ?? '', only?.headers['kithena-signature'] ?? '', 'live-secret'),
    ).toBe(true);
    expect(
      verifySignature(
        `${only?.body ?? ''} `,
        only?.headers['kithena-signature'] ?? '',
        'live-secret',
      ),
    ).toBe(false);
    expect(
      verifySignature(only?.body ?? '', only?.headers['kithena-signature'] ?? '', 'another'),
    ).toBe(false);
  });

  it('signs with both secrets while a rotation overlaps', () => {
    const header = signatureHeader('{}', ['new', 'old']);
    expect(verifySignature('{}', header, 'new')).toBe(true);
    expect(verifySignature('{}', header, 'old')).toBe(true);
  });

  it('sends nothing Time Off does not publish, whatever an endpoint asks for', () => {
    const everything = { ...endpoint, events: ['*'] };
    expect(webhookRequest(approved, everything, 'd1')).not.toBeNull();
    expect(
      webhookRequest({ ...approved, eventName: 'people.person.hired' }, everything, 'd2'),
    ).toBeNull();
  });

  it('backs off from 30 seconds and gives up after a day', () => {
    const first = new Date('2030-01-01T00:00:00.000Z');
    expect(nextAttempt(first, 1, first)?.toISOString()).toBe('2030-01-01T00:00:30.000Z');
    expect(nextAttempt(first, 21, new Date('2030-01-02T00:00:00.000Z'))).toBeNull();
  });
});
