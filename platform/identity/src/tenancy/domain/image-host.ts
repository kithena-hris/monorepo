/**
 * Where an uploaded image is allowed to live.
 *
 * A customer's login page renders these, so an off-site URL is an image
 * somebody else can swap after we have approved it — and the login page is the
 * one screen where a swapped image is a convincing phishing prompt. The rule is
 * therefore a domain rule: images come from somewhere we control, or they do
 * not come at all.
 *
 * **Which** host that is, is not a domain question. It used to be a literal —
 * a regex naming Vercel Blob — which made a deployment decision into an
 * invariant and meant self-hosting the bucket would have required editing a
 * security rule and its tests. The rule has not changed; it now takes the
 * answer as configuration, which is also what lets one deployment allow two
 * hosts while images are moved between them.
 */
export interface ImageHostPolicy {
  /**
   * Hosts an image may be served from.
   *
   * An entry beginning with a dot is a suffix and matches any subdomain of it —
   * `.public.blob.vercel-storage.com` covers every bucket. Anything else is an
   * exact host and matches only itself, so `images.kithena.com` does not admit
   * `evil.images.kithena.com`.
   *
   * Empty refuses everything. A deployment that forgot to configure this should
   * lose its logos, not accept whatever anybody types.
   */
  readonly hosts: readonly string[];
}

/**
 * Whether this URL is one of ours.
 *
 * Parsed rather than pattern-matched, and the difference is the whole point:
 * `vercel-storage.com.evil.example` *contains* the allowed host, and so does a
 * path, a query string and a fragment. Only the parsed `hostname` is compared,
 * so none of those can smuggle a match past it.
 *
 * `https` only. An `http:` image on a login page is a mixed-content warning at
 * best and a rewriteable asset at worst.
 */
export function imageIsOurs(url: string | null, policy: ImageHostPolicy): boolean {
  // Absent is not the same as elsewhere: a company with no logo is ordinary.
  if (url === null) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  // DNS is case-insensitive and `URL` already lowercases the hostname; the
  // configured side is lowercased here so a capitalised entry still works.
  const host = parsed.hostname;

  return policy.hosts.some((allowed) => {
    const wanted = allowed.trim().toLowerCase();
    if (wanted === '') return false;
    // A leading dot means "and any subdomain of this", and the dot is what
    // keeps the match on a label boundary: without it, `notpublic.blob…` ends
    // with the allowed string and a suffix check would say yes.
    return wanted.startsWith('.') ? host.endsWith(wanted) : host === wanted;
  });
}
