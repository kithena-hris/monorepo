import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProviderEvent, SettleDelivery } from '../application/settle-delivery.js';

/**
 * The provider telling us what happened to a message.
 *
 * ### Why this is not behind the internal token
 *
 * The caller is Resend, not one of ours, and it has no way to hold our shared
 * secret. What it does hold is a signing key, so the request is authenticated
 * by its signature — which is strictly better: a shared secret in a header is
 * replayable and a signature over the body with a timestamp is not.
 *
 * That makes signature verification the whole of the security here. An
 * unverified webhook endpoint is an open API for marking any message delivered,
 * bounced or complained, and the last of those is how somebody would get a
 * customer's sending domain suppressed.
 *
 * ### Why the body is read as bytes
 *
 * The signature is over the exact bytes that were sent. `JSON.parse` followed
 * by `JSON.stringify` is not those bytes — key order, whitespace and number
 * formatting all move — so the raw payload is kept and parsed only after it has
 * been verified.
 */
const WEBHOOK = '/api/webhooks/resend';

/** Svix's headers, which is what Resend signs with. */
const SIGNATURE_HEADERS = ['svix-id', 'svix-timestamp', 'svix-signature'] as const;

export interface WebhookRoutesDeps {
  readonly settle: SettleDelivery;
  /**
   * Verifies the signature and returns the payload, or throws.
   *
   * A function rather than the SDK, so the route can be tested without one and
   * so that nothing vendor-shaped reaches this layer. Absent means webhooks are
   * not configured for this deployment, and every request is refused rather
   * than trusted — the safe direction, and the one a missing secret should
   * take.
   */
  readonly verify?:
    ((input: { payload: string; headers: Record<string, string> }) => unknown) | undefined;
  readonly onRefusal?: (reason: string) => void;
}

export function webhookRoutes({ settle, verify, onRefusal }: WebhookRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (path !== WEBHOOK) return false;

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }

    if (verify === undefined) {
      onRefusal?.('not_configured');
      response.writeHead(503).end();
      return true;
    }

    const payload = await readRawBody(request);
    if (payload === null) {
      onRefusal?.('body_too_large');
      response.writeHead(413).end();
      return true;
    }

    const headers: Record<string, string> = {};
    for (const name of SIGNATURE_HEADERS) {
      const value = request.headers[name];
      // An array means the header arrived twice, which is a caller choosing
      // which one gets verified. Neither.
      if (typeof value !== 'string') {
        onRefusal?.('signature_headers');
        response.writeHead(401).end();
        return true;
      }
      headers[name] = value;
    }

    let verified: unknown;
    try {
      verified = verify({ payload, headers });
    } catch {
      // Nothing about *why* reaches the caller. A verifier distinguishes a bad
      // signature from a stale timestamp, and saying which is a hint to
      // whoever is guessing.
      onRefusal?.('signature');
      response.writeHead(401).end();
      return true;
    }

    const event = eventFrom(verified);
    if (event === null) {
      onRefusal?.('unreadable_event');
      // 200, not 400. A shape we do not recognise is not something the provider
      // can fix by retrying, and Svix retries a 4xx for hours before giving up
      // and marking the endpoint unhealthy.
      response.writeHead(200).end();
      return true;
    }

    const settled = await settle(event);
    if (!settled.ok) {
      // Also 200, and for the same reason: an event we ignore on purpose and an
      // event about a message we have never heard of are both final answers.
      // Only a failure we might recover from should ask to be sent again.
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ handled: false, reason: settled.error.code }));
      return true;
    }

    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ handled: true, status: settled.value }));
    return true;
  };
}

/**
 * The two fields we act on, narrowed by asking rather than by asserting.
 *
 * The verifier returns the parsed payload typed as whatever the SDK declares,
 * and this route deliberately does not depend on that type — the shape crossing
 * the wire is the provider's to change, and a cast would describe what it is
 * supposed to send rather than what arrived.
 */
export function eventFrom(payload: unknown): ProviderEvent | null {
  if (payload === null || typeof payload !== 'object') return null;

  const type: unknown = Reflect.get(payload, 'type');
  const data: unknown = Reflect.get(payload, 'data');
  if (typeof type !== 'string' || data === null || typeof data !== 'object') return null;

  // Resend names it `email_id`. Read defensively rather than assumed, because
  // an event with no id is one this service must not act on at all — every
  // update is keyed by it.
  const messageId: unknown = Reflect.get(data, 'email_id');
  if (typeof messageId !== 'string' || messageId === '') return null;

  return { type, messageId };
}

/**
 * The exact bytes, capped.
 *
 * Not `readJsonBody`: the signature is over what was sent, and a parse-then-
 * re-serialise round trip does not reproduce it. 256 KiB because a webhook
 * payload is metadata — the body of the email is not in it, which is a thing
 * worth knowing before somebody goes looking for it.
 */
async function readRawBody(
  request: IncomingMessage,
  maxBytes = 256 * 1024,
): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) return null;
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}
