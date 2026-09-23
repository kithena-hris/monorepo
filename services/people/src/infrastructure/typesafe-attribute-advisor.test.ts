import { describe, expect, it } from 'vitest';

import {
  typesafeAttributeAdvisor,
  typesafeAttributeAdvisorFromEnv,
} from './typesafe-attribute-advisor.js';

const candidates = [
  {
    key: 'work_email',
    label: 'Work email',
    description: null,
    dataType: 'email',
    sectionKey: 'hr',
  },
  {
    key: 'cost_centre',
    label: 'Cost centre',
    description: 'Finance code',
    dataType: 'text',
    sectionKey: 'hr',
  },
];

function fakeFetch(
  respond: () => Response | Promise<Response>,
  sent: unknown[] = [],
): typeof fetch {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(init?.body as string));
    return respond();
  };
}

describe('the TypeSafe adapter', () => {
  it('is absent with no key, and the module works without it', () => {
    expect(typesafeAttributeAdvisorFromEnv({})).toBeNull();
    expect(typesafeAttributeAdvisorFromEnv({ TYPESAFE_API_KEY: '  ' })).toBeNull();
    expect(typesafeAttributeAdvisorFromEnv({ TYPESAFE_API_KEY: 'k' })).not.toBeNull();
  });

  it('asks one Choice per column in one request, with no_match, and reads the answers', async () => {
    const sent: unknown[] = [];
    const advisor = typesafeAttributeAdvisor({
      apiKey: 'k',
      fetch: fakeFetch(
        () =>
          Response.json({
            answers: {
              column_0: {
                type: 'choice',
                choice: 'work_email',
                probabilities: {},
                confidence: 0.93,
              },
              column_1: { type: 'choice', choice: 'no_match', probabilities: {}, confidence: 0.8 },
            },
          }),
        sent,
      ),
    });
    const answers = await advisor.mapColumns(['E-mail', 'Shoe size'], candidates);
    expect(answers.get('E-mail')).toEqual({ key: 'work_email', confidence: 0.93 });
    expect(answers.get('Shoe size')).toEqual({ key: null, confidence: 0.8 });

    expect(sent).toHaveLength(1);
    const body = sent[0] as { state: unknown; questions: Record<string, { criteria: object }> };
    expect(body.state).toEqual({ columns: ['E-mail', 'Shoe size'], attributes: candidates });
    expect(Object.keys(body.questions['column_0']?.criteria ?? {})).toEqual([
      'work_email',
      'cost_centre',
      'no_match',
    ]);
  });

  it('returns nothing, rather than throwing, when the service fails', async () => {
    for (const respond of [
      () => new Response('nope', { status: 503 }),
      () => Response.json({ answers: { column_0: { type: 'score' } } }),
      () => Promise.reject(new Error('offline')),
    ]) {
      const advisor = typesafeAttributeAdvisor({ apiKey: 'k', fetch: fakeFetch(respond) });
      expect((await advisor.mapColumns(['E-mail'], candidates)).size).toBe(0);
    }
  });
});
