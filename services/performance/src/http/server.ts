import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { systemClock } from '@kithena/domain-kit';

import type { Deps } from '../application/ports.js';
import { configureGraphQL, yogaOptions } from '../graphql/schema.js';
import type { CallerFrom } from './caller.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest, type RestResponse } from './rest.js';

type Listener = (request: IncomingMessage, response: ServerResponse) => void;
type RestDispatch = (request: RestRequest) => Promise<RestResponse | null>;

const OPENAPI = '/v1/performance/openapi.json';
// A CSV of completions or a member import is the largest body.
const MAX_BODY = 4 * 1024 * 1024;

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

/**
 * The one listener on Performance's port: `/healthz`, the OpenAPI document,
 * REST v1, then GraphQL, whose subscription answers as server-sent events
 * (PRD §8.7). Onboarding's.
 */
export function performanceListener(graphql: Listener, rest?: RestDispatch): Listener {
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
      const body = await bodyOf(request);
      if (body === null) {
        response
          .writeHead(413, { 'content-type': 'application/json' })
          .end('{"error":{"code":"TOO_LARGE","message":"Too large"}}');
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

export interface PerformanceServerOptions {
  readonly uow: Deps['uow'];
  readonly live: Deps['live'];
  readonly callerFrom: CallerFrom;
  readonly clock?: Deps['clock'];
  readonly newId?: Deps['newId'];
  readonly mailer?: Deps['mailer'];
  readonly model?: Deps['model'];
  readonly webhooks?: Deps['webhooks'];
}

/** Performance's transports over a unit of work. */
export function performanceServer(
  options: PerformanceServerOptions,
  newId: () => string,
): { readonly listener: Listener; readonly rest: RestDispatch; readonly deps: Deps } {
  const deps: Deps = {
    uow: options.uow,
    live: options.live,
    clock: options.clock ?? systemClock,
    newId: options.newId ?? newId,
    ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.webhooks === undefined ? {} : { webhooks: options.webhooks }),
  };
  const rest = restHandler({ deps, callerFrom: options.callerFrom });
  configureGraphQL({ rest, live: deps.live, callerFrom: options.callerFrom });
  const graphql = createYoga(yogaOptions);
  return {
    rest,
    deps,
    listener: performanceListener((request, response) => {
      void graphql(request, response);
    }, rest),
  };
}
