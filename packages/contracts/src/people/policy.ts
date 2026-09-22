import * as z from 'zod';

import { asInternal, asPublic, policy } from '../classification.js';

/**
 * `FieldPolicy`, as a schema a tenant's row can be parsed into.
 *
 * The static registry in `classification.ts` classifies fields that exist at
 * build time: `just codegen` walks it and emits the redaction paths, the AI
 * deny list and the DSAR manifest. A tenant-defined attribute created on a
 * Tuesday afternoon is not in that walk, and the guarantee the walk makes has
 * to survive it — so the runtime registry stores the *same* shape, and every
 * derived artifact is computed from the union of the two.
 *
 * **The same vocabulary, not a parallel one.** That is the entire design, and
 * it is why this file is a mirror rather than a new model: two classification
 * vocabularies means two answers to "may this be sent to a model", and the
 * moment they disagree the one that ships is whichever the caller reached for.
 * `policy.test.ts` asserts the two are assignable in both directions, which is
 * what makes "mirror" checkable rather than aspirational.
 */

export const ClassificationSchema = z
  .enum(['public', 'internal', 'confidential', 'special-category'])
  .register(policy, asPublic());

export const PiiKindSchema = z
  .enum(['identity', 'financial', 'contact', 'health', 'biometric', 'none'])
  .register(policy, asPublic());

/**
 * How long after employment ends a value is kept.
 *
 * `statutoryFloor` is not the tenant's to override downward, and that is the
 * only reason it is on the contract rather than in a settings screen: a
 * retention job reading this has to be able to tell "the customer chose 24
 * months" from "Spanish labour law says four years whatever the customer
 * chose".
 */
export const RetentionPolicySchema = z.object({
  monthsAfterTermination: z.int().nonnegative().register(policy, asInternal()),
  statutoryFloor: z
    .enum(['es-labour', 'de-labour', 'eu-payroll'])
    .optional()
    .register(policy, asInternal()),
});

export const FieldPolicySchema = z.object({
  classification: ClassificationSchema,
  piiKind: PiiKindSchema,
  /** Included in a subject access request package. */
  exportable: z.boolean().register(policy, asPublic()),
  /** May be sent to a model. Never true for special-category data. */
  aiEligible: z.boolean().register(policy, asPublic()),
  retention: RetentionPolicySchema.optional(),
});

/**
 * The parsed shape, which must be assignable to the interface and back.
 *
 * Exported so a type-level test can assert it rather than describe it. If
 * `FieldPolicy` gains a field and this schema does not, the assignment in
 * `policy.test.ts` stops compiling — which is the point, because the
 * alternative is a tenant attribute stored without whatever the new field
 * governs.
 */
export type FieldPolicyInput = z.infer<typeof FieldPolicySchema>;

/**
 * The floor a tenant configures above.
 *
 * Special-category data is never AI-eligible, whatever a settings screen was
 * told. Enforced again on `AttributeDefinition`, because a value can reach the
 * registry through an import or an API as well as through a form, and the
 * refinement that catches all three is the one on the definition itself.
 */
export function policyIsCoherent(value: FieldPolicyInput): boolean {
  if (value.classification === 'special-category' && value.aiEligible) return false;
  return true;
}

/**
 * Whether one policy is at least as strict as another.
 *
 * The comparison a core attribute needs: a tenant may relabel `national_id`
 * and may not mark it AI-eligible, may tighten `internal` to `confidential`
 * and may not loosen it back. Ordering classification is what makes
 * "cannot be loosened" a check rather than a code review.
 */
const STRICTNESS = ['public', 'internal', 'confidential', 'special-category'] as const;

export function atLeastAsStrict(candidate: FieldPolicyInput, floor: FieldPolicyInput): boolean {
  const rank = (c: FieldPolicyInput['classification']): number => STRICTNESS.indexOf(c);
  if (rank(candidate.classification) < rank(floor.classification)) return false;
  if (candidate.aiEligible && !floor.aiEligible) return false;
  // Exportability is a subject's right rather than a tenant's setting: a value
  // the floor says belongs in a DSAR package cannot be quietly withheld.
  if (!candidate.exportable && floor.exportable) return false;
  return true;
}
