import { accentHex } from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import { escapeHtml, safeHref, safeImageSrc } from './markup.js';
import { ENGLISH, Unrenderable, type Language, type RenderedMessage } from './invitation.js';
import { frame } from './frame.js';
import { light } from './palette.js';

/**
 * Correspondence: an email a module wrote word for word, to somebody outside
 * the company who is not a user — a candidate (Recruiting PRD §12.7).
 *
 * The one kind of message here whose words are not this service's. A
 * candidate's thread is the feature, so Recruiting writes it and keeps it;
 * messaging sends it and, as for everything else, records the outcome and
 * never the body.
 *
 * It is drawn as the sign-up email is drawn (`invitation.ts`): the company's
 * name above an outlined card with its accent rule, its logo, a heading and
 * the words. A module may add structure, never markup: times grouped by day,
 * a few facts, one button and one quieter link. Every value is escaped here
 * and every link must be `https:`, so a caller still cannot put HTML in front
 * of a candidate.
 */
export const CORRESPONDENCE_KIND = 'correspondence';

/** What a module may lay out beside its words. */
export interface CorrespondenceParts {
  /** The card's heading; the subject when absent. */
  readonly heading?: string | null | undefined;
  /** Times grouped by day, read at a glance: "Tuesday 4 November" over "10:00 – 10:45". */
  readonly times?:
    | {
        readonly title: string;
        readonly days: readonly { readonly day: string; readonly times: readonly string[] }[];
        readonly note?: string | null | undefined;
      }
    | null
    | undefined;
  /** A few labelled facts: when, where, how long. */
  readonly facts?: readonly { readonly label: string; readonly value: string }[] | undefined;
  /** The one thing to do. */
  readonly action?: { readonly label: string; readonly href: string } | null | undefined;
  /** A quieter second thing: change my times, ask for another. */
  readonly secondary?: { readonly label: string; readonly href: string } | null | undefined;
  /** What happens next, in order: "You sign first", "Then the company signs". */
  readonly steps?: readonly string[] | undefined;
  /** Small print under the button: how long a link lasts. */
  readonly note?: string | null | undefined;
  /** The company's theme preset and mark, as its careers page shows them. */
  readonly themeId?: string | null | undefined;
  readonly logoUrl?: string | null | undefined;
}

const LIMITS = { days: 14, timesPerDay: 24, facts: 8, steps: 6, label: 120, value: 500 } as const;

export function renderCorrespondence(
  subject: string,
  text: string,
  companyName: string,
  parts: CorrespondenceParts = {},
  /** The company's language, for the frame around the module's own words. */
  words: Language = ENGLISH,
  /** A member of the company rather than a candidate: their footer, and where they change what reaches them. */
  member: { readonly manageHref: string | null } | null = null,
): Result<RenderedMessage> {
  // A bare `t`, so `i18n-extract` finds every key.
  const { t } = words;
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
  const days = (parts.times?.days ?? []).slice(0, LIMITS.days).map((d) => ({
    day: d.day.slice(0, LIMITS.label),
    times: d.times.slice(0, LIMITS.timesPerDay).map((t) => t.slice(0, LIMITS.label)),
  }));
  const facts = (parts.facts ?? [])
    .slice(0, LIMITS.facts)
    .map((f) => ({ label: f.label.slice(0, LIMITS.label), value: f.value.slice(0, LIMITS.value) }));
  // A link that is not plainly https is dropped, never rendered: the words still say what to do.
  const action =
    parts.action == null ? null : link(parts.action.label, safeHref(parts.action.href));
  const secondary =
    parts.secondary == null ? null : link(parts.secondary.label, safeHref(parts.secondary.href));
  const title = (parts.heading ?? '').trim() === '' ? heading : (parts.heading ?? '').trim();
  const steps = (parts.steps ?? [])
    .slice(0, LIMITS.steps)
    .map((x) => escapeHtml(x.slice(0, LIMITS.value)));
  const paragraphs = body.split(/\n{2,}/u).map((p) => escapeHtml(p).replace(/\n/gu, '<br />'));
  const manage = member?.manageHref == null ? null : safeHref(member.manageHref);
  const html = frame({
    language: escapeHtml(words.language),
    title: escapeHtml(title.slice(0, 200)),
    preheader: paragraphs[0]?.replaceAll('<br />', ' ').slice(0, 140) ?? '',
    company: escapeHtml(companyName),
    logo: safeImageSrc(parts.logoUrl ?? null),
    accent: accentHex(parts.themeId) ?? light['accent-solid'],
    paragraphs,
    facts: facts.map((f) => ({ label: escapeHtml(f.label), value: escapeHtml(f.value) })),
    times:
      parts.times == null || days.length === 0
        ? null
        : {
            title: escapeHtml(parts.times.title.slice(0, LIMITS.label)),
            note: parts.times.note == null ? null : escapeHtml(parts.times.note.slice(0, 300)),
            days: days.map((d) => ({ day: escapeHtml(d.day), times: d.times.map(escapeHtml) })),
          },
    steps:
      steps.length === 0
        ? null
        : {
            title: escapeHtml(t('correspondence.next', 'What happens next')),
            items: steps,
          },
    action,
    secondary,
    note:
      parts.note == null || parts.note.trim() === '' ? null : escapeHtml(parts.note.slice(0, 300)),
    footer: escapeHtml(
      member === null
        ? t(
            'correspondence.footer',
            'Sent by {{company}} about your application. Reply to this email to answer them.',
            { company: companyName },
          )
        : t(
            'correspondence.member_footer',
            'Sent to you at {{company}} by Kithena, because it is yours to do or to know.',
            { company: companyName },
          ),
    ),
    manage:
      manage === null
        ? null
        : {
            label: escapeHtml(t('correspondence.manage', 'Choose what reaches you')),
            href: manage,
          },
  });
  return ok({
    subject: heading,
    html,
    text: plain({
      body,
      companyName,
      parts: { days, facts, steps: (parts.steps ?? []).slice(0, LIMITS.steps) },
      action: parts.action,
      secondary: parts.secondary,
      timesTitle: parts.times?.title ?? t('correspondence.times', 'Times'),
    }),
  });
}

const link = (label: string, href: string | null): { label: string; href: string } | null =>
  href === null || label.trim() === ''
    ? null
    : { label: escapeHtml(label.trim().slice(0, 60)), href };

/** The same message as text, for the clients and filters that read only that part. */
function plain(v: {
  body: string;
  companyName: string;
  parts: {
    days: readonly { day: string; times: readonly string[] }[];
    facts: readonly { label: string; value: string }[];
    steps: readonly string[];
  };
  timesTitle: string;
  action: CorrespondenceParts['action'];
  secondary: CorrespondenceParts['secondary'];
}): string {
  return [
    v.body,
    ...(v.parts.days.length === 0
      ? []
      : ['', v.timesTitle, ...v.parts.days.map((d) => `  ${d.day}: ${d.times.join(', ')}`)]),
    ...(v.parts.facts.length === 0
      ? []
      : ['', ...v.parts.facts.map((f) => `${f.label}: ${f.value}`)]),
    ...(v.parts.steps.length === 0
      ? []
      : ['', ...v.parts.steps.map((x, i) => `${String(i + 1)}. ${x}`)]),
    ...(v.action == null || safeHref(v.action.href) === null
      ? []
      : ['', `${v.action.label}:`, v.action.href]),
    ...(v.secondary == null || safeHref(v.secondary.href) === null
      ? []
      : ['', `${v.secondary.label}:`, v.secondary.href]),
    '',
    v.companyName,
  ].join('\n');
}
