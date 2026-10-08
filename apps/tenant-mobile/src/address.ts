/**
 * Where a company lives: its own hostname under `app.kithena.com`, as on the
 * web. The phone asks for it first because nothing else says which company —
 * the same reason the web's sign-in page lives on that hostname.
 *
 * Only the company's label is typed; the suffix is fixed beside the field, so
 * there is nothing else to get wrong.
 */
export const TENANT_SUFFIX = '.app.kithena.com';

/** A DNS label: letters, digits and inner hyphens, as a company's slug is. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** What may be typed: lower case, and nothing a label cannot hold. */
export function asLabel(typed: string): string {
  return typed.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** `https://<label>.app.kithena.com`, or null when the label is not one. */
export function companyOrigin(label: string): string | null {
  return LABEL.test(label) ? `https://${label}${TENANT_SUFFIX}` : null;
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
