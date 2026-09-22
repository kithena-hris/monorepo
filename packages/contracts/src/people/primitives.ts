import * as z from 'zod';

import { asInternal, asPublic, policy } from '../classification.js';

/**
 * The vocabulary the People registry is built from.
 *
 * A tenant defines their own fields here, which is the point of the module —
 * and the reason these three types are worth their own file. A key chosen by a
 * customer on a Tuesday afternoon ends up in a Kafka payload, a CSV header, an
 * OpenAPI schema and somebody's integration, so the rules about what a key may
 * look like are a contract rather than a form validation.
 */

/**
 * How long a key may be.
 *
 * Long enough for the compound names a real registry grows —
 * `emergency_contact_relationship` is 31 — and short enough to stay legible as
 * a CSV header and a JSON key. A bound rather than a rule: the shape below is
 * the rule.
 */
export const KEY_MAX = 64;

/**
 * What a key may be made of: lowercase, digits and underscores, starting with
 * a letter.
 *
 * Deliberately narrower than "a slug". A key is not a label — it is the
 * identifier that appears in `custom->>'employee_number'`, in a column name if
 * the attribute is ever promoted to a generated column, in a two-header-row
 * export, and in the URL of a REST field. Each of those has its own opinion
 * about hyphens, case and leading digits, and the intersection of those
 * opinions is this.
 *
 * A leading digit is refused because a generated column named `2fa_enabled`
 * has to be quoted everywhere forever. Uppercase is refused because Postgres
 * folds an unquoted identifier to lowercase, so `employeeNumber` and
 * `employeenumber` would be two keys in the registry and one column in the
 * database. A hyphen is refused because it is a minus sign in SQL and in
 * roughly every expression language a spreadsheet has.
 */
const KEY_SHAPE = /^[a-z][a-z0-9_]*$/u;

const keySchema = (what: string) =>
  z
    .string()
    .min(1, `A ${what} key is required`)
    .max(KEY_MAX, `A ${what} key must be ${String(KEY_MAX)} characters or fewer`)
    .regex(
      KEY_SHAPE,
      `A ${what} key is lowercase letters, digits and underscores, starting with a letter`,
    );

/**
 * One field's stable identifier. Chosen once and never edited.
 *
 * Immutability is not enforced by this type — a string cannot refuse to be
 * replaced — but by the domain, which has no operation that changes a key. A
 * rename is a new attribute plus a migration of values, offered as an explicit
 * action, because every integration that ever read the old key is still
 * reading it.
 */
export const AttributeKey = keySchema('attribute')
  .brand<'AttributeKey'>()
  .register(policy, asPublic());
export type AttributeKey = z.infer<typeof AttributeKey>;

/** A section's stable identifier. The same rules, for the same reasons. */
export const SectionKey = keySchema('section').brand<'SectionKey'>().register(policy, asPublic());
export type SectionKey = z.infer<typeof SectionKey>;

/**
 * A BCP 47 tag, loosely: a language and an optional region.
 *
 * Checked for shape rather than against a list. The registry of languages
 * changes, and a hard-coded copy refuses a real customer's real locale — the
 * same argument `person-profile.ts` makes about time zones, except that
 * `Intl` offers no equivalent yes-or-no question here.
 */
const LOCALE_SHAPE = /^[a-z]{2,3}(-[A-Z]{2})?$/u;

export const Locale = z
  .string()
  .regex(LOCALE_SHAPE, 'A locale is a language tag such as `en` or `es-ES`')
  .register(policy, asPublic());
export type Locale = z.infer<typeof Locale>;

/**
 * What a human sees, in every language the tenant has.
 *
 * A map with a required default rather than a bare string, and the default is
 * what makes it usable: a tenant who has never thought about localisation
 * writes one entry and never sees the feature, while one who ships in three
 * countries adds two more without a migration. A lookup that misses falls back
 * to `default`, so a half-translated registry renders rather than showing a
 * key to an employee.
 *
 * The key is never localized, and the two are deliberately different shapes so
 * that cannot be forgotten.
 */
export const LocalizedString = z
  .object({
    /** Shown when the reader's locale has no entry. Always present. */
    default: z.string().min(1).max(200).register(policy, asInternal()),
    /**
     * Per-locale overrides. Absent is normal; empty is not the same as absent
     * and is refused, because a blank label renders as a field with no name.
     */
    translations: z
      .record(Locale, z.string().min(1).max(200))
      .default({})
      .register(policy, asInternal()),
  })
  .register(policy, asInternal());
export type LocalizedString = z.infer<typeof LocalizedString>;

/**
 * The label for a reader, with the fallback applied.
 *
 * Here rather than in the UI because two transports render labels — a form and
 * an export header — and a fallback implemented twice is a fallback that
 * disagrees with itself the first time somebody adds a locale.
 */
export function localized(value: LocalizedString, locale?: string): string {
  if (locale === undefined) return value.default;

  const exact = value.translations[locale];
  if (exact !== undefined) return exact;

  // `es-MX` reading a registry that only has `es`. The reverse — `es` reading
  // `es-MX` — is deliberately not done: a regional variant is somebody's
  // considered choice for that region, not a better default for the language.
  const language = locale.split('-')[0];
  if (language !== undefined && language !== locale) {
    const broader = value.translations[language];
    if (broader !== undefined) return broader;
  }

  return value.default;
}
