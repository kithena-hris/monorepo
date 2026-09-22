import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import type { CapturedProfile } from '../../shared/captured-profile.js';
import type { PersonName } from '../../shared/person-name.js';
import type { PersonProfile } from '../../shared/person-profile.js';
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
  /**
   * The account state machine's `enrol`, which enforces the employment start
   * date and publishes what the form captured.
   *
   * `captured` travels with it rather than being written quietly beside the
   * row: a name confirmed here is a name the People module needs, and reading
   * another service's table is not how it would get one. It is absent for a
   * recovery, where the form asks for nothing because the registry already
   * knows this person.
   */
  readonly enrolAccount: (
    accountId: string,
    credentialId: string,
    captured?: CapturedProfile,
  ) => Promise<Result<void>>;
  /**
   * What onboarding asked them to confirm, written before the passkey is.
   *
   * Before, and that order is the point: if the name cannot be stored, nothing
   * else should happen either, and a person who has already created a
   * credential cannot be sent back through a form. It is also the last moment
   * anybody is going to be asked — after this the link is spent and the screen
   * is gone.
   */
  readonly recordName: (accountId: string, name: PersonName) => Promise<void>;
  /**
   * The time zone they confirmed, and a number to reach them on.
   *
   * Written beside the name and for the same reason: this is the last moment
   * anybody is asked. The zone in particular is why this exists — every
   * invitation path defaults it to `Etc/UTC` when HR does not type one, so a
   * clock built from the account read UTC for everybody. The person enrolling
   * is standing in front of the only device that knows the answer.
   */
  readonly recordProfile: (accountId: string, profile: PersonProfile) => Promise<void>;
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
  /**
   * Already checked by `checkName` at the boundary, so this arm holds a name
   * rather than whatever a form posted. Optional because a recovery link
   * replaces a passkey for somebody the registry already knows: asking them to
   * retype their own name to get back in would be a worse screen and a chance
   * to disagree with the row that is already there.
   */
  readonly name?: PersonName;
  /**
   * Already checked by `checkProfile` at the boundary. Optional for the same
   * reason `name` is: a recovery link belongs to somebody whose row already has
   * these, and the form does not ask again.
   */
  readonly profile?: PersonProfile;
}

/**
 * Enrolment says why. Sign-in does not, and the difference is deliberate.
 *
 * A sign-in refusal must be uniform: anyone can present a passkey, so telling
 * them whether the account exists here answers a question that is not theirs to
 * ask.
 *
 * Enrolment is different. Reaching this at all requires a 256-bit token that
 * was handed over out of band, so the person on the other end already holds the
 * secret — "you have already used this link" tells them nothing they could not
 * work out, and not telling them turns a solvable problem into a support call.
 * The reasons are a closed set, so no detail leaks by accident.
 */
export type EnrolmentRefusal =
  'link_invalid' | 'link_used_or_expired' | 'employment_not_started' | 'passkey_rejected';

const refusalOf = (reason: EnrolmentRefusal): ReturnType<typeof failure> =>
  failure('ENROLMENT_FAILED', 'Could not complete enrolment', [reason]);

export type CompleteEnrolment = (
  request: CompleteEnrolmentRequest,
) => Promise<Result<{ accountId: string; credentialId: string }>>;

export function completeEnrolment(deps: CompleteEnrolmentDeps): CompleteEnrolment {
  const refuse = (reason: string, shown: EnrolmentRefusal): Result<never> => {
    // Two vocabularies on purpose: the log gets the precise cause, the caller
    // gets the closed set above.
    deps.onRefusal?.(reason);
    return err(refusalOf(shown));
  };

  return async (request) => {
    if (!isAcceptableOrigin(request.origin, deps.origins)) return refuse('origin', 'link_invalid');

    // Spent here, before the ceremony is checked. A link that has been
    // presented has been out in the world, and a registration that then fails
    // is not a reason to leave it usable.
    const spent = await deps.tokens.consume(request.token);
    if (!spent) return refuse('token', 'link_used_or_expired');

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
    if (!accepted.ok) return refuse('token-stale', 'link_used_or_expired');

    const identityId = await deps.identityOf(spent.accountId);
    if (identityId === null) return refuse('no-identity', 'link_invalid');

    let registered: RegisteredCredential;
    try {
      registered = await deps.verifyRegistration(request.response, {
        challenge: request.challenge,
        origin: request.origin,
      });
    } catch {
      return refuse('attestation', 'passkey_rejected');
    }

    if (request.name !== undefined) await deps.recordName(spent.accountId, request.name);
    if (request.profile !== undefined) await deps.recordProfile(spent.accountId, request.profile);

    const credentialId = await deps.storeCredential(identityId, registered);

    // Last, and it can still refuse: a hire entered three weeks early has an
    // invited account and a valid passkey, and those three weeks are not
    // employment.
    // The number is deliberately left behind. People asks for a mobile itself,
    // under its own classification; an event carrying one to every consumer of
    // the identity stream is a phone number in one more log.
    const captured: CapturedProfile | undefined =
      request.name === undefined
        ? undefined
        : { name: request.name, mobilePresent: request.profile?.mobile != null };

    const enrolled = await deps.enrolAccount(spent.accountId, credentialId, captured);
    if (!enrolled.ok) {
      return refuse(
        enrolled.error.code,
        enrolled.error.code === 'EMPLOYMENT_NOT_STARTED'
          ? 'employment_not_started'
          : 'link_invalid',
      );
    }

    return ok({ accountId: spent.accountId, credentialId });
  };
}
