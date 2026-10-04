import { err, failure, type Result } from '@kithena/domain-kit';
import {
  TimeOffAway,
  TimeOffBalances,
  TimeOffManagers,
  type Capability,
  type CapabilityInput,
} from '@kithena/contracts';

import {
  away,
  balances,
  capabilityCatalogue,
  managers,
} from '../application/assist/capabilities.js';
import type { Caller, Deps } from '../application/ports.js';
import type { CallerFrom } from './caller.js';
import { refused, type RestRequest, type RestResponse } from './rest.js';

/**
 * The assistant's door into Time Off (assistant PRD §8.5, §10.2):
 *
 *   GET  /internal/capabilities          what this asker is offered
 *   POST /internal/capabilities/{name}   one capability, as the asker
 *
 * Reached only with `ASSISTANT_TIMEOFF_TOKEN` beside the forwarded principal,
 * the router's shape, so the caller is resolved exactly as for the router —
 * entitlement, support and view-as sessions refused, the member found in the
 * projection — and every handler is a read over the application layer, run
 * as that person. The router's token is not accepted here, and this token is
 * accepted nowhere else: the listener sends only this prefix here, and REST
 * and GraphQL check the router's.
 *
 * Not in `ROUTES`, so not in the OpenAPI document, the subgraph or the
 * persisted operations: nothing outside the deployment calls these.
 */

export const CAPABILITIES_PREFIX = '/internal/capabilities';

type Handler = (deps: Deps, caller: Caller, body: unknown) => Promise<Result<unknown>>;

/** A capability's input parsed by its own contract, then its use case as the asker. */
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
  [TimeOffAway.name]: served(TimeOffAway, away),
  [TimeOffManagers.name]: served(TimeOffManagers, managers),
  [TimeOffBalances.name]: served(TimeOffBalances, balances),
};

const notFound = (): RestResponse => refused(failure('NOT_FOUND', 'No such capability'));

export function capabilitiesHandler(rest: {
  readonly deps: Deps;
  readonly callerFrom: CallerFrom;
}): (request: RestRequest) => Promise<RestResponse> {
  const { deps } = rest;
  return async (request) => {
    const path = new URL(request.url, 'http://timeoff.internal').pathname;
    const name = path === CAPABILITIES_PREFIX ? null : path.slice(CAPABILITIES_PREFIX.length + 1);
    if (
      name !== null &&
      (!path.startsWith(`${CAPABILITIES_PREFIX}/`) || !Object.hasOwn(HANDLERS, name))
    ) {
      return notFound();
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
      result = await capabilityCatalogue(deps)(caller.value);
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
