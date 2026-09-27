import * as z from 'zod';

import { asInternal, asPublic, policy } from './classification.js';
import { AttributeKey } from './people/primitives.js';

/**
 * The tenant's own questions for the sign-up page:
 * `PUT /api/internal/tenants/<id>/signup-questions`, a `SignupQuestionSet`.
 *
 * A People field marked `collectAt: signup` or `enrolment` is asked on the
 * auth origin, before the passkey (PRD §8.3). Identity renders that page and
 * may not import People or read its schema, so People reports the set the way
 * it reports its administrator roles (`module-roles.ts`): the whole set each
 * time, newest `asOf` wins, sent when a schema version is published and for
 * every tenant at boot and daily.
 *
 * **Only what a form needs, never a value.** And only fields the PRD allows
 * on that page: public or internal, not financial, not encrypted, not
 * special-category, single-valued, and one the employee may write. People
 * filters (`signupQuestions`), and identity refuses a set that says otherwise,
 * because the answers then ride `identity.account.signup_answered` — which is
 * only acceptable for data classified no higher than internal.
 */

/** The shapes a sign-up form renders. Anything else waits for onboarding. */
export const SignupDataType = z
  .enum([
    'text',
    'long_text',
    'number',
    'decimal',
    'boolean',
    'date',
    'select',
    'email',
    'phone',
    'url',
  ])
  .register(policy, asPublic());
export type SignupDataType = z.infer<typeof SignupDataType>;

const Label = z.string().min(1).max(200).register(policy, asInternal());

export const SignupQuestion = z.object({
  key: AttributeKey,
  label: Label,
  description: z.string().max(1000).nullable().register(policy, asInternal()),
  dataType: SignupDataType,
  /** Asked of everybody (`requiredness: always`). A conditional field is asked but optional. */
  required: z.boolean().register(policy, asPublic()),
  /** A select's live options, in order. Empty for every other type. */
  options: z
    .array(z.object({ value: AttributeKey, label: Label }))
    .max(200)
    .register(policy, asInternal()),
  /** Text: the longest answer taken. Null for anything else. */
  maxLength: z.int().positive().max(20_000).nullable().register(policy, asInternal()),
  /** Number and decimal: bounds and places. Null where not set. */
  min: z.number().nullable().register(policy, asInternal()),
  max: z.number().nullable().register(policy, asInternal()),
  decimals: z.int().min(0).max(6).nullable().register(policy, asInternal()),
  /** Never higher than internal: see the file comment. */
  classification: z.enum(['public', 'internal']).register(policy, asPublic()),
});
export type SignupQuestion = z.infer<typeof SignupQuestion>;

export const SignupQuestionSet = z.object({
  /** When People read its schema. An older set than the one kept is ignored. */
  asOf: z.iso.datetime({ offset: true }).register(policy, asInternal()),
  /** The published schema version the questions come from; 0 before any. */
  schemaVersion: z.int().nonnegative().register(policy, asPublic()),
  questions: z.array(SignupQuestion).max(30),
});
export type SignupQuestionSet = z.infer<typeof SignupQuestionSet>;

/** One answer as it travels: never an object, never a list. */
export const SignupAnswerValue = z.union([z.string().max(20_000), z.number(), z.boolean()]);
export type SignupAnswerValue = z.infer<typeof SignupAnswerValue>;

export interface SignupAnswerProblem {
  /** The question's key: the input to point at. */
  readonly field: string;
  readonly message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const PHONE = /^\+?[0-9 ().-]{5,32}$/u;

/**
 * The answers worth keeping from whatever a form sent, or the first wrong one.
 *
 * One definition for both readers, like `checkPersonName`: the page runs it
 * before the passkey step so a refusal lands on a form, and identity runs it
 * again at the boundary because the page is a convenience, not enforcement.
 * People validates once more on its own write path, against the schema in
 * force — this is shape and requiredness, not the registry's last word.
 *
 * An empty optional answer is dropped rather than sent as an empty string. A
 * key the set does not ask is dropped too, never forwarded: it is not this
 * page's to write, and refusing it would turn a question answered a moment ago
 * — or a set People replaced while the page was open — into a second ceremony.
 */
export function checkSignupAnswers(
  questions: readonly SignupQuestion[],
  input: unknown,
):
  | { ok: true; value: Record<string, SignupAnswerValue> }
  | { ok: false; problem: SignupAnswerProblem } {
  const raw: Record<string, unknown> =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const value: Record<string, SignupAnswerValue> = {};
  for (const question of questions) {
    const given = raw[question.key];
    const blank =
      given === undefined || given === null || (typeof given === 'string' && given.trim() === '');
    if (blank) {
      if (question.required) {
        return { ok: false, problem: { field: question.key, message: 'This is required' } };
      }
      continue;
    }
    const checked = checkOne(question, given);
    if (typeof checked === 'string') {
      return { ok: false, problem: { field: question.key, message: checked } };
    }
    value[question.key] = checked.value;
  }
  return { ok: true, value };
}

function checkOne(q: SignupQuestion, given: unknown): { value: SignupAnswerValue } | string {
  switch (q.dataType) {
    case 'boolean':
      return typeof given === 'boolean' ? { value: given } : 'Choose yes or no';
    case 'number':
    case 'decimal': {
      const n = typeof given === 'number' ? given : typeof given === 'string' ? Number(given) : NaN;
      if (!Number.isFinite(n)) return 'Enter a number';
      const places = q.decimals ?? (q.dataType === 'number' ? 0 : 6);
      if (Math.round(n * 10 ** places) / 10 ** places !== n) {
        return places === 0
          ? 'Enter a whole number'
          : `Use at most ${String(places)} decimal places`;
      }
      if (q.min !== null && n < q.min) return `The smallest allowed is ${String(q.min)}`;
      if (q.max !== null && n > q.max) return `The largest allowed is ${String(q.max)}`;
      return { value: n };
    }
    default: {
      if (typeof given !== 'string') return 'Enter some text';
      const text = given.trim();
      if (q.maxLength !== null && text.length > q.maxLength) {
        return `Keep this under ${String(q.maxLength)} characters`;
      }
      if (q.dataType === 'select' && !q.options.some((o) => o.value === text))
        return 'Choose one of the options';
      if (
        q.dataType === 'date' &&
        (!DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)))
      ) {
        return 'Enter a date';
      }
      if (q.dataType === 'email' && !z.email().safeParse(text).success)
        return 'Enter an email address';
      if (q.dataType === 'phone' && !PHONE.test(text)) return 'Enter a phone number';
      if (q.dataType === 'url' && !/^https?:\/\//u.test(text))
        return 'Enter a web address starting with https://';
      return { value: text };
    }
  }
}
