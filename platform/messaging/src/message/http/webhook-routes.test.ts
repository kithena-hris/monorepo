import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { err, failure, ok } from '@kithena/domain-kit';

import { eventFrom, webhookRoutes } from './webhook-routes.js';
import type { SettleDelivery } from '../application/settle-delivery.js';

const SIGNED = {
  'svix-id': 'msg_2c',
  'svix-timestamp': '1787524249',
  'svix-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};

const payload = JSON.stringify({ type: 'email.bounced', data: { email_id: 'msg_1' } });

function exchange(over: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
}) {
  const request = Readable.from([Buffer.from(over.body ?? payload)]) as unknown as IncomingMessage;
  request.method = over.method ?? 'POST';
  request.url = over.url ?? '/api/webhooks/resend';
  request.headers = over.headers ?? SIGNED;

  const recorded = { status: 0, body: '' };
  const response = {
    writeHead(status: number) {
      recorded.status = status;
      return response;
    },
    end(chunk?: string) {
      recorded.body = chunk ?? '';
    },
    headersSent: false,
  } as unknown as ServerResponse;

  return { request, response, recorded };
}

const settled: SettleDelivery = () => Promise.resolve(ok('bounced'));
const unknown: SettleDelivery = () =>
  Promise.resolve(err(failure('MESSAGE_UNKNOWN', 'no such message')));

const routes = (over: Partial<Parameters<typeof webhookRoutes>[0]> = {}) =>
  webhookRoutes({
    settle: settled,
    verify: ({ payload: raw }) => JSON.parse(raw) as unknown,
    ...over,
  });

describe('the webhook route', () => {
  it('settles a verified bounce', async () => {
    const { request, response, recorded } = exchange({});

    await expect(routes()(request, response)).resolves.toBe(true);

    expect(recorded.status).toBe(200);
    expect(JSON.parse(recorded.body)).toEqual({ handled: true, status: 'bounced' });
  });

  it('refuses a signature it cannot verify, and says nothing about why', async () => {
    // A verifier distinguishes a bad signature from a stale timestamp. Saying
    // which is a hint to whoever is guessing.
    const reasons: string[] = [];
    const { request, response, recorded } = exchange({});

    await routes({
      verify: () => {
        throw new Error('no match');
      },
      onRefusal: (reason) => reasons.push(reason),
    })(request, response);

    expect(recorded.status).toBe(401);
    expect(recorded.body).toBe('');
    expect(reasons).toEqual(['signature']);
  });

  it('refuses a request with no signature headers at all', async () => {
    const { request, response, recorded } = exchange({ headers: {} });
    await routes()(request, response);
    expect(recorded.status).toBe(401);
  });

  it('refuses a repeated signature header', async () => {
    // An array means the header arrived twice, which is a caller choosing which
    // one gets verified.
    const { request, response, recorded } = exchange({
      headers: { ...SIGNED, 'svix-signature': ['a', 'b'] },
    });
    await routes()(request, response);
    expect(recorded.status).toBe(401);
  });

  it('refuses everything when no secret is configured', async () => {
    // The safe direction. An unverified webhook endpoint is an open API for
    // marking any message bounced or complained, and the second is how somebody
    // gets a customer's sending domain suppressed.
    const { request, response, recorded } = exchange({});
    await routes({ verify: undefined })(request, response);
    expect(recorded.status).toBe(503);
  });

  it('verifies the exact bytes that arrived', async () => {
    // The signature is over what was sent. A parse-then-re-serialise round trip
    // moves key order, whitespace and number formatting, and the signature no
    // longer matches.
    const raw = '{"type":"email.bounced",  "data":{"email_id":"msg_1"}}';
    let seen = '';
    const { request, response } = exchange({ body: raw });

    await routes({
      verify: ({ payload: bytes }) => {
        seen = bytes;
        return JSON.parse(bytes) as unknown;
      },
    })(request, response);

    expect(seen).toBe(raw);
  });

  it('answers 200 to an event it will never handle', async () => {
    // Not 400. Svix retries a 4xx for hours before marking the endpoint
    // unhealthy, and a shape we do not recognise is not something retrying
    // fixes.
    const { request, response, recorded } = exchange({ body: '{"type":"noise"}' });
    await routes()(request, response);
    expect(recorded.status).toBe(200);
  });

  it('answers 200 to an event about a message it has never heard of', async () => {
    const { request, response, recorded } = exchange({});
    await routes({ settle: unknown })(request, response);

    expect(recorded.status).toBe(200);
    expect(JSON.parse(recorded.body)).toEqual({ handled: false, reason: 'MESSAGE_UNKNOWN' });
  });

  it('refuses a method that is not POST', async () => {
    const { request, response, recorded } = exchange({ method: 'GET' });
    await routes()(request, response);
    expect(recorded.status).toBe(405);
  });

  it('passes on a path it does not own', async () => {
    const { request, response } = exchange({ url: '/healthz' });
    await expect(routes()(request, response)).resolves.toBe(false);
  });
});

describe('eventFrom', () => {
  it('reads the two fields it acts on', () => {
    expect(eventFrom({ type: 'email.bounced', data: { email_id: 'msg_1' } })).toEqual({
      type: 'email.bounced',
      messageId: 'msg_1',
    });
  });

  it.each([
    ['no data', { type: 'email.bounced' }],
    ['no id', { type: 'email.bounced', data: {} }],
    ['an empty id', { type: 'email.bounced', data: { email_id: '' } }],
    ['no type', { data: { email_id: 'msg_1' } }],
    ['not an object', 'email.bounced'],
    ['null', null],
  ])('refuses %s', (_case, given) => {
    // An event with no id is one this service must not act on at all: every
    // update is keyed by it, and a missing one would match nothing or, worse,
    // everything.
    expect(eventFrom(given)).toBeNull();
  });
});
