import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import { admitOperatorSession } from '../domain/operator.js';
import type { OperatorSignIn } from '../application/operator-sign-in.js';
import type { OperatorRepository } from '../infrastructure/drizzle-operator-repository.js';
import type { Clock } from '@kithena/domain-kit';

/**
 * The back-office's own sign-in, and the session it reads back.
 *
 * A separate relying party from the product's: `admin.kithena.com` is not under
 * `app.kithena.com`, so the browser will not offer an employee's passkey here
 * and will not offer this one there. That isolation is free and it is the main
 * reason the back-office lives on its own registrable domain rather than on a
 * path.
 */
const BEGIN = '/api/internal/operator/begin';
const FINISH = '/api/internal/operator/finish';
const SESSION = '/api/internal/operator/session';
const ENROL_BEGIN = '/api/internal/operator/enrol/begin';
const ENROL_FINISH = '/api/internal/operator/enrol/finish';

export interface OperatorRoutesDeps {
  readonly signIn: OperatorSignIn;
  readonly operators: OperatorRepository;
  readonly beginAssertion: () => Promise<{ options: unknown; challenge: string }>;
  readonly beginRegistration: (input: {
    identityId: string;
    displayName: string;
  }) => Promise<{ options: unknown; challenge: string }>;
  readonly finishRegistration: (
    response: unknown,
    expected: { challenge: string; origin: string; identityId: string },
  ) => Promise<void>;
  readonly rememberChallenge: (
    challenge: string,
    purpose: 'registration' | 'authentication',
    subject: string | null,
  ) => Promise<void>;
  readonly spendChallenge: (
    challenge: string,
  ) => Promise<{ purpose: string; subject: string | null } | null>;
  readonly internalToken: string;
  readonly clock: Clock;
  readonly onRefusal?: (reason: string) => void;
}

export function operatorRoutes(deps: OperatorRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (![BEGIN, FINISH, SESSION, ENROL_BEGIN, ENROL_FINISH].includes(path)) return false;

    if (!presentsInternalToken(request, deps.internalToken)) {
      response.writeHead(401).end();
      return true;
    }

    const json = (status: number, body: unknown): true => {
      response
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
      return true;
    };

    if (path === BEGIN) {
      const { options, challenge } = await deps.beginAssertion();
      await deps.rememberChallenge(challenge, 'authentication', null);
      return json(200, { options });
    }

    const body = await readJsonBody(request);
    const input = (body ?? {}) as Record<string, unknown>;

    if (path === SESSION) {
      const sessionId = typeof input['sessionId'] === 'string' ? input['sessionId'] : null;
      if (sessionId === null) return json(401, {});

      const session = await deps.operators.sessionById(sessionId);
      if (!session) return json(401, {});

      const live = admitOperatorSession(session, deps.clock);
      if (!live.ok) return json(401, {});

      // Lazily, and only the idle clock — `expires_at` is never moved, or a
      // session in daily use would never end.
      await deps.operators.touchSession(sessionId);
      return json(200, { operatorId: session.operatorId, email: session.email });
    }

    if (path === ENROL_BEGIN) {
      if (typeof input['identityId'] !== 'string') return json(400, {});

      /*
       * The identity must already be an operator awaiting a credential.
       *
       * The back-office exposes this route without a session — it has to, since
       * an operator has none until this succeeds — so "only the back-office can
       * reach it" is the whole of the protection, and that is not enough on its
       * own. Without this check, anything holding the internal token could
       * register a passkey against any identity it could name, and the first
       * thing it would name is an identity that is not an operator at all.
       *
       * Rows are written by hand and only ever move `invited` to `active`, so
       * this narrows the window to exactly the person who is meant to be
       * enrolling, and closes it the moment they have.
       */
      const awaiting = await deps.operators.byIdentity(input['identityId']);
      if (!awaiting || awaiting.status !== 'invited') {
        deps.onRefusal?.('not-awaiting-enrolment');
        return json(401, {});
      }
      const { options, challenge } = await deps.beginRegistration({
        identityId: input['identityId'],
        // The address on the row, not one the caller supplied. This becomes
        // the label in the keychain, and a caller that could choose it could
        // make an operator's passkey look like somebody else's.
        displayName: awaiting.email,
      });
      await deps.rememberChallenge(challenge, 'registration', input['identityId']);
      return json(200, { options });
    }

    const challenge = typeof input['challenge'] === 'string' ? input['challenge'] : null;
    const origin = typeof input['origin'] === 'string' ? input['origin'] : null;
    if (challenge === null || origin === null) return json(400, {});

    const spent = await deps.spendChallenge(challenge);
    if (!spent) {
      deps.onRefusal?.('challenge');
      return json(401, {});
    }

    if (path === ENROL_FINISH) {
      if (spent.purpose !== 'registration' || spent.subject === null) return json(401, {});

      try {
        // Whose ceremony this is was decided when the challenge was issued and
        // travelled with it. Working it out again here — by looking for "the
        // invited operator", say — is correct only while there is exactly one,
        // and wrong silently the moment somebody invites a second.
        await deps.finishRegistration(input['response'], {
          challenge,
          origin,
          identityId: spent.subject,
        });
        await deps.operators.markEnrolled(spent.subject);
        return json(200, { enrolled: true });
      } catch {
        deps.onRefusal?.('attestation');
        return json(401, {});
      }
    }

    if (spent.purpose !== 'authentication') return json(401, {});

    const result = await deps.signIn({ response: input['response'], origin, challenge });
    if (!result.ok) return json(401, {});

    return json(200, result.value);
  };
}
