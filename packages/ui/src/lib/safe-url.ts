/**
 * URL guards for values that arrive from outside.
 *
 * An avatar URL, an uploaded file's location and a link in stored rich text
 * all come from an upload, an import or another tenant's data. By the time one
 * reaches `href` or `src` it is attacker-influenced content going into the DOM,
 * and the two risks are different:
 *
 * A `javascript:` href executes on click, which is stored XSS with an extra
 * step. React does not block it; it only escapes text.
 *
 * An `http:` src to somebody else's host does not execute anything, and still
 * leaks. Every viewer's IP address, user agent and referrer go to a server the
 * attacker chose, once per render, which is a tracking pixel that arrived
 * through your own database.
 *
 * Both guards fail closed. An unrecognised value returns `undefined` so the
 * caller renders its fallback, rather than being handed something sanitised
 * that is still whatever somebody chose.
 */

/** Schemes that can only ever be a picture. */
const IMAGE_DATA = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|svg\+xml)[,;]/i;

/** A same-origin path: `/x`, `./x`, `../x`. Never `//host`, which is remote. */
const RELATIVE = /^(?!\/\/)(?:\.{0,2}\/)/;

const IMAGE_SCHEMES = new Set(['http:', 'https:', 'blob:', 'data:']);
const LINK_SCHEMES = new Set(['http:', 'https:', 'blob:', 'mailto:', 'tel:']);

/**
 * The shared decision: parse, then allow only known-safe schemes.
 *
 * A relative value has no scheme of its own, so it is resolved against a
 * throwaway base purely to *classify* it — the value returned is always the
 * caller's original, never the absolutised form, because `./logo.png` means
 * something different relative to `/a/b/` than it does to `/`.
 *
 * `//host/x` is refused before parsing. It is protocol-relative — a remote URL
 * wearing something that looks like a path — and resolving it against the base
 * would classify it as ordinary `http:` and let it through.
 */
function allowedScheme(url: string | undefined | null, schemes: Set<string>): string | undefined {
  if (typeof url !== 'string') return undefined;
  const value = url.trim();
  if (value === '') return undefined;
  if (value.startsWith('//')) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value, 'http://localhost/');
  } catch {
    // Not a URL at all, by the parser that will be asked to render it.
    return undefined;
  }

  if (!schemes.has(parsed.protocol)) return undefined;

  // `data:` is in the image set but only ever as a picture: a `data:text/html`
  // is a document, and a document runs.
  if (parsed.protocol === 'data:' && !IMAGE_DATA.test(value)) return undefined;

  // A relative value must still look relative. Without this, the throwaway base
  // would let a bare `evil.test/x` through as though it were a path.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (!isAbsolute && !RELATIVE.test(value) && !value.startsWith('#')) return undefined;

  /*
   * The parser's own output for anything absolute, not the caller's string.
   *
   * `href` is the URL the browser would resolve this to, normalised — so what
   * reaches `src` is a value this function constructed rather than one it
   * merely inspected and passed along. That closes the gap a scheme check alone
   * leaves: a value can survive validation and still carry something the
   * validator did not think to look at, and it is why a static analyser treats
   * "checked, then returned unchanged" as no barrier at all.
   *
   * A relative value is returned as written. Resolving it would change what it
   * means — `./logo.png` is not the same file from `/a/b/` as from `/` — and it
   * cannot carry a scheme, which is the thing being guarded against.
   */
  return isAbsolute ? parsed.href : value;
}

/**
 * A URL safe to put in `src`.
 *
 * `http(s)`, a `data:` image, a `blob:` (which only the same document can
 * mint), or a same-origin path. Everything else, including `javascript:`,
 * `vbscript:`, `file:` and a bare `data:text/html`, returns `undefined`.
 *
 * The scheme is decided by **parsing** rather than by matching the string, and
 * that is not a stylistic preference. A regex over raw text has to anticipate
 * every way a scheme can be written — leading control characters, embedded
 * newlines, `java\tscript:`, percent-encoding — and the parser already knows
 * all of them. It is also the difference between a guard a static analyser can
 * see and one it cannot: CodeQL models a `URL` parse followed by a `protocol`
 * allowlist as a barrier, and flagged a sink guarded by the regex version of
 * this function as unprotected. It was right to.
 */
export function safeImageUrl(url: string | undefined | null): string | undefined {
  return allowedScheme(url, IMAGE_SCHEMES);
}

/**
 * A URL safe to put in `href`.
 *
 * Stricter than the image guard: no `data:`, because a `data:text/html`
 * document opens with your origin's referrer and renders whatever it likes.
 * `mailto:` and `tel:` are allowed because they hand off to another
 * application rather than executing in the page.
 */
export function safeLinkUrl(url: string | undefined | null): string | undefined {
  return allowedScheme(url, LINK_SCHEMES);
}
