import { err, ok, type Result } from '@kithena/domain-kit';

import { escapeHtml, safeHref } from './markup.js';
import { dark, light, scale } from './palette.js';
import { Unrenderable, type RenderedMessage } from './invitation.js';

/**
 * A notice: one thing a person should know, and one link to act on it.
 *
 * Every message this service sends after the invitation has the same shape —
 * a heading, a sentence or two, a button — so they share one template and
 * differ only in `COPY`. Pure, like the invitation: a struct in, a subject and
 * two bodies out, and nothing here opens a socket or reads a clock.
 *
 * ### What a notice may say
 *
 * Nothing a forwarded email should not carry. A profile reminder counts the
 * missing details and never names one: the field keys are the tenant's schema,
 * a value is personal data, and the person reads the list on the page the
 * button opens, signed in. A webhook alert names the receiver's host and
 * nothing after it, because a path or query can carry the receiver's own
 * token. The link carries no token and no record id.
 *
 * ### Who it is from, and where it points
 *
 * Every notice names the company it is about — an HR email that will not say
 * which employer sent it reads as phishing — and links to that company's own
 * origin, `<slug>.app…`, which `linkIsOnTenantApp` checks against the one
 * pattern this service is configured with.
 */
export type Notice =
  | { readonly kind: 'profile_reminder'; readonly missing: number }
  | { readonly kind: 'webhook_disabled'; readonly host: string };

export type NoticeKind = Notice['kind'];

interface Copy {
  readonly subject: string;
  readonly heading: string;
  readonly lede: string;
  readonly action: string;
  readonly footer: string;
}

/** Enough for any real schema; a count past it is a caller bug, not copy. */
const MAX_COUNT = 1000;

/** A hostname, and only a hostname: letters, digits, dots and hyphens. */
const HOST =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/** The invitation's limit: long enough for any real company, one subject line. */
const MAX_COMPANY_NAME = 120;

/** One DNS label, as a tenant slug must be. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Whether a link is on some company's own origin under `base`, a URL with
 * `{slug}` where the label goes (`https://{slug}.app.kithena.com`).
 *
 * The first host label is taken as the slug and the base is rebuilt with it;
 * the link passes only if its origin is exactly that. So `acme.app.kithena.com`
 * passes, and `acme.app.kithena.com.evil.example`, a different port, or a
 * second label in front of the base do not. Which company's origin it is, is
 * the caller's to get right — this only refuses an origin that is nobody's.
 */
export function linkIsOnTenantApp(url: string, base: string): boolean {
  if (!base.includes('{slug}')) return false;
  try {
    const target = new URL(url);
    const slug = target.hostname.split('.')[0] ?? '';
    if (!LABEL.test(slug)) return false;
    return target.origin === new URL(base.replace('{slug}', slug)).origin;
  } catch {
    return false;
  }
}

/**
 * Each kind's copy for a company, or null when its input cannot be said
 * honestly. Called once with the name as typed (subject, text) and once
 * escaped (HTML).
 */
const COPY: {
  readonly [K in NoticeKind]: (
    notice: Extract<Notice, { kind: K }>,
    company: string,
  ) => Copy | null;
} = {
  profile_reminder: ({ missing }, company) => {
    if (!Number.isInteger(missing) || missing < 1 || missing > MAX_COUNT) return null;
    const details = missing === 1 ? 'one detail' : `${String(missing)} details`;
    return {
      subject: `${company}: a few details are missing from your profile`,
      heading: 'Your profile needs a few details',
      lede: `${company} has asked everyone to fill in ${details} that only you can provide. It takes a minute, and you can see exactly what is missing once you open your profile.`,
      action: 'Open your profile',
      footer: `Sent by Kithena on behalf of ${company}. You will get at most one of these a week, and none once your profile is complete.`,
    };
  },
  webhook_disabled: ({ host }, company) => {
    if (!HOST.test(host)) return null;
    return {
      subject: `${company}: a People webhook was turned off`,
      heading: 'We stopped sending to one of your webhooks',
      lede: `Nothing sent to ${host} has succeeded for 24 hours, so Kithena turned that endpoint off. Events raised while it is off are not sent to it. Once the receiver is fixed, turn the endpoint back on and replay the delivery that failed.`,
      action: 'Open People',
      footer: `Sent by Kithena because this address is the alert contact for a webhook endpoint in ${company}'s People.`,
    };
  },
};

export function renderNotice(
  notice: Notice,
  url: string,
  companyName: string,
): Result<RenderedMessage> {
  const company = companyName.trim();
  if (company.length === 0 || company.length > MAX_COMPANY_NAME) return err(Unrenderable);

  // The mapped type pairs each kind with its input; TypeScript cannot follow
  // that through an index, so the call is widened by hand.
  const copyFor = COPY[notice.kind] as (n: Notice, company: string) => Copy | null;
  const plain = copyFor(notice, company);
  const marked = copyFor(notice, escapeHtml(company));
  const href = safeHref(url);
  if (plain === null || marked === null || href === null) return err(Unrenderable);

  return ok({
    subject: plain.subject,
    html: html(marked, href, escapeHtml(url)),
    text: [plain.heading, '', plain.lede, '', `${plain.action}:`, url, '', plain.footer, ''].join(
      '\n',
    ),
  });
}

/**
 * The invitation's card, cut down to one action.
 *
 * The same Reach values and the same concessions to Outlook — tables, inline
 * styles, a VML button — for the reasons `invitation.ts` gives at length. The
 * accent is always Kithena's: a notice carries no company theme.
 */
function html(copy: Copy, href: string, plainUrl: string): string {
  const pad = scale.cardPadding;
  const accent = light['accent-solid'];
  return `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${copy.heading}</title>
    <style>
      @media (prefers-color-scheme: dark) {
        .k-canvas { background: ${dark.canvas} !important; }
        .k-surface { background: ${dark.surface} !important; border-color: ${dark.border} !important; }
        .k-fg { color: ${dark.fg} !important; }
        .k-muted { color: ${dark['fg-muted']} !important; }
        .k-accent { color: ${dark.accent} !important; }
      }
      @media only screen and (max-width: 600px) {
        .k-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .k-button { display: block !important; }
      }
    </style>
  </head>
  <body class="k-canvas" style="margin:0;padding:0;width:100%;background:${light.canvas};font-family:${scale.fontFamily};-webkit-font-smoothing:antialiased;">
    <table role="presentation" class="k-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${light.canvas};">
      <tr>
        <td align="center" style="padding:40px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:544px;">
            <tr>
              <td style="padding:0 4px 18px 4px;">
                <span class="k-accent" style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${light.accent};">Kithena</span>
              </td>
            </tr>
            <!-- Card variant="outlined". -->
            <tr>
              <td class="k-surface" style="background:${light.surface};border:1px solid ${light.border};border-radius:${scale.radiusCard};overflow:hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="height:3px;line-height:3px;font-size:0;background:${accent};">&nbsp;</td></tr>
                  <tr>
                    <td class="k-pad" style="padding:28px ${pad} 0 ${pad};">
                      <h1 class="k-fg" style="margin:0;font-size:${scale.heading.size};line-height:${scale.heading.lineHeight};letter-spacing:${scale.heading.tracking};font-weight:600;color:${light.fg};">${copy.heading}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td class="k-pad k-muted" style="padding:10px ${pad} 0 ${pad};font-size:${scale.body.size};line-height:${scale.body.lineHeight};color:${light['fg-muted']};">${copy.lede}</td>
                  </tr>
                  <!-- Button variant="primary" size="lg", longhand. -->
                  <tr>
                    <td class="k-pad" style="padding:22px ${pad} 0 ${pad};">
                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${scale.controlHeight};v-text-anchor:middle;width:220px;" arcsize="18%" stroke="f" fillcolor="${accent}">
                        <w:anchorlock/>
                        <center style="color:${light['fg-on-accent']};font-family:'Segoe UI',Arial,sans-serif;font-size:${scale.body.size};font-weight:500;">${copy.action}</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-- -->
                      <a href="${href}" class="k-button" style="display:inline-block;box-sizing:border-box;height:${scale.controlHeight};line-height:${scale.controlHeight};padding:0 20px;background:${accent};color:${light['fg-on-accent']};font-size:${scale.body.size};font-weight:500;text-align:center;text-decoration:none;border-radius:${scale.radiusControl};mso-hide:all;">${copy.action}</a>
                      <!--<![endif]-->
                    </td>
                  </tr>
                  <tr>
                    <td class="k-pad k-muted" style="padding:22px ${pad} ${pad} ${pad};font-size:${scale.small.size};line-height:${scale.small.lineHeight};color:${light['fg-muted']};">
                      <p style="margin:0;">Button not working? Paste this into your browser:<br /><a href="${href}" class="k-muted" style="color:${light['fg-muted']};word-break:break-all;text-decoration:underline;">${plainUrl}</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="k-muted" style="padding:18px 4px 0 4px;font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};color:${light['fg-muted']};">${copy.footer}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
