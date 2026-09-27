import type { IncomingMessage, ServerResponse } from 'node:http';
import { SignupQuestionSet } from '@kithena/contracts';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';

/**
 * People reporting the tenant's sign-up questions:
 * `PUT /api/internal/tenants/<id>/signup-questions`, a `SignupQuestionSet`.
 *
 * The same shape of route as `module-role-routes.ts` and for the same reason:
 * identity renders the page that asks, and may neither import People nor read
 * its schema, so People pushes the set with its own token and identity keeps
 * the newest. `SignupQuestionSet` refuses anything classified above internal,
 * so a set that would put a confidential answer on an event never lands.
 */
const PATH =
  /^\/api\/internal\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/signup-questions$/i;

export interface SignupQuestionRoutesDeps {
  /** The secret People presents. */
  readonly token: string;
  /** Keep the set unless a newer one is kept; false when the company does not exist. */
  readonly record: (tenantId: string, set: SignupQuestionSet) => Promise<boolean>;
}

export function signupQuestionRoutes({ token, record }: SignupQuestionRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const match = PATH.exec((request.url ?? '').split('?')[0] ?? '');
    if (!match) return false;

    if (request.method !== 'PUT') {
      response.writeHead(405, { allow: 'PUT' }).end();
      return true;
    }
    if (!presentsInternalToken(request, token)) {
      response.writeHead(401).end();
      return true;
    }
    const set = SignupQuestionSet.safeParse(await readJsonBody(request, 1024 * 1024));
    if (!set.success) {
      response.writeHead(400).end();
      return true;
    }
    const known = await record(match[1] ?? '', set.data);
    response.writeHead(known ? 204 : 404).end();
    return true;
  };
}
