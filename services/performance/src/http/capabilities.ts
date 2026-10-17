import { err, failure, type Result } from '@kithena/domain-kit';
import { performanceCapabilities } from '@kithena/contracts';

import { answer, capabilityCatalogue } from '../application/capabilities.js';
import { contextOf } from '../application/context.js';
import type { Deps } from '../application/ports.js';
import type { CallerFrom } from './caller.js';
import type { RestRequest, RestResponse } from './rest.js';

/**
 * The assistant's door into Performance (assistant PRD §8.5, §10.2),
 * Documents':
 *
 *   GET  /internal/capabilities          what this asker is offered
 *   POST /internal/capabilities/{name}   one capability, as the asker
 *
 * Reached only with `ASSISTANT_PERFORMANCE_TOKEN` beside the forwarded
 * principal, resolved as for the router; the router's token is not accepted
 * here, and this one nowhere else. Not in the route table, so not in the
 * OpenAPI document, the subgraph or the persisted operations.
 */

export const CAPABILITIES_PREFIX = '/internal/capabilities';

const BY_NAME = new Map(performanceCapabilities.map((c) => [c.name as string, c]));

const refusal = (why: { code: string; message: string }, status: number): RestResponse => ({
  status,
  body: { error: why },
});

export function capabilitiesHandler(rest: {
  readonly deps: Deps;
  readonly callerFrom: CallerFrom;
}): (request: RestRequest) => Promise<RestResponse> {
  const { deps } = rest;
  return async (request) => {
    const path = new URL(request.url, 'http://performance.internal').pathname;
    const name = path === CAPABILITIES_PREFIX ? null : path.slice(CAPABILITIES_PREFIX.length + 1);
    const capability = name === null ? undefined : BY_NAME.get(name);
    if (name !== null && (!path.startsWith(`${CAPABILITIES_PREFIX}/`) || capability === undefined))
      return refusal({ code: 'NOT_FOUND', message: 'No such capability' }, 404);
    if (request.method !== (name === null ? 'GET' : 'POST'))
      return refusal({ code: 'METHOD_NOT_ALLOWED', message: request.method }, 405);
    const caller = await rest.callerFrom(request);
    if (!caller.ok) return refusal(caller.error, caller.error.code === 'FORBIDDEN' ? 403 : 401);
    if (capability === undefined) return { status: 200, body: capabilityCatalogue() };
    let body: unknown;
    try {
      body = request.body === '' ? {} : JSON.parse(request.body);
    } catch {
      return refusal({ code: 'BAD_REQUEST', message: 'The body is not JSON' }, 400);
    }
    const input = capability.schemas.input.safeParse(body);
    if (!input.success)
      return refusal(
        { code: 'BAD_REQUEST', message: input.error.issues[0]?.message ?? 'invalid input' },
        400,
      );
    const result: Result<unknown> = await deps.uow
      .run(caller.value.tenantId, async (tx) =>
        answer(await contextOf(deps, tx, { ...caller.value, via: 'Ask Kithena' }), capability.name, input.data),
      )
      .catch(() => err(failure('UNAVAILABLE', 'Performance could not answer just now')));
    return result.ok
      ? { status: 200, body: result.value }
      : refusal(result.error, result.error.code === 'FORBIDDEN' ? 403 : 503);
  };
}
