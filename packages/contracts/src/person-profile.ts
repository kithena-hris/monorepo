import * as z from 'zod';

import { asContact, asInternal, policy } from './classification.js';

/**
 * The two facts onboarding asks for besides a name, defined once.
 *
 * Here rather than in the service that stores them, for the reason
 * `person-name.ts` gives at length: the rule has two readers — the identity
 * service, which refuses a bad value, and the enrolment form, which has to say
 * *which* field is wrong before somebody spends a single-use link — and a
 * client-side copy of a rule is a copy that drifts.
 *
 * ### Why identity holds these and stops
 *
 * A time zone and a mobile number are the same kind of fact as the work address
 * already on `platform.account`: the ceremony and the enrolment rules need
 * them, and neither can wait for a module the customer may not have bought. A
 * job title, a manager, a department, a home address are the People module's,
 * and identity holding them would give one person two records that drift apart.
 */

/**
 * Long enough for every IANA name in the database, which tops out well short of
 * this. A bound rather than a rule about zones: the real check is `isTimeZone`.
 */
export const TIME_ZONE_MAX = 64;

/** Generous. The longest E.164 number is 15 digits, and people type separators. */
export const MOBILE_MAX = 32;

/** Short enough to catch a stray digit, long enough for every real plan. */
const MOBILE_MIN = 6;

/**
 * What a phone number may be made of.
 *
 * Deliberately permissive, and `PhoneField` in the design system says why:
 * numbering plans differ by country and change, so a regex that "validates" a
 * phone number rejects real ones. This refuses what is obviously not a number —
 * letters, a newline, a semicolon someone pasted out of a spreadsheet — and
 * accepts the rest. Anything stricter belongs to a library that tracks the
 * plans, on the day somebody needs one.
 */
const MOBILE_SHAPE = /^\+?[\d\s().-]+$/u;

/** At least this many actual digits, whatever the separators look like. */
const DIGITS = /\d/gu;

/**
 * Whether the runtime recognises this zone.
 *
 * Asked of `Intl` rather than checked against a list, because the list is the
 * IANA database and it changes: zones are added, and a hard-coded copy is a
 * copy that refuses a real employee's real location. `Intl` throws a
 * `RangeError` for an unknown zone, which is the only reliable way to ask.
 */
export function isTimeZone(value: string): boolean {
  if (value === '') return false;
  try {
    // Constructed for its side effect, which is throwing. There is no predicate
    // to call: `Intl.supportedValuesOf('timeZone')` exists but returns the
    // canonical list only, so it refuses `Asia/Calcutta` and every other alias
    // a real employee's device reports.
    // oxlint-disable-next-line no-new
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The profile as a form sends it.
 *
 * `mobile` accepts an empty string and an absence alike — it is optional, and a
 * form that renders an empty input sends the empty string back. Both mean "no
 * number on file", which is not the same as a number somebody deleted; there is
 * nothing here that can tell those apart and nothing that needs to.
 */
export const PersonProfileInput = z.object({
  timeZone: z
    .string()
    .trim()
    .max(TIME_ZONE_MAX, { error: 'That is not a time zone' })
    .refine(isTimeZone, { error: 'That is not a time zone this system knows' })
    .register(policy, asInternal()),
  /*
   * `.nullish()`, not a union with `z.undefined()`. A union that includes
   * undefined still requires the *key* to be present — Zod 4 reports
   * `expected nonoptional, received undefined` for a form that simply did not
   * send the field, which is the ordinary case here and not an error.
   */
  mobile: z
    .string()
    .nullish()
    .transform((value) => (typeof value === 'string' ? value.trim() : ''))
    .transform((value) => (value === '' ? null : value))
    .refine((value) => value === null || MOBILE_SHAPE.test(value), {
      error: 'A phone number can only contain digits, spaces and + ( ) - .',
    })
    .refine((value) => value === null || (value.match(DIGITS)?.length ?? 0) >= MOBILE_MIN, {
      error: `A phone number needs at least ${String(MOBILE_MIN)} digits`,
    })
    .refine((value) => value === null || value.length <= MOBILE_MAX, {
      error: `Keep this under ${String(MOBILE_MAX)} characters`,
    })
    .register(policy, asContact()),
});

export interface PersonProfile {
  /** The IANA zone they work in, which is what a local clock is rendered from. */
  readonly timeZone: string;
  /** A second way to reach them, or null. Never a way to sign in. */
  readonly mobile: string | null;
}

export type PersonProfileProblem = {
  /** Which input to point at. */
  readonly field: 'timeZone' | 'mobile';
  readonly message: string;
};

/**
 * A profile from whatever was submitted, or the first field that is wrong.
 *
 * Returns the problem rather than throwing, because both callers want to show
 * it: the service turns it into a 422 naming the field, and the form puts it
 * under the input.
 */
export function checkPersonProfile(
  input: unknown,
): { ok: true; value: PersonProfile } | { ok: false; problem: PersonProfileProblem } {
  const parsed = PersonProfileInput.safeParse(input);

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path[0];
    return {
      ok: false,
      problem: {
        field: field === 'mobile' ? 'mobile' : 'timeZone',
        message: first?.message ?? 'That is not a time zone this system knows',
      },
    };
  }

  return { ok: true, value: parsed.data };
}
