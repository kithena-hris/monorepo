import { describe, expect, it } from 'vitest';

import { AttributeDefinition } from './attribute-definition.js';

/**
 * The refinements that are not negotiable.
 *
 * Everything else on a definition is a tenant's business. These four are ways
 * a value reaches somewhere it must never be — a model prompt, a Kafka topic,
 * a JSONB column, an index — and each is closed here because this is the only
 * point every writer passes through: the settings form, the import, the REST
 * API and a country pack all parse this object.
 */

const base = {
  key: 'accommodation_notes',
  sectionKey: 'health_and_safety',
  label: { default: 'Accommodation notes' },
  dataType: 'long_text',
  typeConfig: { kind: 'long_text' },
  requiredness: { mode: 'never' },
  ownership: ['hr'],
  visibility: ['hr'],
  collectAt: 'hr_only',
  classification: {
    classification: 'confidential',
    piiKind: 'identity',
    exportable: true,
    aiEligible: false,
  },
  classificationSource: 'human',
  origin: 'tenant',
} as const;

const define = (over: Record<string, unknown> = {}) =>
  AttributeDefinition.safeParse({ ...base, ...over });

describe('special-category data', () => {
  const special = {
    classification: {
      classification: 'special-category',
      piiKind: 'health',
      exportable: true,
      aiEligible: false,
    },
  };

  it('is refused when it claims to be AI-eligible', () => {
    expect(
      define({ classification: { ...special.classification, aiEligible: true } }).success,
    ).toBe(false);
  });

  it('is refused when it claims to travel on an event', () => {
    // The same value in every consumer's log, every backup of that log, and a
    // subject access request that now has to find all of them.
    expect(define({ ...special, includeInEvents: true }).success).toBe(false);
  });

  it('is accepted when it does neither', () => {
    expect(define(special).success).toBe(true);
  });
});

describe('financial data', () => {
  const financial = {
    dataType: 'bank_account',
    typeConfig: { kind: 'bank_account', country: 'ES' },
    classification: {
      classification: 'confidential',
      piiKind: 'financial',
      exportable: true,
      aiEligible: false,
    },
  };

  it('is refused unless it is encrypted', () => {
    expect(define(financial).success).toBe(false);
  });

  it('is accepted once it is', () => {
    expect(define({ ...financial, encrypted: true }).success).toBe(true);
  });

  it('cannot be encrypted and indexed at the same time', () => {
    // A generated column over a decrypted value is the plaintext with an index
    // on it.
    expect(define({ ...financial, encrypted: true, indexed: true }).success).toBe(false);
  });

  it('cannot be encrypted and in the directory', () => {
    expect(define({ ...financial, encrypted: true, includeInDirectory: true }).success).toBe(false);
  });
});

describe('whether a value rides on an event', () => {
  it('defaults to false for anything confidential or above', () => {
    // "Did anybody remember to untick this" is the wrong question to be asking
    // about a field called "Disciplinary outcome".
    const parsed = AttributeDefinition.parse(base);
    expect(parsed.includeInEvents).toBe(false);
  });

  it('defaults to true for public and internal fields', () => {
    const parsed = AttributeDefinition.parse({
      ...base,
      classification: {
        classification: 'internal',
        piiKind: 'none',
        exportable: true,
        aiEligible: true,
      },
    });
    expect(parsed.includeInEvents).toBe(true);
  });

  it('can still be set explicitly for a confidential field', () => {
    // Defaulted, not forbidden. A confidential field a consumer genuinely
    // needs is a decision somebody makes on purpose.
    const parsed = AttributeDefinition.parse({ ...base, includeInEvents: true });
    expect(parsed.includeInEvents).toBe(true);
  });
});

describe('the rest of the shape', () => {
  it('refuses a configuration describing a different type', () => {
    expect(
      define({
        dataType: 'text',
        typeConfig: { kind: 'select', options: [{ value: 'one', label: { default: 'One' } }] },
      }).success,
    ).toBe(false);
  });

  it('refuses a field nobody may write', () => {
    expect(define({ ownership: [] }).success).toBe(false);
  });

  it('allows a field nobody may read, as long as nobody is asked for it', () => {
    // Diversity self-identification: visible to nobody as an individual value,
    // including HR and including the tenant's own administrators.
    expect(define({ visibility: [], ownership: ['employee'] }).success).toBe(true);
  });

  it('refuses a required field nobody may read', () => {
    expect(
      define({ visibility: [], requiredness: { mode: 'always' } }).success,
    ).toBe(false);
  });

  it('refuses a key that is not a key', () => {
    expect(define({ key: 'Accommodation Notes' }).success).toBe(false);
  });

  it('refuses a definition with no classification at all', () => {
    // There is no "decide later" state. §12.2.
    const without: Record<string, unknown> = { ...base };
    delete without['classification'];
    expect(AttributeDefinition.safeParse(without).success).toBe(false);
  });
});
