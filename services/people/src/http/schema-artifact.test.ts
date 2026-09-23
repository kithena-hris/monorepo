import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import { inMemoryIdempotency } from './idempotency.js';
import { restHandler } from './rest.js';
import { schemaArtifact } from './schema-artifact.js';

/**
 * Each published version is fetchable on its own and never changes, so an
 * integrator can pin to one and generate types from it.
 */

const v1 = versionOf(1, [define({ key: 'job_title' })]);
const v2 = versionOf(2, [
  define({ key: 'job_title' }),
  define({
    key: 'contract',
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'permanent', label: { default: 'Permanent' } },
        { value: 'fixed_term', label: { default: 'Fixed term' } },
      ],
    },
  }),
]);

function setup() {
  const versions = [v1, v2];
  const store = inMemoryPeople(versions);
  const rest = restHandler({
    service: {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    },
    callerFrom: () =>
      ok({
        tenantId: TENANT,
        viewer: { accountId: '00000000-0000-4000-8000-0000000000b3', roles: new Set<string>() },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      }),
    idempotency: inMemoryIdempotency(),
  });
  const fetch = async (version: number) => {
    const answer = await rest({
      method: 'GET',
      url: `/v1/schema/versions/${String(version)}`,
      headers: {},
      body: '',
    });
    return {
      status: answer?.status,
      headers: answer?.headers,
      bytes: JSON.stringify(answer?.body),
    };
  };
  return { versions, fetch };
}

describe('the published schema artifact', () => {
  it('serves two versions independently, each describing its own attributes', async () => {
    const { fetch } = setup();
    const [one, two] = [await fetch(1), await fetch(2)];
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);

    const oneSchema = JSON.parse(one.bytes) as { properties: Record<string, unknown> };
    const twoSchema = JSON.parse(two.bytes) as { properties: Record<string, unknown> };
    expect(Object.keys(oneSchema.properties)).toEqual(['job_title']);
    expect(Object.keys(twoSchema.properties)).toEqual(['job_title', 'contract']);
    expect(JSON.stringify(twoSchema.properties['contract'])).toContain('fixed_term');
  });

  it('serves the older one byte-identical across requests, before and after a newer publish', async () => {
    const { fetch, versions } = setup();
    const before = await fetch(1);
    const again = await fetch(1);
    versions.push(versionOf(3, [define({ key: 'job_title' }), define({ key: 'desk' })]));
    const after = await fetch(1);

    expect(again.bytes).toBe(before.bytes);
    expect(after.bytes).toBe(before.bytes);
    expect(after.headers).toMatchObject({ etag: `"${v1.checksum}"` });
  });

  it('renders every data type the registry offers', () => {
    const configs: Record<string, Record<string, unknown>> = {
      money: { kind: 'money' },
      date: { kind: 'date', range: 'past' },
      address: { kind: 'address' },
      country: { kind: 'country' },
      multi_select: {
        kind: 'multi_select',
        options: [{ value: 'a', label: { default: 'A' } }],
      },
      national_id: { kind: 'national_id', country: 'ES', scheme: 'NIF' },
      time_zone: { kind: 'time_zone' },
      decimal: { kind: 'decimal', decimals: 2 },
    };
    const attributes = Object.entries(configs).map(([dataType, typeConfig]) =>
      define({
        key: dataType,
        dataType: dataType as never,
        typeConfig: typeConfig as never,
        ...(dataType === 'national_id'
          ? {
              encrypted: true,
              classification: {
                classification: 'confidential',
                piiKind: 'identity',
                exportable: true,
                aiEligible: false,
              },
            }
          : {}),
      }),
    );
    const artifact = schemaArtifact(versionOf(4, attributes)) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(artifact.properties)).toEqual(Object.keys(configs));
    expect(JSON.stringify(artifact.properties['money'])).toContain('amountMinor');
    expect(JSON.stringify(artifact.properties['national_id'])).toContain('last4');
  });

  it('answers 404 for a version that was never published', async () => {
    const { fetch } = setup();
    expect((await fetch(9)).status).toBe(404);
  });
});
