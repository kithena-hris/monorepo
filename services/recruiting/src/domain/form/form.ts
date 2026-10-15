import { err, failure, ok, type Result } from '@kithena/domain-kit';
import * as z from 'zod';

/**
 * The apply form (Recruiting PRD §8.4, REC-018).
 *
 * A list of typed fields, each required or not, shown or hidden. One
 * definition renders the form on Kithena Jobs, validates the public API and
 * types the stored answer: `answersSchema` builds that Zod schema.
 *
 * What a form may never ask is a domain list, not a setting: refused at save.
 */

export const STANDARD_FIELDS = [
  'name',
  'email',
  'phone',
  'location',
  'cv',
  'cover_letter',
  'linkedin',
  'portfolio',
  'github',
  'right_to_work',
  'notice_period',
  'earliest_start',
  'salary_expectation',
] as const;
export type StandardField = (typeof STANDARD_FIELDS)[number];

export type FieldKind =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'url'
  | 'file'
  | 'yes_no'
  | 'date'
  | 'number'
  | 'choice'
  | 'choices';

export interface FormField {
  /** A standard field's key, or a tenant's own (`custom_<key>`). */
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly shown: boolean;
  readonly options?: readonly string[];
}

const KINDS: Readonly<Record<StandardField, FieldKind>> = {
  name: 'short_text',
  email: 'email',
  phone: 'phone',
  location: 'short_text',
  cv: 'file',
  cover_letter: 'file',
  linkedin: 'url',
  portfolio: 'url',
  github: 'url',
  right_to_work: 'yes_no',
  notice_period: 'short_text',
  earliest_start: 'date',
  salary_expectation: 'number',
};

/** The form a new job starts from: name, email and CV required, the rest offered. */
export function defaultForm(): FormField[] {
  const required = new Set<StandardField>(['name', 'email', 'cv']);
  const shown = new Set<StandardField>([
    'name',
    'email',
    'phone',
    'location',
    'cv',
    'cover_letter',
    'linkedin',
    'right_to_work',
    'earliest_start',
  ]);
  return STANDARD_FIELDS.map((key) => ({
    key,
    label: key.replace(/_/gu, ' ').replace(/^./u, (c) => c.toUpperCase()),
    kind: KINDS[key],
    required: required.has(key),
    shown: shown.has(key),
  }));
}

/**
 * What a form may never ask (PRD §8.4): matched on the field's key and label
 * in English, German and Spanish, so a custom field cannot ask it under
 * another name.
 */
const NEVER_ASK: readonly [RegExp, string][] = [
  [
    /date.?of.?birth|birth.?date|\bdob\b|\bage\b|geburtsdatum|\balter\b|fecha de nacimiento|\bedad\b/iu,
    'date of birth or age',
  ],
  [/photo|picture|headshot|foto|lichtbild|fotograf/iu, 'a photo'],
  [/marital|married|familienstand|verheiratet|estado civil/iu, 'marital status'],
  [/religio|konfession|religión/iu, 'religion'],
  [/health|disabilit|medical|gesundheit|behinderung|salud|discapacidad/iu, 'health'],
  [/pregnan|schwanger|embaraz/iu, 'pregnancy'],
  [
    /nationality|citizenship|staatsangeh|nacionalidad/iu,
    'nationality (ask for the right to work instead)',
  ],
  [/union|gewerkschaft|sindica/iu, 'trade union membership'],
  [
    /gender|sex\b|geschlecht|género|sexo/iu,
    'gender (diversity is asked separately, after the application)',
  ],
  [/ethnic|race|ethnie|raza|etnia/iu, 'ethnicity'],
];

/** Current or past pay, refused where §8.3 bans it; an expectation is allowed. */
export const PAY_HISTORY =
  /current (?:salary|pay)|previous (?:salary|pay)|salary history|pay history|aktuelles gehalt|bisheriges gehalt|salario actual/iu;

export function validateForm(fields: readonly FormField[]): Result<readonly FormField[]> {
  const keys = new Set<string>();
  for (const field of fields) {
    if (keys.has(field.key))
      return err(failure('DUPLICATE_FIELD', `“${field.label}” appears twice`, [field.key]));
    keys.add(field.key);
    for (const [pattern, what] of NEVER_ASK) {
      if (pattern.test(field.key) || pattern.test(field.label)) {
        return err(failure('NEVER_ASK', `An application may never ask for ${what}`, [field.key]));
      }
    }
    if (field.required && !field.shown)
      return err(
        failure('REQUIRED_HIDDEN', `“${field.label}” is required but hidden`, [field.key]),
      );
    if ((field.kind === 'choice' || field.kind === 'choices') && (field.options ?? []).length < 2) {
      return err(failure('OPTIONS', `“${field.label}” needs at least two options`, [field.key]));
    }
  }
  for (const needed of ['name', 'email'] as const) {
    const field = fields.find((f) => f.key === needed);
    if (field === undefined || !field.required) {
      return err(
        failure(
          'CONTACT_REQUIRED',
          'Name and email are always asked: the candidate confirms the email by a code',
          [needed],
        ),
      );
    }
  }
  return ok(fields);
}

export const asksPayHistory = (fields: readonly FormField[]): boolean =>
  fields.some((f) => f.shown && (PAY_HISTORY.test(f.label) || PAY_HISTORY.test(f.key)));

/** A file the candidate sends: an id the upload returned. */
const FileRef = z.object({ fileId: z.uuid(), name: z.string().max(200) });

function fieldSchema(field: FormField): z.ZodType {
  switch (field.kind) {
    case 'short_text':
      return z.string().trim().min(1).max(300);
    case 'long_text':
      return z.string().trim().min(1).max(10_000);
    case 'email':
      return z.email().max(320);
    case 'phone':
      return z.string().regex(/^\+?[0-9 ()-]{6,20}$/u, 'A phone number');
    case 'url':
      return z.url().max(500);
    case 'file':
      return FileRef;
    case 'yes_no':
      return z.boolean();
    case 'date':
      return z.iso.date();
    case 'number':
      return z.number().int().nonnegative();
    case 'choice':
      return z.enum(field.options as [string, ...string[]]);
    case 'choices':
      return z.array(z.enum(field.options as [string, ...string[]])).min(1);
  }
}

/** The answers' schema for a form: the one definition the site, the API and storage share. */
export function answersSchema(fields: readonly FormField[]): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields.filter((f) => f.shown)) {
    shape[field.key] = field.required ? fieldSchema(field) : fieldSchema(field).optional();
  }
  return z.strictObject(shape);
}
