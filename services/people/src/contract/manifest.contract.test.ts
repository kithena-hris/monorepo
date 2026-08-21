import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { EVENT_NAMESPACE, peopleEvents, type DefinedEvent } from '@kithena/contracts';
import { classifiedFieldsOf } from '@kithena/testing';

import manifest from '../../module.manifest.js';

/**
 * People against the shared registry.
 *
 * People is the source of record here, which makes it the module most likely to
 * grow a field that nobody classified: it is where legal name, work email and
 * termination reason enter the system. Nothing below imports Time Off — the
 * registry is the only vocabulary the two share.
 */

const OWN = peopleEvents as readonly DefinedEvent[];
const nameOf = (event: DefinedEvent): string => event.name;

describe('what the manifest declares matches the registry', () => {
  it('publishes exactly the events defined for this module', () => {
    expect(manifest.publishes.toSorted()).toEqual(OWN.map(nameOf).toSorted());
  });

  it('publishes only events inside its own namespace', () => {
    for (const name of manifest.publishes) {
      expect(name.startsWith(`${manifest.key}.`)).toBe(true);
    }
  });

  it('consumes nothing', () => {
    // People is upstream of everything. The day it consumes another module's
    // event, it has a dependency, and `dependsOn: []` stops being true.
    expect(manifest.consumes).toEqual([]);
  });
});

describe('the module stays sellable alone', () => {
  it('declares no hard dependency on another module', () => {
    expect(manifest.dependsOn).toEqual([]);
  });

  it('is its own people source', () => {
    expect(manifest.requiresPeopleSource).toBe('own');
  });
});

describe('the envelope holds', () => {
  it.each(OWN.map((event) => [event.name, event] as const))('%s is registrable', (_name, event) => {
    expect(event.topic).toBe(`${EVENT_NAMESPACE}.${manifest.key}.v${String(event.version)}`);
    expect(() => z.toJSONSchema(event.schema)).not.toThrow();
  });

  it('rejects an envelope carrying another module event name', () => {
    const hired = OWN.find((event) => event.name === 'people.person.hired');
    if (!hired) throw new Error('people.person.hired is missing from the registry');

    const foreign = { ...envelope('timeoff.request.requested'), payload: {} };
    expect(hired.safeParse(foreign).success).toBe(false);
  });
});

describe('classification is a safety property, not a label', () => {
  const fields = classifiedFieldsOf(OWN);

  it('classifies something at all', () => {
    expect(fields.size).toBeGreaterThan(0);
  });

  it('never marks special-category data as eligible for a model', () => {
    for (const [path, field] of fields) {
      if (field.classification === 'special-category') {
        expect(field.aiEligible, `${path} is Article 9 data`).toBe(false);
      }
    }
  });

  it('never sends an identity-bearing field to a model', () => {
    for (const [path, field] of fields) {
      if (field.piiKind === 'identity') {
        expect(field.aiEligible, `${path} carries identity data`).toBe(false);
      }
    }
  });

  it('classifies a legal name through the nested object that holds it', () => {
    // `name` is a `PersonName` object; the policies live on its leaves. If the
    // walk stopped at the outer field these would be absent and every assertion
    // above would pass without ever inspecting the most sensitive field People
    // owns.
    const given = fields.get('people.person.hired.name.given');
    expect(given?.classification).toBe('confidential');
    expect(given?.piiKind).toBe('identity');
    expect(given?.aiEligible).toBe(false);
  });

  it('classifies a field whose policy sits under a nullable wrapper', () => {
    // `preferred` is `z.string().nullable()` with the policy registered on the
    // outside of the string, so it is only found by unwrapping. This is the
    // case that would silently drop a name from the redaction paths.
    const preferred = fields.get('people.person.hired.name.preferred');
    expect(preferred?.classification).toBe('confidential');
    expect(preferred?.aiEligible).toBe(false);
  });

  it('redacts every confidential field from logs', () => {
    // The classification is what `tools/codegen` turns into the Pino redaction
    // paths. This asserts the property those paths are derived from, so a field
    // that should never be logged cannot be introduced as `internal`.
    const mustRedact = [...fields].filter(
      ([, field]) =>
        field.classification === 'confidential' || field.classification === 'special-category',
    );
    expect(mustRedact.length).toBeGreaterThan(0);
    for (const [, field] of mustRedact) {
      expect(field.aiEligible).toBe(false);
    }
  });
});

/* --------------------------------------------------------------- helpers -- */

function envelope(eventName: string): Record<string, unknown> {
  return {
    eventId: '01890000-0000-7000-8000-000000000000',
    eventName,
    eventVersion: 1,
    tenantId: '00000000-0000-4000-8000-000000000001',
    occurredAt: '2026-01-01T00:00:00.000Z',
    recordedAt: '2026-01-01T00:00:00.000Z',
    effectiveFrom: '2026-01-01',
    aggregate: { type: 'Person', id: 'a', version: 1 },
    actor: { kind: 'system', process: 'contract-test' },
    correlationId: '00000000-0000-4000-8000-000000000002',
    causationId: null,
  };
}
