import { accentHex } from '@kithena/contracts';
import { err, failure, ok, wordsIn, type Result, type Words } from '@kithena/domain-kit';

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

/**
 * Why a link was sent, and therefore what the message says.
 *
 * Both kinds carry the same link to the same page; what differs is everything a
 * person reads around it. Recovery sent the invitation copy verbatim, so
 * somebody who had worked somewhere for two years and lost their phone was
 * emailed "You're invited to join Acme Corp" with "An account is waiting for
 * you" underneath — which reads as a mistake, and the safety advice at the
 * bottom then told them not to use a link they had just asked for.
 */
export type MessagePurpose = 'invitation' | 'recovery';

export interface InvitationMessage {
  /** The company's display name, as the tenant registry holds it. */
  readonly companyName: string;
  /** Defaults to an invitation, which is what every caller sent before this existed. */
  readonly purpose?: MessagePurpose;
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
  /**
   * The theme the company chose in the back office, as a preset id.
   *
   * The button in this message is the one the login page it leads to is
   * filled with, so a person clicking through does not change colour on the
   * way. Null or unknown falls back to Kithena's own accent, which is what
   * every message carried before a company could choose.
   *
   * An id rather than a colour, for the reason `ThemeId` gives: a stored
   * `oklch(...)` pins a customer to whatever the preset was on the afternoon
   * they signed up. Resolving it here means a retuned preset reaches every
   * message that has not been sent yet.
   */
  readonly themeId?: string | null | undefined;
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
export function formatDeadline(iso: string, words: Language = ENGLISH): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const month = MONTHS[at.getUTCMonth()];
  if (month === undefined) return null;

  const hours = String(at.getUTCHours()).padStart(2, '0');
  const minutes = String(at.getUTCMinutes()).padStart(2, '0');
  // English keeps its own day-month-year, which reads the same on either side
  // of the Atlantic; every other language writes the date as it does, in UTC.
  const date = words.language.startsWith('en')
    ? `${String(at.getUTCDate())} ${month} ${String(at.getUTCFullYear())}`
    : new Intl.DateTimeFormat(words.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(at);
  return words.t('invitation.deadline', '{{date}} at {{time}} UTC', {
    date,
    time: `${hours}:${minutes}`,
  });
}

/** A language and its words: what a message is written in. */
export interface Language {
  readonly language: string;
  readonly t: Words;
}

/** US English, the words in the code: what a message says when no language is given. */
export const ENGLISH: Language = { language: 'en-US', t: wordsIn('en-US', {}) };

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
export function renderInvitation(
  message: InvitationMessage,
  /** The company's language: every email is in the company's language. */
  words: Language = ENGLISH,
): Result<RenderedMessage> {
  const companyName = message.companyName.trim();
  if (companyName.length === 0 || companyName.length > MAX_COMPANY_NAME) {
    return err(Unrenderable);
  }

  const href = safeHref(message.enrolUrl);
  if (href === null) return err(Unrenderable);

  const deadline = formatDeadline(message.expiresAt, words);
  if (deadline === null) return err(Unrenderable);

  const copy = COPY[message.purpose ?? 'invitation'](words.t, companyName, deadline);

  return ok({
    subject: copy.subject,
    html: html({
      copy: escaped(copy),
      language: escapeHtml(words.language),
      company: escapeHtml(companyName),
      recipient: escapeHtml(message.recipient),
      href,
      // The visible copy of the link, which is not the `href`. A person who
      // does not trust a button is right not to, and the thing they check is
      // the text.
      plainUrl: escapeHtml(message.enrolUrl),
      deadline: escapeHtml(deadline),
      logo: safeImageSrc(message.logoUrl ?? null),
      // Kithena's own when the company chose nothing, or named a preset that
      // no longer exists. `accentHex` returns null for both, which is why it
      // does not simply default to Indigo itself.
      accent: accentHex(message.themeId) ?? light['accent-solid'],
    }),
    text: text({
      copy,
      recipient: message.recipient,
      url: message.enrolUrl,
    }),
  });
}

/**
 * What each kind of message says, in one place.
 *
 * A table rather than eight conditionals through the template: the markup is
 * already hard to read for reasons Outlook imposes, and a variant threaded
 * through it as inline ternaries is how one of the eight gets missed.
 */
interface Copy {
  readonly subject: string;
  readonly heading: string;
  readonly lede: string;
  readonly action: string;
  readonly preheader: string;
  readonly address: string;
  readonly next: string;
  readonly steps: readonly string[];
  readonly chip: string;
  /** The deadline and what to do once it has passed, as the plain text says it. */
  readonly expiry: string;
  /** What to do once it has passed, beside the chip that says when. */
  readonly expired: string;
  readonly caution: string;
  readonly buttonNotWorking: string;
  readonly footer: string;
  readonly oneOff: string;
}

/** Each field escaped once, for the HTML. */
function escaped(copy: Copy): Copy {
  return {
    subject: escapeHtml(copy.subject),
    heading: escapeHtml(copy.heading),
    lede: escapeHtml(copy.lede),
    action: escapeHtml(copy.action),
    preheader: escapeHtml(copy.preheader),
    address: escapeHtml(copy.address),
    next: escapeHtml(copy.next),
    steps: copy.steps.map(escapeHtml),
    chip: escapeHtml(copy.chip),
    expiry: escapeHtml(copy.expiry),
    expired: escapeHtml(copy.expired),
    caution: escapeHtml(copy.caution),
    buttonNotWorking: escapeHtml(copy.buttonNotWorking),
    footer: escapeHtml(copy.footer),
    oneOff: escapeHtml(copy.oneOff),
  };
}

/** What both kinds of message share: the labels around their own words. */
function common(t: Words, deadline: string) {
  return {
    address: t('invitation.your_sign_in_address', 'Your sign-in address'),
    next: t('invitation.what_happens_next', 'What happens next'),
    chip: t('invitation.works_once_expires', 'Works once · expires {{deadline}}', { deadline }),
    buttonNotWorking: t(
      'invitation.button_not_working',
      'Button not working? Paste this into your browser:',
    ),
    oneOff: t(
      'invitation.one_off',
      'This is a one-off message about your account, not a subscription.',
    ),
  };
}

const COPY: Record<MessagePurpose, (t: Words, company: string, deadline: string) => Copy> = {
  invitation: (t, company, deadline) => {
    const action = t('invitation.invitation.action', 'Set up your account');
    const expired = t(
      'invitation.invitation.expired',
      'If it has expired, ask your HR team for another.',
    );
    return {
      ...common(t, deadline),
      subject: t('invitation.invitation.subject', 'You’re invited to join {{company}} on Kithena', {
        company,
      }),
      heading: t('invitation.invitation.heading', 'You’re invited to join {{company}}', {
        company,
      }),
      lede: t(
        'invitation.invitation.lede',
        'An account is waiting for you. Setting it up takes about a minute, and there is no password to choose.',
      ),
      action,
      preheader: t(
        'invitation.invitation.preheader',
        'Set up your account at {{company}}. The link works once, until {{deadline}}.',
        { company, deadline },
      ),
      steps: [
        t('invitation.invitation.step_1', 'Your device asks for your fingerprint, face or PIN.'),
        t('invitation.invitation.step_2', 'That becomes your passkey. Nothing leaves your device.'),
        t('invitation.invitation.step_3', 'You sign in to {{company}} the same way from then on.', {
          company,
        }),
      ],
      expiry: t(
        'invitation.invitation.expiry',
        'This link works once and expires {{deadline}}. If it has expired, ask your HR team for another.',
        { deadline },
      ),
      expired,
      caution: t(
        'invitation.invitation.caution',
        'If you were not expecting this, or you do not recognise {{company}}, do not use the link — tell your HR team instead.',
        { company },
      ),
      footer: t(
        'invitation.invitation.footer',
        'Sent by Kithena because {{company}} added you to their team.',
        { company },
      ),
    };
  },
  recovery: (t, company, deadline) => ({
    ...common(t, deadline),
    subject: t('invitation.recovery.subject', 'Set up a new passkey for {{company}}', { company }),
    heading: t('invitation.recovery.heading', 'Set up a new passkey'),
    lede: t(
      'invitation.recovery.lede',
      'You asked for a new way to sign in. The passkey you had stays where it is — this one is for the device you are on now.',
    ),
    action: t('invitation.recovery.action', 'Set up a new passkey'),
    preheader: t(
      'invitation.recovery.preheader',
      'Set up a new passkey at {{company}}. The link works once, until {{deadline}}.',
      { company, deadline },
    ),
    steps: [
      t('invitation.recovery.step_1', 'Your device asks for your fingerprint, face or PIN.'),
      t('invitation.recovery.step_2', 'That becomes your new passkey. Nothing leaves your device.'),
      t('invitation.recovery.step_3', 'You sign in to {{company}} with it from then on.', {
        company,
      }),
    ],
    expiry: t(
      'invitation.recovery.expiry',
      'This link works once and expires {{deadline}}. If it has expired, ask for another from your sign-in page.',
      { deadline },
    ),
    expired: t(
      'invitation.recovery.expired',
      'If it has expired, ask for another from your sign-in page.',
    ),
    caution: t(
      'invitation.recovery.caution',
      'If you did not ask for this, you can ignore it — the link does nothing until somebody uses it, and nobody can use it without this mailbox.',
    ),
    footer: t(
      'invitation.recovery.footer',
      'Sent by Kithena because somebody asked for a new setup link for this address.',
    ),
  }),
};

/* -------------------------------------------------------------- rendering -- */

interface View {
  readonly copy: Copy;
  /** Escaped, as every value in the view is. */
  readonly language: string;
  readonly company: string;
  readonly recipient: string;
  readonly href: string;
  readonly plainUrl: string;
  readonly deadline: string;
  readonly logo: string | null;
  /**
   * The company's accent, resolved to sRGB, already defaulted.
   *
   * A hex and not a preset id: the template renders colours, and a template
   * that looked one up would be the second place a fallback had to be decided.
   */
  readonly accent: string;
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
  const preheader = view.copy.preheader;
  const pad = scale.cardPadding;

  return `<!doctype html>
<html lang="${view.language}" style="margin:0;padding:0;">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${view.copy.heading}</title>
    <!--[if mso]>
      <style>
        /* Word substitutes Times New Roman for any family it cannot resolve,
           which turns the whole message serif. This names one it can. */
        * { font-family: 'Segoe UI', Arial, sans-serif !important; }
      </style>
    <![endif]-->
    <style>
      /* Only clients that keep a style block and honour the query get this.
         The inline light theme stands everywhere else. */
      @media (prefers-color-scheme: dark) {
        .k-canvas { background: ${dark.canvas} !important; }
        .k-surface { background: ${dark.surface} !important; border-color: ${dark.border} !important; }
        .k-inset { background: ${dark['surface-sunken']} !important; border-color: ${dark.border} !important; }
        .k-fg { color: ${dark.fg} !important; }
        .k-muted { color: ${dark['fg-muted']} !important; }
        .k-accent { color: ${dark.accent} !important; }
        .k-rule { background: ${dark.border} !important; }
        .k-chip { background: ${dark['accent-subtle']} !important; color: ${dark['accent-fg']} !important; }
      }
      /* A phone is 320px at its narrowest. The card loses its outer margin
         rather than its padding: cramped copy reads worse than a card that
         touches the edges. */
      @media only screen and (max-width: 600px) {
        .k-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .k-button { display: block !important; }
      }
    </style>
  </head>
  <body class="k-canvas" style="margin:0;padding:0;width:100%;background:${light.canvas};font-family:${scale.fontFamily};-webkit-font-smoothing:antialiased;">
    <!-- Shown in the inbox list beside the subject. Without it, clients pull
         the first line of the body, which here is the heading repeated. The
         entities pad it so the client does not fill the rest of the preview
         line with the markup that follows. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>

    <table role="presentation" class="k-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${light.canvas};">
      <tr>
        <td align="center" style="padding:40px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:544px;">

            <!-- Wordmark. Type rather than an image on purpose: Gmail drops
                 data: image sources and Outlook desktop will not render SVG,
                 so the mark would be a broken box for most recipients. -->
            <tr>
              <td style="padding:0 4px 18px 4px;">
                <span class="k-accent" style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${light.accent};">Kithena</span>
              </td>
            </tr>

            <!-- Card variant="outlined": a line, not a shadow. -->
            <tr>
              <td class="k-surface" style="background:${light.surface};border:1px solid ${light.border};border-radius:${scale.radiusCard};overflow:hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                  <!-- A 3px accent rule across the top. The one piece of
                       ornament, and it earns its place: it is what makes the
                       card read as somebody's at a glance in a crowded inbox.
                       The company's colour when they chose one, so it is the
                       same rule their sign-in page opens with; Kithena's when
                       they did not. -->
                  <tr>
                    <td style="height:3px;line-height:3px;font-size:0;background:${view.accent};">&nbsp;</td>
                  </tr>

${logoRow(view, pad)}
                  <tr>
                    <td class="k-pad" style="padding:${view.logo === null ? '28px' : '4px'} ${pad} 0 ${pad};">
                      <h1 class="k-fg" style="margin:0;font-size:${scale.heading.size};line-height:${scale.heading.lineHeight};letter-spacing:${scale.heading.tracking};font-weight:600;color:${light.fg};">${view.copy.heading}</h1>
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad k-muted" style="padding:10px ${pad} 0 ${pad};font-size:${scale.body.size};line-height:${scale.body.lineHeight};color:${light['fg-muted']};">
                      ${view.copy.lede}
                    </td>
                  </tr>

                  <!-- Which account this is. The same thing the enrolment page
                       says before the device prompt appears, and here for the
                       same reason: one device holds passkeys for several
                       accounts, and the prompt only shows what it was told at
                       registration. -->
                  <tr>
                    <td class="k-pad" style="padding:22px ${pad} 0 ${pad};">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="k-inset" style="background:${light['surface-sunken']};border:1px solid ${light.border};border-radius:${scale.radiusInset};">
                        <tr>
                          <td style="padding:13px 15px;">
                            <div class="k-muted" style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};letter-spacing:0.07em;text-transform:uppercase;color:${light['fg-muted']};">${view.copy.address}</div>
                            <div class="k-fg" style="padding-top:3px;font-size:${scale.body.size};line-height:${scale.body.lineHeight};font-weight:500;color:${light.fg};word-break:break-all;">${view.recipient}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Button variant="primary" size="lg", longhand. -->
                  <tr>
                    <td class="k-pad" style="padding:22px ${pad} 0 ${pad};">
${button(view)}
                    </td>
                  </tr>

                  <!-- What actually happens, because a passkey is unfamiliar to
                       most people receiving this and "no password to choose"
                       raises more questions than it answers on its own. -->
                  <tr>
                    <td class="k-pad" style="padding:26px ${pad} 0 ${pad};">
                      <div class="k-muted" style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};letter-spacing:0.07em;text-transform:uppercase;color:${light['fg-muted']};padding-bottom:10px;">${view.copy.next}</div>
${steps(view)}
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad" style="padding:24px ${pad} 0 ${pad};">
                      <div class="k-rule" style="height:1px;line-height:1px;font-size:0;background:${light.border};">&nbsp;</div>
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad" style="padding:16px ${pad} 0 ${pad};">
                      <!-- Badge tone="accent" size="sm": rounded-full, subtle
                           wash, medium weight. -->
                      <span class="k-chip" style="display:inline-block;padding:3px 10px;border-radius:999px;background:${light['accent-subtle']};color:${light['accent-fg']};font-size:${scale.tiny.size};line-height:16px;font-weight:500;">${view.copy.chip}</span>
                    </td>
                  </tr>

                  <tr>
                    <td class="k-pad k-muted" style="padding:12px ${pad} ${pad} ${pad};font-size:${scale.small.size};line-height:${scale.small.lineHeight};color:${light['fg-muted']};">
                      <p style="margin:0 0 10px 0;">${view.copy.expired} ${view.copy.caution}</p>
                      <p style="margin:0;">${view.copy.buttonNotWorking}<br /><a href="${view.href}" class="k-muted" style="color:${light['fg-muted']};word-break:break-all;text-decoration:underline;">${view.plainUrl}</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="k-muted" style="padding:18px 4px 0 4px;font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};color:${light['fg-muted']};">
                ${view.copy.footer} ${view.copy.oneOff}
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
 * The numbered steps.
 *
 * Rows rather than an `<ol>`: list markers are styled inconsistently across
 * clients and Outlook indents them by an amount nobody agrees on, so the number
 * is an element of its own in a two-column row.
 *
 * The chip is Reach's stepper tick — `accent-subtle` on `accent-fg` rather than
 * a solid fill, because those two are the pair chosen to clear contrast on a
 * wash. `accent-fg` on a solid accent measures about 1.5:1 and merely looks "a
 * bit low", which `tokens.css` warns about by name.
 */
function steps(view: View): string {
  const rows = view.copy.steps
    .map(
      (item, index) => `                        <tr>
                          <td width="30" valign="top" style="padding:0 10px 10px 0;">
                            <span class="k-chip" style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:999px;background:${light['accent-subtle']};color:${light['accent-fg']};font-size:${scale.tiny.size};font-weight:600;text-align:center;">${String(index + 1)}</span>
                          </td>
                          <td valign="top" class="k-muted" style="padding:0 0 10px 0;font-size:${scale.small.size};line-height:20px;color:${light['fg-muted']};">${item}</td>
                        </tr>`,
    )
    .join('\n');

  return `                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
${rows}
                      </table>`;
}

/**
 * The company's mark, above the heading, or nothing.
 *
 * Constrained by height rather than width, so a wordmark and a square badge
 * both sit on the same baseline. `max-width` keeps a very wide wordmark inside
 * the card on a phone; Outlook ignores it, which is why the height is the one
 * that is fixed.
 */
function logoRow(view: View, pad: string): string {
  if (view.logo === null) return '';
  return `                  <tr>
                    <td class="k-pad" style="padding:26px ${pad} 0 ${pad};">
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
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${view.href}" style="height:${scale.controlHeight};v-text-anchor:middle;width:220px;" arcsize="18%" stroke="f" fillcolor="${view.accent}">
                        <w:anchorlock/>
                        <center style="color:${light['fg-on-accent']};font-family:'Segoe UI',Arial,sans-serif;font-size:${scale.body.size};font-weight:500;">${view.copy.action}</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-- -->
                      <a href="${view.href}" class="k-button" style="display:inline-block;box-sizing:border-box;height:${scale.controlHeight};line-height:${scale.controlHeight};padding:0 20px;background:${view.accent};color:${light['fg-on-accent']};font-size:${scale.body.size};font-weight:500;text-align:center;text-decoration:none;border-radius:${scale.radiusControl};mso-hide:all;">${view.copy.action}</a>
                      <!--<![endif]-->`;
}

function text(v: { copy: Copy; recipient: string; url: string }): string {
  return [
    v.copy.heading,
    '',
    v.copy.lede,
    '',
    `${v.copy.address}: ${v.recipient}`,
    '',
    `${v.copy.action}:`,
    v.url,
    '',
    v.copy.next,
    ...v.copy.steps.map((step, index) => `  ${String(index + 1)}. ${step}`),
    '',
    v.copy.expiry,
    '',
    v.copy.caution,
    '',
    v.copy.footer,
    '',
  ].join('\n');
}
