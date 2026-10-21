import { err, ok, type Result } from '@kithena/domain-kit';
import type { Instant } from '@kithena/contracts';

import { may } from '../domain/access/access.js';
import { currentStage } from '../domain/pipeline/application.js';
import { adminOnly, forbidden, type Ctx } from './context.js';
import { portalLink } from './intake.js';
import {
  loadApplication,
  moveApplication,
  queueEmail,
  rejectApplication,
  render,
  sendNow,
  type Loaded,
  type Rejecting,
} from './moves.js';
import type { MoveNeeds } from '../domain/pipeline/application.js';
import { sendAt } from '../domain/pipeline/pipeline.js';
import type { Template } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * The emails a hiring process sends at its turning points (PRD §12.7): one
 * purpose each, a company template when it has written one, a built-in
 * otherwise, and the same placeholders everywhere. A composer on the screen
 * shows the email filled in before it goes, so a recruiter edits words, not
 * variables; `{{link}}` alone stays a placeholder until the send, because
 * each link is minted for one candidate.
 */

export const EMAIL_PURPOSES = [
  'rejection',
  'selection',
  'interview_confirmation',
  'offer',
] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

/** Every placeholder a template or a composed email may use, with what it becomes. */
export const PLACEHOLDERS = [
  { key: 'candidate', label: 'Candidate’s full name' },
  { key: 'first_name', label: 'Candidate’s first name' },
  { key: 'job', label: 'Job title' },
  { key: 'company', label: 'Company name' },
  { key: 'stage', label: 'Current stage, as the candidate sees it' },
  { key: 'interview', label: 'Next interview: name, date and time' },
  { key: 'where', label: 'Where the next interview is' },
  { key: 'sender', label: 'Who is writing' },
  { key: 'link', label: 'The candidate’s own page' },
] as const;

export const DEFAULT_EMAILS: Readonly<
  Record<EmailPurpose, { readonly name: string; readonly subject: string; readonly body: string }>
> = {
  rejection: {
    name: 'Application not taken forward',
    subject: 'Your application to {{company}}',
    body: 'Hello {{first_name}},\n\nThank you for applying for {{job}} and for the time you gave us. We will not be taking your application further this time.\n\nWe would be glad to hear from you again for a role that fits, and we wish you well in your search.\n\n{{sender}}\n{{company}}',
  },
  selection: {
    name: 'Moving to the next step',
    subject: 'Good news about your application to {{company}}',
    body: 'Hello {{first_name}},\n\nThank you for your application for {{job}}. We would like to take it to the next step: {{stage}}.\n\nWe will be in touch shortly with what happens next. Everything about your application is on your page:\n{{link}}\n\n{{sender}}\n{{company}}',
  },
  interview_confirmation: {
    name: 'Interview confirmed',
    subject: 'Appointment scheduled: {{interview}} with {{company}}',
    body: 'Hello {{first_name}},\n\nYour {{interview}} for {{job}} is confirmed.\nWhere: {{where}}\n\nIf that time no longer works, ask for a change from your page:\n{{link}}\n\nWe look forward to meeting you.\n{{sender}}\n{{company}}',
  },
  offer: {
    name: 'Your offer',
    subject: 'Your offer from {{company}}',
    body: 'Hello {{first_name}},\n\nWe are delighted to offer you the role of {{job}}. Read the offer, and accept or decline it, on your page:\n{{link}}\n\n{{sender}}\n{{company}}',
  },
};

const fmt = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );

/** The values every placeholder becomes for this application; `link` only when asked, since it mints a token. */
export async function emailValues(
  ctx: Ctx,
  loaded: Loaded,
  options: { readonly link: boolean } = { link: true },
): Promise<Record<string, string>> {
  const settings = await generalSettings(ctx);
  const job = await ctx.tx.jobs.get(loaded.app.jobId);
  const stage = loaded.stages.find((s) => s.id === currentStage(loaded.app));
  const zone = loaded.candidate.timeZone ?? 'UTC';
  const next = (await ctx.tx.interviews.forApplication(loaded.app.id))
    .filter((i) => i.state === 'scheduled' && i.startsAt > ctx.at)
    .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const sender =
    ctx.caller.personId === null
      ? settings.companyName
      : ((await ctx.tx.members.get(ctx.caller.personId))?.displayName ??
        settings.companyName);
  return {
    candidate: loaded.candidate.name,
    first_name: loaded.candidate.name.split(' ')[0] ?? loaded.candidate.name,
    job: job?.title ?? '',
    company: settings.companyName,
    stage: stage?.candidateName ?? stage?.name ?? '',
    interview: next === undefined ? '' : `${next.title}, ${fmt(next.startsAt, zone)} (${zone})`,
    where: next?.videoUrl ?? next?.place ?? '',
    sender,
    link: options.link ? await portalLink(ctx, loaded.candidate.id) : '{{link}}',
  };
}

/** The company's template for a purpose, in the candidate's language first, else the built-in words. */
export async function emailFor(
  ctx: Ctx,
  purpose: EmailPurpose,
  language: string | null,
): Promise<{
  readonly subject: string;
  readonly body: string;
  readonly templateId: string | null;
}> {
  const mine = (await ctx.tx.templates.list()).filter(
    (t) => t.kind === 'email' && t.purpose === purpose,
  );
  const chosen = mine.find((t) => t.language === language) ?? mine[0];
  if (chosen !== undefined)
    return { subject: chosen.subject ?? '', body: chosen.body, templateId: chosen.id };
  const built = DEFAULT_EMAILS[purpose];
  return { subject: built.subject, body: built.body, templateId: null };
}

/** An email rendered for an application: what the composer opens with. */
export interface EmailDraft {
  readonly subject: string;
  readonly body: string;
  readonly templateId: string | null;
}

/**
 * R10, R11, R12: the email a composer opens with. Filled in for one
 * candidate; with `fill` off, the placeholders stay, for a send to many.
 */
export async function previewEmail(
  ctx: Ctx,
  applicationId: string,
  input: {
    readonly purpose: EmailPurpose;
    readonly templateId: string | null;
    readonly fill: boolean;
  },
): Promise<Result<EmailDraft>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.message')) return err(forbidden());
  const held = input.templateId === null ? null : await ctx.tx.templates.get(input.templateId);
  const base: EmailDraft =
    held === null
      ? await emailFor(ctx, input.purpose, null)
      : { subject: held.subject ?? '', body: held.body, templateId: held.id };
  if (!input.fill) return ok(base);
  const values = await emailValues(ctx, loaded.value, { link: false });
  return ok({ ...base, subject: render(base.subject, values), body: render(base.body, values) });
}

/** Settings: the built-in email for each purpose the company has none for, as templates to edit. */
export async function seedEmailTemplates(ctx: Ctx): Promise<Result<readonly Template[]>> {
  const allowed = adminOnly(ctx);
  if (!allowed.ok) return allowed;
  const held = new Set(
    (await ctx.tx.templates.list()).filter((t) => t.kind === 'email').map((t) => t.purpose),
  );
  const added: Template[] = [];
  for (const purpose of EMAIL_PURPOSES) {
    if (held.has(purpose)) continue;
    const built = DEFAULT_EMAILS[purpose];
    const template: Template = {
      id: ctx.deps.newId(),
      kind: 'email',
      purpose,
      language: 'en',
      name: built.name,
      subject: built.subject,
      body: built.body,
    };
    await ctx.tx.templates.save(template);
    added.push(template);
  }
  return ok(added);
}

/** Words the recruiter settled on in the composer: rendered once more at the send, so `{{link}}` and any placeholder left in fill. */
export interface ComposedEmail {
  readonly subject: string;
  readonly body: string;
}

/**
 * R10: reject, and send the words from the composer now or later today
 * (never between 21:00 and 08:00 where the candidate is). Without words,
 * the rejection goes as before: a template by id, or no email.
 */
export async function rejectAndEmail(
  ctx: Ctx,
  applicationId: string,
  how: Rejecting & { readonly message: ComposedEmail | null },
): Promise<Result<true>> {
  const { message, ...plain } = how;
  const rejected = await rejectApplication(
    ctx,
    applicationId,
    message === null ? plain : { ...plain, templateId: null },
  );
  if (!rejected.ok || message === null || how.send === 'none') return rejected;
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return rejected;
  const values = await emailValues(ctx, loaded.value);
  const zone = loaded.value.candidate.timeZone ?? 'UTC';
  const later = new Date(Date.parse(ctx.at) + 4 * 3_600_000);
  const subject = render(message.subject, values);
  const body = render(message.body, values);
  if (how.send === 'now') await sendNow(ctx, loaded.value.candidate, applicationId, subject, body);
  else
    await queueEmail(
      ctx,
      loaded.value.candidate,
      applicationId,
      subject,
      body,
      sendAt(later, zone).toISOString() as Instant,
      null,
    );
  return rejected;
}

/** R10: move, and tell the candidate in the composer's words at once. */
export async function moveAndEmail(
  ctx: Ctx,
  applicationId: string,
  to: string,
  needs: MoveNeeds,
  message: ComposedEmail | null,
): Promise<Result<{ moveId: string; opensOffer: boolean }>> {
  const moved = await moveApplication(ctx, applicationId, to, needs);
  if (!moved.ok || message === null) return moved;
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return moved;
  const values = await emailValues(ctx, loaded.value);
  await sendNow(
    ctx,
    loaded.value.candidate,
    applicationId,
    render(message.subject, values),
    render(message.body, values),
  );
  return moved;
}
