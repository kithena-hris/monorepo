import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  SignupDataType,
  localized,
  type AttributeDefinition,
  type SignupQuestion,
} from '@kithena/contracts';

import type { Attribute } from './draft.js';

/**
 * The fields the auth origin asks before the passkey, from the schema in force.
 *
 * PRD §8.3: a field at `collectAt: signup` or `enrolment` is asked on the
 * sign-up page, and that page may hold "identity's own fields plus a strictly
 * bounded set — nothing confidential, nothing financial, nothing
 * special-category". So a field placed there is asked only when it is also:
 *
 * - public or internal, not encrypted and not financial — its answer rides
 *   `identity.account.signup_answered`, which is classified internal;
 * - one the employee may write, since it is the employee answering;
 * - single-valued, live, and of a type the page renders (`SignupDataType`).
 *
 * A field placed at sign-up that fails any of those is not dropped from the
 * record, only from that page: it stays required where it is required, and
 * the person's missing-information prompts ask for it after first sign-in.
 *
 * The legal and preferred names are never in the set. Identity asks them on
 * the same page already, and publishes them on `profile_captured`.
 */
const IDENTITY_ASKS = new Set(['given_name', 'family_name', 'preferred_name', 'work_email']);
const RENDERED = new Set<string>(SignupDataType.options);

/** Placed at sign-up or enrolment. */
export const atSignup = (a: Pick<AttributeDefinition, 'collectAt'>): boolean =>
  a.collectAt === 'signup' || a.collectAt === 'enrolment';

/**
 * Asked on identity's sign-up page, before the passkey. A field placed at
 * sign-up that is not is asked on the first screen after it instead.
 */
export function onSignupPage(a: AttributeDefinition): boolean {
  return (
    atSignup(a) &&
    a.deprecatedAt === null &&
    a.cardinality === 'single' &&
    a.ownership.includes('employee') &&
    !a.encrypted &&
    a.classification.piiKind !== 'financial' &&
    (a.classification.classification === 'public' ||
      a.classification.classification === 'internal') &&
    RENDERED.has(a.dataType) &&
    !IDENTITY_ASKS.has(a.key)
  );
}

export type SignupAsk = 'off' | 'optional' | 'required';

/**
 * A field put on, or taken off, the sign-up flow: where it is collected and
 * whether it must be answered. Only a field the employee fills in can be
 * asked of them; the names are identity's own step already. Off moves it to
 * onboarding and leaves its requiredness alone.
 */
export function askAtSignup(
  a: AttributeDefinition,
  ask: SignupAsk,
): Result<{
  readonly collectAt: AttributeDefinition['collectAt'];
  readonly requiredness?: AttributeDefinition['requiredness'];
}> {
  if (ask === 'off') return ok({ collectAt: atSignup(a) ? 'onboarding' : a.collectAt });
  if (!a.ownership.includes('employee') || IDENTITY_ASKS.has(a.key) || a.deprecatedAt !== null) {
    return err(
      failure(
        'NOT_ASKABLE_AT_SIGNUP',
        IDENTITY_ASKS.has(a.key)
          ? `${a.key} is asked on sign-up already, in its own step`
          : 'Only a field the employee fills in can be asked at sign-up',
        ['key'],
      ),
    );
  }
  return ok({
    collectAt: 'signup',
    // Required of whoever signs up from now: the people already here signed
    // up without being asked, and do not turn incomplete overnight.
    requiredness:
      ask === 'optional'
        ? { mode: 'never' }
        : a.requiredness.mode === 'always'
          ? a.requiredness
          : { mode: 'always', requiredFrom: null, appliesTo: 'new_records' },
  });
}

export function signupQuestions(attributes: readonly Attribute[]): SignupQuestion[] {
  return attributes
    .filter(onSignupPage)
    .toSorted((a, b) => a.order - b.order)
    .map((a): SignupQuestion => {
      const config = a.typeConfig;
      const numeric = config.kind === 'number' || config.kind === 'decimal';
      return {
        key: a.key,
        label: localized(a.label),
        description: a.description === null ? null : localized(a.description),
        dataType: a.dataType as SignupQuestion['dataType'],
        // A conditional requirement depends on facts this page does not have.
        // Asked, and optional here; completeness still asks for it after.
        required: a.requiredness.mode === 'always',
        options:
          config.kind === 'select'
            ? config.options
                .filter((o) => o.retiredAt === null)
                .map((o) => ({ value: o.value, label: localized(o.label) }))
            : [],
        maxLength: config.kind === 'text' || config.kind === 'long_text' ? config.maxLength : null,
        min: numeric ? config.min : null,
        max: numeric ? config.max : null,
        decimals: numeric ? config.decimals : null,
        classification: a.classification.classification as SignupQuestion['classification'],
      };
    });
}
