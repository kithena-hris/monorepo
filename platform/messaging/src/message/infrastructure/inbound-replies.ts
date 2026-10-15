import { Resend } from 'resend';

/**
 * A candidate's reply, from Resend's inbound webhook to the module whose
 * thread it belongs to (Recruiting PRD §12.7).
 *
 * The module writes the reply-to address, `<company>.<token>@<INBOUND_DOMAIN>`,
 * and keeps what the token means; this service only reads the address, fetches
 * the text — the webhook carries metadata, never the body — and posts it on,
 * behind the same token the module uses to send through here. Nothing about
 * the reply is stored here: `messaging.delivery` records outcomes only.
 */

export interface ReceivedEmail {
  readonly to: readonly string[];
  readonly from: string;
  readonly subject: string;
  readonly text: string | null;
}

/** The company and token an address names, or null when it is not one of ours. */
export function replyTarget(
  address: string,
  domain: string,
): { readonly company: string; readonly token: string } | null {
  const bare = (/<([^>]+)>/u.exec(address)?.[1] ?? address).trim().toLowerCase();
  const at = bare.lastIndexOf('@');
  if (at < 0 || bare.slice(at + 1) !== domain.toLowerCase()) return null;
  const match = /^([a-z0-9-]{1,63})\.([a-f0-9]{20})$/u.exec(bare.slice(0, at));
  return match === null ? null : { company: match[1] ?? '', token: match[2] ?? '' };
}

export interface ForwardRepliesDeps {
  readonly domain: string;
  /** Recruiting's base URL. */
  readonly recruitingUrl: string;
  readonly recruitingToken: string;
  readonly getEmail: (id: string) => Promise<ReceivedEmail | null>;
  readonly post?: typeof fetch;
}

/** Hands each reply to Recruiting; one that names no thread of ours is dropped. */
export function forwardReplies(deps: ForwardRepliesDeps): (emailId: string) => Promise<number> {
  const post = deps.post ?? fetch;
  return async (emailId) => {
    const email = await deps.getEmail(emailId);
    if (email === null) return 0;
    let forwarded = 0;
    for (const address of email.to) {
      const target = replyTarget(address, deps.domain);
      if (target === null) continue;
      const answer = await post(
        `${deps.recruitingUrl}/v1/recruiting/public/${target.company}/replies`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-token': deps.recruitingToken },
          body: JSON.stringify({
            token: target.token,
            from: (/<([^>]+)>/u.exec(email.from)?.[1] ?? email.from).trim(),
            subject: email.subject.slice(0, 500),
            text: (email.text ?? '').slice(0, 20_000),
          }),
        },
      );
      if (answer.ok) forwarded += 1;
    }
    return forwarded;
  };
}

/** The received email's text, through Resend's API. */
export function resendReceived(apiKey: string): (id: string) => Promise<ReceivedEmail | null> {
  const resend = new Resend(apiKey);
  return async (id) => {
    const { data } = await resend.emails.receiving.get(id);
    return data === null
      ? null
      : { to: data.to, from: data.from, subject: data.subject, text: data.text };
  };
}
