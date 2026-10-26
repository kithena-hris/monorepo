import { accentHex } from '@kithena/contracts';
import { err, failure, ok, wordsIn, type Result, type Words } from '@kithena/domain-kit';

import type { EmailAddress } from './address.js';
import { escapeHtml, safeHref, safeImageSrc } from './markup.js';
import { frame } from './frame.js';
import { light } from './palette.js';

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
  // A bare `t`, so `i18n-extract` finds every key.
  const { t } = words;
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
  return t('invitation.deadline', '{{date}} at {{time}} UTC', {
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
    html: card(escaped(copy), {
      language: escapeHtml(words.language),
      company: escapeHtml(companyName),
      recipient: escapeHtml(message.recipient),
      href,
      // The visible copy of the link, which is not the `href`: a person who
      // does not trust a button checks the text.
      plainUrl: escapeHtml(message.enrolUrl),
      logo: safeImageSrc(message.logoUrl ?? null),
      // Kithena's own when the company chose nothing or a preset that is gone.
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

/**
 * The invitation in the frame every email shares (`frame.ts`): which account
 * it is for and when the link runs out as the summary, the steps a passkey
 * takes, one button, and what to do once it has expired.
 */
function card(
  copy: Copy,
  v: {
    readonly language: string;
    readonly company: string;
    readonly recipient: string;
    readonly href: string;
    readonly plainUrl: string;
    readonly logo: string | null;
    readonly accent: string;
  },
): string {
  return frame({
    language: v.language,
    title: copy.heading,
    preheader: copy.preheader,
    company: v.company,
    logo: v.logo,
    accent: v.accent,
    paragraphs: [copy.lede],
    // Which account this is, as the enrolment page says before the device asks:
    // one device holds passkeys for several accounts.
    facts: [{ label: copy.address, value: v.recipient }],
    times: null,
    steps: { title: copy.next, items: copy.steps },
    action: { label: copy.action, href: v.href },
    secondary: null,
    note: `<strong>${copy.chip}.</strong> ${copy.expired} ${copy.caution}<br /><br />${copy.buttonNotWorking}<br /><a href="${v.href}" style="color:inherit;word-break:break-all;text-decoration:underline;">${v.plainUrl}</a>`,
    footer: `${copy.footer} ${copy.oneOff}`,
    manage: null,
  });
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
