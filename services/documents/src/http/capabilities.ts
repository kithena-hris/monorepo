import { err, failure, type Result } from '@kithena/domain-kit';
import {
  DocumentsExpiring,
  DocumentsWaiting,
  type Capability,
  type CapabilityInput,
} from '@kithena/contracts';

import { capabilityCatalogue, expiring, waiting } from '../application/capabilities.js';
import type { Caller, Deps } from '../application/ports.js';
import type { CallerFrom } from './caller.js';
import { refused, type RestRequest, type RestResponse } from './rest.js';

/**
 * The assistant's door into Documents (assistant PRD §8.5, §10.2), Time
 * Off's:
 *
 *   GET  /internal/capabilities          what this asker is offered
 *   POST /internal/capabilities/{name}   one capability, as the asker
 *
 * Reached only with `ASSISTANT_DOCUMENTS_TOKEN` beside the forwarded
 * principal, resolved exactly as for the router; the router's token is not
 * accepted here, and this one nowhere else. Not in the route table, so not
 * in the OpenAPI document, the subgraph or the persisted operations.
 */

export const CAPABILITIES_PREFIX = '/internal/capabilities';

type Handler = (deps: Deps, caller: Caller, body: unknown) => Promise<Result<unknown>>;

const served =
  (
    capability: Capability,
    run: (deps: Deps) => (caller: Caller, input: CapabilityInput) => Promise<Result<unknown>>,
  ): Handler =>
  async (deps, caller, body) => {
    const parsed = capability.schemas.input.safeParse(body);
    if (parsed.success) return run(deps)(caller, parsed.data);
    const issue = parsed.error.issues[0];
    return err(failure('BAD_REQUEST', issue?.message ?? 'invalid input', issue?.path.map(String)));
  };

const HANDLERS: Readonly<Record<string, Handler>> = {
  [DocumentsWaiting.name]: served(DocumentsWaiting, waiting),
  [DocumentsExpiring.name]: served(DocumentsExpiring, expiring),
};

export function capabilitiesHandler(rest: {
  readonly deps: Deps;
  readonly callerFrom: CallerFrom;
}): (request: RestRequest) => Promise<RestResponse> {
  const { deps } = rest;
  return async (request) => {
    const path = new URL(request.url, 'http://documents.internal').pathname;
    const name = path === CAPABILITIES_PREFIX ? null : path.slice(CAPABILITIES_PREFIX.length + 1);
    if (
      name !== null &&
      (!path.startsWith(`${CAPABILITIES_PREFIX}/`) || !Object.hasOwn(HANDLERS, name))
    ) {
      return refused(failure('NOT_FOUND', 'No such capability'));
    }
    const method = name === null ? 'GET' : 'POST';
    if (request.method !== method) {
      return {
        status: 405,
        body: { error: { code: 'METHOD_NOT_ALLOWED', message: request.method } },
      };
    }
    const caller = await rest.callerFrom(request);
    if (!caller.ok) return refused(caller.error);
    let result: Result<unknown>;
    if (name === null) {
      result = await capabilityCatalogue()();
    } else {
      let body: unknown;
      try {
        body = request.body === '' ? {} : JSON.parse(request.body);
      } catch {
        return refused(failure('BAD_REQUEST', 'The body is not JSON'));
      }
      result = await (HANDLERS[name] as Handler)(deps, caller.value, body);
    }
    return result.ok ? { status: 200, body: result.value } : refused(result.error);
  };
}
