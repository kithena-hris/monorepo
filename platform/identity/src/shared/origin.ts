import { isRegistrableSlug } from '@kithena/contracts';

/**
 * Which origins this deployment issued.
 *
 * In `shared/` rather than owned by the credential slice, because enrolment
 * asks the same question of a registration ceremony that sign-in asks of an
 * assertion, and a CSRF check will ask it of an ordinary form post. The concept
 * is "is this one of our hostnames", which is a property of the deployment.
 *
 * The RP ID is `app.kithena.com`, and the browser will let *any* origin under
 * it ask for an assertion. That is the point — a passkey has to work at
 * `acme.app.kithena.com` and `globex.app.kithena.com` both, because one
 * contractor carries one passkey to every employer. It is also why this
 * function exists: the browser enforces the suffix, and we enforce that the
 * label in front of it is a tenant we issued.
 *
 * ### Why not `kithena.com`
 *
 * A registrable suffix one level up would also have been legal, and would have
 * made every credential in the product assertable from `design.kithena.com` and
 * `storybook.kithena.com` — which CLAUDE.md records as world-readable and
 * unprotectable on Vercel's Hobby plan. `app.kithena.com` is structurally
 * unreachable from both, because neither is a subdomain of it.
 */
export interface OriginPolicy {
  /** The WebAuthn RP ID. Every acceptable origin ends in it. */
  readonly rpId: string;
  /** The dedicated ceremony origin, which is not a tenant. */
  readonly authOrigin: string;
  /** Whether to allow `http://` for local development. Never true in production. */
  readonly allowInsecure?: boolean;
}

export function isAcceptableOrigin(origin: string, policy: OriginPolicy): boolean {
  if (origin === policy.authOrigin) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  // A ceremony over plain HTTP is a ceremony an intermediary can watch and
  // replay. The exception exists so `app.localhost` works without a
  // certificate, and it is a configuration flag rather than a hostname check,
  // so nothing about production depends on remembering a special case.
  if (url.protocol !== 'https:' && !(policy.allowInsecure === true && url.protocol === 'http:')) {
    return false;
  }

  // A path, a query or a fragment means this is not an origin. Comparing
  // loosely here is how `https://acme.app.kithena.com.evil.com` gets accepted
  // by something that only looked at the start of the string.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;

  const suffix = `.${policy.rpId}`;
  if (!url.hostname.endsWith(suffix)) return false;

  const label = url.hostname.slice(0, -suffix.length);

  // Exactly one label. `a.b.app.kithena.com` is a hostname nobody issued, and
  // treating it as a tenant would let whoever holds the wildcard certificate
  // invent nesting.
  if (label.includes('.')) return false;

  return isRegistrableSlug(label);
}
