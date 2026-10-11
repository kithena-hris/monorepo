import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import {
  EVENT_NAMESPACE,
  identityEvents,
  peopleEvents,
  timeoffEvents,
  documentsEvents,
  type DefinedEvent,
} from '@kithena/contracts';
import { classifiedFieldsOf } from '@kithena/testing';

import manifest from '../../module.manifest.js';

/**
 * Documents against the shared registry.
 *
 * Nothing here imports People. A module learns about another module's events
 * through `@kithena/contracts` and nowhere else, so that is what these assertions
 * read — the registry is the contract, and a sibling's source is not on disk in
 * a deployment that bought one module.
 */

const OWN = documentsEvents as readonly DefinedEvent[];
/** Every event any module or platform service defines, which is what the registry is for. */
const REGISTRY: readonly DefinedEvent[] = [
  ...(identityEvents as readonly DefinedEvent[]),
  ...peopleEvents,
  ...timeoffEvents,
  ...documentsEvents,
];
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
    // the soft form and is allowed: People makes Documents better, and its
    // absence must not make Documents unusable.
    expect(manifest.dependsOn).toEqual([]);
  });

  it('works against an external people source', () => {
    expect(manifest.requiresPeopleSource).toBe('either');
    // Everything consumed comes from the People Graph, which an external
    // provider fills through the anti-corruption layer. An event no external
    // source could produce would make `either` a false claim. Identity is a
    // platform service every deployment has, not a module, so its events are
    // the other thing a module may hear.
    for (const name of manifest.consumes) {
      expect(name.startsWith('people.') || name.startsWith('identity.')).toBe(true);
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
    const filed = OWN.find((event) => event.name === 'documents.document.filed');
    expect(filed).toBeDefined();
    if (!filed) return;

    const foreign = { ...envelope('people.person.hired'), payload: {} };
    expect(filed.safeParse(foreign).success).toBe(false);
  });

  it('requires both occurredAt and effectiveFrom to survive', () => {
    const filed = OWN.find((event) => event.name === 'documents.document.filed');
    if (!filed) throw new Error('documents.document.filed is missing from the registry');

    const parsed = filed.safeParse({
      ...envelope('documents.document.filed', filed.version),
      payload: {
        documentId: '00000000-0000-4000-8000-000000000010',
        typeKey: 'employment_contract',
        kind: 'Contract',
        ownerAccountId: '00000000-0000-4000-8000-000000000011',
        subjectPersonId: '00000000-0000-4000-8000-000000000012',
        level: 'private',
        confidential: true,
        pages: 6,
        expiresOn: null,
      },
    });
    expect(parsed.success).toBe(true);

    const undated: Record<string, unknown> = {
      ...envelope('documents.document.filed'),
      payload: {},
    };
    delete undated['occurredAt'];
    expect(filed.safeParse(undated).success).toBe(false);
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

  it('classifies the signers, who may be outside addresses, as contact data', () => {
    expect(fields.get('documents.envelope.sent.signers')?.piiKind).toBe('contact');
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
function envelope(eventName: string, eventVersion = 1): Record<string, unknown> {
  return {
    eventId: '01890000-0000-7000-8000-000000000000',
    eventName,
    eventVersion,
    tenantId: '00000000-0000-4000-8000-000000000001',
    occurredAt: '2026-01-01T00:00:00.000Z',
    recordedAt: '2026-01-01T00:00:00.000Z',
    effectiveFrom: '2026-01-01',
    aggregate: { type: 'Document', id: 'a', version: 1 },
    actor: { kind: 'system', process: 'contract-test' },
    correlationId: '00000000-0000-4000-8000-000000000002',
    causationId: null,
  };
}
