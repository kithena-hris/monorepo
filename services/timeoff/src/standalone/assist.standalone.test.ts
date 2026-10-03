import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@kithena/domain-kit';

import type { Caller } from '../application/ports.js';
import { ADA_ACCOUNT, caller, people, world } from '../application/testing/world.js';
import { assistFrom } from '../composition.js';
import type { CallerFrom } from '../http/caller.js';
import type { RestResponse } from '../http/rest.js';
import { timeoffServer } from '../http/server.js';

/**
 * PRD §14.1 with People absent: every AI feature answers whole with
 * `TYPESAFE_API_KEY` and `ASSISTANT_API_KEY` unset, on Time Off's rules and
 * templates, and with them set, through the ports. CI runs this file both
 * ways (`.github/workflows/ci.yml`). Set, `fetch` plays TypeSafe (the first
 * option of every question) and the assistant (a line for every key), and
 * anything else it is asked for fails the test, so nothing reaches a real
 * service.
 */

const keyed =
  (process.env['TYPESAFE_API_KEY'] ?? '').trim() !== '' &&
  (process.env['ASSISTANT_API_KEY'] ?? '').trim() !== '';

type Who = 'adam' | 'marco' | 'ada';
const callers: Record<Who, Caller> = {
  adam: caller(people.adam),
  marco: caller(people.marco),
  ada: caller(null, ADA_ACCOUNT),
};
const callerFrom: CallerFrom = (request) => ok(callers[request.headers['x-as'] as Who]);

const elsewhere: string[] = [];
const asked = { typesafe: 0, assistant: 0 };

/** TypeSafe: the first option offered for every question. */
function typesafe(body: string): Response {
  asked.typesafe += 1;
  const { questions } = JSON.parse(body) as {
    questions: Record<string, { criteria: Record<string, string> }>;
  };
  const answers = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [
      id,
      { type: 'choice', choice: Object.keys(q.criteria)[0], confidence: 0.9 },
    ]),
  );
  return new Response(JSON.stringify({ answers }), { status: 200 });
}

/** The assistant: a plain line for every key it was asked for. */
function assistant(body: string): Response {
  asked.assistant += 1;
  const { messages } = JSON.parse(body) as { messages: { content: string }[] };
  const { lines } = JSON.parse(messages[1]?.content ?? '{}') as { lines?: Record<string, string> };
  const content = JSON.stringify(
    Object.fromEntries(Object.keys(lines ?? {}).map((k) => [k, 'Written by the assistant.'])),
  );
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

beforeEach(() => {
  elsewhere.length = 0;
  asked.typesafe = 0;
  asked.assistant = 0;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.startsWith('https://api.typesafe.ai/')) return Promise.resolve(typesafe(body));
    if (url.startsWith('https://api.groq.com/')) return Promise.resolve(assistant(body));
    elsewhere.push(url);
    return Promise.reject(new Error(`the standalone suite reached for the network: ${url}`));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(elsewhere).toEqual([]);
});

function boot() {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const server = timeoffServer({ ...app.deps, ...assistFrom(process.env), callerFrom });
  return async (who: Who, url: string): Promise<RestResponse> => {
    const answer = await server.rest({ method: 'GET', url, headers: { 'x-as': who }, body: '' });
    if (answer === null) throw new Error(`${url} is not a REST route`);
    return answer;
  };
}

/** Every `{ text, ai }` anywhere in an answer. */
function lines(value: unknown): { text: string; ai: boolean }[] {
  if (Array.isArray(value)) return value.flatMap(lines);
  if (value === null || typeof value !== 'object') return [];
  const v = value as Record<string, unknown>;
  const own =
    typeof v['text'] === 'string' && typeof v['ai'] === 'boolean'
      ? [v as { text: string; ai: boolean }]
      : [];
  return [...own, ...Object.values(v).flatMap(lines)];
}

describe(`the AI features with the keys ${keyed ? 'set' : 'unset'}`, () => {
  it('answers every screen whole, written by the model only when there is one', async () => {
    const get = boot();
    const screens = await Promise.all([
      get('adam', '/v1/timeoff/overview'),
      get(
        'adam',
        `/v1/timeoff/describe?sentence=${encodeURIComponent('a week off in October next to a holiday')}`,
      ),
      get('marco', '/v1/timeoff/approvals?tab=waiting'),
      get('marco', '/v1/timeoff/team-right-now'),
      get(
        'ada',
        `/v1/timeoff/settings/policies/read?text=${encodeURIComponent('Everyone gets 25 days a year.')}`,
      ),
      get(
        'ada',
        `/v1/timeoff/settings/holidays/2028/draft?layerKey=madrid&source=${encodeURIComponent('15 de mayo San Isidro')}`,
      ),
    ]);
    for (const answer of screens) expect(answer.status).toBe(200);
    const written = screens.flatMap((s) => lines(s.body));
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((w) => w.text.trim() !== '')).toBe(true);
    if (keyed) {
      expect(asked.typesafe).toBeGreaterThan(0);
      expect(asked.assistant).toBeGreaterThan(0);
      expect(written.some((w) => w.ai)).toBe(true);
      expect((screens[1].body as { understood: { ai: boolean } }).understood.ai).toBe(true);
    } else {
      expect(asked).toEqual({ typesafe: 0, assistant: 0 });
      expect(written.every((w) => !w.ai)).toBe(true);
      expect((screens[1].body as { understood: { ai: boolean } }).understood.ai).toBe(false);
    }
  });
});
