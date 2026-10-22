import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { Instant, LaunchCountry } from '@kithena/contracts';

import { maySeeApplication, may, type JobFacts } from '../domain/access/access.js';
import {
  correct,
  currentStage,
  furthestCategory,
  moveTo,
  reject,
  undo,
  withdraw,
  type MoveNeeds,
} from '../domain/pipeline/application.js';
import { sendAt, type Stage } from '../domain/pipeline/pipeline.js';
import { poolConsent } from '../domain/privacy/retention.js';
import {
  event,
  forbidden,
  jobFacts,
  notFound,
  publish,
  recruiterOnly,
  type Ctx,
} from './context.js';
import type { ApplicationRecord, Candidate, MailParts, Message, Template } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * Moving candidates (PRD §12.2–§12.4, REC-048): one at a time or in bulk,
 * undone within ten seconds or corrected after, rejected with a reason and
 * an email sent at a decent hour, withdrawn by the candidate.
 */

export interface Loaded {
  readonly app: ApplicationRecord;
  readonly facts: JobFacts;
  readonly stages: readonly Stage[];
  readonly candidate: Candidate;
}

/** The application, or NOT_FOUND when it is missing or the viewer may not see it (PRD §25). */
export async function loadApplication(ctx: Ctx, id: string): Promise<Result<Loaded>> {
  const app = await ctx.tx.applications.get(id);
  if (app === null) return err(notFound('application'));
  const job = await ctx.tx.jobs.get(app.jobId);
  const candidate = await ctx.tx.candidates.get(app.candidateId);
  if (job === null || candidate === null) return err(notFound('application'));
  const facts = await jobFacts(ctx, job);
  const stages = await ctx.tx.jobs.stages(app.jobId);
  const interviews = await ctx.tx.interviews.forApplication(id);
  const settings = await generalSettings(ctx);
  const members = await ctx.tx.members.list();
  const seen = maySeeApplication(
    ctx.viewer,
    facts,
    {
      candidatePersonId: candidate.personId,
      reached: furthestCategory(app, stages),
      interviewerIds: interviews.flatMap((i) => i.interviewerIds),
    },
    {
      revealInternalAt: settings.revealInternalAt,
      managerOf: (p) => members.find((m) => m.personId === p)?.managerPersonId ?? null,
    },
  );
  if (!seen) return err(notFound('application'));
  return ok({ app, facts, stages, candidate });
}

/** Fill a template's variables: `{{candidate}}`, `{{job}}`, `{{company}}`, `{{link}}`. */
export function render(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/giu, (whole, key: string) => values[key] ?? whole);
}

/** Queue an email on the candidate's thread; the sender job sends it when due (PRD §12.7). */
export async function queueEmail(
  ctx: Ctx,
  candidate: Candidate,
  applicationId: string | null,
  subject: string,
  body: string,
  when: Instant,
  templateId: string | null,
): Promise<Message> {
  const message: Message = {
    id: ctx.deps.newId(),
    candidateId: candidate.id,
    applicationId,
    direction: 'out',
    subject,
    body,
    fromPerson: ctx.caller.personId,
    templateId,
    sendAt: when,
    sentAt: null,
    readAt: null,
    createdAt: ctx.at,
  };
  await ctx.tx.messages.add(message);
  return message;
}

/**
 * Email the candidate now, not when the sender job next runs: on the thread
 * as a sent message, and out the door the moment the transaction commits.
 * For what a candidate is waiting on: a time to choose, an invitation, a
 * question from the team, an acknowledgement.
 */
export async function sendNow(
  ctx: Ctx,
  candidate: Candidate,
  applicationId: string | null,
  subject: string,
  body: string,
  parts: MailParts = {},
): Promise<Message> {
  const message: Message = {
    id: ctx.deps.newId(),
    candidateId: candidate.id,
    applicationId,
    direction: 'out',
    subject,
    body,
    fromPerson: ctx.caller.personId,
    templateId: null,
    sendAt: ctx.at,
    sentAt: ctx.at,
    readAt: null,
    createdAt: ctx.at,
  };
  await ctx.tx.messages.add(message);
  // In the company's colours, with its name and mark, as its careers page shows them.
  const settings = await generalSettings(ctx);
  ctx.mail.push({
    to: candidate.email,
    subject,
    text: body,
    dedupeKey: `message:${message.id}`,
    companyName: settings.companyName,
    parts: { themeId: settings.themeId, logoUrl: settings.logoUrl, ...parts },
  });
  return message;
}

async function runAutomations(ctx: Ctx, loaded: Loaded, stage: Stage): Promise<void> {
  const settings = await generalSettings(ctx);
  const job = await ctx.tx.jobs.get(loaded.app.jobId);
  for (const automation of stage.automations) {
    if (automation.kind !== 'email') continue;
    const template = await ctx.tx.templates.get(automation.templateId);
    if (template === null) continue;
    const due = new Date(Date.parse(ctx.at) + automation.delayMinutes * 60_000);
    const when = sendAt(due, loaded.candidate.timeZone ?? 'UTC').toISOString() as Instant;
    const values = {
      candidate: loaded.candidate.name,
      job: job?.title ?? '',
      company: settings.companyName,
    };
    await queueEmail(
      ctx,
      loaded.candidate,
      loaded.app.id,
      render(template.subject ?? '', values),
      render(template.body, values),
      when,
      template.id,
    );
  }
}

export async function moveApplication(
  ctx: Ctx,
  applicationId: string,
  to: string,
  needs: MoveNeeds = {},
): Promise<Result<{ moveId: string; opensOffer: boolean }>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'pipeline.move')) return err(forbidden());
  const council = await worksCouncilCleared(ctx, loaded.value);
  const moved = moveTo(
    loaded.value.app,
    loaded.value.stages,
    to,
    ctx.caller.personId ?? ctx.caller.accountId,
    ctx.at,
    ctx.deps.newId(),
    { ...needs, worksCouncilCleared: council },
  );
  if (!moved.ok) return moved;
  const app: ApplicationRecord = { ...loaded.value.app, history: moved.value.application.history };
  await ctx.tx.applications.save(app, moved.value.category, [moved.value.move], ctx.today);
  await publish(
    ctx,
    moveEvent(ctx, app, moved.value.move.from ?? to, to, moved.value.category, null),
  );
  const stage = loaded.value.stages.find((s) => s.id === to);
  if (stage !== undefined) await runAutomations(ctx, { ...loaded.value, app }, stage);
  return ok({ moveId: moved.value.move.id, opensOffer: moved.value.opensOffer });
}

function moveEvent(
  ctx: Ctx,
  app: ApplicationRecord,
  from: string,
  to: string,
  category: string,
  supersedes: string | null,
) {
  return event(
    ctx,
    'recruiting.application.moved',
    { type: 'Application', id: app.id },
    {
      applicationId: app.id,
      jobId: app.jobId,
      from,
      to,
      category,
      by: ctx.caller.personId ?? ctx.caller.accountId,
      supersedes,
    },
  );
}

/** For a German job with a works council: consent recorded, or deemed after a week (PRD §19.9). */
export async function worksCouncilCleared(ctx: Ctx, loaded: Loaded): Promise<boolean> {
  if (!loaded.stages.some((s) => s.category === 'works_council')) return true;
  const held = (await ctx.tx.settings.get(`works_council:${loaded.app.id}`)) as {
    state: string;
    presentedAt: string;
  } | null;
  if (held === null) return false;
  if (held.state === 'consented') return true;
  if (held.state === 'refused') return false;
  return Date.parse(ctx.at) - Date.parse(held.presentedAt) >= 7 * 86_400_000;
}

export async function undoMove(
  ctx: Ctx,
  applicationId: string,
  moveId: string,
): Promise<Result<true>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'pipeline.move')) return err(forbidden());
  const undone = undo(
    loaded.value.app,
    moveId,
    ctx.caller.personId ?? ctx.caller.accountId,
    ctx.at,
    ctx.deps.newId(),
  );
  if (!undone.ok) return undone;
  const category =
    loaded.value.stages.find((s) => s.id === undone.value.move.to)?.category ?? 'applied';
  const app = { ...loaded.value.app, history: undone.value.application.history };
  await ctx.tx.applications.save(app, category, [undone.value.move], ctx.today);
  await publish(
    ctx,
    moveEvent(ctx, app, undone.value.move.from ?? '', undone.value.move.to, category, moveId),
  );
  return ok(true);
}

export async function correctMove(
  ctx: Ctx,
  applicationId: string,
  moveId: string,
  to: string,
  reason: string,
): Promise<Result<true>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'pipeline.move')) return err(forbidden());
  const corrected = correct(
    loaded.value.app,
    loaded.value.stages,
    moveId,
    to,
    reason,
    ctx.caller.personId ?? ctx.caller.accountId,
    ctx.at,
    ctx.deps.newId(),
  );
  if (!corrected.ok) return corrected;
  const category = loaded.value.stages.find((s) => s.id === to)?.category ?? 'applied';
  const app = { ...loaded.value.app, history: corrected.value.application.history };
  await ctx.tx.applications.save(app, category, [corrected.value.move], ctx.today);
  await publish(ctx, moveEvent(ctx, app, corrected.value.move.from ?? '', to, category, moveId));
  return ok(true);
}

export interface Rejecting {
  readonly reasonKey: string;
  readonly templateId: string | null;
  /** Now, or at the end of the candidate's working day (PRD §12.4). */
  readonly send: 'now' | 'later_today' | 'none';
  readonly poolId: string | null;
}

export async function rejectApplication(
  ctx: Ctx,
  applicationId: string,
  how: Rejecting,
  /** Recruiting itself, on a knockout the company set to reject on its own: no person to check. */
  bySystem = false,
): Promise<Result<true>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!bySystem && !may(ctx.viewer, loaded.value.facts, 'pipeline.move')) return err(forbidden());
  const settings = await generalSettings(ctx);
  if (!settings.rejectionReasons.includes(how.reasonKey))
    return err(failure('REASON', 'Choose one of the company’s rejection reasons'));
  const rejected = reject(
    loaded.value.app,
    how.reasonKey,
    ctx.caller.personId ?? ctx.caller.accountId,
    ctx.at,
  );
  if (!rejected.ok) return rejected;
  const category =
    loaded.value.stages.find((s) => s.id === currentStage(rejected.value))?.category ?? 'applied';
  await ctx.tx.applications.save(
    { ...loaded.value.app, ...rejected.value },
    category,
    [],
    ctx.today,
  );
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.application.rejected',
      { type: 'Application', id: applicationId },
      {
        applicationId,
        jobId: loaded.value.app.jobId,
        reasonKey: how.reasonKey,
        by: ctx.caller.personId ?? ctx.caller.accountId,
      },
    ),
  );
  if (how.send !== 'none' && how.templateId !== null) {
    const template = await ctx.tx.templates.get(how.templateId);
    if (template === null) return err(notFound('template'));
    const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
    const zone = loaded.value.candidate.timeZone ?? 'UTC';
    const later = new Date(Date.parse(ctx.at) + 4 * 3_600_000);
    const when = (
      how.send === 'now' ? new Date(ctx.at) : sendAt(later, zone)
    ).toISOString() as Instant;
    // The email never states a reason (PRD §12.4): the template has no reason variable.
    const values = {
      candidate: loaded.value.candidate.name,
      job: job?.title ?? '',
      company: settings.companyName,
    };
    await queueEmail(
      ctx,
      loaded.value.candidate,
      applicationId,
      render(template.subject ?? '', values),
      render(template.body, values),
      when,
      template.id,
    );
  }
  if (how.poolId !== null)
    await addToPool(ctx, how.poolId, loaded.value.candidate.id, 'Rejected; kept for later roles');
  return ok(true);
}

export interface BulkResult {
  readonly done: readonly string[];
  readonly failed: readonly { readonly applicationId: string; readonly message: string }[];
}

/** A bulk action (PRD §12.2): each application on its own; one failure never stops the rest. */
export async function bulk(
  ctx: Ctx,
  ids: readonly string[],
  action: (id: string) => Promise<Result<unknown>>,
): Promise<BulkResult> {
  const done: string[] = [];
  const failed: { applicationId: string; message: string }[] = [];
  for (const id of ids) {
    const result = await action(id);
    if (result.ok) done.push(id);
    else failed.push({ applicationId: id, message: result.error.message });
  }
  return { done, failed };
}

/** The candidate withdraws, from their page (PRD §10.5). */
export async function withdrawApplication(
  ctx: Ctx,
  candidateId: string,
  applicationId: string,
): Promise<Result<true>> {
  const app = await ctx.tx.applications.get(applicationId);
  if (app?.candidateId !== candidateId) return err(notFound('application'));
  const withdrawn = withdraw(app, ctx.at);
  if (!withdrawn.ok) return withdrawn;
  await ctx.tx.applications.save({ ...app, ...withdrawn.value }, 'applied', [], ctx.today);
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.application.withdrawn',
      { type: 'Application', id: applicationId },
      { applicationId, jobId: app.jobId },
    ),
  );
  return ok(true);
}

/* --------------------------------------------------------------- pools -- */

/**
 * Add a candidate to a pool (PRD §13). Without a pool consent the candidate
 * is asked by email first and joins when they agree; nobody stays without a
 * lawful basis.
 */
export async function addToPool(
  ctx: Ctx,
  poolId: string,
  candidateId: string,
  reason: string,
): Promise<Result<'added' | 'asked'>> {
  const allowed = await recruiterOnly(ctx);
  if (!allowed.ok) return allowed;
  const pool = await ctx.tx.pools.get(poolId);
  const candidate = await ctx.tx.candidates.get(candidateId);
  if (pool === null || candidate === null) return err(notFound('pool'));
  const consents = await ctx.tx.consents.of(candidateId);
  const live = consents.some(
    (c) =>
      c.purpose === 'talent_pool' &&
      c.withdrawnAt === null &&
      (c.expiresOn === null || c.expiresOn >= ctx.today),
  );
  if (live) {
    await ctx.tx.pools.add({
      poolId,
      candidateId,
      reason,
      addedBy: ctx.caller.personId,
      addedAt: ctx.at,
    });
    return ok('added');
  }
  await ctx.tx.settings.set(`pool_ask:${candidateId}:${poolId}`, { reason, askedAt: ctx.at });
  const settings = await generalSettings(ctx);
  const { portalLink } = await import('./intake.js');
  ctx.mail.push({
    to: candidate.email,
    subject: `May ${settings.companyName} keep your details for future roles?`,
    text: `Hello ${candidate.name},\n\n${settings.companyName} would like to keep your application on file and contact you about future roles. You can agree, or say no, on your page:\n${await portalLink(ctx, candidateId)}`,
    dedupeKey: `pool-ask:${candidateId}:${poolId}`,
  });
  return ok('asked');
}

/** The candidate agrees on their page: consent recorded, then every pool that asked. */
export async function agreeToPool(ctx: Ctx, candidateId: string): Promise<Result<true>> {
  const candidate = await ctx.tx.candidates.get(candidateId);
  if (candidate === null) return err(notFound('candidate'));
  const apps = await ctx.tx.applications.forCandidate(candidateId);
  const countries = new Set<LaunchCountry>();
  for (const app of apps)
    for (const c of (await ctx.tx.jobs.get(app.jobId))?.countries ?? []) countries.add(c);
  const { expiresOn } = poolConsent(ctx.today, [...countries]);
  await ctx.tx.consents.save({
    id: ctx.deps.newId(),
    candidateId,
    purpose: 'talent_pool',
    givenAt: ctx.at,
    expiresOn,
    withdrawnAt: null,
    notice: 'Keep me in the talent pool for other jobs.',
  });
  for (const pool of await ctx.tx.pools.list()) {
    const asked = (await ctx.tx.settings.get(`pool_ask:${candidateId}:${pool.id}`)) as {
      reason: string;
    } | null;
    if (asked !== null) {
      await ctx.tx.pools.add({
        poolId: pool.id,
        candidateId,
        reason: asked.reason,
        addedBy: null,
        addedAt: ctx.at,
      });
      await ctx.tx.settings.set(`pool_ask:${candidateId}:${pool.id}`, null);
    }
  }
  return ok(true);
}

export async function withdrawPoolConsent(ctx: Ctx, candidateId: string): Promise<Result<true>> {
  for (const consent of await ctx.tx.consents.of(candidateId)) {
    if (consent.purpose === 'talent_pool' && consent.withdrawnAt === null)
      await ctx.tx.consents.save({ ...consent, withdrawnAt: ctx.at });
  }
  for (const member of await ctx.tx.pools.of(candidateId))
    await ctx.tx.pools.remove(member.poolId, candidateId);
  return ok(true);
}

/* ------------------------------------------------------------ messages -- */

export async function sendMessage(
  ctx: Ctx,
  applicationId: string,
  subject: string,
  body: string,
  templateId: string | null,
): Promise<Result<Message>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.message')) return err(forbidden());
  if (subject.trim() === '' || body.trim() === '')
    return err(failure('EMPTY', 'A message has a subject and a body'));
  return ok(
    await queueEmail(ctx, loaded.value.candidate, applicationId, subject, body, ctx.at, templateId),
  );
}

export const templateFor = async (
  ctx: Ctx,
  purpose: string,
  language: string,
): Promise<Template | null> => {
  const all = await ctx.tx.templates.list();
  return (
    all.find((t) => t.purpose === purpose && t.language === language) ??
    all.find((t) => t.purpose === purpose) ??
    null
  );
};
