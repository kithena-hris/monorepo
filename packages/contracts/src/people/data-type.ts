import * as z from 'zod';

import { CountryCode } from '../address.js';
import { asInternal, asPublic, policy } from '../classification.js';
import { AttributeKey, LocalizedString } from './primitives.js';

/**
 * What kind of thing a field holds, and what configuring it means.
 *
 * The catalogue is deliberately long. Every type missing from it becomes a
 * `long_text` holding something nobody can validate, index, classify or
 * export as anything but a string — and the field that gets modelled that way
 * is always the national identifier, because it is the one the shipped types
 * did not cover.
 */
export const AttributeDataType = z.enum([
  'text',
  'long_text',
  'number',
  'decimal',
  'percentage',
  'money',
  'boolean',
  'date',
  'datetime',
  'duration',
  'select',
  'multi_select',
  'tags',
  'email',
  'phone',
  'url',
  'country',
  'currency',
  'language',
  'time_zone',
  'address',
  'national_id',
  'bank_account',
  'person_ref',
  'org_unit_ref',
  'legal_entity_ref',
  'location_ref',
  'document_ref',
  'image',
  // Registered as a policy-bearing leaf because an event carries this enum
  // directly, and the codegen walk classifies leaves rather than guessing.
]).register(policy, asPublic());
export type AttributeDataType = z.infer<typeof AttributeDataType>;

/**
 * One choice in a `select`.
 *
 * The value is a key rather than the label, and that separation is the whole
 * reason this is an object. A tenant who renames "Part time" to "Part-time"
 * must not thereby rewrite every record that held it, and an export that
 * round-trips has to match on something that survives a relabel.
 */
export const SelectOption = z.object({
  value: AttributeKey,
  label: LocalizedString,
  /**
   * Hidden from new answers, kept on the records that already hold it. The
   * honest alternative to deleting an option somebody's record still points
   * at, which would silently blank a field.
   */
  retiredAt: z.iso.datetime({ offset: true }).nullable().default(null).register(policy, asInternal()),
});
export type SelectOption = z.infer<typeof SelectOption>;

const options = z
  .array(SelectOption)
  .min(1, 'a select needs at least one option')
  .refine(
    (list) => new Set(list.map((o) => o.value)).size === list.length,
    'two options cannot share a value',
  );

/**
 * A plain type with nothing to configure.
 *
 * Still a member of the union rather than an absent `typeConfig`, because a
 * discriminated union is what makes the compiler ask "which type is this"
 * before reading a field that only some types have. An optional bag would make
 * every reader of `typeConfig.options` check for undefined by hand, and one of
 * them would forget.
 */
const plain = <T extends AttributeDataType>(kind: T) => z.object({ kind: z.literal(kind) });

/**
 * Bounds on a number, as bounds rather than as a regex.
 *
 * `decimals` is on the config and not implied by the data type because the
 * question "how many decimal places does this tenant's FTE have" has no
 * universal answer, and storing 0.5 as 0.50 or 0.5000 changes what an export
 * shows and what a payroll integration reads.
 */
const numeric = <T extends AttributeDataType>(kind: T) =>
  z
    .object({
      kind: z.literal(kind),
      min: z.number().nullable().default(null).register(policy, asInternal()),
      max: z.number().nullable().default(null).register(policy, asInternal()),
      decimals: z.int().min(0).max(6).default(0).register(policy, asInternal()),
    })
    .refine((c) => c.min === null || c.max === null || c.min <= c.max, {
      message: 'a minimum above its maximum can never be satisfied',
      path: ['min'],
    });

export const AttributeTypeConfig = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    maxLength: z.int().positive().max(1000).default(200).register(policy, asInternal()),
    /**
     * A shape, named rather than authored.
     *
     * A customer-supplied regular expression is a customer-supplied denial of
     * service — catastrophic backtracking is one nested quantifier away — and
     * the shapes people actually want are a short list. A tenant needing
     * something not on it uses `text` and the field editor's description.
     */
    pattern: z
      .enum(['any', 'alphanumeric', 'digits', 'uppercase_alphanumeric'])
      .default('any')
      .register(policy, asInternal()),
  }),
  z.object({
    kind: z.literal('long_text'),
    maxLength: z.int().positive().max(20_000).default(4000).register(policy, asInternal()),
  }),

  numeric('number'),
  numeric('decimal'),
  numeric('percentage'),
  numeric('duration'),

  /**
   * Money, which is `Money` — minor units and a currency.
   *
   * There is no scale here and no `decimals`, and that absence is the rule
   * this repository already has: money is never a float, so the only question
   * a config can ask is which currency. A `min` or a `max` is in minor units
   * for the same reason.
   */
  z.object({
    kind: z.literal('money'),
    /**
     * Null means the record's own currency decides — a salary in a
     * multi-country tenant is not one currency. A fixed code is for a field
     * that genuinely is, like a statutory allowance.
     */
    currency: z.string().length(3).nullable().default(null).register(policy, asPublic()),
    minMinor: z.int().nullable().default(null).register(policy, asInternal()),
    maxMinor: z.int().nullable().default(null).register(policy, asInternal()),
  }),

  plain('boolean'),

  z.object({
    kind: z.literal('date'),
    /**
     * Which side of today a date may fall on. A birth date is in the past, a
     * probation end is in the future, and a tenant marking the wrong one finds
     * out from an employee rather than from a validation message.
     */
    range: z.enum(['any', 'past', 'future']).default('any').register(policy, asInternal()),
  }),
  z.object({
    kind: z.literal('datetime'),
    range: z.enum(['any', 'past', 'future']).default('any').register(policy, asInternal()),
  }),

  z.object({ kind: z.literal('select'), options }),
  z.object({
    kind: z.literal('multi_select'),
    options,
    maxSelections: z.int().positive().nullable().default(null).register(policy, asInternal()),
  }),
  z.object({
    kind: z.literal('tags'),
    /** Free tags, unlike a select: no option list, so nothing to retire. */
    maxTags: z.int().positive().max(50).default(20).register(policy, asInternal()),
  }),

  plain('email'),
  plain('phone'),
  plain('url'),
  plain('country'),
  plain('currency'),
  plain('language'),
  plain('time_zone'),

  /**
   * An address, which is `PostalAddress` from `address.ts` and not a second
   * definition of one.
   *
   * Nothing to configure: the country on the value decides the subdivision
   * label, the postcode label and the postcode rule, and `checkAddress`
   * already knows all three. A `country` here would be a second place for that
   * answer to live.
   */
  plain('address'),

  /**
   * A national identifier, which is a country's rule and not a string.
   *
   * The country is on the config rather than read from the person, because a
   * tenant asking for a NIF is asking every record for a NIF — including the
   * employee who moved to Berlin last year and still has one.
   */
  z.object({
    kind: z.literal('national_id'),
    country: CountryCode,
    /**
     * Which of that country's identifiers. A country has more than one: Spain
     * has NIF and NIE, India has PAN and Aadhaar, and they validate
     * differently.
     */
    scheme: z.string().min(1).max(32).register(policy, asPublic()),
  }),

  /**
   * A bank account, which is a country's rule and is always a secret.
   *
   * `encrypted` is not configurable here and is not on this shape at all —
   * `AttributeDefinition` forces it true for anything financial, which is the
   * one place it cannot be forgotten.
   */
  z.object({
    kind: z.literal('bank_account'),
    country: CountryCode,
    format: z.enum(['iban', 'local']).default('iban').register(policy, asPublic()),
  }),

  plain('person_ref'),
  plain('org_unit_ref'),
  plain('legal_entity_ref'),
  plain('location_ref'),

  /**
   * A reference to a document, never the bytes.
   *
   * People stores a pointer — at the Documents module when it exists, at
   * object storage when it does not. A module that started storing files would
   * need its own retention, its own virus scanning and its own export path,
   * all of which belong to whoever owns documents.
   */
  z.object({
    kind: z.literal('document_ref'),
    /** Media types, checked at upload. Empty means the platform's default set. */
    accepts: z.array(z.string().min(1)).default([]).register(policy, asInternal()),
    maxBytes: z
      .int()
      .positive()
      .max(100 * 1024 * 1024)
      .default(10 * 1024 * 1024)
      .register(policy, asInternal()),
  }),
  z.object({
    kind: z.literal('image'),
    maxBytes: z
      .int()
      .positive()
      .max(20 * 1024 * 1024)
      .default(5 * 1024 * 1024)
      .register(policy, asInternal()),
  }),
]);
export type AttributeTypeConfig = z.infer<typeof AttributeTypeConfig>;

/**
 * Whether a definition's `dataType` and its `typeConfig` agree.
 *
 * Two fields naming the same thing is a shape that can disagree, and the
 * alternative — deriving the type from the config's discriminant — would make
 * every query that filters by data type reach inside a JSONB column. This is
 * the check that keeps them honest, and `AttributeDefinition` runs it.
 */
export function configMatchesType(
  dataType: AttributeDataType,
  config: AttributeTypeConfig,
): boolean {
  return config.kind === dataType;
}
