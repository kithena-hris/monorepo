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

const OPENAPI = '/v1/onboarding/openapi.json';
const MAX_BODY = 256 * 1024;

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
 * The one listener on Onboarding's port: `/healthz`, the OpenAPI document,
 * REST v1, then GraphQL; and the welcome page's public routes answered to
 * Kithena Jobs' origin from the browser, the token in its header. Recruiting's.
 */
export function onboardingListener(
  graphql: Listener,
  rest?: RestDispatch,
  publicOrigin?: string,
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
    if (
      publicOrigin !== undefined &&
      request.headers.origin === publicOrigin &&
      (request.url ?? '').startsWith('/v1/onboarding/welcome')
    ) {
      response.setHeader('access-control-allow-origin', publicOrigin);
      response.setHeader('vary', 'origin');
      if (request.method === 'OPTIONS') {
        response
          .writeHead(204, {
            'access-control-allow-methods': 'GET, POST',
            'access-control-allow-headers': 'content-type, x-welcome-token',
            'access-control-max-age': '600',
          })
          .end();
        return;
      }
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

export interface OnboardingServerOptions extends Pick<Deps, 'uow' | 'jobsOrigin'> {
  readonly callerFrom: CallerFrom;
  readonly clock?: Deps['clock'];
  readonly newId?: Deps['newId'];
  readonly mailer?: Deps['mailer'];
}

/** Onboarding's transports over a unit of work. */
export function onboardingServer(
  options: OnboardingServerOptions,
  newId: () => string,
): { readonly listener: Listener; readonly rest: RestDispatch; readonly deps: Deps } {
  const deps: Deps = {
    uow: options.uow,
    clock: options.clock ?? systemClock,
    newId: options.newId ?? newId,
    jobsOrigin: options.jobsOrigin,
    ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
  };
  const rest = restHandler({ deps, callerFrom: options.callerFrom });
  configureGraphQL({ rest });
  const graphql = createYoga(yogaOptions);
  return {
    rest,
    deps,
    listener: onboardingListener(
      (request, response) => {
        void graphql(request, response);
      },
      rest,
      options.jobsOrigin,
    ),
  };
}
