import { err, ok, wordsIn, type Result, type Words } from '@kithena/domain-kit';

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
 * token. A scheduled report says how often and in what format, and never the
 * schedule's name, who it is about, or a number from it: the name is typed by
 * whoever made it and can say anything, and the report is read signed in,
 * built as the recipient, on the page the button opens.
 *
 * The link carries no token and no person's id.
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
  | { readonly kind: 'webhook_disabled'; readonly host: string }
  /*
   * A change held for approval (PEO-077): to an approver, then to whoever
   * asked. None names the person, the field or the value — a forwarded
   * "your change to Ana's IBAN" is the disclosure — only that there is one,
   * and a link to the inbox, signed in.
   */
  | { readonly kind: 'approval_requested' }
  | { readonly kind: 'approval_decided'; readonly decision: ApprovalDecision }
  | { readonly kind: 'approval_expired' }
  /*
   * HR's review found something wrong with a detail the employee gave, and
   * asks them to correct it (PEO-125). Never which detail nor why: the
   * reviewer's reason is free text, read on the profile, signed in.
   */
  | { readonly kind: 'correction_requested' }
  | {
      readonly kind: 'scheduled_report';
      readonly cadence: ReportCadence;
      readonly format: ReportFormat;
    }
  /*
   * A People export sent to somebody (design AI13): to its recipient, and,
   * when it holds more than they could read, first to the administrators who
   * approve it. Never who sent it, who is in it, which fields or why — a
   * forwarded "Ada sent you Madrid's salaries" is the disclosure — only that
   * there is one, and a link to the export page, signed in.
   */
  | { readonly kind: 'export_shared' }
  | { readonly kind: 'export_share_requested' }
  /*
   * An Insights summary somebody in HR sent (People's "what changed"). Never
   * who sent it, a figure or a sentence of it: the summary is read signed in,
   * on the page the button opens, and only by its recipient.
   */
  | { readonly kind: 'summary_shared' }
  /*
   * A document sent for signature to somebody outside the company (Documents
   * K6, X7): only that there is one and from which company, and the link to
   * the signing page. Never the document's name nor who sent it.
   */
  | { readonly kind: 'signature_requested' }
  /*
   * The six digits that prove the signer reads this mailbox, sent when they
   * open the signing page. The one notice carrying a secret, as an enrolment
   * link is: it works for ten minutes, once, for one signer.
   */
  | { readonly kind: 'signing_code'; readonly code: string }
  /*
   * A signer's own copy (Documents K7): sent to whoever just signed, the
   * document as signed so far attached, and once everybody has, the sealed
   * one to every signer. As the request, never the document's name nor who
   * sent it: the attachment is the document, for the person who signed it.
   */
  /*
   * A reminder (Documents K8), to whoever a request waits on now and nobody
   * else. As the request itself: no document name, no sender.
   */
  | { readonly kind: 'signature_reminder' }
  | { readonly kind: 'document_signed' }
  | { readonly kind: 'document_completed' }
  /*
   * A nudge to take a break (Time Off, T28): the one notice whose words the
   * module writes, because they are the recipient's own — their days left,
   * a day that suits them — and nobody else's. Time Off guarantees that; this
   * only bounds the length, keeps the heading to one line, and escapes both.
   */
  | { readonly kind: 'rest_nudge'; readonly heading: string; readonly lede: string }
  /*
   * The Inbox (INB-050): a task waiting for somebody, right away, and an
   * update, which waits for the daily digest unless they chose otherwise.
   * Each says only what sort of thing it is, from a fixed list, never who
   * sent it, whom it is about or what it says: the Inbox shows that, signed in.
   */
  | { readonly kind: 'inbox_task'; readonly topic: InboxTaskTopic }
  | { readonly kind: 'inbox_update'; readonly topic: InboxUpdateTopic }
  | { readonly kind: 'inbox_digest'; readonly count: number };

export const INBOX_TASK_TOPICS = [
  'details',
  'correction',
  'document_sign',
  'document_acknowledge',
  'document_countersign',
  'time_off_approval',
  'team_task',
] as const;
export type InboxTaskTopic = (typeof INBOX_TASK_TOPICS)[number];

export const INBOX_UPDATE_TOPICS = [
  'decided',
  'answered',
  'document_shared',
  'document_returned',
  'team_news',
  'calendar',
] as const;
export type InboxUpdateTopic = (typeof INBOX_UPDATE_TOPICS)[number];

/** Each task topic's subject and opening sentence, whole, so each language words them as a pair. */
const TASK_WORDS: Readonly<
  Record<InboxTaskTopic, (t: Words, company: string) => readonly [subject: string, lede: string]>
> = {
  details: (t, company) => [
    t('notice.task.details.subject', '{{company}}: you were asked for some details', { company }),
    t('notice.task.details.lede', 'Somebody asked you to add a few details to your record.'),
  ],
  correction: (t, company) => [
    t('notice.task.correction.subject', '{{company}}: a detail needs correcting', { company }),
    t(
      'notice.task.correction.lede',
      'A detail you gave needs correcting before it can be accepted.',
    ),
  ],
  document_sign: (t, company) => [
    t('notice.task.document_sign.subject', '{{company}}: a document to sign', { company }),
    t('notice.task.document_sign.lede', 'A document is waiting for your signature.'),
  ],
  document_acknowledge: (t, company) => [
    t('notice.task.document_acknowledge.subject', '{{company}}: a document to read', { company }),
    t(
      'notice.task.document_acknowledge.lede',
      'A document is waiting for you to read and acknowledge it.',
    ),
  ],
  document_countersign: (t, company) => [
    t('notice.task.document_countersign.subject', '{{company}}: a document to countersign', {
      company,
    }),
    t(
      'notice.task.document_countersign.lede',
      'A document you sent was signed and waits for your countersignature.',
    ),
  ],
  time_off_approval: (t, company) => [
    t('notice.task.time_off_approval.subject', '{{company}}: a time-off request to decide', {
      company,
    }),
    t(
      'notice.task.time_off_approval.lede',
      'Somebody asked for time off, and it waits for your decision.',
    ),
  ],
  team_task: (t, company) => [
    t('notice.task.team_task.subject', '{{company}}: a task for your team', { company }),
    t(
      'notice.task.team_task.lede',
      'Something needs one of you; whoever takes it tells the others.',
    ),
  ],
};

/** Each update topic's subject and opening sentence. */
const UPDATE_WORDS: Readonly<
  Record<InboxUpdateTopic, (t: Words, company: string) => readonly [subject: string, lede: string]>
> = {
  decided: (t, company) => [
    t('notice.update.decided.subject', '{{company}}: something you asked for was decided', {
      company,
    }),
    t('notice.update.decided.lede', 'A request of yours was decided.'),
  ],
  answered: (t, company) => [
    t('notice.update.answered.subject', '{{company}}: somebody answered your request', { company }),
    t('notice.update.answered.lede', 'Somebody you asked has answered.'),
  ],
  document_shared: (t, company) => [
    t('notice.update.document_shared.subject', '{{company}}: a document was shared with you', {
      company,
    }),
    t(
      'notice.update.document_shared.lede',
      'A document was shared with you, and kept with your record.',
    ),
  ],
  document_returned: (t, company) => [
    t('notice.update.document_returned.subject', '{{company}}: a document you sent came back', {
      company,
    }),
    t(
      'notice.update.document_returned.lede',
      'A document you sent was signed, acknowledged or sent back.',
    ),
  ],
  team_news: (t, company) => [
    t('notice.update.team_news.subject', '{{company}}: news about your team', { company }),
    t('notice.update.team_news.lede', 'Somebody joins or leaves your team.'),
  ],
  calendar: (t, company) => [
    t('notice.update.calendar.subject', '{{company}}: a calendar was updated', { company }),
    t('notice.update.calendar.lede', 'A calendar or a balance of yours changed.'),
  ],
};

/** A nudge's heading fits a subject line; its sentence or two fit a phone's screen. */
export const NUDGE_HEADING_MAX = 120;
export const NUDGE_LEDE_MAX = 600;

export const REPORT_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];
/** A file (`xlsx`, `pdf`) waits on the export page; a `summary` is the analytics screen. */
export const REPORT_FORMATS = ['xlsx', 'pdf', 'summary'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

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
 * Each kind's copy for a company, in the company's language (`t`), or null
 * when its input cannot be said honestly. Plain text: the HTML escapes it.
 */
const COPY: {
  readonly [K in NoticeKind]: (
    notice: Extract<Notice, { kind: K }>,
    company: string,
    t: Words,
  ) => Copy | null;
} = {
  profile_reminder: ({ missing }, company, t) => {
    if (!Number.isInteger(missing) || missing < 1 || missing > MAX_COUNT) return null;
    return {
      subject: t(
        'notice.profile_reminder.subject',
        '{{company}}: a few details are missing from your profile',
        { company },
      ),
      heading: t('notice.profile_reminder.heading', 'Your profile needs a few details'),
      lede: t(
        'notice.profile_reminder.lede',
        {
          one: '{{company}} has asked everyone to fill in one detail that only you can provide. It takes a minute, and you can see exactly what is missing once you open your profile.',
          other:
            '{{company}} has asked everyone to fill in {{count}} details that only you can provide. It takes a minute, and you can see exactly what is missing once you open your profile.',
        },
        { company, count: missing },
      ),
      action: t('notice.profile_reminder.action', 'Open your profile'),
      footer: t(
        'notice.profile_reminder.footer',
        'Sent by Kithena on behalf of {{company}}. You will get at most one of these a week, and none once your profile is complete.',
        { company },
      ),
    };
  },
  approval_requested: (_notice, company, t) => ({
    subject: t(
      'notice.approval_requested.subject',
      '{{company}}: a change is waiting for your approval',
      { company },
    ),
    heading: t('notice.approval_requested.heading', 'A change needs your approval'),
    lede: t(
      'notice.approval_requested.lede',
      'Somebody changed a detail in {{company}}’s People that needs a second person to approve it before it takes effect. It waits for up to seven days; after that it lapses and is not applied.',
      { company },
    ),
    action: t('notice.approval_requested.action', 'Review changes'),
    footer: t(
      'notice.approval_requested.footer',
      'Sent by Kithena on behalf of {{company}} because you approve changes in People.',
      { company },
    ),
  }),
  approval_decided: ({ decision }, company, t) => {
    if (!APPROVAL_DECISIONS.includes(decision)) return null;
    const footer = t(
      'notice.approval_decided.footer',
      'Sent by Kithena on behalf of {{company}} because you made a change that needed approval.',
      { company },
    );
    const action = t('notice.approval_decided.action', 'Open People');
    return decision === 'approved'
      ? {
          subject: t(
            'notice.approval_decided.approved.subject',
            '{{company}}: your change was approved',
            {
              company,
            },
          ),
          heading: t('notice.approval_decided.approved.heading', 'Your change was approved'),
          lede: t(
            'notice.approval_decided.approved.lede',
            'A change you made in {{company}}’s People was approved, and takes effect from the date you gave.',
            { company },
          ),
          action,
          footer,
        }
      : {
          subject: t(
            'notice.approval_decided.rejected.subject',
            '{{company}}: your change was not approved',
            { company },
          ),
          heading: t('notice.approval_decided.rejected.heading', 'Your change was not approved'),
          lede: t(
            'notice.approval_decided.rejected.lede',
            'A change you made in {{company}}’s People was not approved, so it was not applied. Open People to see what is recorded and, if it is still needed, make it again.',
            { company },
          ),
          action,
          footer,
        };
  },
  correction_requested: (_notice, company, t) => ({
    subject: t(
      'notice.correction_requested.subject',
      '{{company}}: HR asked you to correct a detail',
      { company },
    ),
    heading: t('notice.correction_requested.heading', 'A detail needs correcting'),
    lede: t(
      'notice.correction_requested.lede',
      'HR at {{company}} checked a detail you gave in People and could not accept it as it is, so it was not saved. Open your profile to see what they found and correct it.',
      { company },
    ),
    action: t('notice.correction_requested.action', 'Open your profile'),
    footer: t(
      'notice.correction_requested.footer',
      'Sent by Kithena on behalf of {{company}} because a detail in your People profile needs your correction.',
      { company },
    ),
  }),
  approval_expired: (_notice, company, t) => ({
    subject: t(
      'notice.approval_expired.subject',
      '{{company}}: your change expired without a decision',
      { company },
    ),
    heading: t('notice.approval_expired.heading', 'Your change expired'),
    lede: t(
      'notice.approval_expired.lede',
      'Nobody decided a change you made in {{company}}’s People within seven days, so it was not applied. If it is still needed, make it again.',
      { company },
    ),
    action: t('notice.approval_expired.action', 'Open People'),
    footer: t(
      'notice.approval_expired.footer',
      'Sent by Kithena on behalf of {{company}} because you made a change that needed approval.',
      { company },
    ),
  }),
  webhook_disabled: ({ host }, company, t) => {
    if (!HOST.test(host)) return null;
    return {
      subject: t(
        'notice.webhook_disabled.subject',
        '{{company}}: a People webhook was turned off',
        {
          company,
        },
      ),
      heading: t('notice.webhook_disabled.heading', 'We stopped sending to one of your webhooks'),
      lede: t(
        'notice.webhook_disabled.lede',
        'Nothing sent to {{host}} has succeeded for 24 hours, so Kithena turned that endpoint off. Events raised while it is off are not sent to it. Once the receiver is fixed, turn the endpoint back on and replay the delivery that failed.',
        { host },
      ),
      action: t('notice.webhook_disabled.action', 'Open People'),
      footer: t(
        'notice.webhook_disabled.footer',
        'Sent by Kithena because this address is the alert contact for a webhook endpoint in {{company}}’s People.',
        { company },
      ),
    };
  },
  export_shared: (_notice, company, t) => ({
    subject: t('notice.export_shared.subject', '{{company}}: a People export was sent to you', {
      company,
    }),
    heading: t('notice.export_shared.heading', 'A People export was sent to you'),
    lede: t(
      'notice.export_shared.lede',
      'Somebody at {{company}} sent you an export from People. It opens only for you, once you are signed in, and only for seven days; after that it is deleted.',
      { company },
    ),
    action: t('notice.export_shared.action', 'Open the export'),
    footer: t(
      'notice.export_shared.footer',
      'Sent by Kithena on behalf of {{company}} because an export was sent to you. Forwarding this email gives nobody else the file.',
      { company },
    ),
  }),
  export_share_requested: (_notice, company, t) => ({
    subject: t(
      'notice.export_share_requested.subject',
      '{{company}}: an export is waiting for your approval',
      { company },
    ),
    heading: t('notice.export_share_requested.heading', 'An export needs your approval'),
    lede: t(
      'notice.export_share_requested.lede',
      'Somebody at {{company}} wants to send an export from People to a colleague who could not see all of it themselves. Nothing is sent unless a People administrator approves it within seven days.',
      { company },
    ),
    action: t('notice.export_share_requested.action', 'Review the export'),
    footer: t(
      'notice.export_share_requested.footer',
      'Sent by Kithena on behalf of {{company}} because you are a People administrator.',
      { company },
    ),
  }),
  inbox_task: ({ topic }, company, t) => {
    const [subject, opening] = TASK_WORDS[topic](t, company);
    return {
      subject,
      heading: t('notice.inbox_task.heading', 'Something needs you'),
      lede: t(
        'notice.inbox_task.lede',
        '{{opening}} It is in your Inbox at {{company}}, with everything you need to do it.',
        { opening, company },
      ),
      action: t('notice.inbox_task.action', 'Open your Inbox'),
      footer: t(
        'notice.inbox_task.footer',
        'Sent by Kithena on behalf of {{company}}. Choose which tasks reach you by email in Settings, Notifications.',
        { company },
      ),
    };
  },
  inbox_update: ({ topic }, company, t) => {
    const [subject, opening] = UPDATE_WORDS[topic](t, company);
    return {
      subject,
      heading: t('notice.inbox_update.heading', 'An update for you'),
      lede: t(
        'notice.inbox_update.lede',
        '{{opening}} Nothing is owed; it is in your Inbox at {{company}}.',
        { opening, company },
      ),
      action: t('notice.inbox_update.action', 'Open your Inbox'),
      footer: t(
        'notice.inbox_update.footer',
        'Sent by Kithena on behalf of {{company}}. Updates can come in a daily digest instead, in Settings, Notifications.',
        { company },
      ),
    };
  },
  inbox_digest: ({ count }, company, t) => {
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
    return {
      subject: t(
        'notice.inbox_digest.subject',
        {
          one: '{{company}}: one update in your Inbox',
          other: '{{company}}: {{count}} updates in your Inbox',
        },
        { company, count },
      ),
      heading: t(
        'notice.inbox_digest.heading',
        { one: 'One update since yesterday', other: '{{count}} updates since yesterday' },
        { count },
      ),
      lede: t(
        'notice.inbox_digest.lede',
        {
          one: 'Your daily digest: one update you have not opened yet, in your Inbox at {{company}}. Nothing in an update is owed.',
          other:
            'Your daily digest: {{count}} updates you have not opened yet, in your Inbox at {{company}}. Nothing in an update is owed.',
        },
        { company, count },
      ),
      action: t('notice.inbox_digest.action', 'Open your Inbox'),
      footer: t(
        'notice.inbox_digest.footer',
        'Sent by Kithena on behalf of {{company}}, once a day. Change when, or turn it off, in Settings, Notifications.',
        { company },
      ),
    };
  },
  rest_nudge: ({ heading, lede }, company, t) => ({
    subject: t('notice.rest_nudge.subject', '{{company}}: {{heading}}', { company, heading }),
    heading,
    lede,
    action: t('notice.rest_nudge.action', 'Open Time Off'),
    footer: t(
      'notice.rest_nudge.footer',
      'Sent by Kithena on behalf of {{company}}, because HR suggested you take a break. Only you see these numbers.',
      { company },
    ),
  }),
  signature_requested: (_notice, company, t) => ({
    subject: t('notice.signature_requested.subject', '{{company}} sent you a document to sign', {
      company,
    }),
    heading: t('notice.signature_requested.heading', 'A document to sign'),
    lede: t(
      'notice.signature_requested.lede',
      '{{company}} asked you to sign a document with Kithena. It opens ready to sign: press Start, sign where it asks, and Finish. We email you a code at Finish to confirm it is you.',
      { company },
    ),
    action: t('notice.signature_requested.action', 'Review and sign'),
    footer: t(
      'notice.signature_requested.footer',
      'Sent by Kithena on behalf of {{company}}. If you were not expecting this, you can ignore it.',
      { company },
    ),
  }),
  signature_reminder: (_notice, company, t) => ({
    subject: t(
      'notice.signature_reminder.subject',
      'Reminder: {{company}} is waiting for your signature',
      { company },
    ),
    heading: t('notice.signature_reminder.heading', 'Your signature is next'),
    lede: t(
      'notice.signature_reminder.lede',
      'A document from {{company}} is waiting for you to sign. Any signatures before yours are already on it. This link replaces any earlier one we sent you.',
      { company },
    ),
    action: t('notice.signature_reminder.action', 'Review and sign'),
    footer: t(
      'notice.signature_reminder.footer',
      'Sent by Kithena on behalf of {{company}}. If you were not expecting this, you can ignore it.',
      { company },
    ),
  }),
  document_signed: (_notice, company, t) => ({
    subject: t('notice.document_signed.subject', '{{company}}: you signed a document', { company }),
    heading: t('notice.document_signed.heading', 'Your signature is in'),
    lede: t(
      'notice.document_signed.lede',
      'Thank you for signing with {{company}}. A copy as signed so far is attached. Anyone still to sign is asked in turn, and you get the finished copy once everyone has signed.',
      { company },
    ),
    action: t('notice.document_signed.action', 'Open the document'),
    footer: t(
      'notice.document_signed.footer',
      'Sent by Kithena on behalf of {{company}}, because you signed a document.',
      { company },
    ),
  }),
  document_completed: (_notice, company, t) => ({
    subject: t('notice.document_completed.subject', '{{company}}: everyone has signed', {
      company,
    }),
    heading: t('notice.document_completed.heading', 'Signed by everyone'),
    lede: t(
      'notice.document_completed.lede',
      'Every signature is in. The signed document is attached, with a certificate of completion as its last page saying who signed, how and when.',
    ),
    action: t('notice.document_completed.action', 'Open the document'),
    footer: t(
      'notice.document_completed.footer',
      'Sent by Kithena on behalf of {{company}}, because you signed this document.',
      { company },
    ),
  }),
  signing_code: ({ code }, company, t) => {
    if (!/^\d{6}$/u.test(code)) return null;
    return {
      subject: t('notice.signing_code.subject', 'Your code to sign for {{company}}: {{code}}', {
        company,
        code,
      }),
      heading: t('notice.signing_code.heading', 'Your code is {{code}}', { code }),
      lede: t(
        'notice.signing_code.lede',
        'Enter it on the signing page to show it is you. It works for ten minutes. If you did not ask for it, somebody may have your link; nothing can be signed without the code.',
      ),
      action: t('notice.signing_code.action', 'Back to the document'),
      footer: t('notice.signing_code.footer', 'Sent by Kithena on behalf of {{company}}.', {
        company,
      }),
    };
  },
  summary_shared: (_notice, company, t) => ({
    subject: t(
      'notice.summary_shared.subject',
      '{{company}}: a People summary was shared with you',
      { company },
    ),
    heading: t('notice.summary_shared.heading', 'A People summary for you'),
    lede: t(
      'notice.summary_shared.lede',
      'Somebody at {{company}} sent you a summary of what changed in People, written for what you are allowed to see. It is shown only once you are signed in, and it opens for seven days.',
      { company },
    ),
    action: t('notice.summary_shared.action', 'Open the summary'),
    footer: t(
      'notice.summary_shared.footer',
      'Sent by Kithena on behalf of {{company}}, because somebody in HR shared a People summary with you.',
      { company },
    ),
  }),
  scheduled_report: ({ cadence, format }, company, t) => {
    if (!REPORT_CADENCES.includes(cadence) || !REPORT_FORMATS.includes(format)) return null;
    const footer = t(
      'notice.scheduled_report.footer',
      'Sent by Kithena on behalf of {{company}}, because you are a recipient of a scheduled People report. Whoever manages People at {{company}} can stop it.',
      { company },
    );
    if (format === 'summary') {
      return {
        subject: REPORT_WORDS.summarySubject[cadence](t, company),
        heading: REPORT_WORDS.summaryHeading[cadence](t),
        lede: t(
          'notice.scheduled_report.summary.lede',
          'The numbers {{company}} scheduled for you are up to date: headcount, movement and how complete the records are. They are shown only once you are signed in, and only what you are allowed to see.',
          { company },
        ),
        action: t('notice.scheduled_report.summary.action', 'Open the summary'),
        footer,
      };
    }
    return {
      subject: REPORT_WORDS.fileSubject[cadence](t, company),
      heading: t('notice.scheduled_report.file.heading', 'Your People report is ready'),
      lede: REPORT_WORDS.fileLede[cadence](t, company, format === 'xlsx' ? 'Excel' : 'PDF'),
      action: t('notice.scheduled_report.file.action', 'Download the report'),
      footer,
    };
  },
};

/**
 * A scheduled report's words per cadence, whole: "daily", "weekly" and
 * "monthly" agree with what they describe in most languages, so none is a
 * word slotted into a sentence.
 */
const REPORT_WORDS = {
  summarySubject: {
    daily: (t: Words, company: string) =>
      t('notice.scheduled_report.daily.summary.subject', '{{company}}: your daily People summary', {
        company,
      }),
    weekly: (t: Words, company: string) =>
      t(
        'notice.scheduled_report.weekly.summary.subject',
        '{{company}}: your weekly People summary',
        { company },
      ),
    monthly: (t: Words, company: string) =>
      t(
        'notice.scheduled_report.monthly.summary.subject',
        '{{company}}: your monthly People summary',
        { company },
      ),
  },
  summaryHeading: {
    daily: (t: Words) =>
      t('notice.scheduled_report.daily.summary.heading', 'Your daily People summary'),
    weekly: (t: Words) =>
      t('notice.scheduled_report.weekly.summary.heading', 'Your weekly People summary'),
    monthly: (t: Words) =>
      t('notice.scheduled_report.monthly.summary.heading', 'Your monthly People summary'),
  },
  fileSubject: {
    daily: (t: Words, company: string) =>
      t(
        'notice.scheduled_report.daily.file.subject',
        '{{company}}: your daily People report is ready',
        { company },
      ),
    weekly: (t: Words, company: string) =>
      t(
        'notice.scheduled_report.weekly.file.subject',
        '{{company}}: your weekly People report is ready',
        { company },
      ),
    monthly: (t: Words, company: string) =>
      t(
        'notice.scheduled_report.monthly.file.subject',
        '{{company}}: your monthly People report is ready',
        { company },
      ),
  },
  fileLede: {
    daily: (t: Words, company: string, file: string) =>
      t(
        'notice.scheduled_report.daily.file.lede',
        'The daily {{file}} report {{company}} scheduled for you has been prepared, with only what you are allowed to see. Sign in to download it within 24 hours; after that it is deleted, and the next one comes as scheduled.',
        { company, file },
      ),
    weekly: (t: Words, company: string, file: string) =>
      t(
        'notice.scheduled_report.weekly.file.lede',
        'The weekly {{file}} report {{company}} scheduled for you has been prepared, with only what you are allowed to see. Sign in to download it within 24 hours; after that it is deleted, and the next one comes as scheduled.',
        { company, file },
      ),
    monthly: (t: Words, company: string, file: string) =>
      t(
        'notice.scheduled_report.monthly.file.lede',
        'The monthly {{file}} report {{company}} scheduled for you has been prepared, with only what you are allowed to see. Sign in to download it within 24 hours; after that it is deleted, and the next one comes as scheduled.',
        { company, file },
      ),
  },
} as const;

/** Every notice kind, read off the copy that must have one for each. */
export const NOTICE_KINDS = Object.keys(COPY) as readonly NoticeKind[];

/** US English, the words in the code: what a notice says when no language is given. */
const ENGLISH = wordsIn('en-US', {});

export function renderNotice(
  notice: Notice,
  url: string,
  companyName: string,
  /** The company's language, and its words for it: every email is in the company's language. */
  words: { readonly language: string; readonly t: Words } = { language: 'en-US', t: ENGLISH },
): Result<RenderedMessage> {
  const company = companyName.trim();
  if (company.length === 0 || company.length > MAX_COMPANY_NAME) return err(Unrenderable);

  // A nudge's words are the module's: one line of heading, bounded, and
  // escaped for the HTML with everything else.
  let input = notice;
  if (notice.kind === 'rest_nudge') {
    const heading = notice.heading.trim();
    const lede = notice.lede.trim();
    if (heading.length === 0 || heading.length > NUDGE_HEADING_MAX || /[\r\n]/u.test(heading)) {
      return err(Unrenderable);
    }
    if (lede.length === 0 || lede.length > NUDGE_LEDE_MAX) return err(Unrenderable);
    input = { kind: 'rest_nudge', heading, lede };
  }

  // The mapped type pairs each kind with its input; TypeScript cannot follow
  // that through an index, so the call is widened by hand.
  const copyFor = COPY[notice.kind] as (n: Notice, company: string, t: Words) => Copy | null;
  const plain = copyFor(input, company, words.t);
  const href = safeHref(url);
  if (plain === null || href === null) return err(Unrenderable);
  // Escaped whole, once: the company's name, a nudge's words and the
  // translation itself are all text to the HTML.
  const marked: Copy = {
    subject: escapeHtml(plain.subject),
    heading: escapeHtml(plain.heading),
    lede: escapeHtml(plain.lede),
    action: escapeHtml(plain.action),
    footer: escapeHtml(plain.footer),
  };

  return ok({
    subject: plain.subject,
    html: html(marked, href, escapeHtml(url), words),
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
function html(
  copy: Copy,
  href: string,
  plainUrl: string,
  words: { readonly language: string; readonly t: Words },
): string {
  const pad = scale.cardPadding;
  const accent = light['accent-solid'];
  return `<!doctype html>
<html lang="${escapeHtml(words.language)}" style="margin:0;padding:0;">
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
                      <p style="margin:0;">${escapeHtml(words.t('notice.button_not_working', 'Button not working? Paste this into your browser:'))}<br /><a href="${href}" class="k-muted" style="color:${light['fg-muted']};word-break:break-all;text-decoration:underline;">${plainUrl}</a></p>
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
