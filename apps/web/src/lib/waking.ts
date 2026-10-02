/**
 * Whether a failed call to the router is the VM still waking or a real error,
 * and how often the page asks again while it wakes.
 *
 * The VM sleeps when nobody uses it (`deploy/vm/idle-stop.sh`) and takes a
 * minute or so to come back: first nobody answers through the tunnel, then
 * the router answers before People does. Each of those is "not up yet". A
 * refusal, a GraphQL error from People itself or a signature failure is
 * something the router and People said, and stays an error.
 *
 * Pure, so the server classifies with it and the browser backs off with it.
 */

/** What a write made while it wakes says, and what a waking read is. */
export const WAKING_MESSAGE = 'Kithena is waking up, try again in a moment';

/**
 * Statuses only a gateway in front of the router gives: Cloudflare's for a
 * tunnel with nobody behind it (530, error 1033) or an origin that refused or
 * is not listening yet (502-504, 521-523). The router never answers them.
 */
const GATEWAY_DOWN = new Set([502, 503, 504, 521, 522, 523, 530]);

export function wakingStatus(status: number): boolean {
  return GATEWAY_DOWN.has(status);
}

/**
 * A fetch that threw: refused, reset or not resolved is nobody there. A read
 * that timed out is a VM half up (the tunnel holds the request while the
 * router starts); a write that timed out may have been applied, so it is not
 * waking — it is said as what it is.
 */
export function wakingCause(cause: unknown, write: boolean): boolean {
  const timeout = cause instanceof Error && cause.name === 'TimeoutError';
  return !timeout || !write;
}

/**
 * The router is up and People is not listening yet: Cosmo's own error for a
 * subgraph it could not reach. People's own errors carry its message and code.
 *
 * ponytail: matched on Cosmo's wording, which is also what a People that
 * answers 5xx without a body gets; `statusCode` in the router's
 * `allowed_extension_fields` would tell those apart if that ever matters.
 */
export function wakingErrors(
  errors: readonly { readonly message?: string }[] | undefined,
): boolean {
  return errors?.[0]?.message?.startsWith('Failed to fetch from Subgraph') === true;
}

/** An answer the shell got back while the VM was still waking. */
export function isWaking(answer: { readonly ok: boolean; readonly code?: string }): boolean {
  return !answer.ok && answer.code === 'UNREACHABLE';
}

/** Ask again after 2 s, 3 s, 5 s, then every 5 s. */
const BACKOFF_MS = [2_000, 3_000, 5_000] as const;
export function retryDelay(attempt: number): number {
  return BACKOFF_MS[attempt] ?? 5_000;
}

/** After this long, say so and stop asking by itself: a wake is usually under a minute. */
export const SLOW_AFTER_MS = 3 * 60_000;
