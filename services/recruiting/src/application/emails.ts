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
  'stage_expectations',
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
  { key: 'expectations', label: 'What happens at the current stage' },
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
  stage_expectations: {
    name: 'What to expect at this stage',
    subject: 'What to expect next: {{stage}} with {{company}}',
    body: 'Hello {{first_name}},\n\nYour application for {{job}} is now at {{stage}}. Here is what to expect:\n\n{{expectations}}\n\nIf anything is unclear, reply to this email and we will help.\n\n{{sender}}\n{{company}}',
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
      : ((await ctx.tx.members.get(ctx.caller.personId))?.displayName ?? settings.companyName);
  return {
    expectations: await expectationsOf(ctx, loaded, stage?.category ?? 'applied'),
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

/**
 * What happens at a stage, in plain words, from what Recruiting knows: the
 * interviews in the job's plan with their length and who runs them, or what
 * the stage's kind means. A starting point the recruiter edits in the composer.
 */
async function expectationsOf(ctx: Ctx, loaded: Loaded, category: string): Promise<string> {
  switch (category) {
    case 'interview': {
      const plan = await ctx.tx.jobs.plan(loaded.app.jobId);
      if (plan.length === 0)
        return 'One or more interviews with the team. We will send each invitation with the time, the place or link, and an agenda.';
      const lines: string[] = [];
      for (const p of plan) {
        const names: string[] = [];
        for (const id of p.interviewerIds) {
          const n = (await ctx.tx.members.get(id as never))?.displayName;
          if (n !== undefined) names.push(n);
        }
        lines.push(
          `- ${p.title}, ${String(p.minutes)} minutes${names.length === 0 ? '' : `, with ${names.join(', ')}`}`,
        );
      }
      return `${lines.join('\n')}\n\nEach invitation comes with the time, the place or video link, and an agenda. You can ask to move one from your page.`;
    }
    case 'screening':
      return 'A short conversation with a recruiter, around 20 to 30 minutes, about the role, what you are looking for and the practical details. No preparation is needed.';
    case 'assessment':
      return 'A task that shows how you work, with clear instructions and a time to send it back. Tell us if you need any adjustment.';
    case 'works_council':
      return 'The works council is asked to agree to the hire, as the law requires. It takes up to a week and needs nothing from you.';
    case 'offer':
      return 'We are preparing an offer. You will read it on your page, with the pay, the start date and the terms, and can accept or decline it there.';
    case 'hired':
      return 'Welcome aboard. Your start is being arranged and you will hear about your first day.';
    default:
      return 'We are reading your application and will tell you what happens next either way.';
  }
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

/**
 * At any stage, tell the candidate what to expect there, in the composer's
 * words (the expectations template, edited), sent at once with their page.
 */
export async function sendStageExpectations(
  ctx: Ctx,
  applicationId: string,
  message: ComposedEmail,
): Promise<Result<true>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.message')) return err(forbidden());
  const values = await emailValues(ctx, loaded.value);
  const link = values['link'] ?? '';
  const stage = values['stage'] ?? '';
  await sendNow(
    ctx,
    loaded.value.candidate,
    applicationId,
    render(message.subject, values),
    render(message.body, values),
    {
      heading: `What to expect: ${stage === '' ? 'your next step' : stage}`,
      ...(link.startsWith('https://')
        ? { action: { label: 'See your application', href: link } }
        : {}),
    },
  );
  return ok(true);
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
