import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { systemClock } from '@kithena/domain-kit';

import type { Deps, Listings } from '../application/ports.js';
import { configureGraphQL, yogaOptions } from '../graphql/schema.js';
import type { CallerFrom } from './caller.js';
import { listingsAnswer } from './listings.js';
import { allowed } from './limits.js';
import { planSearch } from '../application/job-assistant.js';
import type { JobSearch } from '@kithena/contracts';
import type { Result } from '@kithena/domain-kit';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest, type RestResponse } from './rest.js';

type Listener = (request: IncomingMessage, response: ServerResponse) => void;
type RestDispatch = (request: RestRequest) => Promise<RestResponse | null>;

const OPENAPI = '/v1/recruiting/openapi.json';
const SEARCH_PLAN = '/v1/recruiting/public/search-plan';
/** The one redirect address every calendar and Zoom app is registered with (REC-135). */
const CONNECT_CALLBACK = '/v1/recruiting/public/calendar-callback';
/** Where Indeed Apply posts every application (REC-132); the job names the company. */
const INDEED_APPLY = '/v1/recruiting/public/indeed-apply';
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

/** Whether an origin is a company's careers domain that Vercel has verified. */
async function ownDomain(listings: Listings | undefined, origin: string): Promise<boolean> {
  const host = /^https:\/\/([a-z0-9.-]+)$/u.exec(origin)?.[1];
  return (
    host !== undefined && listings !== undefined && (await listings.companyForHost(host)) !== null
  );
}

/** The one listener on Recruiting's port: `/healthz`, the OpenAPI document, REST v1, then GraphQL. Documents'. */
export function recruitingListener(
  graphql: Listener,
  rest?: RestDispatch,
  listings?: Listings,
  publicOrigin?: string,
  /** J8 on search: a sentence to filters, when there is a model. */
  plan?: (sentence: string) => Promise<Result<JobSearch>>,
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
      // Kithena Jobs' pages call the public API from the browser: a CV is up to
      // 10 MB, past what a serverless function will relay. Only Kithena Jobs'
      // origin or a company's own verified domain (REC-136), only the public
      // routes, and no cookies, so a token travels in its header.
      const origin = request.headers.origin;
      if (
        origin !== undefined &&
        (request.url ?? '').startsWith('/v1/recruiting/public/') &&
        (origin === publicOrigin || (await ownDomain(listings, origin)))
      ) {
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('vary', 'origin');
        if (request.method === 'OPTIONS') {
          response
            .writeHead(204, {
              'access-control-allow-methods': 'GET, POST',
              'access-control-allow-headers': 'content-type, x-candidate-token',
              'access-control-max-age': '600',
            })
            .end();
          return;
        }
      }
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
      const at = new URL(request.url ?? '/', 'http://recruiting');
      if (request.method === 'GET' && at.pathname === CONNECT_CALLBACK) {
        // The company travels in the state, ahead of the token: `acme.<token>`.
        const state = at.searchParams.get('state') ?? '';
        const company = state.slice(0, Math.max(0, state.indexOf('.')));
        const answer = await rest({
          method: 'POST',
          url: `/v1/recruiting/public/${encodeURIComponent(company)}/connect-grant`,
          headers: {},
          body: JSON.stringify({ state, code: at.searchParams.get('code') }),
        });
        const back = (answer?.body as { returnTo?: unknown } | undefined)?.returnTo;
        if (answer?.status === 200 && typeof back === 'string') {
          response.writeHead(302, { location: back, 'cache-control': 'no-store' }).end();
          return;
        }
        response
          .writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          .end('That did not connect. Go back to Kithena and try again.');
        return;
      }
      const body = await bodyOf(request);
      if (request.method === 'POST' && request.url === INDEED_APPLY && body !== null) {
        // `jobMeta` is what Kithena sent with the posting: `<company>/<jobId>`.
        let company = '';
        try {
          const meta = (JSON.parse(body) as { job?: { jobMeta?: unknown } }).job?.jobMeta;
          company = typeof meta === 'string' ? (meta.split('/')[0] ?? '') : '';
        } catch {
          // Unreadable: the route answers it.
        }
        const answer = await rest({
          method: 'POST',
          url: `/v1/recruiting/public/${encodeURIComponent(company || '-')}/board-applications/indeed`,
          headers: {},
          body: JSON.stringify({
            raw: body,
            signature: String(request.headers['x-indeed-signature'] ?? ''),
          }),
        });
        response
          .writeHead(answer?.status ?? 404, { 'content-type': 'application/json' })
          .end(JSON.stringify(answer?.body ?? {}));
        return;
      }
      if (request.method === 'POST' && request.url === SEARCH_PLAN && body !== null) {
        const ip =
          String(request.headers['x-forwarded-for'] ?? '')
            .split(',')[0]
            ?.trim() ?? '';
        let sentence = '';
        try {
          const given = (JSON.parse(body) as { sentence?: unknown }).sentence;
          sentence = typeof given === 'string' ? given : '';
        } catch {
          // An unreadable body plans nothing.
        }
        const planned =
          plan === undefined || !allowed(ip, Date.now()) ? null : await plan(sentence);
        response
          .writeHead(planned?.ok === true ? 200 : 422, { 'content-type': 'application/json' })
          .end(
            JSON.stringify(
              planned?.ok === true
                ? planned.value
                : { error: { code: 'NO_PLAN', message: 'Try the filters instead' } },
            ),
          );
        return;
      }
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
  readonly inbound?: Deps['inbound'];
  readonly model?: Deps['model'];
  readonly sealer?: Deps['sealer'];
  readonly assessmentProvider?: Deps['assessmentProvider'];
  readonly backgroundChecks?: Deps['backgroundChecks'];
  readonly domains?: Deps['domains'];
  readonly connections?: Deps['connections'];
  readonly boards?: Deps['boards'];
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
    ...(options.inbound === undefined ? {} : { inbound: options.inbound }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.sealer === undefined ? {} : { sealer: options.sealer }),
    ...(options.assessmentProvider === undefined
      ? {}
      : { assessmentProvider: options.assessmentProvider }),
    ...(options.backgroundChecks === undefined
      ? {}
      : { backgroundChecks: options.backgroundChecks }),
    ...(options.domains === undefined ? {} : { domains: options.domains }),
    ...(options.connections === undefined ? {} : { connections: options.connections }),
    ...(options.boards === undefined ? {} : { boards: options.boards }),
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
      options.jobsOrigin,
      (sentence) => planSearch(deps.model, sentence),
    ),
  };
}
