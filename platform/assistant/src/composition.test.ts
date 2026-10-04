import { describe, expect, it } from 'vitest';
import { AssistantAnswer } from '@kithena/contracts';
import { createLogger } from '@kithena/telemetry';

import { compose } from './composition.js';
import { UNAVAILABLE } from './domain/answer.js';

const quiet = { logger: createLogger({ write: () => undefined }) };
const request = (method: string, url: string, headers: Record<string, string> = {}, body = '') => ({
  method,
  url,
  headers,
  body,
});

const QUESTION = JSON.stringify({
  tenantId: '00000000-0000-4000-8000-00000000000a',
  email: 'ada@acme.example',
  question: 'Who is off today?',
  channel: 'slack',
});

describe('the assistant with nothing configured', () => {
  const route = compose({}, quiet);

  it('answers its health check', async () => {
    expect(await route(request('GET', '/health'))).toEqual({ status: 200, body: { ok: true } });
  });

  it('lets no caller in: no channel has a token', async () => {
    const asked = await route(
      request('POST', '/internal/ask', { 'x-internal-token': '' }, QUESTION),
    );
    expect(asked.status).toBe(401);
  });

  it('knows no other route', async () => {
    expect((await route(request('GET', '/'))).status).toBe(404);
  });
});

describe('the assistant with a channel and nothing else', () => {
  it('answers every question with "not available", in the answer’s own shape', async () => {
    const route = compose({ SLACK_ASSISTANT_TOKEN: 'slack-pair' }, quiet);
    const { status, body } = await route(
      request('POST', '/internal/ask', { 'x-internal-token': 'slack-pair' }, QUESTION),
    );
    expect(status).toBe(200);
    expect(AssistantAnswer.parse(body)).toEqual({
      text: UNAVAILABLE,
      understood: 'Not sent to the assistant',
      people: [],
      answered: false,
    });
  });
});
