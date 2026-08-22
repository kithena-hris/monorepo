import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import { challengeFrom } from '../domain/client-data.js';
import type { ChallengeStore } from '../application/challenge-store.js';
import type { RelyingParty } from '../application/relying-party.js';
import type { CompleteEnrolment } from '../application/complete-enrolment.js';

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

const CHALLENGE_TTL_SECONDS = 300;

export interface EnrolmentRoutesDeps {
  readonly rp: RelyingParty;
  readonly challenges: ChallengeStore;
  readonly complete: CompleteEnrolment;
  readonly internalToken: string;
}

export function enrolmentRoutes({ rp, challenges, complete, internalToken }: EnrolmentRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== BEGIN && path !== FINISH) return false;

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
