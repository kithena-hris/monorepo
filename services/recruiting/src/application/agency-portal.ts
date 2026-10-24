import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { normalEmail } from '../domain/candidate/duplicates.js';
import { currentStage } from '../domain/pipeline/application.js';
import { notFound, type Ctx, mailWords } from './context.js';
import { CODE_MINUTES, MAX_ATTEMPTS, sha256, submitByAgency, type IncomingFile } from './intake.js';
import type { Agency, ApplicationRecord } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * J9, the agency portal (PRD §9.4): an agency signs in on Kithena Jobs with a
 * code sent to the contact address the company recorded, submits to the jobs
 * it was invited to, and sees the stage of its own candidates — never another
 * agency's, never a note. The code is keyed by the agency's id where a
 * candidate's is keyed by the job's; the session is a token whose hash is
 * kept for a day.
 */

const SESSION_MS = 86_400_000;

async function agencyByEmail(ctx: Ctx, email: string): Promise<Agency | null> {
  const norm = normalEmail(email);
  return (
    (await ctx.tx.agencies.list()).find((a) => a.active && normalEmail(a.contactEmail) === norm) ??
    null
  );
}

/** The same answer whether or not the address belongs to an agency. */
export async function requestAgencyCode(
  ctx: Ctx,
  email: string,
): Promise<Result<{ sent: true; code?: string }>> {
  const agency = await agencyByEmail(ctx, email);
  if (agency === null) return ok({ sent: true });
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.parse(ctx.at) + CODE_MINUTES * 60_000).toISOString();
  await ctx.tx.codes.put(normalEmail(email), agency.id, sha256(code), expires as never);
  const company = (await generalSettings(ctx)).companyName;
  const { t } = await mailWords(ctx);
  ctx.mail.push({
    to: agency.contactEmail,
    subject: t(
      'email.agency_code.subject',
      '{{code}} is your code for {{company}}’s agency portal',
      {
        code,
        company,
      },
    ),
    text: t(
      'email.agency_code.text',
      'Hello {{name}},\n\nYour code is {{code}}. It works for {{minutes}} minutes.\n\nIf you did not ask for it, ignore this email.',
      { name: agency.name, code, minutes: CODE_MINUTES },
    ),
    dedupeKey: `agency-code:${agency.id}:${ctx.at}`,
  });
  return ok(ctx.deps.mailer === undefined ? { sent: true, code } : { sent: true });
}

export async function openAgencySession(
  ctx: Ctx,
  email: string,
  code: string,
): Promise<Result<{ token: string }>> {
  const agency = await agencyByEmail(ctx, email);
  const held = agency === null ? null : await ctx.tx.codes.get(normalEmail(email), agency.id);
  if (agency === null || held === null || held.expiresAt < ctx.at)
    return err(failure('CODE_EXPIRED', 'Ask for a new code'));
  if (held.attempts >= MAX_ATTEMPTS)
    return err(failure('CODE_ATTEMPTS', 'Too many tries; ask for a new code'));
  if (!timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(held.codeHash))) {
    await ctx.tx.codes.attempt(normalEmail(email), agency.id);
    return err(failure('CODE_WRONG', 'That code is not right'));
  }
  await ctx.tx.codes.remove(normalEmail(email), agency.id);
  const token = randomBytes(32).toString('base64url');
  await ctx.tx.settings.set(`agency_session:${sha256(token)}`, {
    agencyId: agency.id,
    expiresAt: new Date(Date.parse(ctx.at) + SESSION_MS).toISOString(),
  });
  return ok({ token });
}

async function agencyOf(ctx: Ctx, token: string): Promise<Agency | null> {
  if (token === '') return null;
  const session = (await ctx.tx.settings.get(`agency_session:${sha256(token)}`)) as {
    agencyId: string;
    expiresAt: string;
  } | null;
  if (session === null || session.expiresAt < ctx.at) return null;
  const agency = await ctx.tx.agencies.get(session.agencyId);
  return agency?.active === true ? agency : null;
}

export interface AgencyPortal {
  readonly agency: string;
  readonly company: string;
  readonly jobs: readonly { readonly id: string; readonly title: string }[];
  readonly submissions: readonly {
    readonly id: string;
    readonly job: string;
    readonly candidate: string;
    readonly stage: string | null;
    readonly outcome: string;
    readonly submittedOn: string;
  }[];
}

export async function agencyPortal(ctx: Ctx, token: string): Promise<Result<AgencyPortal>> {
  const agency = await agencyOf(ctx, token);
  if (agency === null) return err(notFound('session'));
  const jobs = [];
  for (const id of agency.jobIds) {
    const job = await ctx.tx.jobs.get(id);
    if (job?.state === 'open') jobs.push({ id: job.id, title: job.title });
  }
  const submissions = [];
  for (const s of await ctx.tx.submissions.forAgency(agency.id)) {
    const app = s.applicationId === null ? null : await ctx.tx.applications.get(s.applicationId);
    const job = await ctx.tx.jobs.get(s.jobId);
    const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
    if (app === null || job === null || candidate === null || candidate.anonymisedAt !== null)
      continue;
    const stage = (await ctx.tx.jobs.stages(job.id)).find((x) => x.id === currentStage(app));
    submissions.push({
      id: s.id,
      job: job.title,
      candidate: candidate.name,
      stage: stage === undefined ? null : (stage.candidateName ?? stage.name),
      outcome: app.outcome,
      submittedOn: s.submittedOn,
    });
  }
  return ok({
    agency: agency.name,
    company: (await generalSettings(ctx)).companyName,
    jobs,
    submissions,
  });
}

export async function submitAsAgency(
  ctx: Ctx,
  token: string,
  input: { readonly jobId: string; readonly name: string; readonly email: string },
  files: readonly IncomingFile[],
): Promise<Result<ApplicationRecord>> {
  const agency = await agencyOf(ctx, token);
  if (agency === null) return err(notFound('session'));
  return submitByAgency(ctx, agency.id, input.jobId, input.name, input.email, files);
}
