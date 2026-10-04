import { describe, expect, it } from 'vitest';
import { AssistantAnswer } from '@kithena/contracts';
import { fixedClock } from '@kithena/domain-kit';
import { createLogger } from '@kithena/telemetry';

import { compose } from '../composition.js';
import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from '../domain/fixtures.js';

/**
 * The route, end to end through the composition, over a fake network: a
 * fake identity, fake People and Time Off, and a fake model, all answering
 * HTTP as the real ones do (assistant PRD §5, §12.4, §13.1).
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const CORRELATION = '00000000-0000-4000-8000-0000000000cc';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SETTINGS = {
  SLACK_ASSISTANT_TOKEN: 'slack-pair',
  IDENTITY_URL: 'http://identity.test',
  ASSISTANT_IDENTITY_TOKEN: 'identity-pair',
  PEOPLE_URL: 'http://people.test',
  ASSISTANT_PEOPLE_TOKEN: 'people-pair',
  TIMEOFF_URL: 'http://timeoff.test',
  ASSISTANT_TIMEOFF_TOKEN: 'timeoff-pair',
  ASSISTANT_BASE_URL: 'http://model.test/v1',
  ASSISTANT_API_KEY: 'not-a-real-key',
  TENANT_APP_BASE: 'https://{slug}.app.kithena.test',
};

const PLAN = {
  kind: 'plan',
  steps: [
    {
      id: 's1',
      capability: 'people.find',
      input: { filters: [{ key: 'department', op: 'in', values: ['engineering'] }] },
    },
    { id: 's2', capability: 'timeoff.away', within: 's1', input: { on: 'next_week' } },
  ],
  answer: { kind: 'list', step: 's2' },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The network the assistant sees: each service by its address, and every request kept. */
function network() {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fake = ((url: string, init: RequestInit = {}) => {
    seen.push({
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    });
    if (url.startsWith('http://identity.test/')) {
      return Promise.resolve(
        json({
          accountId: id(900),
          timeZone: 'Europe/Madrid',
          slug: 'acme',
          entitlements: ['module.people', 'module.timeoff'],
        }),
      );
    }
    if (url === 'http://people.test/internal/capabilities')
      return Promise.resolve(json(PEOPLE_CATALOGUE));
    if (url === 'http://timeoff.test/internal/capabilities')
      return Promise.resolve(json(TIMEOFF_CATALOGUE));
    if (url === 'http://model.test/v1/chat/completions') {
      return Promise.resolve(json({ choices: [{ message: { content: JSON.stringify(PLAN) } }] }));
    }
    if (url.endsWith('/people.find')) {
      return Promise.resolve(
        json({
          kind: 'people',
          rows: [],
          ids: [id(1), id(2)],
          total: 2,
          scope: 'everyone',
          described: 'whose department is Engineering',
          notes: [],
        }),
      );
    }
    if (url.endsWith('/timeoff.away')) {
      return Promise.resolve(
        json({
          kind: 'people',
          rows: [
            {
              personId: id(1),
              name: 'Ana Ruiz',
              detail: 'Mon 12 to Wed 14 · Vacation',
              groups: {},
            },
            { personId: id(2), name: 'Ben Ode', detail: 'Thu 15 · Baja médica', groups: {} },
          ],
          total: 2,
          scope: 'visible',
          described: 'away from Monday 12 to Sunday 18 October',
          notes: [],
        }),
      );
    }
    return Promise.resolve(json({ error: { code: 'NOT_FOUND', message: url } }, 404));
  }) as typeof fetch;
  return { fake, seen };
}

function service(settings: Record<string, string> = SETTINGS) {
  const lines: string[] = [];
  const { fake, seen } = network();
  const handle = compose(settings, {
    fetch: fake,
    logger: createLogger({ write: (line: string) => lines.push(line) }),
    clock: fixedClock('2026-10-06T10:00:00Z'),
  });
  return { handle, lines, seen };
}

const QUESTION = {
  tenantId: TENANT,
  email: 'marco.ruiz@acme.example',
  question: 'Who in Engineering is off next week?',
  channel: 'slack',
};

const post = (body: unknown, token: string | null = 'slack-pair', headers = {}) => ({
  method: 'POST',
  url: '/internal/ask',
  headers: {
    ...(token === null ? {} : { 'x-internal-token': token }),
    'x-correlation-id': CORRELATION,
    ...headers,
  },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('POST /internal/ask', () => {
  it('answers a question that needs both modules, from fake services and a fake model', async () => {
    const { handle, seen } = service();
    const { status, body } = await handle(post(QUESTION));
    expect(status).toBe(200);
    const answer = AssistantAnswer.parse(body);
    expect(answer.text).toBe(
      'I found 2 people you can see whose department is Engineering and away from Monday 12 to Sunday 18 October. You see your own team; HR sees everyone.\n• Ana Ruiz — Mon 12 to Wed 14 · Vacation\n• Ben Ode — Thu 15 · Away',
    );
    expect(answer.answered).toBe(true);
    // Every module call carried the question's correlation id and its own pair token.
    const calls = seen.filter((s) => s.url.includes('/internal/capabilities/'));
    expect(
      calls.map((c) => [c.url, c.headers['x-internal-token'], c.headers['x-correlation-id']]),
    ).toEqual([
      ['http://people.test/internal/capabilities/people.find', 'people-pair', CORRELATION],
      ['http://timeoff.test/internal/capabilities/timeoff.away', 'timeoff-pair', CORRELATION],
    ]);
  });

  it('takes the channel from the token, not from the body', async () => {
    const { handle } = service();
    // A body claiming the web would lift the chat rules; the Slack token keeps them.
    const { body } = await handle(post({ ...QUESTION, channel: 'web' }));
    expect(AssistantAnswer.parse(body).text).toContain('• Ben Ode — Thu 15 · Away');
  });

  it('logs one line per question, and no word of it', async () => {
    const { handle, lines } = service();
    await handle(post(QUESTION));
    const asked = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const line = asked.find((l) => l['msg'] === 'assistant question');
    expect(line).toMatchObject({
      tenantId: TENANT,
      channel: 'slack',
      correlationId: CORRELATION,
      outcome: 'answered',
      capabilities: ['people.find', 'timeoff.away'],
      steps: 2,
      answerKind: 'list',
    });
    const everything = lines.join('\n');
    for (const word of [
      'Engineering',
      'engineering',
      'week',
      'marco',
      'Ana Ruiz',
      'Ben Ode',
      'Vacation',
    ]) {
      expect(everything).not.toContain(word);
    }
  });

  it('sends a follow-up’s earlier questions to the model masked, and logs no word of them', async () => {
    const { handle, seen, lines } = service();
    const { status } = await handle(
      post({
        ...QUESTION,
        question: 'And in Sales?',
        earlier: ['Who is off sick today?', 'Who in Engineering is off next week?'],
      }),
    );
    expect(status).toBe(200);
    const sent = seen.find((s) => s.url === 'http://model.test/v1/chat/completions')?.body ?? '';
    const context = JSON.parse(
      (JSON.parse(sent) as { messages: { content: string }[] }).messages[1]?.content ?? '{}',
    ) as Record<string, unknown>;
    expect(context['question']).toBe('And in Sales?');
    expect(context['earlier']).toEqual(['Who is L1 today?', 'Who in Engineering is off next week?']);
    expect(sent).not.toMatch(/sick/iu);
    const everything = lines.join('\n');
    for (const word of ['Sales', 'sick', 'Engineering', 'L1']) expect(everything).not.toContain(word);
  });

  it('refuses a caller without a channel’s token, and says "not available" without a model', async () => {
    const { handle } = service();
    expect((await handle(post(QUESTION, null))).status).toBe(401);
    expect((await handle(post(QUESTION, 'people-pair'))).status).toBe(401);
    const { ASSISTANT_API_KEY: _, ...noModel } = SETTINGS;
    const { handle: unready, seen } = service(noModel);
    const { body } = await unready(post(QUESTION));
    expect(AssistantAnswer.parse(body).text).toBe('The assistant isn’t available right now.');
    expect(seen).toHaveLength(0);
  });

  it('refuses what is not a question, and knows no other route', async () => {
    const { handle } = service();
    expect((await handle(post('not json'))).status).toBe(400);
    expect((await handle(post({ ...QUESTION, question: '' }))).status).toBe(400);
    expect(
      (await handle({ method: 'GET', url: '/internal/ask', headers: {}, body: '' })).status,
    ).toBe(405);
    expect((await handle({ method: 'GET', url: '/', headers: {}, body: '' })).status).toBe(404);
    expect(await handle({ method: 'GET', url: '/health', headers: {}, body: '' })).toEqual({
      status: 200,
      body: { ok: true },
    });
  });
});
