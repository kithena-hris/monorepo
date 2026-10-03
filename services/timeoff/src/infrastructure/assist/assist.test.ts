import { describe, expect, it, vi } from 'vitest';

import { assistFrom } from '../../composition.js';
import { typesafeJudge } from './typesafe-judge.js';
import { gatewayWriter } from './writer.js';

const ask = {
  state: { sentence: 'a week off in October' },
  questions: {
    month: { instructions: 'Which month?', options: { '2026-10': 'October', none: 'No month' } },
  },
};

const answered = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('the TypeSafe judge', () => {
  it('asks every question in one call and keeps only choices it offered', async () => {
    const fetch = answered({
      answers: {
        month: { type: 'choice', choice: '2026-10', confidence: 0.93 },
        other: { type: 'choice', choice: 'x', confidence: 1 },
      },
    });
    const judge = typesafeJudge({ apiKey: 'k', fetch });
    const out = await judge.choose('t1', ask);
    expect([...out]).toEqual([['month', { choice: '2026-10', confidence: 0.93 }]]);
    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ state: ask.state, questions: { month: { type: 'choice' } } });
  });

  it('answers nothing on a failure, a bad shape or an option it never offered', async () => {
    const sizes = await Promise.all(
      [
        answered({}, 500),
        answered({ answers: { month: { type: 'noul', noul: 1 } } }),
        answered({ answers: { month: { type: 'choice', choice: '2027-01', confidence: 1 } } }),
        vi.fn(() => Promise.reject(new Error('offline'))),
      ].map(async (fetch) => (await typesafeJudge({ apiKey: 'k', fetch }).choose('t2', ask)).size),
    );
    expect(sizes).toEqual([0, 0, 0, 0]);
  });

  it('never sends a prompt carrying health data: the gateway refuses it first', async () => {
    const fetch = answered({ answers: {} });
    const out = await typesafeJudge({ apiKey: 'k', fetch }).choose('t3', {
      ...ask,
      state: { sick_note: 'anything' },
    });
    expect(out.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the writer', () => {
  it('reads one JSON object of lines', async () => {
    const send = vi.fn(() => Promise.resolve('{"reason":"Fine."}'));
    const out = await gatewayWriter(send).write('t1', {
      instruction: 'Write the reason.',
      facts: { in: 5 },
      lines: { reason: 'why' },
    });
    expect(out).toEqual({ reason: 'Fine.' });
  });

  it('is null on a refusal, a failure or prose', async () => {
    const refused = vi.fn(() => Promise.resolve('{}'));
    expect(
      await gatewayWriter(refused).write('t2', {
        instruction: 'Mention the due date.',
        facts: {},
        lines: { a: 'b' },
      }),
    ).toBeNull();
    expect(refused).not.toHaveBeenCalled();
    expect(
      await gatewayWriter(() => Promise.reject(new Error('down'))).write('t2', {
        instruction: 'x',
        facts: {},
        lines: { a: 'b' },
      }),
    ).toBeNull();
    expect(
      await gatewayWriter(() => Promise.resolve('Sure! Here you go')).write('t2', {
        instruction: 'y',
        facts: {},
        lines: { a: 'b' },
      }),
    ).toBeNull();
  });
});

describe('the ports from the environment', () => {
  it('are both absent with no keys, and present with them', () => {
    expect(assistFrom({})).toEqual({});
    const both = assistFrom({ TYPESAFE_API_KEY: 'k', ASSISTANT_API_KEY: 'a' });
    expect(Object.keys(both).toSorted()).toEqual(['judge', 'writer']);
  });
});
