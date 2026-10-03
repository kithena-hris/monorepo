import { describe, expect, it } from 'vitest';
import { AssistantAnswer } from '@kithena/contracts';

import { compose, UNAVAILABLE } from './composition.js';

const request = (method: string, url: string) => ({ method, url });

describe('the assistant with nothing configured', () => {
  const route = compose({});

  it('answers its health check', async () => {
    expect(await route(request('GET', '/health'))).toEqual({ status: 200, body: { ok: true } });
  });

  it('answers every question with "not available", in the answer’s own shape', async () => {
    const { status, body } = await route(request('POST', '/internal/ask'));
    expect(status).toBe(200);
    expect(AssistantAnswer.parse(body)).toEqual({
      text: UNAVAILABLE,
      understood: 'Not sent to the assistant',
      people: [],
      answered: false,
    });
  });

  it('knows no other route', async () => {
    expect((await route(request('GET', '/internal/ask'))).status).toBe(404);
    expect((await route(request('GET', '/'))).status).toBe(404);
  });
});
