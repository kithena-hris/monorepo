/**
 * A webhook endpoint and its delivery (PRF-058, PRD §31): which of
 * Performance's events it takes, how far it has got, and what a failed send
 * does. Pure; the signing and the send are the infrastructure's.
 *
 * Events go to an endpoint in the order they were written, one at a time: a
 * failed one is tried again, with People's backoff, before anything after it,
 * so a receiver never sees a review released before it was submitted. After
 * 24 hours of failing the endpoint is turned off, with why, for an
 * administrator to turn on again.
 */

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  /** Event names, or `*` for every one Performance publishes. */
  readonly events: readonly string[];
  /** The secret's rotation: the endpoint's secret is derived from it. */
  readonly version: number;
  /** The rotation before, still signed with until `until`, so a receiver can switch over. */
  readonly previous: { readonly version: number; readonly until: string } | null;
  readonly createdAt: string;
  readonly disabled: { readonly at: string; readonly why: string } | null;
  /** The last event delivered, or where it started: only what follows is sent. */
  readonly cursor: { readonly at: string; readonly id: string };
  readonly failing: {
    readonly since: string;
    readonly attempts: number;
    readonly retryAt: string;
    readonly status: number;
  } | null;
  readonly last: { readonly at: string; readonly status: number; readonly eventId: string } | null;
}

/** How long the previous secret is still signed with after a rotation. */
export const ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const GIVE_UP_MS = 24 * 60 * 60 * 1000;

/** When to try again after `attempts` failures, or null once 24 hours have passed. People's backoff. */
export function nextAttempt(firstAttempt: Date, attempts: number, now: Date): Date | null {
  const deadline = firstAttempt.getTime() + GIVE_UP_MS;
  if (now.getTime() >= deadline) return null;
  const wait = Math.min(FIRST_RETRY_MS * 2 ** Math.max(attempts - 1, 0), MAX_RETRY_MS);
  return new Date(Math.min(now.getTime() + wait, deadline));
}

export const subscribes = (e: Pick<WebhookEndpoint, 'events'>, eventName: string): boolean =>
  e.events.includes('*') || e.events.includes(eventName);

/** Whether it is the endpoint's turn: on, and not waiting out a backoff. */
export const ready = (e: WebhookEndpoint, now: Date): boolean =>
  e.disabled === null && (e.failing === null || Date.parse(e.failing.retryAt) <= now.getTime());

/** The rotations a delivery is signed with now: the current one, and the previous while it overlaps. */
export const liveVersions = (e: WebhookEndpoint, now: Date): readonly number[] =>
  e.previous !== null && Date.parse(e.previous.until) > now.getTime()
    ? [e.version, e.previous.version]
    : [e.version];

/** A 2xx is delivered; anything else, a timeout included, is a failure. */
export const delivered = (status: number): boolean => status >= 200 && status < 300;

/** The endpoint after one send of one event. */
export function afterSend(
  e: WebhookEndpoint,
  sent: { readonly eventId: string; readonly writtenAt: string; readonly status: number },
  now: Date,
): WebhookEndpoint {
  const at = now.toISOString();
  const last = { at, status: sent.status, eventId: sent.eventId };
  if (delivered(sent.status))
    return { ...e, cursor: { at: sent.writtenAt, id: sent.eventId }, failing: null, last };
  const since = e.failing?.since ?? at;
  const attempts = (e.failing?.attempts ?? 0) + 1;
  const retry = nextAttempt(new Date(since), attempts, now);
  if (retry === null)
    return {
      ...e,
      last,
      failing: null,
      disabled: {
        at,
        why: `Turned off after 24 hours of failed deliveries (last answer: ${sent.status === 0 ? 'none' : String(sent.status)})`,
      },
    };
  return {
    ...e,
    last,
    failing: { since, attempts, retryAt: retry.toISOString(), status: sent.status },
  };
}

/** A new rotation; the old one is still signed with for a day. */
export function rotated(e: WebhookEndpoint, now: Date): WebhookEndpoint {
  return {
    ...e,
    version: e.version + 1,
    previous: {
      version: e.version,
      until: new Date(now.getTime() + ROTATION_OVERLAP_MS).toISOString(),
    },
  };
}
