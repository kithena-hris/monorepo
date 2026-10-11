import { failure, type Result } from '@kithena/domain-kit';

import type { Asking } from '../application/person/person-access.js';
import type { CallerFrom } from './caller.js';
import { refused, type RestRequest, type RestResponse } from './rest.js';

/**
 * People's capability routes, for the assistant alone (assistant PRD §8.5,
 * §10.2):
 *
 *   GET  /internal/capabilities          what People offers this asker
 *   POST /internal/capabilities/<name>   one capability, the body its input
 *
 * The caller presents `ASSISTANT_PEOPLE_TOKEN` in `x-internal-token` and the
 * asker in `x-kithena-principal`, the router's shape, resolved as the router's
 * is (`callerFrom`: the recorded entitlements, OpenFGA's roles). The token is
 * not the router's: it opens these routes and no others, and the router's
 * opens every route but these. The wiring runs them read-only (`readOnly`).
 *
 * The assistant forwards the session it was asked in unchanged (AST-035): a
 * question from the web in a view-as is the employee's, read-only, and one in
 * a support session is support's, recorded as the operator's — exactly as on
 * People's own screens, because `callerFrom` is theirs. Every route here is a
 * read under `readOnly` whatever the session, so a leaked token reads what
 * the principal it names could read, and writes nothing.
 */

export const CAPABILITIES = '/internal/capabilities';

export const isCapabilityPath = (path: string): boolean =>
  path === CAPABILITIES || path.startsWith(`${CAPABILITIES}/`);

export interface CapabilityRouteDeps {
  /** The asker, from the assistant's token and the forwarded principal. */
  readonly callerFrom: CallerFrom;
  readonly catalogue: (asking: Asking) => Promise<Result<unknown>>;
  readonly answer: (asking: Asking, name: string, input: unknown) => Promise<Result<unknown>>;
}

const answered = (result: Result<unknown>): RestResponse =>
  result.ok ? { status: 200, body: result.value } : refused(result.error);

export function capabilityRoutes(
  deps: CapabilityRouteDeps,
): (request: RestRequest) => Promise<RestResponse> {
  return async (request) => {
    const asking = await deps.callerFrom(request);
    if (!asking.ok) return refused(asking.error);
    const path = request.url.split('?')[0] ?? '';
    if (path === CAPABILITIES && request.method === 'GET') {
      return answered(await deps.catalogue(asking.value));
    }
    if (path.startsWith(`${CAPABILITIES}/`) && request.method === 'POST') {
      let input: unknown;
      try {
        input = JSON.parse(request.body === '' ? '{}' : request.body);
      } catch {
        return refused(failure('BAD_REQUEST', 'The body is not JSON'));
      }
      return answered(await deps.answer(asking.value, path.slice(CAPABILITIES.length + 1), input));
    }
    return refused(failure('NOT_FOUND', `${request.method} ${path}`));
  };
}
