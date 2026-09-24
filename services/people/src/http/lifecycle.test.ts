import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { fixedCalendars } from '../application/org/org.js';
import { personAccess } from '../application/person/person-access.js';
import { inMemoryIdempotency } from './idempotency.js';
import { LIFECYCLE_ACTIONS } from './lifecycle.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest } from './rest.js';

/**
 * PEO-108 over REST: a route per move, each keyed like every other write,
 * each refusal mapped to the status the rest of the API uses. The in-memory
 * clock reads 22 September 2026, UTC.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const NEW = '00000000-0000-4000-8000-0000000000a2';
const HR = '00000000-0000-4000-8000-0000000000b3';

function setup() {
  const store = inMemoryPeople([versionOf(1, [])]);
  store.seed(ADA);
  store.seed(NEW);
  const fresh = store.rows.get(NEW);
  if (fresh) fresh.snapshot = { ...fresh.snapshot, status: 'provisional', hireDate: null };
  const rest = restHandler({
    service: {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    },
    callerFrom: (request) =>
      ok({
        tenantId: TENANT,
        viewer: {
          accountId: HR,
          roles: new Set(String(request.headers['x-roles'] ?? 'hr').split(',')),
        },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      }),
    idempotency: inMemoryIdempotency(),
  });
  const post = async (
    path: string,
    body: unknown,
    key: string,
    headers: Record<string, string> = {},
  ) => {
    const request: RestRequest = {
      method: 'POST',
      url: `/v1/people/${path}`,
      headers: { 'idempotency-key': key, ...headers },
      body: body === undefined ? '' : JSON.stringify(body),
    };
    const answer = await rest(request);
    if (!answer) throw new Error('not a REST route');
    return answer;
  };
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const answer = await rest({ method: 'GET', url: `/v1/people/${path}`, headers, body: '' });
    if (!answer) throw new Error('not a REST route');
    return answer;
  };
  return { store, post, get };
}

const status = (answer: { body: unknown }) => (answer.body as { status?: string }).status;
const code = (answer: { body: unknown }) =>
  (answer.body as { error?: { code: string } }).error?.code;

describe('the lifecycle routes', () => {
  it('puts somebody on leave and back, answering with the person after', async () => {
    const { post } = setup();
    const away = await post(`${ADA}/leave/start`, undefined, 'l1');
    expect([away.status, status(away)]).toEqual([200, 'on_leave']);
    const back = await post(`${ADA}/leave/end`, {}, 'l2');
    expect([back.status, status(back)]).toEqual([200, 'active']);
  });

  it('gives notice, then terminates once the day has come', async () => {
    const { post, store } = setup();
    const notice = await post(`${ADA}/notice`, { lastWorkingDay: '2026-09-30' }, 'n1');
    expect([notice.status, status(notice)]).toEqual([200, 'notice']);

    const early = await post(
      `${ADA}/termination`,
      { lastWorkingDay: '2026-09-30', reason: 'resigned' },
      't1',
    );
    expect([early.status, code(early)]).toEqual([422, 'LAST_DAY_NOT_REACHED']);

    const ended = await post(
      `${ADA}/termination`,
      { lastWorkingDay: '2026-09-21', reason: 'resigned', note: 'Moving abroad' },
      't2',
    );
    expect([ended.status, status(ended)]).toEqual([200, 'terminated']);
    expect(store.events.at(-1)).toMatchObject({
      eventName: 'people.person.terminated',
      payload: { lastWorkingDay: '2026-09-21', reason: 'Moving abroad' },
    });
  });

  it('ends a leaver’s access at once, with the termination or after it (PEO-109)', async () => {
    const { post, store } = setup();
    const onNotice = await post(`${ADA}/access/end`, undefined, 'a0');
    expect([onNotice.status, code(onNotice)]).toEqual([409, 'INVALID_TRANSITION']);

    const dismissed = await post(
      `${ADA}/termination`,
      { lastWorkingDay: '2026-09-22', reason: 'dismissed', endAccessNow: true },
      'a1',
    );
    expect([dismissed.status, status(dismissed)]).toEqual([200, 'terminated']);
    expect(store.events.at(-1)).toMatchObject({
      eventName: 'people.person.access_ended',
      actor: { kind: 'user', userId: HR },
      payload: { trigger: 'ended_by_hr', endedAt: '2026-09-22T09:00:00.000Z' },
    });

    // Already ended: answered with the record, nothing raised.
    const count = store.events.length;
    const again = await post(`${ADA}/access/end`, undefined, 'a2');
    expect([again.status, status(again)]).toEqual([200, 'terminated']);
    expect(store.events).toHaveLength(count);

    const notHr = await post(`${ADA}/access/end`, undefined, 'a3', { 'x-roles': 'people_admin' });
    expect([notHr.status, code(notHr)]).toEqual([403, 'FORBIDDEN']);
  });

  it('rehires a leaver into a new period, and lists both (PEO-110)', async () => {
    const { post, store, get } = setup();
    const ada = store.rows.get(ADA);
    if (ada) {
      ada.fields = { ...ada.fields, givenName: 'Ada', familyName: 'Lovelace', workEmail: 'ada@acme.test' };
    }
    await post(`${ADA}/termination`, { lastWorkingDay: '2026-09-21', reason: 'resigned' }, 'r0');
    const bad = await post(`${ADA}/rehire`, { startDate: '2026-09-21' }, 'r1');
    expect(code(bad)).toBe('REHIRE_BEFORE_LAST_DAY');
    const back = await post(`${ADA}/rehire`, { startDate: '2026-10-05' }, 'r2');
    expect([back.status, status(back)]).toEqual([200, 'pre_hire']);
    expect(store.events.map((e) => e.eventName)).toContain('people.person.hired');

    const periods = await get(`${ADA}/employment-periods`);
    expect(periods.status).toBe(200);
    expect(
      (periods.body as { items: { period: number; startedOn: string }[] }).items.map((p) => [
        p.period,
        p.startedOn,
      ]),
    ).toEqual([
      [1, '2026-01-01'],
      [2, '2026-10-05'],
    ]);
    const notHr = await get(`${ADA}/employment-periods`, { 'x-roles': 'people_admin' });
    expect([notHr.status, code(notHr)]).toEqual([403, 'FORBIDDEN']);
  });

  it('withdraws notice back to where it was given from (PEO-111)', async () => {
    const { post, store } = setup();
    await post(`${ADA}/notice`, { lastWorkingDay: '2026-09-30' }, 'w0');
    const back = await post(`${ADA}/notice/withdraw`, undefined, 'w1');
    expect([back.status, status(back)]).toEqual([200, 'active']);
    expect(store.events.at(-1)).toMatchObject({
      eventName: 'people.person.status_changed',
      payload: { next: 'active', reason: 'notice_withdrawn' },
    });
    const again = await post(`${ADA}/notice/withdraw`, undefined, 'w2');
    expect(code(again)).toBe('INVALID_TRANSITION');
  });

  it('answers a retried key without moving twice', async () => {
    const { post, store } = setup();
    const first = await post(`${ADA}/notice`, { lastWorkingDay: '2026-12-31' }, 'k');
    const count = store.events.length;
    const again = await post(`${ADA}/notice`, { lastWorkingDay: '2026-12-31' }, 'k');
    expect(again).toEqual(first);
    expect(store.events).toHaveLength(count);
  });

  it('discards a provisional record, and refuses one somebody was employed on', async () => {
    const { post } = setup();
    const gone = await post(`${NEW}/discard`, undefined, 'd1');
    expect([gone.status, status(gone)]).toEqual([200, 'discarded']);
    const refused = await post(`${ADA}/discard`, undefined, 'd2');
    expect([refused.status, code(refused)]).toEqual([409, 'INVALID_TRANSITION']);
  });

  it('refuses a caller who is not HR with 403, and writes nothing', async () => {
    const { post, store } = setup();
    for (const roles of ['people_admin', 'finance']) {
      const refused = await post(
        `${ADA}/termination`,
        { lastWorkingDay: '2026-09-21', reason: 'dismissed' },
        `f-${roles}`,
        { 'x-roles': roles },
      );
      expect([refused.status, code(refused)]).toEqual([403, 'FORBIDDEN']);
    }
    expect(store.events).toEqual([]);
  });

  it('refuses a body the schema does not describe, and a write without a key', async () => {
    const { post } = setup();
    const unknownReason = await post(
      `${ADA}/termination`,
      { lastWorkingDay: '2026-09-21', reason: 'fired' },
      'b1',
    );
    expect([unknownReason.status, code(unknownReason)]).toEqual([422, 'BAD_REQUEST']);
    const extra = await post(`${ADA}/leave/start`, { from: '2026-09-01' }, 'b2');
    expect(code(extra)).toBe('BAD_REQUEST');
    const keyless = await post(`${ADA}/leave/start`, undefined, '');
    expect(code(keyless)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('places a person, a new entity as a transfer (PEO-123)', async () => {
    const ES = '00000000-0000-4000-8000-0000000000e1';
    const PT = '00000000-0000-4000-8000-0000000000e2';
    const LIS = '00000000-0000-4000-8000-0000000000d1';
    const store = inMemoryPeople([
      versionOf(1, [
        define({ key: 'legal_entity_id', dataType: 'legal_entity_ref', typeConfig: { kind: 'legal_entity_ref' }, effectiveDated: true }),
        define({ key: 'location_id', effectiveDated: true }),
      ]),
    ]);
    store.seed(ADA, { fields: { legalEntityId: ES } });
    const calendars = fixedCalendars({
      defaultZone: 'Etc/UTC',
      entities: new Map([
        [ES, { id: ES, name: 'Acme ES', country: 'ES', timeZone: 'Europe/Madrid' }],
        [PT, { id: PT, name: 'Acme PT', country: 'PT', timeZone: 'Europe/Lisbon' }],
      ]),
      locations: new Map([
        [LIS, { id: LIS, legalEntityId: PT, name: 'Lisbon', country: 'PT', zones: [{ effectiveFrom: '2020-01-01' as never, timeZone: 'Europe/Lisbon' }] }],
      ]),
    });
    const rest = restHandler({
      service: {
        access: personAccess({ ...store.deps, calendars }),
        schemas: store.deps.schemas,
        inTenant: (_tenant, fn) => fn({ tx: {} as never }),
      },
      callerFrom: (request) =>
        ok({
          tenantId: TENANT,
          viewer: { accountId: HR, roles: new Set(String(request.headers['x-roles'] ?? 'hr').split(',')) },
          correlationId: '00000000-0000-4000-8000-0000000000c1',
        }),
      idempotency: inMemoryIdempotency(),
    });
    const post = async (body: unknown, key: string, roles = 'hr') => {
      const answer = await rest({
        method: 'POST',
        url: `/v1/people/${ADA}/placement`,
        headers: { 'idempotency-key': key, 'x-roles': roles },
        body: JSON.stringify(body),
      });
      if (!answer) throw new Error('not a REST route');
      return answer;
    };

    expect(code(await post({}, 'p0'))).toBe('BAD_REQUEST');
    const notHr = await post({ locationId: LIS }, 'p1', 'people_admin');
    expect([notHr.status, code(notHr)]).toEqual([403, 'FORBIDDEN']);

    const moved = await post({ locationId: LIS, effectiveFrom: '2026-09-01' }, 'p2');
    expect(moved.status).toBe(200);
    expect((moved.body as { attributes: Record<string, unknown> }).attributes).toMatchObject({
      legal_entity_id: PT,
      location_id: LIS,
    });
    const periods = await rest({ method: 'GET', url: `/v1/people/${ADA}/employment-periods`, headers: {}, body: '' });
    expect(
      (periods?.body as { items: { period: number; legalEntityId: string; lastWorkingDay: string | null }[] }).items.map(
        (p) => [p.period, p.legalEntityId, p.lastWorkingDay],
      ),
    ).toEqual([
      [1, ES, '2026-08-31'],
      [2, PT, null],
    ]);
    // The same key again is a replay, not a second move.
    const count = store.events.length;
    expect((await post({ locationId: LIS, effectiveFrom: '2026-09-01' }, 'p2')).status).toBe(200);
    expect(store.events).toHaveLength(count);
  });

  it('is in the OpenAPI document, each body generated from the schema the route parses', () => {
    const doc = openApiDocument() as {
      paths: Record<string, { post?: { requestBody?: unknown } }>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    for (const a of LIFECYCLE_ACTIONS) {
      expect(doc.paths[`/v1/people/{id}/${a.path}`]?.post, a.path).toBeDefined();
    }
    expect(doc.paths['/v1/people/{id}/leave/start']?.post?.requestBody).toBeUndefined();
    expect(Object.keys(doc.components.schemas['terminatePerson']?.properties ?? {})).toEqual([
      'lastWorkingDay',
      'reason',
      'note',
      'eligibleForRehire',
      'endAccessNow',
    ]);
  });
});
