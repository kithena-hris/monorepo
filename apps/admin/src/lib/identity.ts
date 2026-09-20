import 'server-only';

/**
 * The identity service, and the credential this app must not ship to a browser.
 *
 * Everything the back-office does goes through here, server-side. `server-only`
 * makes that a build error rather than a convention: importing this from a
 * client component fails the build instead of quietly bundling an internal
 * token into JavaScript that anybody can read.
 */
const IDENTITY = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4100';
const TOKEN = process.env['INTERNAL_API_TOKEN'] ?? '';

export async function callIdentity(
  path: string,
  init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = { method: 'GET' },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${IDENTITY}${path}`, {
    method: init.method,
    headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
    // Spread rather than set to `undefined`: `exactOptionalPropertyTypes` draws
    // a distinction between a key that is absent and one whose value is
    // undefined, and `RequestInit` accepts only the first.
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    // The back-office reads live state. A cached tenant list is a list that
    // does not show the customer somebody created a moment ago.
    cache: 'no-store',
    // A bounded wait, because the alternative is unbounded. Identity is a
    // separate deployment and an unreachable one used to mean this request hung
    // until the platform killed it — a blank tab for half a minute, which reads
    // as "the back-office is broken" rather than "identity is down".
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

/**
 * A read, with the two failures told apart.
 *
 * `callIdentity` reports a status and leaves the caller to interpret it, and
 * every caller interpreted it the same wrong way: anything that was not a body
 * became `notFound()`. A company that exists, on an identity service that is
 * refusing or erroring, then rendered as "this page could not be found" — the
 * one message guaranteed to send somebody looking in the wrong place.
 *
 * So: absent is `null`, and *broken* throws. `null` is a 404 and nothing else.
 * Everything else reaches `app/error.tsx`, which says what actually happened.
 */
export async function readIdentity(path: string): Promise<unknown> {
  const { status, body } = await callIdentity(path);
  if (status === 404) return null;
  if (status !== 200) {
    throw new Error(`The identity service answered ${String(status)} for ${path}.`);
  }
  // A 200 with no body is not a found resource. It is a contract violation, and
  // treating it as "missing" would hide it for as long as it kept happening.
  if (body === null) throw new Error(`The identity service returned nothing for ${path}.`);
  return body;
}
