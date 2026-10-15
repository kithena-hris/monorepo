import { err, ok, type Result } from '@kithena/domain-kit';

import { escapeHtml } from './markup.js';
import { Unrenderable, type RenderedMessage } from './invitation.js';

/**
 * Correspondence: an email a module wrote word for word, to somebody outside
 * the company who is not a user — a candidate (Recruiting PRD §12.7).
 *
 * The one kind of message here whose words are not this service's. A
 * candidate's thread is the feature, so Recruiting writes it and keeps it;
 * messaging sends it and, as for everything else, records the outcome and
 * never the body. Plain text in, a plain HTML rendering of the same text
 * out: no markup from the caller is trusted, and every link stays a link the
 * reader can see whole.
 */
export const CORRESPONDENCE_KIND = 'correspondence';

export function renderCorrespondence(
  subject: string,
  text: string,
  companyName: string,
): Result<RenderedMessage> {
  const heading = subject.trim();
  const body = text.trim();
  if (
    heading === '' ||
    body === '' ||
    heading.length > 300 ||
    body.length > 20_000 ||
    /[\r\n]/u.test(heading)
  ) {
    return err(Unrenderable);
  }
  const paragraphs = body
    .split(/\n{2,}/u)
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/gu, '<br>')}</p>`)
    .join('');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font:15px/1.5 -apple-system,'Segoe UI',sans-serif;color:#1b1b1f">${paragraphs}<p style="margin:24px 0 0;color:#6b6b76;font-size:13px">${escapeHtml(companyName)}</p></body></html>`;
  return ok({ subject: heading, html, text: `${body}\n\n${companyName}` });
}
