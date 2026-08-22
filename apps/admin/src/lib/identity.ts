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
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
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
  });

  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}
