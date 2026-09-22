import * as z from 'zod';

import { Instant } from '../primitives.js';
import { asInternal, asPublic, policy } from '../classification.js';
import { AttributeDataType, AttributeTypeConfig, configMatchesType } from './data-type.js';
import { FieldPolicySchema } from './policy.js';
import { AttributeKey, LocalizedString, SectionKey } from './primitives.js';
import { Requiredness } from './requiredness.js';

/**
 * One field on a person record, as the registry holds it.
 *
 * This is the object the whole module is shaped around: a form renders it, an
 * API validates against it, an export makes a column of it, a webhook filters
 * on it and a retention job reads its policy. Which is why the refinements at
 * the bottom are not stylistic — each one is a way a value reaches somewhere it
 * must never be, closed at the only point every writer passes through.
 */

/** Who may write a field. */
export const WriterRole = z
  .enum(['employee', 'manager', 'hr', 'finance', 'system', 'external'])
  .register(policy, asPublic());
export type WriterRole = z.infer<typeof WriterRole>;

/**
 * Who may read a field.
 *
 * The relations mirror the OpenFGA tuples in §6.6 rather than inventing a
 * second permission vocabulary. An empty list is meaningful and is not an
 * oversight: diversity self-identification is visible to nobody as an
 * individual value, including HR and including the tenant's own
 * administrators, and is answerable only in aggregate.
 */
export const ViewerScope = z
  .enum(['self', 'manager', 'manager_chain', 'hr', 'finance', 'admin', 'directory'])
  .register(policy, asPublic());
export type ViewerScope = z.infer<typeof ViewerScope>;

/** Which moment asks for the value. */
export const CollectAt = z
  .enum(['signup', 'enrolment', 'onboarding', 'hr_only', 'anytime'])
  .register(policy, asPublic());
export type CollectAt = z.infer<typeof CollectAt>;

/**
 * Who chose the classification, kept because it is the audit question.
 *
 * `suggested` means a model proposed it and a human accepted it — which is a
 * different fact from a human picking it unprompted, and a works council
 * asking "who decided this field was internal" deserves the true answer.
 */
export const ClassificationSource = z
  .enum(['human', 'suggested', 'section_default'])
  .register(policy, asPublic());
export type ClassificationSource = z.infer<typeof ClassificationSource>;

/** Whether Kithena ships it, a country pack ships it, or the customer invented it. */
export const AttributeOrigin = z
  .enum(['core', 'country_pack', 'tenant'])
  .register(policy, asPublic());
export type AttributeOrigin = z.infer<typeof AttributeOrigin>;

const shape = z.object({
  key: AttributeKey,
  sectionKey: SectionKey,
  label: LocalizedString,
  description: LocalizedString.nullable().default(null),
  order: z.int().nonnegative().default(0).register(policy, asInternal()),

  dataType: AttributeDataType,
  typeConfig: AttributeTypeConfig,
  /** A repeating attribute is a group: emergency contacts, education, grants. */
  cardinality: z.enum(['single', 'repeating']).default('single').register(policy, asPublic()),

  requiredness: Requiredness,
  ownership: z.array(WriterRole).min(1, 'a field nobody may write cannot be filled in'),
  /** Empty is legitimate. See `ViewerScope`. */
  visibility: z.array(ViewerScope),
  collectAt: CollectAt,

  classification: FieldPolicySchema,
  classificationSource: ClassificationSource,

  /** Whether a change is a dated fact (salary, job title) or a correction. */
  effectiveDated: z.boolean().default(false).register(policy, asPublic()),
  uniqueScope: z
    .enum(['none', 'tenant', 'legal_entity'])
    .default('none')
    .register(policy, asPublic()),

  /** Value lives in `people.person_secret`, never in JSONB and never in an event. */
  encrypted: z.boolean().default(false).register(policy, asPublic()),
  /** Promoted to a generated column so a 50,000-row directory can filter on it. */
  indexed: z.boolean().default(false).register(policy, asPublic()),
  includeInDirectory: z.boolean().default(false).register(policy, asPublic()),
  /**
   * Whether the **value** — not just the key — rides on the event payload.
   *
   * Defaulted rather than left to the caller, and the default is computed from
   * the classification below, because "did anybody remember to set this to
   * false" is the wrong question to be asking about a salary.
   */
  includeInEvents: z.boolean().optional().register(policy, asPublic()),

  origin: AttributeOrigin,
  /** Hidden from forms, still exported, still in history. */
  deprecatedAt: Instant.nullable().default(null),
});

/**
 * Whether a value may ride on an event by default.
 *
 * False for anything `confidential` or above. A default that travelled would
 * mean a tenant creating a field called "Disciplinary outcome" publishes its
 * contents to every consumer of the People topic unless somebody noticed a
 * checkbox.
 */
function travelsByDefault(classification: z.infer<typeof FieldPolicySchema>): boolean {
  return classification.classification === 'public' || classification.classification === 'internal';
}

export const AttributeDefinition = shape
  .transform((a) => ({
    ...a,
    includeInEvents: a.includeInEvents ?? travelsByDefault(a.classification),
  }))
  /*
   * Article 9 data never reaches a model and never rides on an event.
   *
   * Both halves matter and they fail differently. `aiEligible` is a prompt
   * carrying a health condition to a third-party model; `includeInEvents` is
   * the same value in every consumer's Kafka log, every one of their backups,
   * and a subject access request that now has to find all of them. Neither is
   * a decision a settings screen is allowed to make.
   */
  .refine(
    (a) =>
      a.classification.classification !== 'special-category' ||
      (!a.classification.aiEligible && !a.includeInEvents),
    {
      message: 'special-category data is never AI-eligible and never travels on an event',
      path: ['classification'],
    },
  )
  /*
   * Financial data is encrypted at rest, whatever the form said.
   *
   * A bank account in `custom` is a bank account in a JSONB column, in a GIN
   * index, in a logical replication slot and in whatever a support engineer
   * pasted into a ticket. `people.person_secret` exists precisely so that path
   * has no way of being taken by accident.
   */
  .refine((a) => a.classification.piiKind !== 'financial' || a.encrypted, {
    message: 'financial data is always encrypted at rest',
    path: ['encrypted'],
  })
  /*
   * An encrypted value cannot also be indexed or travel on an event.
   *
   * Both would defeat the encryption in the obvious way: a generated column
   * over a decrypted value is the plaintext with an index on it, and a payload
   * carrying it is the plaintext in somebody else's log.
   */
  .refine((a) => !a.encrypted || (!a.indexed && !a.includeInEvents && !a.includeInDirectory), {
    message: 'an encrypted attribute is not indexed, not in the directory and not in an event',
    path: ['encrypted'],
  })
  /*
   * The type and its configuration describe the same thing.
   *
   * Two fields naming one thing can disagree, and the disagreement renders as
   * a dropdown over a free-text column.
   */
  .refine((a) => configMatchesType(a.dataType, a.typeConfig), {
    message: 'the configuration describes a different data type',
    path: ['typeConfig'],
  })
  /*
   * A required field somebody can see is the point of requiring it.
   *
   * A field required of an employee who cannot see it is a task they cannot
   * complete, shown to them as a nag they cannot answer. The aggregate
   * invariants in the domain check the stricter version of this against the
   * whole section; this catches the case that needs no context at all.
   */
  .refine((a) => a.requiredness.mode === 'never' || a.visibility.length > 0, {
    message: 'a required field nobody may read cannot be filled in',
    path: ['visibility'],
  });

export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

/**
 * The definition as a draft, before the defaults are applied.
 *
 * Exported because a settings screen edits this shape and a patch of it, and
 * the transform above makes `AttributeDefinition` a one-way street: parsing
 * produces a value that no longer round-trips through its own input type.
 */
export const AttributeDefinitionInput = shape;
export type AttributeDefinitionInput = z.input<typeof shape>;
