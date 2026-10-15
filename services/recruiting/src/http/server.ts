import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { systemClock } from '@kithena/domain-kit';

import type { Deps, Listings } from '../application/ports.js';
import { configureGraphQL, yogaOptions } from '../graphql/schema.js';
import type { CallerFrom } from './caller.js';
import { listingsAnswer } from './listings.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest, type RestResponse } from './rest.js';

type Listener = (request: IncomingMessage, response: ServerResponse) => void;
type RestDispatch = (request: RestRequest) => Promise<RestResponse | null>;

const OPENAPI = '/v1/recruiting/openapi.json';
/** Up to six files of 10 MB as base64, plus the answers. */
const MAX_BODY = 90 * 1024 * 1024;

async function bodyOf(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The one listener on Recruiting's port: `/healthz`, the OpenAPI document, REST v1, then GraphQL. Documents'. */
export function recruitingListener(
  graphql: Listener,
  rest?: RestDispatch,
  listings?: Listings,
): Listener {
  const document = JSON.stringify(openApiDocument());
  return (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (request.method === 'GET' && request.url === OPENAPI) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(document);
      return;
    }
    if (rest === undefined || !(request.url ?? '').startsWith('/v1/')) {
      graphql(request, response);
      return;
    }
    void (async () => {
      const read =
        listings === undefined
          ? null
          : await listingsAnswer(listings, request.method ?? 'GET', request.url ?? '/');
      if (read !== null) {
        response
          .writeHead(read.status, {
            'content-type': 'application/json',
            'cache-control': read.status === 200 ? 'public, max-age=60' : 'no-store',
          })
          .end(JSON.stringify(read.body));
        return;
      }
      const body = await bodyOf(request);
      if (body === null) {
        response
          .writeHead(413, { 'content-type': 'application/json' })
          .end('{"error":{"code":"TOO_LARGE","message":"Files are up to 10 MB each"}}');
        return;
      }
      const answer = await rest({
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        body,
      });
      if (answer === null) {
        graphql(request, response);
        return;
      }
      response
        .writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers })
        .end(JSON.stringify(answer.body));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":{"code":"INTERNAL","message":"Something went wrong"}}');
    });
  };
}

export interface RecruitingServerOptions extends Pick<
  Deps,
  'uow' | 'blobs' | 'jobsOrigin' | 'extractText'
> {
  readonly callerFrom: CallerFrom;
  readonly clock?: Deps['clock'];
  readonly newId?: Deps['newId'];
  readonly mailer?: Deps['mailer'];
  /** Kithena Jobs' reads, when the read-only role is configured. */
  readonly listings?: Listings;
}

/** Recruiting's transports over a unit of work and a blob store. */
export function recruitingServer(
  options: RecruitingServerOptions,
  newId: () => string,
): { readonly listener: Listener; readonly rest: RestDispatch; readonly deps: Deps } {
  const deps: Deps = {
    uow: options.uow,
    blobs: options.blobs,
    clock: options.clock ?? systemClock,
    newId: options.newId ?? newId,
    jobsOrigin: options.jobsOrigin,
    extractText: options.extractText,
    ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
  };
  const rest = restHandler({ deps, callerFrom: options.callerFrom });
  configureGraphQL({ rest });
  const graphql = createYoga(yogaOptions);
  return {
    rest,
    deps,
    listener: recruitingListener(
      (request, response) => {
        void graphql(request, response);
      },
      rest,
      options.listings,
    ),
  };
}
