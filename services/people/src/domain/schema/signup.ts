import { SignupDataType, localized, type SignupQuestion } from '@kithena/contracts';

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

export function signupQuestions(attributes: readonly Attribute[]): SignupQuestion[] {
  return attributes
    .filter(
      (a) =>
        (a.collectAt === 'signup' || a.collectAt === 'enrolment') &&
        a.deprecatedAt === null &&
        a.cardinality === 'single' &&
        a.ownership.includes('employee') &&
        !a.encrypted &&
        a.classification.piiKind !== 'financial' &&
        (a.classification.classification === 'public' ||
          a.classification.classification === 'internal') &&
        RENDERED.has(a.dataType) &&
        !IDENTITY_ASKS.has(a.key),
    )
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
