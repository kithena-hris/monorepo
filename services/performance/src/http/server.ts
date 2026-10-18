import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { err, failure, systemClock } from '@kithena/domain-kit';

import type { Deps } from '../application/ports.js';
import { configureGraphQL, yogaOptions } from '../graphql/schema.js';
import type { CallerFrom } from './caller.js';
import { CAPABILITIES_PREFIX, capabilitiesHandler } from './capabilities.js';
import { CHAT_PREFIX, chatHandler } from './chat.js';
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
export function performanceListener(
  graphql: Listener,
  rest?: RestDispatch,
  capabilities?: RestDispatch,
  chat?: RestDispatch,
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
    // The assistant's capabilities: its own token, never the router's (`capabilities.ts`).
    const url = request.url ?? '';
    const dispatch = url.startsWith(CAPABILITIES_PREFIX)
      ? capabilities
      : url.startsWith(CHAT_PREFIX)
        ? chat
        : url.startsWith('/v1/')
          ? rest
          : undefined;
    if (dispatch === undefined) {
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
      const answer = await dispatch({
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
  /** The assistant's, over `ASSISTANT_PERFORMANCE_TOKEN`; without it its capabilities refuse everybody. */
  readonly assistantCallerFrom?: CallerFrom;
  readonly chat?: Deps['chat'];
  readonly tools?: Deps['tools'];
  /** The chat app's pair secret (`SLACK_PERFORMANCE_TOKEN`); empty refuses it. */
  readonly chatToken?: string;
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
    ...(options.chat === undefined ? {} : { chat: options.chat }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
  };
  const rest = restHandler({ deps, callerFrom: options.callerFrom });
  const capabilities = capabilitiesHandler({
    deps,
    callerFrom:
      options.assistantCallerFrom ??
      (() => Promise.resolve(err(failure('UNAUTHENTICATED', 'The assistant is not set up here')))),
  });
  configureGraphQL({ rest, live: deps.live, callerFrom: options.callerFrom });
  const graphql = createYoga(yogaOptions);
  return {
    rest,
    deps,
    listener: performanceListener(
      (request, response) => {
        void graphql(request, response);
      },
      rest,
      capabilities,
      chatHandler(deps, options.chatToken ?? ''),
    ),
  };
}
