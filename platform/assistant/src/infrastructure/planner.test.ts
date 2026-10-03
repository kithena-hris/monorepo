import { describe, expect, it } from 'vitest';
import type { ModuleKey, RuntimeCatalogue } from '@kithena/contracts';
import { fixedClock } from '@kithena/domain-kit';
import { createLogger, type Prompt } from '@kithena/telemetry';

import type { PlanRequest } from '../application/ports.js';
import { todayIn } from '../domain/dates.js';
import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from '../domain/fixtures.js';
import { mask, maskOffer } from '../domain/mask.js';
import { offer } from '../domain/plan.js';
import { chatModel, gatedPlanner, plannerFrom } from './planner.js';

/**
 * The planner through the AI gateway (assistant PRD §12.3): every worked
 * example's prompt is let through with People's and Time Off's denied words
 * loaded, and a prompt that still says "sick leave" is not.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const today = todayIn('Europe/Madrid', fixedClock('2026-10-06T10:00:00Z'));
const quiet = createLogger({ write: () => undefined });
const BOTH = [PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE];

function request(
  question: string,
  catalogues: readonly RuntimeCatalogue[],
  masking = true,
): PlanRequest {
  const leaveTypes = catalogues.flatMap((c) => c.leaveTypes);
  const masked = masking ? mask(question, leaveTypes) : { question, refs: [] };
  const present = new Set(catalogues.map((c) => c.module));
  return {
    question: masked.question,
    today,
    offer: maskOffer(offer(catalogues), leaveTypes, masked.refs),
    unavailable: (['people', 'timeoff'] as ModuleKey[]).filter((m) => !present.has(m)),
    denied: catalogues.flatMap((c) => c.denied),
  };
}

function recording() {
  const sent: Prompt[] = [];
  const planner = gatedPlanner((prompt) => {
    sent.push(prompt);
    return Promise.resolve('{"kind":"unclear","reply":""}');
  }, quiet);
  return { planner, sent };
}

const EXAMPLES: readonly [string, readonly RuntimeCatalogue[]][] = [
  ['How many people are off today?', BOTH],
  ['Who are the managers of people on sick leave today?', BOTH],
  ['Who in Engineering is off next week?', BOTH],
  ['How many people are off today?', [PEOPLE_CATALOGUE]],
  ['Who reports to Michael?', [PEOPLE_CATALOGUE]],
  ['What’s waiting for my approval?', [PEOPLE_CATALOGUE]],
  ['Who are the managers of people on sick leave today?', [TIMEOFF_CATALOGUE]],
  ['Who reports to Marco?', [TIMEOFF_CATALOGUE]],
  ['What’s the weather in Madrid?', BOTH],
  ['Who is on sick leave today?', BOTH],
];

describe('the planner, through the AI gateway', () => {
  it.each(EXAMPLES)('lets “%s” through, masked', async (q, cs) => {
    const { planner, sent } = recording();
    expect(await planner.plan(TENANT, request(q, cs))).toEqual({
      ok: true,
      text: '{"kind":"unclear","reply":""}',
    });
    expect(sent).toHaveLength(1);
  });

  it('refuses a prompt that still says "sick leave": the second lock behind masking', async () => {
    const { planner, sent } = recording();
    const unmasked = request('Who is on sick leave today?', BOTH, false);
    expect(await planner.plan(TENANT, unmasked)).toEqual({ ok: false, code: 'NOT_ALLOWED' });
    expect(sent).toHaveLength(0);
  });

  it('refuses a question naming a field not for AI, as People does', async () => {
    const { planner, sent } = recording();
    expect(await planner.plan(TENANT, request('What’s Marco’s salary?', BOTH))).toEqual({
      ok: false,
      code: 'NOT_ALLOWED',
    });
    expect(sent).toHaveLength(0);
  });

  it('loads each question’s denied words afresh, so a field made safe stops being refused', async () => {
    const { planner } = recording();
    const withSalary = request('Who earns the highest salary?', [PEOPLE_CATALOGUE]);
    expect((await planner.plan(TENANT, withSalary)).ok).toBe(false);
    const without = { ...withSalary, denied: withSalary.denied.filter((d) => d.key !== 'salary') };
    expect((await planner.plan(TENANT, without)).ok).toBe(true);
  });

  it('says the model failed when it throws', async () => {
    const planner = gatedPlanner(() => Promise.reject(new Error('down')), quiet);
    expect(await planner.plan(TENANT, request('Who is off today?', BOTH))).toEqual({
      ok: false,
      code: 'FAILED',
    });
  });
});

describe('the model', () => {
  it('is not there without a key, unless it is a local one', () => {
    expect(plannerFrom({}, { logger: quiet })).toBeNull();
    expect(
      plannerFrom({ ASSISTANT_BASE_URL: 'http://localhost:11434/v1' }, { logger: quiet }),
    ).not.toBeNull();
    expect(plannerFrom({ ASSISTANT_API_KEY: 'key' }, { logger: quiet })).not.toBeNull();
  });

  it('is asked in JSON mode at temperature 0, the instruction as the system message', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fake = ((url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"unclear"}' } }] })),
      );
    }) as typeof fetch;
    const send = chatModel(
      { baseUrl: 'https://api.example/v1', apiKey: 'test-key', model: 'some-model' },
      { fetch: fake },
    );
    expect(await send({ instruction: 'Plan.', context: { question: 'Who?' } })).toBe(
      '{"kind":"unclear"}',
    );
    expect(sent[0]?.url).toBe('https://api.example/v1/chat/completions');
    const init = sent[0]?.init ?? {};
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'some-model',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Plan.' },
        { role: 'user', content: '{"question":"Who?"}' },
      ],
    });
    const failing = chatModel(
      { baseUrl: 'https://api.example/v1', apiKey: null, model: 'm' },
      { fetch: () => Promise.resolve(new Response('', { status: 503 })) },
    );
    await expect(failing({ instruction: 'x', context: {} })).rejects.toThrow('503');
  });
});
