import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  asFinancial,
  asSpecialCategory,
  type FieldPolicy,
} from '../classification.js';
import {
  FieldPolicySchema,
  atLeastAsStrict,
  policyIsCoherent,
  type FieldPolicyInput,
} from './policy.js';

/**
 * One vocabulary, two registries.
 *
 * The static registry classifies fields that exist at build time; the runtime
 * one classifies fields a customer invented this afternoon. Every derived
 * artifact — redaction paths, the AI deny list, the DSAR manifest, retention
 * targets — is the union of both, and a union only makes sense if the two
 * sides are the same shape. These assertions are what make "the same shape" a
 * thing the compiler checks rather than a claim in a comment.
 */
describe('the runtime policy and the static interface', () => {
  it('are assignable in both directions', () => {
    expectTypeOf<FieldPolicyInput>().toExtend<FieldPolicy>();
    expectTypeOf<FieldPolicy>().toExtend<FieldPolicyInput>();
  });

  it('parse what the static presets produce', () => {
    // The presets are what every hand-written contract field uses. A runtime
    // policy that could not express one of them would mean a tenant cannot
    // classify a field the way Kithena's own fields are classified.
    for (const preset of [asFinancial(), asSpecialCategory('health')]) {
      expect(FieldPolicySchema.safeParse(preset).success).toBe(true);
    }
  });

  it('refuse a classification nobody defined', () => {
    expect(
      FieldPolicySchema.safeParse({
        classification: 'secret',
        piiKind: 'none',
        exportable: true,
        aiEligible: false,
      }).success,
    ).toBe(false);
  });

  it('refuse a policy missing an answer', () => {
    // There is no "decide later". A definition without a full policy is the
    // state §12.2 says cannot exist.
    expect(
      FieldPolicySchema.safeParse({ classification: 'internal', piiKind: 'none' }).success,
    ).toBe(false);
  });

  it('keep a statutory floor distinguishable from a tenant choice', () => {
    const parsed = FieldPolicySchema.parse({
      classification: 'confidential',
      piiKind: 'financial',
      exportable: true,
      aiEligible: false,
      retention: { monthsAfterTermination: 24, statutoryFloor: 'es-labour' },
    });
    expect(parsed.retention).toMatchObject({ statutoryFloor: 'es-labour' });
  });
});

describe('the floor a tenant configures above', () => {
  const base: FieldPolicyInput = {
    classification: 'confidential',
    piiKind: 'identity',
    exportable: true,
    aiEligible: false,
  };

  it('refuses special-category data that claims to be AI-eligible', () => {
    expect(policyIsCoherent({ ...base, classification: 'special-category', aiEligible: true })).toBe(
      false,
    );
    expect(policyIsCoherent({ ...base, classification: 'special-category' })).toBe(true);
  });

  it('lets a tenant tighten a core attribute', () => {
    expect(atLeastAsStrict({ ...base, classification: 'special-category' }, base)).toBe(true);
  });

  it('refuses a tenant loosening one', () => {
    // A tenant may relabel `national_id`. They may not make it internal.
    expect(atLeastAsStrict({ ...base, classification: 'internal' }, base)).toBe(false);
  });

  it('refuses a tenant making a withheld field AI-eligible', () => {
    expect(atLeastAsStrict({ ...base, aiEligible: true }, base)).toBe(false);
  });

  it('refuses a tenant withholding a field from a subject access request', () => {
    // Exportability is the subject's right, not the tenant's setting.
    expect(atLeastAsStrict({ ...base, exportable: false }, base)).toBe(false);
  });
});
