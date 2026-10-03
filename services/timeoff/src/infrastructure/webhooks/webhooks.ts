import { createHmac, timingSafeEqual } from 'node:crypto';

import manifest from '../../../module.manifest.js';

/**
 * Outbound webhooks (PRD §18, TOF-047): every event Time Off publishes,
 * signed, to the endpoints that subscribe to it.
 *
 * The signature is People's (`services/people/src/infrastructure/webhooks/
 * payload.ts`), byte for byte, so an integrator verifies both modules with
 * one function: `kithena-signature: v1=<hex>` per live secret, HMAC-SHA256
 * over the raw body, both secrets during a rotation's overlap. Copied rather
 * than shared — there is no package for it, and a module does not import
 * another. `nextAttempt` is People's backoff, for the same reason.
 *
 * ponytail: delivery is one attempt per endpoint, told back to the caller.
 * People's durable schedule — a delivery row per endpoint written by a
 * trigger on the outbox, leased, retried for 24 hours — comes with Time
 * Off's endpoint tables, when a tenant registers the first one.
 */

export interface StoredEnvelope {
  readonly eventId: string;
  readonly eventName: string;
  readonly payload: unknown;
  readonly [field: string]: unknown;
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  /** The live secret first; the previous one too while a rotation overlaps. */
  readonly secrets: readonly string[];
  /** Event names, or `*` for every one Time Off publishes. */
  readonly events: readonly string[];
}

export type Poster = (
  url: string,
  request: { readonly headers: Record<string, string>; readonly body: string },
) => Promise<{ readonly status: number }>;

/** `v1=<hex>` per live secret: HMAC-SHA256 over the raw body. */
export function signatureHeader(body: string, secrets: readonly string[]): string {
  return secrets
    .map((secret) => `v1=${createHmac('sha256', secret).update(body).digest('hex')}`)
    .join(',');
}

/** What a receiver does, here so the tests check what an integrator would. */
export function verifySignature(body: string, header: string, secret: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'));
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .some((part) => {
      const presented = Buffer.from(part.slice(3));
      return presented.length === expected.length && timingSafeEqual(presented, expected);
    });
}

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const GIVE_UP_MS = 24 * 60 * 60 * 1000;

/** When to try again after `attempts` failures, or null once 24 hours have passed. */
export function nextAttempt(firstAttempt: Date, attempts: number, now: Date): Date | null {
  const deadline = firstAttempt.getTime() + GIVE_UP_MS;
  if (now.getTime() >= deadline) return null;
  const wait = Math.min(FIRST_RETRY_MS * 2 ** Math.max(attempts - 1, 0), MAX_RETRY_MS);
  return new Date(Math.min(now.getTime() + wait, deadline));
}

const PUBLISHED: ReadonlySet<string> = new Set(manifest.publishes);

/** The signed request for one event to one endpoint, or `null` when it does not subscribe. */
export function webhookRequest(
  envelope: StoredEnvelope,
  endpoint: WebhookEndpoint,
  deliveryId: string,
): { readonly headers: Record<string, string>; readonly body: string } | null {
  if (!PUBLISHED.has(envelope.eventName)) return null;
  if (!endpoint.events.includes('*') && !endpoint.events.includes(envelope.eventName)) return null;
  const body = JSON.stringify(envelope);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'kithena-event-id': envelope.eventId,
      'kithena-delivery-id': deliveryId,
      'kithena-signature': signatureHeader(body, endpoint.secrets),
    },
  };
}

/** One event to every endpoint that subscribes to it; a failed send is status 0. */
export async function deliver(
  envelope: StoredEnvelope,
  endpoints: readonly WebhookEndpoint[],
  post: Poster,
  newId: () => string,
): Promise<{ readonly endpointId: string; readonly status: number }[]> {
  const sends = endpoints.flatMap((endpoint) => {
    const request = webhookRequest(envelope, endpoint, newId());
    return request === null ? [] : [{ endpoint, request }];
  });
  return Promise.all(
    sends.map(async ({ endpoint, request }) => ({
      endpointId: endpoint.id,
      status: await post(endpoint.url, request)
        .then((r) => r.status)
        .catch(() => 0),
    })),
  );
}
