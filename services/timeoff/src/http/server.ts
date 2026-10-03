import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { systemClock } from '@kithena/domain-kit';

import type { Deps } from '../application/ports.js';
import { configureGraphQL, yogaOptions } from '../graphql/schema.js';
import { uuidv7 } from '../infrastructure/ids.js';
import type { CallerFrom } from './caller.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest, type RestResponse } from './rest.js';
import { SCIM_PREFIX, scimHandler, type ScimRequest, type ScimResponse } from './scim.js';

type Listener = (request: IncomingMessage, response: ServerResponse) => void;
type RestDispatch = (request: RestRequest) => Promise<RestResponse | null>;
type ScimDispatch = (request: ScimRequest) => Promise<ScimResponse>;

const OPENAPI = '/v1/timeoff/openapi.json';

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The one request listener on Time Off's one port: `/healthz`, the OpenAPI
 * document, REST v1 in front of GraphQL — the way People's `wirePeople` puts
 * its routes before Yoga — and everything else to GraphQL.
 *
 * `/healthz` needs nothing — no database, no broker — so it says the process
 * is up and serving, which is what a container health check asks.
 */
export function timeoffListener(
  graphql: Listener,
  rest?: RestDispatch,
  scim?: ScimDispatch,
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
    // SCIM first: an identity provider's token, not a user's, and SCIM's own errors.
    if (scim !== undefined && (request.url ?? '').startsWith(SCIM_PREFIX)) {
      void (async () => {
        const answer = await scim({
          method: request.method ?? 'GET',
          url: request.url ?? '/',
          headers: request.headers,
          body: await bodyOf(request),
        });
        response
          .writeHead(answer.status, answer.headers)
          .end(answer.body === null ? undefined : JSON.stringify(answer.body));
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
        response.end('{"error":{"code":"INTERNAL","message":"Something went wrong"}}');
      });
      return;
    }
    if (rest === undefined || !(request.url ?? '').startsWith('/v1/')) {
      graphql(request, response);
      return;
    }
    void (async () => {
      const answer = await rest({
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        body: await bodyOf(request),
      });
      if (answer === null) {
        graphql(request, response);
        return;
      }
      const text = typeof answer.body === 'string';
      response
        .writeHead(answer.status, {
          'content-type': 'application/json',
          ...answer.headers,
        })
        .end(text ? answer.body : JSON.stringify(answer.body));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":{"code":"INTERNAL","message":"Something went wrong"}}');
    });
  };
}

export interface TimeOffServerOptions extends Pick<
  Deps,
  'uow' | 'authz' | 'feedSecret' | 'judge' | 'writer'
> {
  readonly callerFrom: CallerFrom;
  readonly clock?: Deps['clock'];
  readonly newId?: Deps['newId'];
  /** Temporal's, when `TEMPORAL_ADDRESS` is set; without it nothing reminds or escalates. */
  readonly timers?: Deps['timers'];
  readonly notifier?: Deps['notifier'];
  /** Calendars and chat apps, as their credentials allow. */
  readonly reach?: Deps['reach'];
  /** Messaging's, when `MESSAGING_URL` and `MESSAGING_TIMEOFF_TOKEN` are set; without it no nudge is sent. */
  readonly mailer?: Deps['mailer'];
}

/**
 * Time Off's transports over a unit of work: REST, the subgraph sharing
 * REST's routes, and the listener serving both. The composition root hands
 * it the Drizzle unit of work; the standalone suite hands it the in-memory
 * one.
 */
export function timeoffServer(options: TimeOffServerOptions): {
  readonly listener: Listener;
  readonly rest: RestDispatch;
  readonly scim: ScimDispatch;
  readonly graphql: ReturnType<typeof createYoga>;
} {
  const deps: Deps = {
    uow: options.uow,
    authz: options.authz,
    feedSecret: options.feedSecret,
    clock: options.clock ?? systemClock,
    newId: options.newId ?? uuidv7,
    timers: options.timers ?? { started: async () => {}, closed: async () => {} },
    notifier: options.notifier ?? { notify: async () => {} },
    ...(options.reach === undefined ? {} : { reach: options.reach }),
    ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
    ...(options.judge === undefined ? {} : { judge: options.judge }),
    ...(options.writer === undefined ? {} : { writer: options.writer }),
  };
  const rest = restHandler({ deps, callerFrom: options.callerFrom });
  const publicUrl = (options.reach?.publicUrl ?? 'http://localhost:4002').replace(/\/$/u, '');
  const scim = scimHandler(deps, `${publicUrl}${SCIM_PREFIX}`);
  configureGraphQL({ rest });
  const graphql = createYoga(yogaOptions);
  return {
    rest,
    scim,
    graphql,
    listener: timeoffListener(
      (request, response) => {
        void graphql(request, response);
      },
      rest,
      scim,
    ),
  };
}
