import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { systemClock } from '@kithena/domain-kit';

import type { Deps } from '../application/ports.js';
import { configureGraphQL, yogaOptions } from '../graphql/schema.js';
import { uuidv7 } from '../infrastructure/ids.js';
import type { CallerFrom } from './caller.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest, type RestResponse } from './rest.js';

type Listener = (request: IncomingMessage, response: ServerResponse) => void;
type RestDispatch = (request: RestRequest) => Promise<RestResponse | null>;

const OPENAPI = '/v1/documents/openapi.json';

/** A base64 file of 25 MB, plus the rest of the body. */
const MAX_BODY = 40 * 1024 * 1024;

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
 * The one listener on Documents' one port: `/healthz`, the OpenAPI document
 * and REST v1 in front of GraphQL. Time Off's.
 */
export function documentsListener(graphql: Listener, rest?: RestDispatch): Listener {
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
          .end('{"error":{"code":"TOO_LARGE","message":"Files are up to 25 MB"}}');
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

export interface DocumentsServerOptions extends Pick<Deps, 'uow' | 'blobs'> {
  readonly callerFrom: CallerFrom;
  readonly clock?: Deps['clock'];
  readonly newId?: Deps['newId'];
  readonly mailer?: Deps['mailer'];
}

/** Documents' transports over a unit of work and a blob store. */
export function documentsServer(options: DocumentsServerOptions): {
  readonly listener: Listener;
  readonly rest: RestDispatch;
  readonly graphql: ReturnType<typeof createYoga>;
  readonly deps: Deps;
} {
  const deps: Deps = {
    uow: options.uow,
    blobs: options.blobs,
    clock: options.clock ?? systemClock,
    newId: options.newId ?? uuidv7,
    ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
  };
  const rest = restHandler({ deps, callerFrom: options.callerFrom });
  configureGraphQL({ rest });
  const graphql = createYoga(yogaOptions);
  return {
    rest,
    graphql,
    deps,
    listener: documentsListener((request, response) => {
      void graphql(request, response);
    }, rest),
  };
}
