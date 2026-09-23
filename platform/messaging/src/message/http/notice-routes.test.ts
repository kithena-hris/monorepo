import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import { noticeRoutes } from './notice-routes.js';
import type { SendNotice, SendNoticeRequest } from '../application/send-notice.js';

const TOKEN = 'people-token-for-tests';

const body = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  email: 'ada@acme.example',
  url: 'https://acme.app.kithena.com/people',
  companyName: 'Acme Corp',
  dedupeKey: 'p/2026-09-23T09:00:00.000Z',
  notice: { kind: 'profile_reminder', missing: 2 },
};

function exchange(token: string | undefined, payload: unknown = body) {
  const request = Readable.from([
    Buffer.from(JSON.stringify(payload)),
  ]) as unknown as IncomingMessage;
  request.method = 'POST';
  request.url = '/api/internal/messaging/notice';
  request.headers = token === undefined ? {} : { 'x-internal-token': token };
  const recorded = { status: 0, body: '' };
  const response = {
    writeHead(status: number) {
      recorded.status = status;
      return response;
    },
    end(chunk?: string) {
      recorded.body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return { request, response, recorded };
}

function routes(internalToken = TOKEN) {
  const seen: SendNoticeRequest[] = [];
  const sendNotice: SendNotice = (r) => {
    seen.push(r);
    return Promise.resolve(ok({ messageId: 'msg_1' }));
  };
  return { seen, handle: noticeRoutes({ sendNotice, internalToken }) };
}

describe('the notice route', () => {
  it('accepts a profile reminder from People', async () => {
    const { seen, handle } = routes();
    const { request, response, recorded } = exchange(TOKEN);
    await handle(request, response);
    expect(recorded.status).toBe(202);
    expect(seen[0]?.notice).toEqual({ kind: 'profile_reminder', missing: 2 });
  });

  it('refuses every request when no token is configured', async () => {
    const { handle } = routes('');
    const { request, response, recorded } = exchange('');
    await handle(request, response);
    expect(recorded.status).toBe(401);
  });

  it('refuses a notice kind it has no copy for', async () => {
    const { handle } = routes();
    const { request, response, recorded } = exchange(TOKEN, {
      ...body,
      notice: { kind: 'marketing' },
    });
    await handle(request, response);
    expect(recorded.status).toBe(422);
  });

  it('refuses a notice with no company to name', async () => {
    const { handle } = routes();
    const { companyName: _omitted, ...nameless } = body;
    const { request, response, recorded } = exchange(TOKEN, nameless);
    await handle(request, response);
    expect(recorded.status).toBe(422);
  });
});
