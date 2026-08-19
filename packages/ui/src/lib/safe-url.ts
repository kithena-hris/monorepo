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

/**
 * A URL safe to put in `src`.
 *
 * `http(s)`, a `data:` image, a `blob:` (which only the same document can
 * mint), or a same-origin path. Everything else, including `javascript:`,
 * `vbscript:`, `file:` and a bare `data:text/html`, returns `undefined`.
 */
export function safeImageUrl(url: string | undefined | null): string | undefined {
  if (typeof url !== 'string') return undefined;
  const value = url.trim();
  if (value === '') return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (IMAGE_DATA.test(value)) return value;
  if (RELATIVE.test(value)) return value;
  return undefined;
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
  if (typeof url !== 'string') return undefined;
  const value = url.trim();
  if (value === '') return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:mailto|tel):/i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (RELATIVE.test(value)) return value;
  // A bare fragment, for in-page navigation.
  if (value.startsWith('#')) return value;
  return undefined;
}
