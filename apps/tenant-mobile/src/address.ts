/**
 * Where a company lives: its own hostname under `app.kithena.com`, as on the
 * web. The phone asks for it first because nothing else says which company —
 * the same reason the web's sign-in page lives on that hostname.
 *
 * Parsed by hand rather than with `URL`: React Native's `URL` implements
 * construction and little else, and its getters throw.
 */
const TENANT_SUFFIX = 'app.kithena.com';

/** Labels of letters, digits and inner hyphens, at least two of them, and a port. */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?$/;

/** `https://<host>` for what somebody typed, or null when it is not an address. */
export function companyOrigin(typed: string): string | null {
  let host = typed
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/.*$/, '');
  // A company's name alone is the label in front of the suffix.
  if (host !== '' && !host.includes('.') && !host.includes(':')) host = `${host}.${TENANT_SUFFIX}`;
  return HOST.test(host) ? `https://${host}` : null;
}

/**
 * What to call somebody: what they asked to be called, else their given name,
 * else words made from their address — the web's `displayName` fallback.
 */
export function greetingFor(
  name: { given: string; family: string; preferred: string | null } | null,
  workEmail: string | null,
): string {
  if (name !== null) return name.preferred ?? name.given;
  const words = (workEmail?.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return words.length === 0 ? 'there' : words.join(' ');
}
