import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { EVENT_NAMESPACE, peopleEvents, timeoffEvents, type DefinedEvent } from '@kithena/contracts';
import { classifiedFieldsOf } from '@kithena/testing';

import manifest from '../../module.manifest.js';

/**
 * Time Off against the shared registry.
 *
 * Nothing here imports People. A module learns about another module's events
 * through `@kithena/contracts` and nowhere else, so that is what these assertions
 * read — the registry is the contract, and a sibling's source is not on disk in
 * a deployment that bought one module.
 */

const OWN = timeoffEvents as readonly DefinedEvent[];
/** Every event any module defines, which is what the registry is for. */
const REGISTRY: readonly DefinedEvent[] = [...peopleEvents, ...timeoffEvents];
const nameOf = (event: DefinedEvent): string => event.name;

describe('what the manifest declares matches the registry', () => {
  it('publishes exactly the events defined for this module', () => {
    // Both directions. A missing declaration hides an event from consumers; a
    // stale one advertises a topic that will never receive a message.
    expect(manifest.publishes.toSorted()).toEqual(OWN.map(nameOf).toSorted());
  });

  it('publishes only events inside its own namespace', () => {
    // Owning an event means owning the aggregate behind it. A module publishing
    // under another module's prefix has taken over its bounded context,
    // whatever the manifest says about dependencies.
    for (const name of manifest.publishes) {
      expect(name.startsWith(`${manifest.key}.`)).toBe(true);
    }
  });

  it('consumes only events that some module actually defines', () => {
    const known = new Set(REGISTRY.map(nameOf));
    for (const name of manifest.consumes) {
      expect(known, `${name} is consumed but defined nowhere`).toContain(name);
    }
  });

  it('consumes nothing it publishes itself', () => {
    // A module reacting to its own event through the bus is a loop waiting to
    // happen, and it means the write path is missing a step it should take
    // directly.
    for (const name of manifest.consumes) {
      expect(manifest.publishes).not.toContain(name);
    }
  });
});

describe('the module stays sellable alone', () => {
  it('declares no hard dependency on another module', () => {
    // The rule from CLAUDE.md, asserted rather than described. `enrichedBy` is
    // the soft form and is allowed: People makes Time Off better, and its
    // absence must not make Time Off unusable.
    expect(manifest.dependsOn).toEqual([]);
  });

  it('works against an external people source', () => {
    expect(manifest.requiresPeopleSource).toBe('either');
    // Everything consumed comes from the People Graph, which an external
    // provider fills through the anti-corruption layer. An event no external
    // source could produce would make `either` a false claim.
    for (const name of manifest.consumes) {
      expect(name.startsWith('people.')).toBe(true);
    }
  });
});

describe('the envelope holds', () => {
  it.each(OWN.map((event) => [event.name, event] as const))('%s is registrable', (_name, event) => {
    expect(event.topic).toBe(`${EVENT_NAMESPACE}.${manifest.key}.v${String(event.version)}`);
    // A payload that cannot describe itself as JSON Schema cannot be registered
    // with Redpanda, and the producer would fail at startup rather than here.
    expect(() => z.toJSONSchema(event.schema)).not.toThrow();
  });

  it('rejects an envelope carrying another module event name', () => {
    const requested = OWN.find((event) => event.name === 'timeoff.request.requested');
    expect(requested).toBeDefined();
    if (!requested) return;

    const foreign = { ...envelope('people.person.hired'), payload: {} };
    expect(requested.safeParse(foreign).success).toBe(false);
  });

  it('requires both occurredAt and effectiveFrom to survive', () => {
    // Bitemporality is the reason payroll can compute a retroactive delta. An
    // envelope that dropped one of them would still look valid to a consumer
    // reading only the other.
    const requested = OWN.find((event) => event.name === 'timeoff.request.requested');
    if (!requested) throw new Error('timeoff.request.requested is missing from the registry');

    const parsed = requested.safeParse({
      ...envelope('timeoff.request.requested'),
      payload: {
        requestId: '00000000-0000-4000-8000-000000000010',
        personId: '00000000-0000-4000-8000-000000000011',
        kind: 'sick_leave',
        from: '2026-03-02',
        to: '2026-03-04',
        medicalNote: null,
      },
    });
    expect(parsed.success).toBe(true);

    const undated: Record<string, unknown> = {
      ...envelope('timeoff.request.requested'),
      payload: {},
    };
    delete undated['occurredAt'];
    expect(requested.safeParse(undated).success).toBe(false);
  });
});

describe('classification is a safety property, not a label', () => {
  const fields = classifiedFieldsOf(OWN);

  it('classifies something at all', () => {
    // A walk that matched nothing would make every assertion below vacuous.
    expect(fields.size).toBeGreaterThan(0);
  });

  /**
   * `pnpm codegen` fails on an *unclassified* field. It does not check that a
   * classification is internally consistent, and `asSpecialCategory` is only a
   * helper — nothing stops a future field being written out by hand with
   * `aiEligible: true`. Article 9 data reaching a model prompt is the failure
   * the whole registry exists to prevent, so it is asserted rather than assumed.
   */
  it('never marks special-category data as eligible for a model', () => {
    for (const [path, field] of fields) {
      if (field.classification === 'special-category') {
        expect(field.aiEligible, `${path} is Article 9 data`).toBe(false);
      }
    }
  });

  it('keeps the sick-note field out of model prompts', () => {
    // Named explicitly, because this is the field the privacy documentation
    // cites as the worked example.
    const note = fields.get('timeoff.request.requested.medicalNote');
    expect(note).toBeDefined();
    expect(note?.classification).toBe('special-category');
    expect(note?.piiKind).toBe('health');
    expect(note?.aiEligible).toBe(false);
  });

  it('never sends an identity-bearing field to a model', () => {
    // Free text a human typed can hold a diagnosis or a colleague's name, so
    // its treatment cannot depend on what it happens to contain today.
    for (const [path, field] of fields) {
      if (field.piiKind === 'identity') {
        expect(field.aiEligible, `${path} carries identity data`).toBe(false);
      }
    }
  });
});

/* --------------------------------------------------------------- helpers -- */

/** A minimal valid envelope, so a test can vary one field and check the rest. */
function envelope(eventName: string): Record<string, unknown> {
  return {
    eventId: '01890000-0000-7000-8000-000000000000',
    eventName,
    eventVersion: 1,
    tenantId: '00000000-0000-4000-8000-000000000001',
    occurredAt: '2026-01-01T00:00:00.000Z',
    recordedAt: '2026-01-01T00:00:00.000Z',
    effectiveFrom: '2026-01-01',
    aggregate: { type: 'LeaveRequest', id: 'a', version: 1 },
    actor: { kind: 'system', process: 'contract-test' },
    correlationId: '00000000-0000-4000-8000-000000000002',
    causationId: null,
  };
}
