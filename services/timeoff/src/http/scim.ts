import { randomUUID } from 'node:crypto';
import type { DomainFailure, Result } from '@kithena/domain-kit';

import {
  authenticateScim,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  patchUser,
  replaceUser,
  resourceTypes,
  serviceProviderConfig,
  CORE_USER,
  ENTERPRISE_USER,
  TIMEOFF_USER,
  type Json,
} from '../application/member/scim.js';
import type { Deps } from '../application/ports.js';

/**
 * SCIM 2.0 over HTTP (TOF-114; RFC 7644), at `/v1/timeoff/scim/v2/*` on Time
 * Off's port: People's handler (`services/people/src/http/scim.ts`), in Time
 * Off's own copy. Not behind the router: an identity provider presents its
 * connection's bearer token, not a user's, so this path authenticates its
 * caller itself. Every request, discovery included, needs a live token.
 * Errors are the RFC's (`urn:…:Error`, `status` as a string, `scimType`).
 */

export const SCIM_PREFIX = '/v1/timeoff/scim/v2';
const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const MEDIA = 'application/scim+json; charset=utf-8';

export interface ScimRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

export interface ScimResponse {
  readonly status: number;
  readonly body: Json | null;
  readonly headers: Readonly<Record<string, string>>;
}

const STATUS: Record<string, [number, string | null]> = {
  UNAUTHENTICATED: [401, null],
  FORBIDDEN: [403, null],
  NOT_FOUND: [404, null],
  SCIM_INVALID_FILTER: [400, 'invalidFilter'],
  SCIM_INVALID_SYNTAX: [400, 'invalidSyntax'],
  SCIM_INVALID_PATH: [400, 'invalidPath'],
  SCIM_NO_TARGET: [400, 'noTarget'],
  SCIM_INVALID_VALUE: [400, 'invalidValue'],
  SCIM_UNIQUENESS: [409, 'uniqueness'],
};

function scimError(error: DomainFailure): ScimResponse {
  const [status, scimType] = STATUS[error.code] ?? [400, 'invalidValue'];
  return {
    status,
    body: {
      schemas: [ERROR],
      status: String(status),
      ...(scimType === null ? {} : { scimType }),
      detail: error.message,
    },
    headers: {
      'content-type': MEDIA,
      ...(status === 401 ? { 'www-authenticate': 'Bearer realm="timeoff-scim"' } : {}),
    },
  };
}

const list = (resources: Json[]): Json => ({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: resources.length,
  startIndex: 1,
  itemsPerPage: resources.length,
  Resources: resources,
});

/** The three schemas a User here is made of, each as its URN and attributes' names. */
const SCHEMAS: Json[] = [
  { id: CORE_USER, name: 'User' },
  { id: ENTERPRISE_USER, name: 'EnterpriseUser' },
  { id: TIMEOFF_USER, name: 'TimeOffUser' },
].map((s) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'], ...s }));

export function scimHandler(
  deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'notifier'>,
  baseUrl: string,
): (request: ScimRequest) => Promise<ScimResponse> {
  return async (request) => {
    const url = new URL(request.url, 'http://timeoff.internal');
    const path = url.pathname.slice(SCIM_PREFIX.length).replace(/\/$/u, '');
    const header = (name: string) => {
      const v = request.headers[name];
      return typeof v === 'string' ? v : undefined;
    };
    const correlation = header('x-correlation-id');
    const caller = await authenticateScim(deps)(
      header('authorization'),
      correlation !== undefined && /^[0-9a-f-]{36}$/iu.test(correlation)
        ? correlation
        : randomUUID(),
    );
    if (!caller.ok) return scimError(caller.error);

    let body: unknown = null;
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      try {
        body = request.body === '' ? null : JSON.parse(request.body);
      } catch {
        return scimError({ code: 'SCIM_INVALID_SYNTAX', message: 'The body is not JSON' });
      }
    }
    const number = (name: string) =>
      url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined;
    const query = {
      filter: url.searchParams.get('filter') ?? undefined,
      startIndex: number('startIndex'),
      count: number('count'),
    };
    if (Number.isNaN(query.startIndex) || Number.isNaN(query.count)) {
      return scimError({
        code: 'SCIM_INVALID_VALUE',
        message: 'startIndex and count are integers',
      });
    }

    const done = (result: Result<Json>, status = 200): ScimResponse => {
      if (!result.ok) return scimError(result.error);
      const location = (result.value['meta'] as Json | undefined)?.['location'];
      return {
        status,
        body: result.value,
        headers: {
          'content-type': MEDIA,
          ...(status === 201 && typeof location === 'string' ? { location } : {}),
        },
      };
    };
    const ok = (value: Json) => done({ ok: true, value });
    const [, kind = '', id, ...rest] = path.split('/');
    const one = id !== undefined && id !== '' && rest.length === 0 ? decodeURIComponent(id) : null;
    const bare = id === undefined || id === '';
    const { method } = request;
    const c = caller.value;

    if (method === 'GET' && kind === 'ServiceProviderConfig' && bare)
      return ok(serviceProviderConfig(baseUrl));
    if (method === 'GET' && kind === 'ResourceTypes') {
      const types = resourceTypes(baseUrl);
      if (bare) return ok(list(types));
      const found = types.find((t) => t['id'] === one);
      return found === undefined
        ? scimError({ code: 'NOT_FOUND', message: 'No such resource type' })
        : ok(found);
    }
    if (method === 'GET' && kind === 'Schemas') {
      if (bare) return ok(list(SCHEMAS));
      const found = SCHEMAS.find((s) => s['id'] === one);
      return found === undefined
        ? scimError({ code: 'NOT_FOUND', message: 'No such schema' })
        : ok(found);
    }
    if (kind === 'Users') {
      if (bare && method === 'GET') return done(await listUsers(deps)(c, baseUrl, query));
      if (bare && method === 'POST') return done(await createUser(deps)(c, baseUrl, body), 201);
      if (one !== null && method === 'GET') return done(await getUser(deps)(c, baseUrl, one));
      if (one !== null && method === 'PUT')
        return done(await replaceUser(deps)(c, baseUrl, one, body));
      if (one !== null && method === 'PATCH')
        return done(await patchUser(deps)(c, baseUrl, one, body));
      if (one !== null && method === 'DELETE') {
        const gone = await deleteUser(deps)(c, baseUrl, one);
        return gone.ok ? { status: 204, body: null, headers: {} } : scimError(gone.error);
      }
    }
    return scimError({ code: 'NOT_FOUND', message: `No SCIM endpoint at ${path}` });
  };
}
