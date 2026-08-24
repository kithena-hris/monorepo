import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { err, failure, ok } from '@kithena/domain-kit';

import { messagingRoutes } from './messaging-routes.js';
import type { SendInvitation, SendRefusal } from '../application/send-invitation.js';

const TOKEN = 'internal-token-for-tests';

const body = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  companyName: 'Acme Corp',
  email: 'ada@acme.example',
  enrolUrl: 'https://auth.app.kithena.com/enrol?tenant=acme&token=abc',
  expiresAt: '2026-08-27T09:05:00.000Z',
};

/**
 * A request and a response, without a socket.
 *
 * `IncomingMessage` is a readable stream and the route reads it as one, so a
 * `Readable` carrying the body is the honest fake. The response records rather
 * than writes; nothing here needs a port to be listening.
 */
function exchange(over: {
  method?: string;
  url?: string;
  token?: string | undefined;
  payload?: unknown;
}) {
  const request = Readable.from([
    Buffer.from(JSON.stringify(over.payload ?? body)),
  ]) as unknown as IncomingMessage;
  request.method = over.method ?? 'POST';
  request.url = over.url ?? '/api/internal/messaging/invitation';
  request.headers = over.token === undefined ? {} : { 'x-internal-token': over.token };

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

const accepting: SendInvitation = () => Promise.resolve(ok({ messageId: 'msg_1' }));

const refusingWith =
  (reason: SendRefusal): SendInvitation =>
  () =>
    Promise.resolve(err(failure('INVITATION_NOT_SENT', 'no', [reason])));

const routes = (sendInvitation: SendInvitation = accepting) =>
  messagingRoutes({ sendInvitation, internalToken: TOKEN, transportName: 'recorder' });

describe('the invitation route', () => {
  it('accepts a well-formed request and reports the provider id', async () => {
    const { request, response, recorded } = exchange({ token: TOKEN });

    await expect(routes()(request, response)).resolves.toBe(true);

    // 202, not 201: nothing was created, and handing a message to a provider
    // is not the same as it arriving.
    expect(recorded.status).toBe(202);
    expect(JSON.parse(recorded.body)).toEqual({ messageId: 'msg_1' });
  });

  it('refuses a caller with no token, before reading the body', async () => {
    const { request, response, recorded } = exchange({});
    await routes()(request, response);
    expect(recorded.status).toBe(401);
  });

  it('refuses a caller with the wrong token', async () => {
    const { request, response, recorded } = exchange({ token: 'not-the-token--------' });
    await routes()(request, response);
    expect(recorded.status).toBe(401);
  });

  it('refuses a method that is not POST', async () => {
    const { request, response, recorded } = exchange({ method: 'GET', token: TOKEN });
    await routes()(request, response);
    expect(recorded.status).toBe(405);
  });

  it('names the fields it could not read', async () => {
    const { request, response, recorded } = exchange({
      token: TOKEN,
      payload: { ...body, expiresAt: 'soon', tenantId: 'not-a-uuid' },
    });

    await routes()(request, response);

    expect(recorded.status).toBe(422);
    const parsed = JSON.parse(recorded.body) as { fields: string[] };
    expect(parsed.fields.toSorted()).toEqual(['expiresAt', 'tenantId']);
  });

  it('separates a provider failure from a request we would never send', async () => {
    // The distinction the caller acts on: 502 is worth retrying, 422 never is.
    const provider = exchange({ token: TOKEN });
    await routes(refusingWith('provider'))(provider.request, provider.response);
    expect(provider.recorded.status).toBe(502);

    const link = exchange({ token: TOKEN });
    await routes(refusingWith('untrusted_link'))(link.request, link.response);
    expect(link.recorded.status).toBe(422);
  });

  it('passes on a path it does not own', async () => {
    const { request, response } = exchange({ url: '/api/internal/something-else', token: TOKEN });
    await expect(routes()(request, response)).resolves.toBe(false);
  });
});

describe('the health route', () => {
  it('answers without a token, and says which transport is composed', async () => {
    // A deploy needs something to curl before it promotes. Putting the shared
    // secret in a smoke test is how the shared secret reaches a workflow log.
    const { request, response, recorded } = exchange({ method: 'GET', url: '/healthz' });

    await expect(routes()(request, response)).resolves.toBe(true);

    expect(recorded.status).toBe(200);
    expect(JSON.parse(recorded.body)).toEqual({ status: 'ok', transport: 'recorder' });
  });
});
