import { describe, expect, it } from 'vitest';
import { PeopleFind, PeopleManagers, TimeOffAway } from '@kithena/contracts';
import { createLogger } from '@kithena/telemetry';

import type { Principal } from '../application/ports.js';
import { PEOPLE_CATALOGUE } from '../domain/fixtures.js';
import { modulesFrom } from './modules.js';

/** The module client against a mocked `fetch` (assistant PRD §8.6, §10.2). */

const AS: Principal = {
  userId: '00000000-0000-4000-8000-000000000900',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  entitlements: ['module.people', 'module.timeoff'],
  impersonatedBy: null,
  viewedBy: null,
};
const SETTINGS = {
  PEOPLE_URL: 'http://people:4001/',
  ASSISTANT_PEOPLE_TOKEN: 'people-pair',
  TIMEOFF_URL: 'http://timeoff:4002',
  ASSISTANT_TIMEOFF_TOKEN: 'timeoff-pair',
};
const quiet = createLogger({ write: () => undefined });

interface Sent {
  url: string;
  init: RequestInit;
}

function fetching(answer: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const sent: Sent[] = [];
  // The client only ever passes a string.
  const fake = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  return { fake, sent };
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const signal = () => new AbortController().signal;

describe('which modules the assistant can reach', () => {
  it('a module needs both its URL and its pair token', () => {
    expect(modulesFrom(SETTINGS, { logger: quiet }).configured).toEqual(['people', 'timeoff']);
    const half = { PEOPLE_URL: 'http://people:4001', TIMEOFF_URL: 'http://timeoff:4002' };
    expect(modulesFrom(half, { logger: quiet }).configured).toEqual([]);
  });
});

describe('a catalogue', () => {
  it('is asked as the asker, with the pair token and the correlation id', async () => {
    const { fake, sent } = fetching(() => reply(200, PEOPLE_CATALOGUE));
    const modules = modulesFrom(SETTINGS, { fetch: fake, logger: quiet });
    expect(await modules.catalogue('people', AS, 'corr-1')).toEqual(PEOPLE_CATALOGUE);
    expect(sent[0]?.url).toBe('http://people:4001/internal/capabilities');
    const headers = sent[0]?.init.headers as Record<string, string>;
    expect(headers['x-internal-token']).toBe('people-pair');
    expect(headers['x-correlation-id']).toBe('corr-1');
    expect(JSON.parse(headers['x-kithena-principal'] ?? '')).toEqual({
      userId: AS.userId,
      tenantId: AS.tenantId,
      entitlements: AS.entitlements,
      impersonatedBy: null,
      viewedBy: null,
    });
  });

  it('is kept a minute per tenant, account and module', async () => {
    let at = 0;
    const { fake, sent } = fetching(() => reply(200, PEOPLE_CATALOGUE));
    const modules = modulesFrom(SETTINGS, { fetch: fake, logger: quiet, now: () => at });
    await modules.catalogue('people', AS, 'c');
    at = 59_000;
    await modules.catalogue('people', AS, 'c');
    expect(sent).toHaveLength(1);
    await modules.catalogue(
      'people',
      { ...AS, userId: '00000000-0000-4000-8000-000000000901' },
      'c',
    );
    expect(sent).toHaveLength(2);
    at = 61_000;
    await modules.catalogue('people', AS, 'c');
    expect(sent).toHaveLength(3);
  });

  it('forwards a view-as or a support session unchanged, and keeps each apart', async () => {
    const { fake, sent } = fetching(() => reply(200, PEOPLE_CATALOGUE));
    const modules = modulesFrom(SETTINGS, { fetch: fake, logger: quiet });
    const admin = '00000000-0000-4000-8000-0000000000c1';
    await modules.catalogue('people', { ...AS, viewedBy: admin }, 'c');
    await modules.catalogue('people', { ...AS, impersonatedBy: admin }, 'c');
    await modules.catalogue('people', AS, 'c');
    const principals = sent.map(
      (s) =>
        JSON.parse(
          (s.init.headers as Record<string, string>)['x-kithena-principal'] ?? '',
        ) as Principal,
    );
    expect(principals.map((p) => [p.viewedBy, p.impersonatedBy])).toEqual([
      [admin, null],
      [null, admin],
      [null, null],
    ]);
  });

  it('is the module’s refusal in its own words when it says no (403)', async () => {
    const { fake } = fetching(() =>
      reply(403, {
        error: {
          code: 'FORBIDDEN',
          message: 'Time Off cannot be used in a support or view-as session',
        },
      }),
    );
    const modules = modulesFrom(SETTINGS, { fetch: fake, logger: quiet });
    expect(await modules.catalogue('timeoff', AS, 'c')).toEqual({
      refused: 'Time Off cannot be used in a support or view-as session',
    });
  });

  it('drops a capability served at a version the assistant does not pin', async () => {
    const { fake } = fetching(() =>
      reply(200, {
        ...PEOPLE_CATALOGUE,
        serves: [
          { name: 'people.find', version: 2 },
          { name: 'people.reports', version: 1 },
        ],
      }),
    );
    const got = await modulesFrom(SETTINGS, { fetch: fake, logger: quiet }).catalogue(
      'people',
      AS,
      'c',
    );
    expect(got).toMatchObject({ serves: [{ name: 'people.reports', version: 1 }] });
  });

  it('is nothing when the module refuses, answers off contract, or does not answer in time', async () => {
    const refused = fetching(() =>
      reply(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }),
    );
    expect(
      await modulesFrom(SETTINGS, { fetch: refused.fake, logger: quiet }).catalogue(
        'people',
        AS,
        'c',
      ),
    ).toBeNull();
    const malformed = fetching(() => reply(200, { module: 'people', serves: 'everything' }));
    expect(
      await modulesFrom(SETTINGS, { fetch: malformed.fake, logger: quiet }).catalogue(
        'people',
        AS,
        'c',
      ),
    ).toBeNull();
    // A catalogue claiming to be another module's is not this one's.
    const other = fetching(() => reply(200, { ...PEOPLE_CATALOGUE, module: 'timeoff' }));
    expect(
      await modulesFrom(SETTINGS, { fetch: other.fake, logger: quiet }).catalogue(
        'people',
        AS,
        'c',
      ),
    ).toBeNull();
    const slow = fetching(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    const modules = modulesFrom(SETTINGS, { fetch: slow.fake, logger: quiet, timeoutMs: 10 });
    expect(await modules.catalogue('people', AS, 'c')).toBeNull();
  });
});

describe('a capability call', () => {
  const found = {
    kind: 'people',
    rows: [],
    total: 3,
    scope: 'everyone',
    described: 'whose department is Sales',
    notes: [],
  };

  it('posts the input as the asker and reads the answer with the contract', async () => {
    const { fake, sent } = fetching(() => reply(200, found));
    const modules = modulesFrom(SETTINGS, { fetch: fake, logger: quiet });
    const outcome = await modules.call(PeopleFind, { limit: 0 }, AS, 'corr-2', signal());
    expect(outcome).toEqual({ ok: true, value: found });
    expect(sent[0]?.url).toBe('http://people:4001/internal/capabilities/people.find');
    expect(sent[0]?.init.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init.body as string)).toEqual({ limit: 0 });
    const headers = sent[0]?.init.headers as Record<string, string>;
    expect(headers['x-internal-token']).toBe('people-pair');
  });

  it('takes a 403 as the module saying no, in its own words', async () => {
    const { fake } = fetching(() =>
      reply(403, {
        error: { code: 'NOT_ENTITLED', message: 'This workspace does not include Time Off' },
      }),
    );
    const outcome = await modulesFrom(SETTINGS, { fetch: fake, logger: quiet }).call(
      TimeOffAway,
      TimeOffAway.schemas.input.parse({ on: { from: '2026-10-06', to: '2026-10-06' }, limit: 0 }),
      AS,
      'c',
      signal(),
    );
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'REFUSED', message: 'This workspace does not include Time Off' },
    });
  });

  it('takes anything else, a malformed answer or a timeout as a module that did not answer', async () => {
    const unreachable = { ok: false, error: { code: 'UNREACHABLE' } };
    const statuses = [400, 401, 404, 422, 500];
    const outcomes = await Promise.all(
      statuses.map((status) => {
        const { fake } = fetching(() => reply(status, { error: { code: 'X', message: 'x' } }));
        return modulesFrom(SETTINGS, { fetch: fake, logger: quiet }).call(
          PeopleManagers,
          { personIds: [], limit: 25 },
          AS,
          'c',
          signal(),
        );
      }),
    );
    expect(outcomes).toEqual(statuses.map(() => unreachable));
    const malformed = fetching(() => reply(200, { kind: 'people', rows: 'everyone' }));
    expect(
      await modulesFrom(SETTINGS, { fetch: malformed.fake, logger: quiet }).call(
        PeopleFind,
        { limit: 0 },
        AS,
        'c',
        signal(),
      ),
    ).toEqual(unreachable);
    const slow = fetching(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    const timed = modulesFrom(SETTINGS, { fetch: slow.fake, logger: quiet, timeoutMs: 10 });
    expect(await timed.call(PeopleFind, { limit: 0 }, AS, 'c', signal())).toEqual(unreachable);
    // The question's own deadline aborts it too.
    const question = new AbortController();
    const waiting = modulesFrom(SETTINGS, { fetch: slow.fake, logger: quiet }).call(
      PeopleFind,
      { limit: 0 },
      AS,
      'c',
      question.signal,
    );
    question.abort();
    expect(await waiting).toEqual(unreachable);
  });

  it('never reaches a module that is not configured', async () => {
    const { fake, sent } = fetching(() => reply(200, found));
    const modules = modulesFrom({}, { fetch: fake, logger: quiet });
    expect(await modules.catalogue('people', AS, 'c')).toBeNull();
    expect(await modules.call(PeopleFind, { limit: 0 }, AS, 'c', signal())).toEqual({
      ok: false,
      error: { code: 'UNREACHABLE' },
    });
    expect(sent).toHaveLength(0);
  });
});
