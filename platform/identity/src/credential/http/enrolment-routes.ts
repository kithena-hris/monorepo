import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import { challengeFrom } from '../domain/client-data.js';
import type { EnrolmentState } from '../domain/enrolment-state.js';
import type { ChallengeStore } from '../application/challenge-store.js';
import type { RelyingParty } from '../application/relying-party.js';
import type { CompleteEnrolment, RegisteredCredential } from '../application/complete-enrolment.js';
import type { SignInWithPasskey } from '../application/sign-in-with-passkey.js';

/**
 * Registering a first passkey.
 *
 * Internal, like the sign-in routes and for the same reason: the browser talks
 * to whichever app owns its origin, and that app talks to this service. What
 * comes back is an account id, not a cookie — cookies belong to whoever owns
 * the origin.
 */
const BEGIN = '/api/internal/webauthn/register/begin';
const FINISH = '/api/internal/webauthn/register/finish';

/**
 * What a link is worth, asked before anybody is prompted for a passkey.
 *
 * The page used to find out by trying — a real biometric prompt, and only then
 * "this link has already been used". Holding the token is what authorises the
 * specific answer; see `EnrolmentState`.
 */
const STATUS = '/api/internal/enrolment/status';

/**
 * Replacing a passkey, gated by the one being replaced.
 *
 * Two steps, and the gate is the first. `BEGIN` verifies an assertion — a real
 * prompt on the device holding the current passkey — and only then issues a
 * registration challenge bound to the identity that assertion proved. `FINISH`
 * spends that challenge, stores the new credential and revokes the old.
 *
 * No enrolment token anywhere in this, which is the point: a link is something
 * somebody can be tricked into forwarding, and possession of the current
 * passkey is not. It is also why this is safe to offer from a page that anybody
 * holding a spent link can open.
 */
const REPLACE_BEGIN = '/api/internal/webauthn/replace/begin';
const REPLACE_FINISH = '/api/internal/webauthn/replace/finish';

const CHALLENGE_TTL_SECONDS = 300;

export interface EnrolmentRoutesDeps {
  readonly rp: RelyingParty;
  readonly challenges: ChallengeStore;
  readonly complete: CompleteEnrolment;
  /** Reads a token's state without spending it, inside the tenant. */
  readonly inspectToken: (tenantId: string, token: string) => Promise<EnrolmentState>;
  /** The assertion check that gates a replacement. Same one sign-in uses. */
  readonly verifyAssertion: SignInWithPasskey;
  /** Their current credentials, so the device is asked not to make a duplicate. */
  readonly credentialIdsOf: (identityId: string) => Promise<readonly string[]>;
  readonly storeCredential: (
    identityId: string,
    credential: RegisteredCredential,
  ) => Promise<string>;
  /**
   * Retire every credential this identity had except the one just made.
   *
   * Replacing means the old one stops working. The usual reason somebody is
   * here is a device they no longer have, and leaving its passkey live would
   * make "replace" mean "add", which is the opposite of what they asked for.
   */
  readonly revokeOtherCredentials: (identityId: string, keepCredentialId: string) => Promise<void>;
  readonly internalToken: string;
}

export function enrolmentRoutes({
  rp,
  challenges,
  complete,
  inspectToken,
  verifyAssertion,
  credentialIdsOf,
  storeCredential,
  revokeOtherCredentials,
  internalToken,
}: EnrolmentRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0];
    if (
      path !== BEGIN &&
      path !== FINISH &&
      path !== STATUS &&
      path !== REPLACE_BEGIN &&
      path !== REPLACE_FINISH
    ) {
      return false;
    }

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }

    const body = await readJsonBody(request);
    if (body === null || typeof body !== 'object') {
      response.writeHead(400).end();
      return true;
    }
    const input = body as Record<string, unknown>;

    if (path === STATUS) {
      const tenantId = typeof input['tenantId'] === 'string' ? input['tenantId'] : '';
      const token = typeof input['token'] === 'string' ? input['token'] : '';
      if (tenantId === '' || token === '') {
        response.writeHead(400).end();
        return true;
      }

      /*
       * Always 200, with the state in the body.
       *
       * A status code per outcome would make the answer readable from the
       * response line alone, and this endpoint is reached through a proxy that
       * logs those. The distinction is for the person holding the link, in the
       * page they are looking at.
       */
      const state = await inspectToken(tenantId, token);
      response
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ state }));
      return true;
    }

    if (path === REPLACE_BEGIN || path === REPLACE_FINISH) {
      const origin = typeof input['origin'] === 'string' ? input['origin'] : '';
      const presented = input['response'];
      const challenge = challengeFrom(presented);
      if (origin === '' || challenge === null) {
        response.writeHead(400).end();
        return true;
      }

      if (path === REPLACE_BEGIN) {
        // The gate. Everything after this happens for the identity this
        // assertion proved, and for no other.
        const asserted = await verifyAssertion({ response: presented, origin, challenge });
        if (!asserted.ok) {
          // One refusal, like sign-in. Whoever is asking has proved nothing.
          response.writeHead(401, { 'cache-control': 'no-store' }).end();
          return true;
        }

        const identityId = asserted.value.identityId;
        const { options, challenge: registration } = await rp.beginRegistration({
          identityId,
          displayName: typeof input['displayName'] === 'string' ? input['displayName'] : 'Kithena',
          // So the device offers to make a *new* passkey rather than silently
          // overwriting the one being replaced before it has been revoked.
          excludeCredentialIds: [...(await credentialIdsOf(identityId))],
          // The same policy first enrolment uses. A replacement is not the
          // moment to raise the bar: somebody whose device is gone would be
          // told to produce a hardware key they were never asked for.
          requireHardwareBound: false,
        });

        // The challenge carries the subject, which is what stops `finish` from
        // having to be told whose identity to register against — a value a
        // caller could otherwise choose.
        await challenges.issue(
          registration,
          { purpose: 'registration', subject: identityId },
          CHALLENGE_TTL_SECONDS,
        );

        response
          .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify({ options }));
        return true;
      }

      const issued = await challenges.consume(challenge);
      if (issued === null || issued.purpose !== 'registration' || issued.subject === null) {
        response.writeHead(401, { 'cache-control': 'no-store' }).end();
        return true;
      }

      const verdict = await rp.finishRegistration(presented, { challenge, origin });
      const credentialId = await storeCredential(issued.subject, verdict);
      await revokeOtherCredentials(issued.subject, credentialId);

      response
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ replaced: true }));
      return true;
    }

    if (path === BEGIN) {
      // The identity is named by the caller, which holds the internal token and
      // has already checked the enrolment link. Naming it rather than deriving
      // it from the link keeps this reusable for adding a second passkey, where
      // there is no link at all.
      if (typeof input['identityId'] !== 'string' || typeof input['displayName'] !== 'string') {
        response.writeHead(400).end();
        return true;
      }

      const { options, challenge } = await rp.beginRegistration({
        identityId: input['identityId'],
        displayName: input['displayName'],
        excludeCredentialIds: Array.isArray(input['exclude'])
          ? input['exclude'].filter((id): id is string => typeof id === 'string')
          : [],
        requireHardwareBound: false,
      });

      await challenges.issue(
        challenge,
        { purpose: 'registration', subject: input['identityId'] },
        CHALLENGE_TTL_SECONDS,
      );

      response
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ options }));
      return true;
    }

    if (
      typeof input['tenantId'] !== 'string' ||
      typeof input['origin'] !== 'string' ||
      typeof input['token'] !== 'string'
    ) {
      response.writeHead(400).end();
      return true;
    }

    const challenge = challengeFrom(input['response']);
    if (challenge === null) {
      response
        .writeHead(401, { 'content-type': 'application/json' })
        .end(JSON.stringify({ reason: 'passkey_rejected' }));
      return true;
    }

    // Spent here as well as issued above: a registration challenge must not
    // outlive its one use any more than an authentication one.
    const issued = await challenges.consume(challenge);
    if (!issued || issued.purpose !== 'registration') {
      response
        .writeHead(401, { 'content-type': 'application/json' })
        .end(JSON.stringify({ reason: 'link_used_or_expired' }));
      return true;
    }

    const result = await complete({
      tenantId: input['tenantId'],
      token: input['token'],
      response: input['response'],
      origin: input['origin'],
      challenge,
    });

    if (!result.ok) {
      // The reason travels, unlike on sign-in. `complete` decides what is safe
      // to say; this only carries it.
      response
        .writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ reason: result.error.path?.[0] ?? 'link_invalid' }));
      return true;
    }

    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(result.value));
    return true;
  };
}
