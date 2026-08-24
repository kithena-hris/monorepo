/**
 * Turning values into markup safely.
 *
 * An invitation carries two pieces of text somebody else typed — the company's
 * display name, and the address the account was created against — straight into
 * an HTML document. Neither is hostile in the ordinary case and both are
 * attacker-controllable in the case worth designing for: a company registers as
 * `<img src=x onerror=…>`, or an address is entered with a quote in it, and the
 * mail client renders whatever we sent.
 *
 * Email is the worst place to be relaxed about this. There is no Content
 * Security Policy in a mail client, the message is stored for years, and it is
 * forwarded to people who were never our users.
 */

/**
 * Escapes the five characters that change the meaning of HTML.
 *
 * `&` first, and that ordering is the whole correctness of the function: escape
 * it last and the ampersands introduced by the other four are escaped a second
 * time, so `<` renders to a literal `&lt;` on the screen instead of a `<`.
 *
 * The two quotes are included although only attributes need them, because a
 * function that is safe in one position and not the other is a function that
 * gets used in the wrong one.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * A URL, safe to put in an `href`.
 *
 * Two jobs, and the scheme check is the one that is easy to forget. Escaping
 * alone leaves `javascript:…` intact — perfectly valid markup that some mail
 * clients and most webmail previews will still honour — so anything that is not
 * plainly `https:` (or `http:`, which only a local origin ever is) is refused
 * rather than escaped.
 *
 * Returns null instead of throwing so the caller decides. Rendering a message
 * with a dead button is worse than not sending it, and only the caller knows
 * that.
 */
export function safeHref(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return escapeHtml(parsed.toString());
}

/**
 * A logo URL, safe to put in an `<img src>` — or nothing.
 *
 * Stricter than `safeHref`, and the extra rules are about delivery rather than
 * about safety.
 *
 * `https:` only, because a mail client showing an `http:` image over a secure
 * connection reports mixed content and most simply drop it. `data:` is refused
 * for the same practical reason and not a security one: **Gmail does not render
 * `data:` image sources at all**, and neither does Outlook desktop — so a mark
 * inlined that way is a broken-image box for most of the people receiving this.
 * The seed script's placeholder logo is exactly such a URI, which is how that
 * would have gone unnoticed until it reached a real inbox.
 *
 * Null in means null out, so the caller can pass a nullable column straight
 * through.
 */
export function safeImageSrc(url: string | null): string | null {
  if (url === null || url === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  return escapeHtml(parsed.toString());
}
