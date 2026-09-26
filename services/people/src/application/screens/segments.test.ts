import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import type { CallerFrom } from '../../http/caller.js';
import { inMemoryIdempotency } from '../../http/idempotency.js';
import { restHandler } from '../../http/rest.js';
import { screenRoutes, type ScreenRouteDeps } from '../../http/screens.js';
import { inMemorySegments } from '../../infrastructure/drizzle-segments.js';
import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { PeopleService } from '../person/service.js';

/**
 * Saved segments over REST (PEO-068): a filter, shared or not, that shows
 * whoever uses it only what they could have asked for themselves.
 */

const HR = '00000000-0000-4000-8000-0000000000b9';
const MARCO = '00000000-0000-4000-8000-0000000000b2';
const MARCO_PERSON = '00000000-0000-4000-8000-0000000000a2';
const ANA = '00000000-0000-4000-8000-0000000000a3';
const BEA = '00000000-0000-4000-8000-0000000000a4';

const attributes = [
  // Everybody may filter the directory by it.
  define({
    key: 'cost_centre',
    visibility: ['hr', 'directory'],
    includeInDirectory: true,
  }),
  // A manager reads it on their chain, so may chart by it, and not filter the
  // whole directory by it.
  define({ key: 'org_unit', visibility: ['hr', 'manager_chain'] }),
  // HR's alone.
  define({ key: 'performance_flag', visibility: ['hr'] }),
];

function world() {
  const store = inMemoryPeople([versionOf(1, attributes)]);
  store.seed(MARCO_PERSON, { account: MARCO, custom: { cost_centre: 'CC1' } });
  store.seed(ANA, { custom: { cost_centre: 'CC1', performance_flag: 'at_risk' } });
  store.seed(BEA, { custom: { cost_centre: 'CC2' } });
  const service: PeopleService = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  };
  const idempotency = inMemoryIdempotency();
  let ids = 0;
  const segments = inMemorySegments();
  const as = (account: string, roles: string[]) => {
    const callerFrom: CallerFrom = () =>
      ok({
        tenantId: TENANT,
        viewer: { accountId: account, roles: new Set(roles) },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      });
    const screens = screenRoutes(
      {
        service,
        relations: store.deps.relations,
        clock: store.deps.clock,
        calendars: utcCalendars,
        personOf: (_tx: unknown, _tenant: string, of: string) =>
          Promise.resolve(of === MARCO ? MARCO_PERSON : null),
        gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
        segments: {
          store: segments,
          newId: () => {
            ids += 1;
            return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
          },
        },
      } as unknown as ScreenRouteDeps,
      idempotency,
    );
    const rest = restHandler({ service, callerFrom, idempotency, screens });
    return async (method: string, url: string, body?: unknown) => {
      const answer = await rest({
        method,
        url,
        headers: { 'idempotency-key': `${account}:${method}:${url}:${JSON.stringify(body)}` },
        body: body === undefined ? '' : JSON.stringify(body),
      });
      if (answer === null) throw new Error(`no route for ${url}`);
      return answer as { status: number; body: Record<string, unknown> };
    };
  };
  return { hr: as(HR, ['hr']), marco: as(MARCO, []) };
}

type Listed = { items: { id: string; name: string; usableIn: Record<string, boolean> }[] };

describe('saved segments', () => {
  it('saves a filter, and a retry of the same key answers the same segment', async () => {
    const { hr } = world();
    const body = { name: 'CC1', filter: { cost_centre: 'CC1' }, shared: true };
    const first = await hr('POST', '/v1/segments', body);
    expect(first).toMatchObject({
      status: 201,
      body: { name: 'CC1', shared: true, mine: true, usableIn: { directory: true } },
    });
    expect((await hr('POST', '/v1/segments', body)).body).toEqual(first.body);
  });

  it('refuses to save a filter its owner could not use anywhere', async () => {
    const { marco } = world();
    const refused = await marco('POST', '/v1/segments', {
      name: 'Flagged',
      filter: { performance_flag: 'at_risk' },
      shared: true,
    });
    expect(refused).toMatchObject({
      status: 403,
      body: { error: { code: 'FIELD_NOT_FILTERABLE' } },
    });
  });

  it('applies a segment in the directory as the filter it holds', async () => {
    const { hr } = world();
    const made = await hr('POST', '/v1/segments', {
      name: 'CC1',
      filter: { cost_centre: 'CC1' },
      shared: false,
    });
    const id = made.body['id'] as string;
    const page = await hr('GET', `/v1/views/directory?segment=${id}`);
    expect(page.body).toMatchObject({ active: 2, segment: { id, name: 'CC1' } });
    expect((page.body['people'] as { id: string }[]).map((p) => p.id).toSorted()).toEqual(
      [MARCO_PERSON, ANA].toSorted(),
    );
  });

  it('offers a segment in the export builder, counted as its user may list it', async () => {
    const { hr } = world();
    const made = await hr('POST', '/v1/segments', {
      name: 'CC1',
      filter: { cost_centre: 'CC1' },
      shared: false,
    });
    const builder = await hr('GET', '/v1/views/export');
    expect(builder.body['who']).toEqual([
      expect.objectContaining({ value: 'everyone' }),
      { value: `segment:${made.body['id'] as string}`, label: 'CC1', count: 2 },
    ]);
  });

  it("does not let a shared segment over HR's field show a manager anybody", async () => {
    const { hr, marco } = world();
    const made = await hr('POST', '/v1/segments', {
      name: 'At risk',
      filter: { performance_flag: 'at_risk' },
      shared: true,
    });
    const id = made.body['id'] as string;
    // Not offered to him at all: its values say something about a field he cannot read.
    expect(((await marco('GET', '/v1/segments')).body as unknown as Listed).items).toEqual([]);
    // And applied by id anyway, it is refused rather than answered.
    const used = await marco('GET', `/v1/views/directory?segment=${id}`);
    expect(used).toMatchObject({ status: 403, body: { error: { code: 'FIELD_NOT_FILTERABLE' } } });
  });

  it('offers a segment only where its user could use it', async () => {
    const { hr, marco } = world();
    await hr('POST', '/v1/segments', { name: 'Eng', filter: { org_unit: 'eng' }, shared: true });
    await hr('POST', '/v1/segments', { name: 'CC2', filter: { cost_centre: 'CC2' }, shared: true });
    const listed = ((await marco('GET', '/v1/segments')).body as unknown as Listed).items;
    expect(listed.map((s) => [s.name, s.usableIn])).toEqual([
      // cost_centre is not a chart dimension; org_unit is his chain's to chart, not the directory's.
      ['CC2', { directory: true, analytics: false }],
      ['Eng', { directory: false, analytics: true }],
    ]);
  });

  it("keeps a segment its owner's until it is shared", async () => {
    const { hr, marco } = world();
    const made = await hr('POST', '/v1/segments', {
      name: 'CC1',
      filter: { cost_centre: 'CC1' },
      shared: false,
    });
    expect(((await marco('GET', '/v1/segments')).body as unknown as Listed).items).toEqual([]);
    const used = await marco('GET', `/v1/views/directory?segment=${made.body['id'] as string}`);
    expect(used).toMatchObject({ status: 404 });
  });

  it('is deleted by its owner and nobody else', async () => {
    const { hr, marco } = world();
    const made = await hr('POST', '/v1/segments', {
      name: 'CC1',
      filter: { cost_centre: 'CC1' },
      shared: true,
    });
    const url = `/v1/segments/${made.body['id'] as string}`;
    expect(await marco('DELETE', url)).toMatchObject({ status: 403 });
    expect(await hr('DELETE', url)).toMatchObject({ status: 200 });
    expect(((await hr('GET', '/v1/segments')).body as unknown as Listed).items).toEqual([]);
  });

  it('refuses a second segment of the same name for one owner, whatever its case', async () => {
    const { hr } = world();
    await hr('POST', '/v1/segments', {
      name: 'CC1',
      filter: { cost_centre: 'CC1' },
      shared: false,
    });
    const again = await hr('POST', '/v1/segments', {
      name: 'cc1',
      filter: { cost_centre: 'CC2' },
      shared: false,
    });
    expect(again).toMatchObject({ body: { error: { code: 'SEGMENT_NAME_TAKEN' } } });
  });
});
