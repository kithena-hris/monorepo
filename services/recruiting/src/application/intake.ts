import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  ApplyPayload,
  type ApplicationSource,
  type PublicJob,
  type PublicationTarget,
  type TenantId,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { receive } from '../domain/pipeline/application.js';
import { findMatches, normalEmail, normalPhone } from '../domain/candidate/duplicates.js';
import { answersSchema } from '../domain/form/form.js';
import { poolConsent } from '../domain/privacy/retention.js';
import { ownership } from '../domain/referral/referral.js';
import { score, type Answer } from '../domain/screening/questionnaire.js';
import { asPerson, event, notFound, publish, type Ctx } from './context.js';
import type { ApplicationRecord, Candidate, CandidateFile, Deps, JobRecord } from './ports.js';
import { generalSettings } from './setup.js';
import { pagesFor } from './jobs.js';

/** A board's name as a person reads it: `indeed` is Indeed. */
const words = (target: PublicationTarget) =>
  target.charAt(0).toUpperCase() + target.slice(1).replaceAll('_', ' ');

/**
 * Applying (PRD §10.4, §11, REC-047), through the public API: no account,
 * the email confirmed by a six-digit code, a honeypot, consent asked
 * separately, and files of up to 10 MB. Plus a member's referral and an
 * agency's submission, which land the same way with their own source.
 */

export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
export const CODE_MINUTES = 15;
export const MAX_ATTEMPTS = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
  'image/png',
  'image/jpeg',
]);

/** A job open to applications on the public site, by the company's slug and the job's. */
export async function publicJob(ctx: Ctx, slug: string): Promise<JobRecord | null> {
  const job = await ctx.tx.jobs.bySlug(slug);
  if (job === null || job.state !== 'open' || job.internalOnly) return null;
  const targets = await ctx.tx.jobs.targets(job.id);
  return targets.some(
    (t) => (t.target === 'careers_page' || t.target === 'kithena_jobs') && t.state === 'live',
  )
    ? job
    : null;
}

/**
 * A preview of a job as Kithena Jobs will show it (R7): the page built the
 * way publishing builds it, for a job that may not be open yet, behind a
 * token the job's screen hands its team for a day. The page says it is a
 * preview; search engines never see it and nobody can apply from it.
 */
export async function previewJob(
  ctx: Ctx,
  token: string,
  language: string | null,
): Promise<Result<PublicJob>> {
  const held = (await ctx.tx.settings.get(`preview-token:${token}`)) as {
    readonly jobId: string;
    readonly expires: string;
  } | null;
  if (held === null || Date.parse(held.expires) < Date.parse(ctx.at))
    return err(failure('NOT_FOUND', 'This preview has expired'));
  const job = await ctx.tx.jobs.get(held.jobId);
  if (job === null) return err(failure('NOT_FOUND', 'No such job'));
  const pages = await pagesFor(ctx, job, await ctx.tx.jobs.targets(job.id));
  const page = pages.find((p) => p.page.language === language) ?? pages[0];
  if (page === undefined) return err(failure('NO_AD', 'Write the ad first'));
  return ok({ ...page.page, closed: false });
}

/** The token a job's team previews it with: one per job, good for a day, made when the screen loads. */
export async function previewTokenFor(ctx: Ctx, jobId: string): Promise<string> {
  const held = (await ctx.tx.settings.get(`preview:${jobId}`)) as {
    readonly token: string;
    readonly expires: string;
  } | null;
  if (held !== null && Date.parse(held.expires) > Date.parse(ctx.at) + 3_600_000) return held.token;
  const token = randomBytes(24).toString('base64url');
  const expires = new Date(Date.parse(ctx.at) + 86_400_000).toISOString();
  await ctx.tx.settings.set(`preview:${jobId}`, { token, expires });
  await ctx.tx.settings.set(`preview-token:${token}`, { jobId, expires });
  return token;
}

/** Send the six-digit code that confirms the address (PRD §10.4). Same answer whether or not the job exists. */
export async function requestCode(
  ctx: Ctx,
  jobSlug: string,
  email: string,
  name: string,
): Promise<Result<{ sent: true; code?: string }>> {
  const job = await publicJob(ctx, jobSlug);
  if (job === null) return err(notFound('job'));
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.parse(ctx.at) + CODE_MINUTES * 60_000).toISOString();
  await ctx.tx.codes.put(normalEmail(email), job.id, sha256(code), expires as never);
  const company = (await generalSettings(ctx)).companyName;
  ctx.mail.push({
    to: email,
    subject: `${code} is your code to apply to ${company}`,
    text: `Hello ${name},\n\nYour code to send your application for ${job.title} is ${code}. It works for ${String(CODE_MINUTES)} minutes.\n\nIf you did not ask for it, ignore this email.`,
    dedupeKey: `code:${job.id}:${normalEmail(email)}:${ctx.at}`,
  });
  // Without a mailer (tests, a local run) the code comes back so the flow can be finished.
  return ok(ctx.deps.mailer === undefined ? { sent: true, code } : { sent: true });
}

export interface IncomingFile {
  readonly field: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

async function storeFile(
  ctx: Ctx,
  deps: Deps,
  candidateId: string,
  applicationId: string | null,
  file: IncomingFile,
  kind: CandidateFile['kind'],
): Promise<Result<CandidateFile>> {
  if (!FILE_TYPES.has(file.mediaType))
    return err(failure('FILE_TYPE', 'Files are PDF, Word, OpenDocument, RTF or an image'));
  if (file.bytes.length === 0 || file.bytes.length > MAX_FILE_BYTES)
    return err(failure('FILE_SIZE', 'Files are up to 10 MB'));
  const id = deps.newId();
  const blobKey = `${ctx.caller.tenantId}/${candidateId}/${id}`;
  await deps.blobs.put(blobKey, file.bytes, file.mediaType);
  const stored: CandidateFile = {
    id,
    candidateId,
    applicationId,
    kind,
    blobKey,
    fileName: file.fileName.slice(0, 200),
    mediaType: file.mediaType,
    size: file.bytes.length,
    sha256: sha256(file.bytes),
    uploadedAt: ctx.at,
  };
  await ctx.tx.files.add(stored);
  // Text by code (PRD §14.1); a scan with no text layer is "no text", read by a person.
  await ctx.tx.files.setText(
    id,
    file.mediaType.startsWith('image/') ? null : await deps.extractText(file.bytes, file.mediaType),
  );
  return ok(stored);
}

function sourceOf(payload: ApplyPayload): ApplicationSource {
  const link = payload.source.link;
  if (link?.startsWith('ref-') === true)
    return { kind: 'referral', referrerPersonId: link.slice(4) };
  if (link !== undefined && /^[a-z][a-z0-9_]{0,62}$/u.test(link))
    return { kind: 'share_link', channel: link };
  return {
    kind: 'target',
    target: payload.source.target ?? ('careers_page' satisfies PublicationTarget),
  };
}

export interface Applied {
  readonly applicationId: string;
  readonly candidateId: string;
  /** The candidate page's magic link (PRD §10.5). */
  readonly portalUrl: string;
}

/**
 * Turn an incoming person into a candidate: the one with this email, or a
 * new one flagged when a phone or CV suggests the same person (PRD §11.2).
 */
async function candidateFor(
  ctx: Ctx,
  name: string,
  email: string,
  phone: string | null,
  cvHash: string | null,
  personId: string | null,
): Promise<Candidate> {
  const same = await ctx.tx.candidates.byEmail(email);
  if (same !== null) return same;
  const tail = phone === null ? null : normalPhone(phone).replace(/^\+/u, '').slice(-9);
  const suspects = await ctx.tx.candidates.suspects(tail, cvHash);
  const matches = findMatches(
    { email, phone, name, cvHash },
    suspects.map((c) => ({
      id: c.id,
      email: c.email,
      phone: c.phone,
      name: c.name,
      cvHash: c.cvHash,
    })),
  );
  const candidate: Candidate = {
    id: ctx.deps.newId(),
    name: name.trim(),
    email: email.trim(),
    phone,
    cvHash,
    personId,
    location: null,
    links: [],
    timeZone: null,
    language: 'en',
    tags: matches.length > 0 ? ['possible_duplicate'] : [],
    mergedInto: null,
    anonymisedAt: null,
    createdAt: ctx.at,
  };
  await ctx.tx.candidates.save(candidate);
  return candidate;
}

/** The candidate page's link: a token whose hash is all that is kept. */
export async function portalLink(ctx: Ctx, candidateId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.parse(ctx.at) + 180 * 86_400_000).toISOString();
  await ctx.tx.tokens.put(sha256(token), candidateId, expires as never);
  const company = (await generalSettings(ctx)).companySlug;
  return `${ctx.deps.jobsOrigin}/me/${company}#${token}`;
}

/** Shared by the public form, a referral and an agency: one application, its files, consents and event. */
async function land(
  ctx: Ctx,
  job: JobRecord,
  candidate: Candidate,
  source: ApplicationSource,
  answers: Readonly<Record<string, unknown>>,
  language: string,
  adjustments: string | null,
  files: readonly IncomingFile[],
): Promise<Result<ApplicationRecord>> {
  if ((await ctx.tx.applications.find(candidate.id, job.id)) !== null) {
    return err(
      failure(
        'ALREADY_APPLIED',
        'You have already applied to this job; your page has its progress',
      ),
    );
  }
  const stages = await ctx.tx.jobs.stages(job.id);
  const form = await ctx.tx.jobs.form(job.id);
  const questionnaire =
    form?.questionnaireId == null ? null : await ctx.tx.questionnaires.get(form.questionnaireId);
  const given: Record<string, Answer> = {};
  if (questionnaire !== null)
    for (const q of questionnaire.questions) given[q.id] = (answers[`q_${q.id}`] ?? null) as Answer;
  const scored = questionnaire === null ? null : score(questionnaire, given);
  const id = ctx.deps.newId();
  const base = receive({
    id,
    candidateId: candidate.id,
    jobId: job.id,
    stages,
    at: ctx.at,
    by: 'candidate',
    moveId: ctx.deps.newId(),
    flagged: (scored?.knockedOut.length ?? 0) > 0,
  });
  const app: ApplicationRecord = {
    ...base,
    source,
    language,
    answers,
    adjustments,
    score: scored?.score ?? null,
    createdAt: ctx.at,
  };
  await ctx.tx.applications.save(app, stages[0]?.category ?? 'applied', app.history, ctx.today);
  if (questionnaire !== null && scored !== null) {
    await ctx.tx.questionnaires.saveAnswers(
      id,
      questionnaire.id,
      questionnaire.version,
      given,
      scored.score,
      scored.knockedOut,
    );
  }
  for (const file of files) {
    const kind: CandidateFile['kind'] =
      file.field === 'cv'
        ? 'cv'
        : file.field === 'cover_letter'
          ? 'cover_letter'
          : file.field === 'portfolio'
            ? 'portfolio'
            : 'other';
    const stored = await storeFile(ctx, ctx.deps, candidate.id, id, file, kind);
    if (!stored.ok) return stored;
    if (kind === 'cv' && candidate.cvHash === null)
      await ctx.tx.candidates.save({ ...candidate, cvHash: stored.value.sha256 });
  }
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.application.received',
      { type: 'Application', id },
      {
        applicationId: id,
        candidateId: candidate.id,
        jobId: job.id,
        source,
        knockedOut: app.flagged,
      },
    ),
  );
  return ok(app);
}

/** The signed-in account applying (PRD §10.5, extended): its address is proven, and its default CV stands in for one not attached. */
export interface ApplyingAccount {
  readonly email: string;
  readonly defaultCv: IncomingFile | null;
}

export async function apply(
  ctx: Ctx,
  input: unknown,
  given: readonly IncomingFile[],
  account: ApplyingAccount | null = null,
): Promise<Result<Applied>> {
  // Signed in, with no CV attached: the library's default one applies.
  const files =
    account?.defaultCv !== null &&
    account?.defaultCv !== undefined &&
    !given.some((f) => f.field === 'cv')
      ? [...given, account.defaultCv]
      : given;
  const parsed = ApplyPayload.safeParse(input);
  if (!parsed.success)
    return err(failure('INVALID', parsed.error.issues[0]?.message ?? 'Check the form'));
  const payload = parsed.data;
  // The honeypot: a person never fills it in. Answered as a success, so a bot learns nothing.
  if ((payload.website ?? '') !== '')
    return ok({
      applicationId: ctx.deps.newId(),
      candidateId: ctx.deps.newId(),
      portalUrl: ctx.deps.jobsOrigin,
    });
  const job = await ctx.tx.jobs.get(payload.jobId);
  if (job === null || (await publicJob(ctx, job.slug)) === null) return err(notFound('job'));
  const form = await ctx.tx.jobs.form(job.id);
  const fields = form?.fields ?? [];
  const fileFields = new Set(fields.filter((f) => f.kind === 'file').map((f) => f.key));
  // Files arrive beside the answers; their slots are filled with references for the schema.
  const withFiles: Record<string, unknown> = { ...payload.answers };
  for (const file of files)
    if (fileFields.has(file.field))
      withFiles[file.field] = { fileId: ctx.deps.newId(), name: file.fileName.slice(0, 200) };
  const schemaAnswers = Object.fromEntries(
    Object.entries(withFiles).filter(([k]) => !k.startsWith('q_')),
  );
  const checked = answersSchema(fields).safeParse(schemaAnswers);
  if (!checked.success)
    return err(
      failure(
        'INVALID',
        checked.error.issues[0]?.message ?? 'Check the form',
        checked.error.issues[0]?.path.map(String),
      ),
    );
  const email = String(checked.data['email']);
  // An account already proved the address; anyone else proves it with the emailed code.
  if (account === null || normalEmail(account.email) !== normalEmail(email)) {
    const held = await ctx.tx.codes.get(normalEmail(email), job.id);
    if (held === null || held.expiresAt < ctx.at)
      return err(failure('CODE_EXPIRED', 'Ask for a new code'));
    if (held.attempts >= MAX_ATTEMPTS)
      return err(failure('CODE_ATTEMPTS', 'Too many tries; ask for a new code'));
    const typed = Buffer.from(sha256(payload.code));
    if (!timingSafeEqual(typed, Buffer.from(held.codeHash))) {
      await ctx.tx.codes.attempt(normalEmail(email), job.id);
      return err(failure('CODE_WRONG', 'That code is not right'));
    }
    await ctx.tx.codes.remove(normalEmail(email), job.id);
  }
  const name = String(checked.data['name']);
  const phone = typeof checked.data['phone'] === 'string' ? checked.data['phone'] : null;
  const cv = files.find((f) => f.field === 'cv');
  const candidate = await candidateFor(
    ctx,
    name,
    email,
    phone,
    cv === undefined ? null : sha256(cv.bytes),
    null,
  );
  const landed = await land(
    ctx,
    job,
    candidate,
    sourceOf(payload),
    withFiles,
    payload.language,
    payload.adjustments,
    files,
  );
  if (!landed.ok) return landed;
  // Consent, each separately (PRD §10.4): what was shown is kept with it.
  const settings = await generalSettings(ctx);
  await ctx.tx.consents.save({
    id: ctx.deps.newId(),
    candidateId: candidate.id,
    purpose: 'application',
    givenAt: ctx.at,
    expiresOn: null,
    withdrawnAt: null,
    notice: `${settings.companyName} processes this application to consider you for ${job.title}.`,
  });
  if (payload.consent.talentPool) {
    const { expiresOn } = poolConsent(ctx.today, job.countries);
    await ctx.tx.consents.save({
      id: ctx.deps.newId(),
      candidateId: candidate.id,
      purpose: 'talent_pool',
      givenAt: ctx.at,
      expiresOn,
      withdrawnAt: null,
      notice: 'Keep me in the talent pool for other jobs.',
    });
  }
  if (payload.consent.nycNotice === true) {
    await ctx.tx.consents.save({
      id: ctx.deps.newId(),
      candidateId: candidate.id,
      purpose: 'nyc_aedt_notice',
      givenAt: ctx.at,
      expiresOn: null,
      withdrawnAt: null,
      notice: 'NYC Local Law 144 notice',
    });
  }
  const portalUrl = await portalLink(ctx, candidate.id);
  ctx.mail.push({
    to: email,
    subject: `Your application to ${settings.companyName}`,
    text: `Hello ${name},\n\nThank you for applying for ${job.title}. You can follow your application, and withdraw it, here:\n${portalUrl}`,
    dedupeKey: `applied:${landed.value.id}`,
  });
  return ok({ applicationId: landed.value.id, candidateId: candidate.id, portalUrl });
}

/**
 * An application from a board's own apply (Indeed Apply, REC-132), signed by
 * the board: checked, mapped at its adapter, and landed as any other. The
 * board asked for consent on its form; the record says where. Nothing about
 * the content is refused here (a board stops sending to a site that refuses):
 * the knockout rules and the team decide afterwards.
 */
export async function receiveBoardApplication(
  ctx: Ctx,
  target: PublicationTarget,
  raw: string,
  signature: string,
): Promise<Result<{ applicationId: string }>> {
  const board = ctx.deps.boards?.find((b) => b.target === target);
  if (board?.inbound === undefined) return err(notFound('board'));
  if (!board.inbound.verify(raw, signature))
    return err(failure('UNAUTHENTICATED', 'The signature does not match'));
  const parsed = board.inbound.parse(raw);
  if (!parsed.ok) return parsed;
  const given = parsed.value;
  const job = await ctx.tx.jobs.get(given.jobId);
  const listed = (await ctx.tx.jobs.targets(given.jobId)).some(
    (t) => t.target === target && t.state === 'live',
  );
  if (job === null || job.state !== 'open' || !listed)
    return err(failure('JOB_CLOSED', 'This job is no longer taking applications'));
  const cv = given.files.find((f) => f.field === 'cv');
  const candidate = await candidateFor(
    ctx,
    given.name,
    given.email,
    given.phone,
    cv === undefined ? null : sha256(cv.bytes),
    null,
  );
  const landed = await land(
    ctx,
    job,
    candidate,
    { kind: 'target', target },
    { ...given.answers, name: given.name, email: given.email, boardRef: given.ref },
    'en',
    null,
    given.files,
  );
  if (!landed.ok) return landed;
  const settings = await generalSettings(ctx);
  await ctx.tx.consents.save({
    id: ctx.deps.newId(),
    candidateId: candidate.id,
    purpose: 'application',
    givenAt: ctx.at,
    expiresOn: null,
    withdrawnAt: null,
    notice: `Applied through ${words(target)}: ${settings.companyName} processes this application to consider you for ${job.title}.`,
  });
  return ok({ applicationId: landed.value.id });
}

/** A live job's questionnaire in a board's format, for its apply to ask; NOT_FOUND when it asks none. */
export async function boardQuestions(
  ctx: Ctx,
  target: PublicationTarget,
  jobId: string,
): Promise<Result<unknown>> {
  const board = ctx.deps.boards?.find((b) => b.target === target);
  const live = (await ctx.tx.jobs.targets(jobId)).some(
    (t) => t.target === target && t.state === 'live',
  );
  const form = live ? await ctx.tx.jobs.form(jobId) : null;
  const questionnaire =
    form?.questionnaireId == null ? null : await ctx.tx.questionnaires.get(form.questionnaireId);
  if (board?.questions === undefined || questionnaire === null) return err(notFound('questions'));
  return ok(board.questions(questionnaire));
}

/** A recruiter adds a candidate by hand (source "added by a recruiter", PRD §9.2). */
export async function addCandidate(
  ctx: Ctx,
  jobId: string,
  name: string,
  email: string,
  phone: string | null,
  files: readonly IncomingFile[],
  sourced: boolean,
): Promise<Result<ApplicationRecord>> {
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null) return err(notFound('job'));
  const team = await ctx.tx.jobs.team(jobId);
  if (
    !ctx.viewer.admin &&
    !team.some((t) => t.personId === ctx.viewer.personId && t.role === 'recruiter')
  )
    return err(failure('FORBIDDEN', 'Only a recruiter on this job can add candidates'));
  const cv = files.find((f) => f.field === 'cv');
  const candidate = await candidateFor(
    ctx,
    name,
    email,
    phone,
    cv === undefined ? null : sha256(cv.bytes),
    null,
  );
  const landed = await land(
    ctx,
    job,
    candidate,
    sourced ? { kind: 'sourced' } : { kind: 'recruiter' },
    { name, email },
    'en',
    null,
    files,
  );
  if (landed.ok && sourced) {
    // A sourced person is told within a month, with the opt-out (GDPR art. 14).
    const settings = await generalSettings(ctx);
    ctx.mail.push({
      to: email,
      subject: `${settings.companyName} added you as a possible candidate`,
      text: `Hello ${name},\n\n${settings.companyName} found your public profile and is considering you for ${job.title}. We hold your name, contact details and the profile we found, to contact you about this role. You can see what we hold, or ask us to delete it, here:\n${await portalLink(ctx, candidate.id)}`,
      dedupeKey: `sourced:${candidate.id}`,
    });
  }
  return landed;
}

/**
 * A candidate already known here, put forward for an open job by a recruiter
 * (PRD §13.3): from a talent pool, or from their profile. They enter the
 * job's first stage with no new form, and are told by email, with the ad's
 * address and their own page, so nothing moves without their knowing.
 */
export async function putForward(
  ctx: Ctx,
  jobId: string,
  candidateId: string,
): Promise<Result<ApplicationRecord>> {
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null || job.state !== 'open') return err(failure('JOB_CLOSED', 'Choose an open job'));
  const team = await ctx.tx.jobs.team(jobId);
  if (
    !ctx.viewer.admin &&
    !team.some((t) => t.personId === ctx.viewer.personId && t.role === 'recruiter')
  )
    return err(failure('FORBIDDEN', 'Only a recruiter on this job can put someone forward'));
  const candidate = await ctx.tx.candidates.get(candidateId);
  if (candidate === null || candidate.mergedInto !== null || candidate.anonymisedAt !== null)
    return err(notFound('candidate'));
  const landed = await land(
    ctx,
    job,
    candidate,
    { kind: 'recruiter' },
    { name: candidate.name, email: candidate.email },
    'en',
    null,
    [],
  );
  if (!landed.ok) return landed;
  const settings = await generalSettings(ctx);
  ctx.mail.push({
    to: candidate.email,
    subject: `${settings.companyName} would like to consider you for ${job.title}`,
    text: `Hello ${candidate.name},\n\n${settings.companyName} has put your application forward for a new opening, ${job.title}. The ad is here:\n${ctx.deps.jobsOrigin}/${settings.companySlug}/${job.slug}\n\nYou can follow it, or withdraw, here:\n${await portalLink(ctx, candidate.id)}`,
    dedupeKey: `put-forward:${landed.value.id}`,
  });
  return landed;
}

/** A member refers someone (PRD §9.3): the person completes the application themselves, by their own consent. */
export async function refer(
  ctx: Ctx,
  jobId: string,
  name: string,
  email: string,
  note: string | null,
): Promise<Result<{ referralId: string }>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null || job.state !== 'open' || job.confidential) return err(notFound('job'));
  const id = ctx.deps.newId();
  await ctx.tx.referrals.save({
    id,
    jobId,
    referrerId: person.value,
    candidateName: name,
    candidateEmail: email,
    note,
    applicationId: null,
    createdAt: ctx.at,
  });
  const settings = await generalSettings(ctx);
  const referrer = ctx.member?.displayName ?? 'Someone at the company';
  ctx.mail.push({
    to: email,
    subject: `${referrer} thinks you’d be great for ${job.title}`,
    text: `Hello ${name},\n\n${referrer} referred you for ${job.title} at ${settings.companyName}. If you would like to apply, start here:\n${ctx.deps.jobsOrigin}/${settings.companySlug}/${job.slug}?src=ref-${person.value}\n\nNothing about you is kept unless you apply.`,
    dedupeKey: `referral:${id}`,
  });
  return ok({ referralId: id });
}

/** An agency submits a candidate to a job it was invited to (PRD §9.4). */
export async function submitByAgency(
  ctx: Ctx,
  agencyId: string,
  jobId: string,
  name: string,
  email: string,
  files: readonly IncomingFile[],
): Promise<Result<ApplicationRecord>> {
  const agency = await ctx.tx.agencies.get(agencyId);
  if (agency === null || !agency.active || !agency.jobIds.includes(jobId))
    return err(notFound('job'));
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null || job.state !== 'open') return err(notFound('job'));
  const emailNorm = normalEmail(email);
  const owned = ownership(
    { agencyId, email: emailNorm, submittedOn: ctx.today },
    (await ctx.tx.submissions.forEmail(emailNorm)).map((sub) => ({
      agencyId: sub.agencyId,
      email: sub.emailNorm,
      submittedOn: sub.submittedOn,
    })),
    agency.ownershipMonths,
  );
  if (!owned.accepted)
    return err(failure('ALREADY_SUBMITTED', `This candidate was submitted on ${owned.since}`));
  const cv = files.find((f) => f.field === 'cv');
  const candidate = await candidateFor(
    ctx,
    name,
    email,
    null,
    cv === undefined ? null : sha256(cv.bytes),
    null,
  );
  const landed = await land(
    ctx,
    job,
    candidate,
    { kind: 'agency', agencyId: agencyId as never },
    { name, email },
    'en',
    null,
    files,
  );
  if (!landed.ok) return landed;
  await ctx.tx.submissions.add({
    id: ctx.deps.newId(),
    agencyId,
    jobId,
    emailNorm,
    applicationId: landed.value.id,
    submittedOn: ctx.today,
  });
  return landed;
}

/** A member applies internally (PRD §25): their person id rides on the candidate. */
export async function applyInternally(
  ctx: Ctx,
  jobId: string,
  files: readonly IncomingFile[],
): Promise<Result<ApplicationRecord>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const member = ctx.member;
  if (member === null || member.workEmail === null)
    return err(failure('NO_EMAIL', 'Your record has no work email'));
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null || job.state !== 'open' || job.confidential) return err(notFound('job'));
  const cv = files.find((f) => f.field === 'cv');
  const found = await candidateFor(
    ctx,
    member.displayName,
    member.workEmail,
    null,
    cv === undefined ? null : sha256(cv.bytes),
    person.value,
  );
  const candidate = found.personId === null ? { ...found, personId: person.value } : found;
  if (candidate !== found) await ctx.tx.candidates.save(candidate);
  return land(
    ctx,
    job,
    candidate,
    { kind: 'target', target: 'internal_board' },
    { name: member.displayName, email: member.workEmail },
    'en',
    null,
    files,
  );
}

/** A tenant chosen by its public slug, for the public API. */
export async function tenantOf(deps: Deps, companySlug: string): Promise<TenantId | null> {
  return deps.uow.tenantBySlug(companySlug);
}
