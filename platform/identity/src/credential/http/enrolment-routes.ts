import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import { challengeFrom } from '../domain/client-data.js';
import type { EnrolmentState } from '../domain/enrolment-state.js';
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

/**
 * What a link is worth, asked before anybody is prompted for a passkey.
 *
 * The page used to find out by trying — a real biometric prompt, and only then
 * "this link has already been used". Holding the token is what authorises the
 * specific answer; see `EnrolmentState`.
 */
const STATUS = '/api/internal/enrolment/status';

/**
 * A fresh setup link for somebody who lost their passkey.
 *
 * This replaced a flow that asked the person to present the passkey they had
 * just lost — correct as a gate and useless in the only situation it existed
 * for. `recoverAccount` explains what was traded away to remove it.
 */
const RECOVER = '/api/internal/enrolment/recover';

const CHALLENGE_TTL_SECONDS = 300;

export interface EnrolmentRoutesDeps {
  readonly rp: RelyingParty;
  readonly challenges: ChallengeStore;
  readonly complete: CompleteEnrolment;
  /** Reads a token's state without spending it, inside the tenant. */
  readonly inspectToken: (tenantId: string, token: string) => Promise<EnrolmentState>;
  /**
   * Sends a fresh setup link, and always succeeds.
   *
   * The signature is declared here rather than imported from the tenancy slice
   * that implements it: `no-cross-slice-imports` forbids credential reaching
   * into tenancy, and is right to. `sign-in.ts` states its account dependency
   * the same way — the slice says what it needs, `composition.ts` supplies it,
   * and neither slice learns the other's shape.
   *
   * Returning nothing is the contract, not an omission. An unknown address and
   * a real one produce the same answer; the difference goes to the log.
   */
  readonly recover: (request: { tenantId: string; workEmail: string }) => Promise<void>;
  readonly internalToken: string;
}

export function enrolmentRoutes({
  rp,
  challenges,
  complete,
  inspectToken,
  recover,
  internalToken,
}: EnrolmentRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== BEGIN && path !== FINISH && path !== STATUS && path !== RECOVER) return false;

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

    if (path === RECOVER) {
      const tenantId = typeof input['tenantId'] === 'string' ? input['tenantId'] : '';
      const workEmail = typeof input['workEmail'] === 'string' ? input['workEmail'] : '';
      if (tenantId === '' || workEmail === '') {
        response.writeHead(400).end();
        return true;
      }

      /*
       * 202 whatever happened, with an empty body.
       *
       * An unknown address, an address at another company and a suspended
       * account are one answer here — anything else is an oracle for whether a
       * given person works at a given company. The reason is in the log.
       *
       * Awaited rather than fired and forgotten: a caller that got 202 before
       * the send was attempted would be told a message is coming when the
       * service that sends it may be unreachable.
       */
      await recover({ tenantId, workEmail });
      response.writeHead(202, { 'cache-control': 'no-store' }).end();
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
