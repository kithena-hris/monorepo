import { randomUUID } from 'node:crypto';
import type { DomainFailure, Result } from '@kithena/domain-kit';

import { KITHENA_USER, ENTERPRISE_USER, CORE_USER, CORE_GROUP } from '../domain/scim/resource.js';
import type { Json } from '../domain/scim/paths.js';
import type { ScimCaller, ScimProvisioning } from '../application/scim/provisioning.js';

/**
 * SCIM 2.0 over HTTP (PEO-072; RFC 7644), at `/scim/v2/*` on People's port.
 *
 * Not behind the router: an identity provider presents the connection's
 * bearer token, not a user's, so this is the one People path that
 * authenticates its caller itself (`ScimProvisioning.authenticate`). Every
 * request, discovery included, needs a live token of a company with People.
 * Errors are the RFC's (`urn:…:Error`, `status` as a string, `scimType`).
 */

export const SCIM_PREFIX = '/scim/v2';
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
  NOT_ENTITLED: [403, null],
  FORBIDDEN: [403, null],
  NOT_FOUND: [404, null],
  SCIM_INVALID_FILTER: [400, 'invalidFilter'],
  SCIM_INVALID_SYNTAX: [400, 'invalidSyntax'],
  SCIM_INVALID_PATH: [400, 'invalidPath'],
  SCIM_NO_TARGET: [400, 'noTarget'],
  SCIM_INVALID_VALUE: [400, 'invalidValue'],
  VALUE_INVALID: [400, 'invalidValue'],
  FIELD_NOT_WRITABLE: [400, 'mutability'],
  FIELD_DEPRECATED: [400, 'mutability'],
  SOURCE_OF_RECORD_EXTERNAL: [400, 'mutability'],
  INVALID_TRANSITION: [400, 'mutability'],
  UNIQUE_SCOPE_MISSING: [400, 'invalidValue'],
  SCIM_UNIQUENESS: [409, 'uniqueness'],
  UNIQUE_VALUE_TAKEN: [409, 'uniqueness'],
  SCHEMA_NOT_PUBLISHED: [409, null],
  UNAVAILABLE: [503, null],
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
      ...(status === 401 ? { 'www-authenticate': 'Bearer realm="people-scim"' } : {}),
    },
  };
}

const answer = (
  status: number,
  body: Json | null,
  headers: Record<string, string> = {},
): ScimResponse => ({
  status,
  body,
  headers: { 'content-type': MEDIA, ...headers },
});

/** Drop the top-level attributes `excludedAttributes` names (RFC 7644 §3.9); never `id` or `schemas`. */
function excluding(resource: Json, excluded: readonly string[]): Json {
  if (excluded.length === 0) return resource;
  const drop = new Set(excluded.filter((a) => !['id', 'schemas'].includes(a)));
  const strip = (r: Json) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => !drop.has(k.toLowerCase())));
  const listed = resource['Resources'];
  return Array.isArray(listed)
    ? { ...resource, Resources: (listed as Json[]).map(strip) }
    : strip(resource);
}

function serviceProviderConfig(base: string): Json {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'Bearer token',
        description: 'The connection token issued in People settings, Integrations',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` },
  };
}

function resourceTypes(base: string): Json[] {
  return [
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      schema: CORE_USER,
      schemaExtensions: [
        { schema: ENTERPRISE_USER, required: false },
        { schema: KITHENA_USER, required: false },
      ],
      meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      schema: CORE_GROUP,
      meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
    },
  ];
}

const list = (resources: Json[]): Json => ({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: resources.length,
  startIndex: 1,
  itemsPerPage: resources.length,
  Resources: resources,
});

export function scimHandler(
  scim: ScimProvisioning,
  baseUrl: string,
): (request: ScimRequest) => Promise<ScimResponse> {
  return async (request) => {
    const url = new URL(request.url, 'http://people.internal');
    const path = url.pathname.slice(SCIM_PREFIX.length).replace(/\/$/u, '');
    const header = (name: string) => {
      const v = request.headers[name];
      return typeof v === 'string' ? v : undefined;
    };
    const correlation = header('x-correlation-id');
    const caller = await scim.authenticate(
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
    const query = {
      filter: url.searchParams.get('filter') ?? undefined,
      startIndex: url.searchParams.has('startIndex')
        ? Number(url.searchParams.get('startIndex'))
        : undefined,
      count: url.searchParams.has('count') ? Number(url.searchParams.get('count')) : undefined,
    };
    if (Number.isNaN(query.startIndex) || Number.isNaN(query.count)) {
      return scimError({
        code: 'SCIM_INVALID_VALUE',
        message: 'startIndex and count are integers',
      });
    }
    const excluded = (url.searchParams.get('excludedAttributes') ?? '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a !== '');

    const done = (result: Result<Json>, status = 200): ScimResponse => {
      if (!result.ok) return scimError(result.error);
      const location = (result.value['meta'] as Json | undefined)?.['location'];
      return answer(
        status,
        excluding(result.value, excluded),
        status === 201 && typeof location === 'string' ? { location } : {},
      );
    };
    const gone = (result: Result<null>): ScimResponse =>
      result.ok ? { status: 204, body: null, headers: {} } : scimError(result.error);
    return route(scim, caller.value, request.method, path, body, query, baseUrl, done, gone);
  };
}

async function route(
  scim: ScimProvisioning,
  caller: ScimCaller,
  method: string,
  path: string,
  body: unknown,
  query: {
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
  },
  base: string,
  done: (result: Result<Json>, status?: number) => ScimResponse,
  gone: (result: Result<null>) => ScimResponse,
): Promise<ScimResponse> {
  const [, kind = '', id, ...rest] = path.split('/');
  const one = id !== undefined && id !== '' && rest.length === 0 ? decodeURIComponent(id) : null;
  const bare = id === undefined || id === '';
  const ok = (value: Json) => done({ ok: true, value });

  if (method === 'GET' && kind === 'ServiceProviderConfig' && bare)
    return ok(serviceProviderConfig(base));
  if (method === 'GET' && kind === 'ResourceTypes') {
    const types = resourceTypes(base);
    if (bare) return ok(list(types));
    const found = types.find((t) => t['id'] === one);
    return found === undefined
      ? done({ ok: false, error: { code: 'NOT_FOUND', message: 'No such resource type' } })
      : ok(found);
  }
  if (method === 'GET' && kind === 'Schemas') {
    const schema = await scim.extensionSchema(caller);
    if (!schema.ok || bare) return schema.ok ? ok(list([schema.value])) : done(schema);
    return one === KITHENA_USER
      ? ok(schema.value)
      : done({ ok: false, error: { code: 'NOT_FOUND', message: 'No such schema' } });
  }

  if (kind === 'Users') {
    if (bare && method === 'GET') return done(await scim.listUsers(caller, query));
    if (bare && method === 'POST') return done(await scim.createUser(caller, body), 201);
    if (one !== null && method === 'GET') return done(await scim.getUser(caller, one));
    if (one !== null && method === 'PUT') return done(await scim.replaceUser(caller, one, body));
    if (one !== null && method === 'PATCH') return done(await scim.patchUser(caller, one, body));
    if (one !== null && method === 'DELETE') return gone(await scim.deleteUser(caller, one));
  }
  if (kind === 'Groups') {
    if (bare && method === 'GET') return done(await scim.listGroups(caller, query));
    if (bare && method === 'POST') return done(await scim.createGroup(caller, body), 201);
    if (one !== null && method === 'GET') return done(await scim.getGroup(caller, one));
    if (one !== null && method === 'PUT') return done(await scim.replaceGroup(caller, one, body));
    if (one !== null && method === 'PATCH') return done(await scim.patchGroup(caller, one, body));
    if (one !== null && method === 'DELETE') return gone(await scim.deleteGroup(caller, one));
  }
  return done({ ok: false, error: { code: 'NOT_FOUND', message: `No SCIM endpoint at ${path}` } });
}
