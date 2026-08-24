import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { EmailAddress } from './address.js';
import { escapeHtml, safeHref, safeImageSrc } from './markup.js';
import { dark, light, scale } from './palette.js';

/**
 * The one message this service sends today: somebody has an account waiting at
 * a company, and here is how to set it up.
 *
 * Pure, which is what makes the copy reviewable. Rendering takes a struct and
 * returns a subject and two bodies; nothing here opens a socket, reads a clock
 * or knows what an enrolment token is. The link arrives already built, because
 * the service that mints the token is the only one that ever holds it and
 * messaging has no business learning its shape.
 */

export interface InvitationMessage {
  /** The company's display name, as the tenant registry holds it. */
  readonly companyName: string;
  readonly recipient: EmailAddress;
  /** Where the button goes. Already checked against the trusted origin. */
  readonly enrolUrl: string;
  /** ISO 8601, with an offset. When the link stops working. */
  readonly expiresAt: string;
  /**
   * The company's mark, when they have one and have agreed to it being shown.
   *
   * Whether they have agreed is the identity service's decision, not this one's
   * — `brandingFor` in the tenancy slice answers it, and a template that had to
   * remember to check a flag is a template that leaks the first time somebody
   * adds a header. Null arrives here already meaning "do not show one".
   */
  readonly logoUrl?: string | null | undefined;
}

export interface RenderedMessage {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export const Unrenderable = failure(
  'MESSAGE_UNRENDERABLE',
  'That invitation cannot be turned into a message',
);

/** Long enough for any real company, short enough that a subject line stays one. */
const MAX_COMPANY_NAME = 120;

/**
 * Whether a link may be put in front of a person.
 *
 * This is the check that stops messaging being a way to send a Kithena-branded
 * email pointing anywhere. The service takes a URL from a caller and mails it,
 * so without this the whole thing is an open redirect with our sending domain's
 * reputation attached — and the caller is authenticated by a shared secret,
 * which is exactly the kind of credential that ends up in a CI log.
 *
 * Origin, not prefix. The origin is the boundary that matters — it is what the
 * enrolment ceremony itself checks, what the cookie is scoped to, and what a
 * person reads in the address bar — and matching a path prefix as well would
 * mean editing this service every time the auth app grows a screen.
 */
export function linkIsTrusted(url: string, allowedOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A deadline a person can read, in UTC.
 *
 * Hand-formatted rather than `Intl.DateTimeFormat`, and the reason is not
 * taste. The recipient's time zone is not known here — the account carries one,
 * but it is the employer's guess about a person who has not logged in yet — so
 * any local rendering would be a guess presented as a fact about a deadline.
 * UTC, said out loud, is honest; "17:00" in the wrong zone is worse than no
 * time at all.
 *
 * Naming the zone also removes the ICU dependency from the output, which keeps
 * this assertable in a test that will still pass on a different Node build.
 */
export function formatDeadline(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const month = MONTHS[at.getUTCMonth()];
  if (month === undefined) return null;

  const hours = String(at.getUTCHours()).padStart(2, '0');
  const minutes = String(at.getUTCMinutes()).padStart(2, '0');
  return `${String(at.getUTCDate())} ${month} ${String(at.getUTCFullYear())} at ${hours}:${minutes} UTC`;
}

/**
 * The message, rendered.
 *
 * Both bodies, always. A `text/plain` alternative is not a courtesy: a message
 * with only an HTML part is scored as spam by most filters, and a corporate
 * gateway that strips HTML would otherwise deliver an empty invitation to
 * exactly the deskless population this product is meant to reach.
 *
 * The two are kept in step by being generated from the same values in the same
 * function, which is the only arrangement that survives a copy change.
 */
export function renderInvitation(message: InvitationMessage): Result<RenderedMessage> {
  const companyName = message.companyName.trim();
  if (companyName.length === 0 || companyName.length > MAX_COMPANY_NAME) {
    return err(Unrenderable);
  }

  const href = safeHref(message.enrolUrl);
  if (href === null) return err(Unrenderable);

  const deadline = formatDeadline(message.expiresAt);
  if (deadline === null) return err(Unrenderable);

  return ok({
    subject: `You're invited to join ${companyName} on Kithena`,
    html: html({
      company: escapeHtml(companyName),
      recipient: escapeHtml(message.recipient),
      href,
      // The visible copy of the link, which is not the `href`. A person who
      // does not trust a button is right not to, and the thing they check is
      // the text.
      plainUrl: escapeHtml(message.enrolUrl),
      deadline: escapeHtml(deadline),
      logo: safeImageSrc(message.logoUrl ?? null),
    }),
    text: text({
      companyName,
      recipient: message.recipient,
      url: message.enrolUrl,
      deadline,
    }),
  });
}

/* -------------------------------------------------------------- rendering -- */

interface View {
  readonly company: string;
  readonly recipient: string;
  readonly href: string;
  readonly plainUrl: string;
  readonly deadline: string;
  readonly logo: string | null;
}

/**
 * Reach, in the subset of HTML that survives a mail client.
 *
 * ### Why this looks like 2004
 *
 * Outlook on Windows still renders through Word. No flexbox, no grid, no
 * `border-radius`, and a `<style>` block it feels free to ignore. Gmail strips
 * the `<head>` entirely on some clients. These constraints are twenty years old
 * and have not moved, so the layout is tables and the styling is inline — this
 * is not a web page that happens to be emailed.
 *
 * ### How it is still the design system
 *
 * Every colour is a Reach token resolved to sRGB by `palette.ts`, and
 * `pnpm email:theme-drift` fails if one of them moves. Every size, radius and
 * weight below names the token it came from. The button is `Button`
 * `variant="primary" size="lg"` written out longhand: `accent-solid` on
 * `fg-on-accent`, `--radius-md`, `--reach-control-lg`, `--text-md`, medium.
 * The card is `Card` `variant="outlined"`: `surface`, a `border` line rather
 * than a shadow, `--radius-lg`, `p-5`.
 *
 * ### Dark mode
 *
 * The inline styles are the light theme, because inline is the only thing every
 * client honours and a light email is never *wrong*. The `<style>` block adds
 * the dark palette for the clients that both keep it and report
 * `prefers-color-scheme` — Apple Mail, iOS Mail, Outlook.com. Gmail keeps
 * neither and force-inverts instead, which is why the light palette is chosen
 * from Reach's own tokens rather than from pure white and black: an inverted
 * `#f9fafb` is a usable dark, an inverted `#ffffff` is not.
 */
function html(view: View): string {
  const preheader = `Set up your account at ${view.company}. The link works once, until ${view.deadline}.`;

  return `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>You're invited to join ${view.company}</title>
    <!--[if mso]>
      <style>
        /* Word substitutes Times New Roman for any family it cannot resolve,
           which turns the whole message serif. This names one it can. */
        * { font-family: 'Segoe UI', Arial, sans-serif !important; }
      </style>
    <![endif]-->
    <style>
      /* Only the clients that keep a style block and honour the query get
         this. The inline light theme stands everywhere else. */
      @media (prefers-color-scheme: dark) {
        .k-canvas { background: ${dark.canvas} !important; }
        .k-surface { background: ${dark.surface} !important; border-color: ${dark.border} !important; }
        .k-inset { background: ${dark['surface-sunken']} !important; border-color: ${dark.border} !important; }
        .k-fg { color: ${dark.fg} !important; }
        .k-muted { color: ${dark['fg-muted']} !important; }
        .k-accent { color: ${dark.accent} !important; }
        .k-rule { background: ${dark.border} !important; }
      }
      /* A phone is 320px wide at its narrowest. The card loses its outer
         margin rather than its padding: cramped copy reads worse than a card
         that touches the edges. */
      @media only screen and (max-width: 600px) {
        .k-pad { padding-left: 16px !important; padding-right: 16px !important; }
        .k-button { display: block !important; }
      }
    </style>
  </head>
  <body class="k-canvas" style="margin:0;padding:0;width:100%;background:${light.canvas};font-family:${scale.fontFamily};-webkit-font-smoothing:antialiased;">
    <!-- Shown in the inbox list beside the subject. Without it, clients pull
         the first line of the body, which here is the heading repeated. The
         trailing entities pad it so the client does not fill the rest of the
         preview line with the markup that follows. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>

    <table role="presentation" class="k-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${light.canvas};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:544px;">

            <!-- Wordmark. Type rather than an image on purpose: Gmail drops
                 'data:' image sources and Outlook desktop will not render SVG
                 at all, so the mark would be a broken box for most of the
                 people receiving this. Set in the brand colour at '--text-xs'
                 with the tracking a wordmark wants. -->
            <tr>
              <td style="padding:0 4px 16px 4px;">
                <span class="k-accent" style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${light.accent};">Kithena</span>
              </td>
            </tr>

            <!-- The card. 'Card variant="outlined"': a line, not a shadow. -->
            <tr>
              <td class="k-surface" style="background:${light.surface};border:1px solid ${light.border};border-radius:${scale.radiusCard};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${logoRow(view)}
                  <tr>
                    <td class="k-pad" style="padding:${view.logo === null ? scale.cardPadding : '0px'} ${scale.cardPadding} 0 ${scale.cardPadding};">
                      <h1 class="k-fg" style="margin:0;font-size:${scale.heading.size};line-height:${scale.heading.lineHeight};letter-spacing:${scale.heading.tracking};font-weight:600;color:${light.fg};">You're invited to join ${view.company}</h1>
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad k-muted" style="padding:12px ${scale.cardPadding} 0 ${scale.cardPadding};font-size:${scale.body.size};line-height:${scale.body.lineHeight};color:${light['fg-muted']};">
                      <p style="margin:0 0 12px 0;">An account is waiting for you. Setting it up takes about a minute.</p>
                      <p style="margin:0;">There is no password to choose. Your device will ask for your fingerprint, face or PIN, and that becomes how you sign in from then on.</p>
                    </td>
                  </tr>

                  <!-- Which account this is. It is the same thing the enrolment
                       page says before the device prompt appears, and it is
                       here for the same reason: one device holds passkeys for
                       several accounts, and the system prompt only shows what
                       it was told at registration. -->
                  <tr>
                    <td class="k-pad" style="padding:20px ${scale.cardPadding} 0 ${scale.cardPadding};">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="k-inset" style="background:${light['surface-sunken']};border:1px solid ${light.border};border-radius:${scale.radiusInset};">
                        <tr>
                          <td style="padding:12px 14px;">
                            <div class="k-muted" style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};letter-spacing:0.06em;text-transform:uppercase;color:${light['fg-muted']};">Your sign-in address</div>
                            <div class="k-fg" style="padding-top:2px;font-size:${scale.body.size};line-height:${scale.body.lineHeight};font-weight:500;color:${light.fg};word-break:break-all;">${view.recipient}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- 'Button variant="primary" size="lg"', longhand. -->
                  <tr>
                    <td class="k-pad" style="padding:20px ${scale.cardPadding} 0 ${scale.cardPadding};">
${button(view)}
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad k-muted" style="padding:16px ${scale.cardPadding} 0 ${scale.cardPadding};font-size:${scale.small.size};line-height:${scale.small.lineHeight};color:${light['fg-muted']};">
                      Or copy this address into your browser:<br />
                      <a href="${view.href}" class="k-accent" style="color:${light.accent};word-break:break-all;text-decoration:underline;">${view.plainUrl}</a>
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad" style="padding:20px ${scale.cardPadding} 0 ${scale.cardPadding};">
                      <div class="k-rule" style="height:1px;line-height:1px;font-size:0;background:${light.border};">&nbsp;</div>
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad k-muted" style="padding:16px ${scale.cardPadding} ${scale.cardPadding} ${scale.cardPadding};font-size:${scale.small.size};line-height:${scale.small.lineHeight};color:${light['fg-muted']};">
                      <p style="margin:0 0 8px 0;">This link works once, and stops working on <strong class="k-fg" style="color:${light.fg};font-weight:600;">${view.deadline}</strong>. If it has expired, ask your HR team for another.</p>
                      <p style="margin:0;">If you were not expecting this, or you do not recognise ${view.company}, do not use the link — tell your HR team instead.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="k-muted" style="padding:16px 4px 0 4px;font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};color:${light['fg-muted']};">
                Sent by Kithena because ${view.company} added you to their team. This is a one-off message about your account, not a subscription.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The company's mark, above the heading, or nothing.
 *
 * Constrained by height rather than width, so a wordmark and a square badge
 * both sit on the same baseline. `max-width` keeps a very wide wordmark inside
 * the card on a phone; Outlook ignores it, which is why the height is the one
 * that is fixed.
 */
function logoRow(view: View): string {
  if (view.logo === null) return '';
  return `                  <tr>
                    <td class="k-pad" style="padding:${scale.cardPadding} ${scale.cardPadding} 4px ${scale.cardPadding};">
                      <img src="${view.logo}" alt="${view.company}" height="28" style="height:28px;max-width:180px;width:auto;border:0;outline:none;display:block;" />
                    </td>
                  </tr>
`;
}

/**
 * The primary action.
 *
 * Two buttons, and only ever one of them visible. Word ignores `border-radius`
 * and `padding` on an anchor, so Outlook would otherwise get a square,
 * unpadded, hard-to-hit link — the VML `roundrect` inside the conditional
 * comment is what gives it the same 8px corner and 44px height as everywhere
 * else. `mso-hide:all` on the real one keeps Outlook from showing both.
 *
 * `arcsize="18%"` rather than a pixel radius: VML takes a percentage of the
 * shorter side, and 8 of 44 is 18%.
 */
function button(view: View): string {
  return `                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${view.href}" style="height:${scale.controlHeight};v-text-anchor:middle;width:220px;" arcsize="18%" stroke="f" fillcolor="${light['accent-solid']}">
                        <w:anchorlock/>
                        <center style="color:${light['fg-on-accent']};font-family:'Segoe UI',Arial,sans-serif;font-size:${scale.body.size};font-weight:500;">Set up your account</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-- -->
                      <a href="${view.href}" class="k-button" style="display:inline-block;box-sizing:border-box;height:${scale.controlHeight};line-height:${scale.controlHeight};padding:0 20px;background:${light['accent-solid']};color:${light['fg-on-accent']};font-size:${scale.body.size};font-weight:500;text-align:center;text-decoration:none;border-radius:${scale.radiusControl};mso-hide:all;">Set up your account</a>
                      <!--<![endif]-->`;
}

function text(v: {
  companyName: string;
  recipient: string;
  url: string;
  deadline: string;
}): string {
  return [
    `You're invited to join ${v.companyName}`,
    '',
    'An account is waiting for you. Setting it up takes about a minute.',
    '',
    'There is no password to choose. Your device will ask for your fingerprint,',
    'face or PIN, and that becomes how you sign in from then on.',
    '',
    `Your sign-in address: ${v.recipient}`,
    '',
    'Set up your account:',
    v.url,
    '',
    `This link works once, and stops working on ${v.deadline}. If it has expired,`,
    'ask your HR team for another.',
    '',
    `If you were not expecting this, or you do not recognise ${v.companyName}, do`,
    'not use the link — tell your HR team instead.',
    '',
    `Sent by Kithena because ${v.companyName} added you to their team.`,
    '',
  ].join('\n');
}
