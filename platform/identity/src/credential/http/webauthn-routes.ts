import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import { asAddress, type Device } from '../../shared/device.js';
import { challengeFrom } from '../domain/client-data.js';
import type { ChallengeStore } from '../application/challenge-store.js';
import type { RelyingParty } from '../application/relying-party.js';
import type { SignIn } from '../application/sign-in.js';

/**
 * The two calls a login screen makes.
 *
 * Both are internal: the browser talks to whichever app owns its origin, and
 * that app talks to this service. Keeping the browser one hop away is what lets
 * the session id come back in a response body — it never leaves the server that
 * turns it into an `HttpOnly` cookie.
 *
 * It is also what makes headless mode real rather than aspirational. A customer
 * running their own login UI calls exactly these endpoints; there is no private
 * path that `apps/auth` uses and they cannot.
 */
const BEGIN = '/api/internal/webauthn/authenticate/begin';
const FINISH = '/api/internal/webauthn/authenticate/finish';

/** How long a browser has to answer. Long enough for a QR flow on a phone. */
const CHALLENGE_TTL_SECONDS = 300;

export interface WebAuthnRoutesDeps {
  readonly rp: RelyingParty;
  readonly challenges: ChallengeStore;
  readonly signIn: SignIn;
  readonly internalToken: string;
  readonly onRefusal?: (reason: string, detail?: Record<string, unknown>) => void;
}

export function webauthnRoutes({
  rp,
  challenges,
  signIn,
  internalToken,
  onRefusal,
}: WebAuthnRoutesDeps) {
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

    if (path === BEGIN) {
      const { options, challenge } = await rp.beginAuthentication();
      // Stored before the options are handed out. The other order leaves a
      // window in which a very fast browser answers a challenge this service
      // has not yet agreed to accept.
      await challenges.issue(
        challenge,
        { purpose: 'authentication', subject: null },
        CHALLENGE_TTL_SECONDS,
      );

      response
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ options }));
      return true;
    }

    const input = body as {
      tenantId?: unknown;
      origin?: unknown;
      response?: unknown;
      device?: unknown;
    };

    if (typeof input.tenantId !== 'string' || typeof input.origin !== 'string') {
      response.writeHead(400).end();
      return true;
    }

    const challenge = challengeFrom(input.response);
    if (challenge === null) {
      onRefusal?.('malformed-client-data');
      response.writeHead(401).end();
      return true;
    }

    const result = await signIn({
      tenantId: input.tenantId,
      response: input.response,
      origin: input.origin,
      challenge,
      device: deviceFrom(input.device),
    });

    if (!result.ok) {
      // 401 for every refusal, with nothing distinguishing them. The reasons
      // are already in the log by the time this runs.
      response.writeHead(401, { 'cache-control': 'no-store' }).end();
      return true;
    }

    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(result.value));
    return true;
  };
}

/**
 * The device, as reported by the app that owns the origin.
 *
 * Trusted because the caller holds the internal token and is our own server
 * reading its own socket — a browser cannot set these. Defaulted rather than
 * required so a caller that omits them gets a session with an unknown device
 * rather than a 400 they cannot act on.
 */
export function deviceFrom(value: unknown): Device {
  const device =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  /*
   * Absent stays absent, and so does anything that is not an address.
   *
   * This returned `'unknown'` for a missing address, which is harmless beside
   * the `text` column for the user agent and fatal beside `inet`: Postgres
   * raised `22P02` in `network_in` and a sign-in that should have refused
   * politely became a 500.
   *
   * Widening `Device.ip` to `string | null` did not fix it on its own, and the
   * reason is worth keeping: this function declared its own return type as
   * `{ ip: string }`, which is assignable to `string | null`, so the compiler
   * had nothing to say. The type moved and the value did not.
   *
   * A browser cannot know its own address and is not asked. Whatever terminates
   * the connection supplies one or nothing does.
   */
  return {
    ip: asAddress(device['ip']),
    userAgent:
      typeof device['userAgent'] === 'string' && device['userAgent'] !== ''
        ? device['userAgent']
        : null,
    aaguid: typeof device['aaguid'] === 'string' ? device['aaguid'] : null,
  };
}
