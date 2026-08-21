import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import { isAcceptableOrigin, type OriginPolicy } from '../../shared/origin.js';
import { tokenStillValid } from '../domain/enrolment-token.js';
import type { EnrolmentTokenStore } from './enrolment-token-store.js';

/**
 * A first passkey, and the account it makes usable.
 *
 * Four things happen and every one of them can refuse. The token is spent
 * whether or not the rest succeeds, which is deliberate: a link presented once
 * is a link that has been out in the world, and a failed registration is not a
 * reason to leave it live.
 *
 * The credential and account operations arrive as functions rather than
 * imports. `no-cross-slice-imports` refuses the alternative and is right to;
 * this states what it needs and `main.ts` supplies it.
 */

/** Structurally what the credential slice's `RegistrationVerdict` provides. */
export interface RegisteredCredential {
  readonly credentialId: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly signCount: number;
  readonly aaguid: string;
  readonly backedUp: boolean;
}

export interface CompleteEnrolmentDeps {
  readonly tokens: EnrolmentTokenStore;
  readonly verifyRegistration: (
    response: unknown,
    expected: { challenge: string; origin: string },
  ) => Promise<RegisteredCredential>;
  /** The human behind an account. Needed because a credential belongs to them, not to the job. */
  readonly identityOf: (accountId: string) => Promise<string | null>;
  readonly storeCredential: (
    identityId: string,
    credential: RegisteredCredential,
  ) => Promise<string>;
  /** The account state machine's `enrol`, which enforces the employment start date. */
  readonly enrolAccount: (accountId: string, credentialId: string) => Promise<Result<void>>;
  readonly origins: OriginPolicy;
  readonly clock: Clock;
  readonly onRefusal?: (reason: string) => void;
}

export interface CompleteEnrolmentRequest {
  readonly tenantId: string;
  readonly token: string;
  readonly response: unknown;
  readonly origin: string;
  readonly challenge: string;
}

const Refused = failure('ENROLMENT_FAILED', 'Could not complete enrolment');

export type CompleteEnrolment = (
  request: CompleteEnrolmentRequest,
) => Promise<Result<{ accountId: string; credentialId: string }>>;

export function completeEnrolment(deps: CompleteEnrolmentDeps): CompleteEnrolment {
  const refuse = (reason: string): Result<never> => {
    deps.onRefusal?.(reason);
    return err(Refused);
  };

  return async (request) => {
    if (!isAcceptableOrigin(request.origin, deps.origins)) return refuse('origin');

    // Spent here, before the ceremony is checked. A link that has been
    // presented has been out in the world, and a registration that then fails
    // is not a reason to leave it usable.
    const spent = await deps.tokens.consume(request.token);
    if (!spent) return refuse('token');

    // `tokenStillValid`, not `acceptToken`. The row that comes back has just
    // had `consumed_at` set by the statement above, so the full rule would
    // refuse every token at the moment it is spent — which is exactly what the
    // integration test caught. Single use is the database's answer here; what
    // is left to check is whose token it was and whether it was in date.
    //
    // Re-asked at all because the rule belongs to the domain rather than to one
    // adapter's SQL, and a second adapter must not be able to skip it by
    // writing a looser query.
    const accepted = tokenStillValid(spent, request.tenantId, deps.clock);
    if (!accepted.ok) return refuse('token');

    const identityId = await deps.identityOf(spent.accountId);
    if (identityId === null) return refuse('no-identity');

    let registered: RegisteredCredential;
    try {
      registered = await deps.verifyRegistration(request.response, {
        challenge: request.challenge,
        origin: request.origin,
      });
    } catch {
      return refuse('attestation');
    }

    const credentialId = await deps.storeCredential(identityId, registered);

    // Last, and it can still refuse: a hire entered three weeks early has an
    // invited account and a valid passkey, and those three weeks are not
    // employment.
    const enrolled = await deps.enrolAccount(spent.accountId, credentialId);
    if (!enrolled.ok) return refuse(enrolled.error.code);

    return ok({ accountId: spent.accountId, credentialId });
  };
}
