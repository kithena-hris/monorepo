import type { VercelRequest, VercelResponse } from '@vercel/node';

import { compose, type RequestHandler } from '../src/composition.js';

/**
 * The messaging service, as a Vercel function.
 *
 * The same composed router `src/main.ts` puts behind `node:http`, and nothing
 * under `src/` knows this file exists. A Vercel Node function receives
 * `VercelRequest` and `VercelResponse`, which extend `IncomingMessage` and
 * `ServerResponse`, so the routes and their tests moved here unchanged.
 *
 * Unlike identity, this one has no argument to have about the runtime. That
 * service went to a container because it holds a Postgres pool across requests
 * and a function-per-request runtime takes that away; this holds nothing, so a
 * function is simply the right shape — see `src/main.ts` for why holding
 * nothing is a decision rather than an omission.
 */

/*
 * Composed once per instance. Module scope runs when the instance boots and is
 * reused for every request it serves, so the transport and its client are built
 * once rather than per request.
 */
let handler: RequestHandler | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

function routes(): RequestHandler {
  handler ??= compose({
    resendApiKey: process.env['RESEND_API_KEY'],
    from: process.env['RESEND_FROM'],
    replyTo: process.env['RESEND_REPLY_TO'],
    // Its own secret, falling back to the shared one. Identity sends whichever
    // of the two it has; see `Config.messagingToken` there for why they differ.
    internalToken: process.env['MESSAGING_API_TOKEN'] ?? required('INTERNAL_API_TOKEN'),
    // Required rather than defaulted. A default here would be an origin this
    // deployment does not serve, and every invitation would be refused as an
    // untrusted link — which is the safe way to be wrong, but still wrong.
    authOrigin: required('AUTH_ORIGIN'),
    // Preview and staging may write invitations to the log. Production may not:
    // a service that silently prints them instead of sending looks exactly like
    // one that works.
    allowLogTransport: process.env['VERCEL_ENV'] !== 'production',
    // Neon's *pooled* host, and `svc_messaging` rather than the owner — an
    // owner bypasses row-level security on its own tables whatever the policy
    // says, and `messaging.delivery` is scoped by one.
    databaseUrl: process.env['MESSAGING_DATABASE_URL'],
    // Absent means the webhook endpoint refuses rather than trusts. A bounced
    // invitation then stays recorded as accepted, which is worth a warning in
    // the log and is what `compose` emits.
    webhookSecret: process.env['RESEND_WEBHOOK_SECRET'],
  });
  return handler;
}

/**
 * Puts the original path back before the router sees it.
 *
 * `vercel.json` rewrites every request here and passes the path it came in on
 * as `__path`, because by the time the function runs `req.url` names the
 * function rather than what the caller asked for. The same arrangement identity
 * uses, and for the same reason a catch-all segment cannot work: the rewrite
 * matches paths that already begin `/api`, so `/api/internal/messaging/…` would
 * become `/api/api/internal/messaging/…` and match nothing.
 *
 * It is a query parameter set by the rewrite rather than a header, because
 * `__path` arrives in the URL the platform rewrote rather than from the caller.
 * A router that trusts a caller-supplied header is a router an attacker chooses
 * their way through.
 */
const INTERNAL = '__path';

function originalUrl(request: VercelRequest): string {
  const raw = request.query[INTERNAL];
  const first = Array.isArray(raw) ? raw[0] : raw;
  const path = typeof first === 'string' && first.startsWith('/') ? first : '/';

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (key === INTERNAL) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') query.append(key, item);
    }
  }

  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

export default async function gateway(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  request.url = originalUrl(request);

  try {
    const handled = await routes()(request, response);
    if (!handled) response.writeHead(404).end();
  } catch (error) {
    // Never to the caller. A provider error quotes the address it refused, and
    // this endpoint answers before anybody has authenticated as a person.
    console.error('unhandled request failure', { url: request.url, error });
    if (!response.headersSent) response.writeHead(500).end();
  }
}
