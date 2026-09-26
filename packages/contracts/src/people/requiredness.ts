import * as z from 'zod';

import { CountryCode } from '../address.js';
import { CalendarDate, LegalEntityId } from '../primitives.js';
import { asInternal, asPublic, policy } from '../classification.js';
import { AttributeKey } from './primitives.js';

/**
 * When a field is required, and what "when" is allowed to mean.
 *
 * Three states rather than a boolean, because two are not enough for an
 * employer in more than one country: a NIF is required in Spain and
 * meaningless in Germany, and a registry that can only say yes or no forces
 * the tenant to choose which country's records are wrong.
 *
 * The predicate below is a **closed grammar**. It is not an expression
 * language, it has no functions, no arithmetic and no nesting depth to
 * exhaust, and a customer cannot write a loop in it. That is deliberate: every
 * real requirement in HR is a country, a legal entity, a contract type, a work
 * model, a status, or another field being filled in — and a predicate language
 * a customer *can* write loops in is a support incident waiting for a slow
 * afternoon.
 */

/**
 * The person facts a predicate may read.
 *
 * Six operands, listed in one enum, and the enum is the closure: a predicate
 * naming anything else fails to parse. The alternative — a free-text field
 * name resolved at evaluation time — moves the failure from the settings
 * screen, where an admin can fix it, to the nightly recompute, where it is a
 * log line nobody reads.
 */
export const PredicateOperand = z.enum([
  'legalEntity',
  'country',
  'employmentType',
  'workModel',
  'status',
  'attribute',
]);
export type PredicateOperand = z.infer<typeof PredicateOperand>;

/**
 * The employment shapes requiredness can turn on.
 *
 * Enumerated here rather than left as free text because a predicate comparing
 * against a string the tenant typed is a predicate that silently never matches
 * the day somebody writes "Full-Time".
 */
export const EmploymentType = z.enum([
  'permanent',
  'fixed_term',
  'contractor',
  'intern',
  'apprentice',
  'seasonal',
]);
export type EmploymentType = z.infer<typeof EmploymentType>;

export const WorkModel = z.enum(['onsite', 'hybrid', 'remote']);
export type WorkModel = z.infer<typeof WorkModel>;

/**
 * The lifecycle states, mirrored from §8.1.
 *
 * Declared here as well as in the domain's state machine, in the vocabulary
 * both actually share, for the reason `SecondChannel` gives in identity: a
 * contract importing a domain type inverts the dependency the layering rule
 * exists to hold.
 */
export const PersonStatus = z.enum([
  'provisional',
  'pre_hire',
  'active',
  'on_leave',
  'notice',
  'terminated',
  'discarded',
  'merged',
]);
export type PersonStatus = z.infer<typeof PersonStatus>;

/**
 * One clause. The discriminant is the operand, so each clause carries exactly
 * the values that operand can be compared against — a country clause holds
 * country codes and cannot hold an employment type.
 */
export const PredicateClause = z.discriminatedUnion('operand', [
  z.object({
    operand: z.literal('legalEntity'),
    in: z.array(LegalEntityId).min(1, 'a clause with no values can never hold'),
  }),
  z.object({
    operand: z.literal('country'),
    in: z.array(CountryCode).min(1, 'a clause with no values can never hold'),
  }),
  z.object({
    operand: z.literal('employmentType'),
    in: z.array(EmploymentType).min(1, 'a clause with no values can never hold'),
  }),
  z.object({
    operand: z.literal('workModel'),
    in: z.array(WorkModel).min(1, 'a clause with no values can never hold'),
  }),
  z.object({
    operand: z.literal('status'),
    in: z.array(PersonStatus).min(1, 'a clause with no values can never hold'),
  }),
  /**
   * Another field being filled in, or holding a particular value.
   *
   * `equals` is a string because it is compared against the stored value's
   * canonical form — a select's option key, a country code, a date in ISO
   * form. Comparing against a rendered label would break the first time
   * somebody relabelled an option.
   */
  z.object({
    operand: z.literal('attribute'),
    key: AttributeKey,
    is: z.enum(['set', 'equals']).register(policy, asPublic()),
    equals: z.string().max(200).nullable().default(null).register(policy, asInternal()),
  }).refine((c) => c.is !== 'equals' || c.equals !== null, {
    message: 'an `equals` clause needs something to equal',
    path: ['equals'],
  }),
]);
export type PredicateClause = z.infer<typeof PredicateClause>;

/**
 * Clauses, combined one way.
 *
 * `all` or `any` over a flat list, and no nesting. A tree would let a tenant
 * express a rule nobody can read back out of a settings screen, and the
 * requirement that actually turns up — "required in Spain and Germany for
 * permanent staff" — is one `all` over two `in` clauses.
 *
 * The list is bounded for the same reason the grammar is closed: a predicate
 * is evaluated once per person per publish, and a tenant with 50,000 people
 * should not be able to write a rule that makes that job quadratic by hand.
 */
export const RequirednessPredicate = z.object({
  combine: z.enum(['all', 'any']).default('all').register(policy, asPublic()),
  clauses: z
    .array(PredicateClause)
    .min(1, 'a predicate needs at least one clause')
    .max(10, 'a predicate is ten clauses at most'),
});
export type RequirednessPredicate = z.infer<typeof RequirednessPredicate>;

/**
 * `requiredFrom` and `appliesTo`, which both exist to stop a publish becoming
 * a mass email.
 *
 * `requiredFrom` is a calendar date: required from the 1st, not required
 * retroactively of a record completed on the 30th of the month before.
 * `appliesTo` decides whether existing records are re-evaluated at all — and
 * neither of them blocks anything. §8.4 is explicit that a newly required
 * field makes a record *incomplete*, not unreadable.
 */
const dated = {
  requiredFrom: CalendarDate.nullable().default(null),
  appliesTo: z
    .enum(['all_records', 'new_records'])
    .default('all_records')
    .register(policy, asPublic()),
};

export const Requiredness = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('never') }),
    z.object({ mode: z.literal('always'), ...dated }),
    z.object({ mode: z.literal('conditional'), when: RequirednessPredicate, ...dated }),
  ])
  // Classified as a whole because it travels on `attribute_created` and the
  // codegen walk descends into objects, not into unions. A rule is
  // configuration rather than personal data, so `asInternal` is the honest
  // answer rather than the convenient one.
  .register(policy, asInternal());
export type Requiredness = z.infer<typeof Requiredness>;

/**
 * Which attributes a predicate reads.
 *
 * Used by the domain to notice that a rule names an archived attribute, and by
 * the settings screen to refuse archiving one that a live rule depends on. It
 * is here rather than in the domain because it is a fact about the grammar,
 * and the grammar is defined here.
 */
export function attributesReferenced(requiredness: Requiredness): readonly string[] {
  if (requiredness.mode !== 'conditional') return [];
  return requiredness.when.clauses
    .filter((c) => c.operand === 'attribute')
    .map((c) => c.key as string);
}
