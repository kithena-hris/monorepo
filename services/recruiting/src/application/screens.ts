import { err, ok, type Result } from '@kithena/domain-kit';
import type { InboxItem, Instant } from '@kithena/contracts';
import { RECRUITING_INBOX_KINDS } from '@kithena/contracts';

import { jobPermissions, may, maySeeOffer } from '../domain/access/access.js';
import { currentStage, daysInStage, furthestCategory } from '../domain/pipeline/application.js';
import { latest, versionHash } from '../domain/offer/offer.js';
import { packFor } from '../domain/terms/packs.js';
import { composerSteps, type TermsAnswers } from '../domain/terms/pack.js';
import { TERMS_STEPS } from '@kithena/contracts';
import { approvalState } from '../domain/requisition/requisition.js';
import { visibleScorecards } from '../domain/interview/interview.js';
import { referralOutcome } from '../domain/referral/referral.js';
import { jobFacts, notFound, recruiterOnly, type Ctx } from './context.js';
import { internalBoard, myJobs } from './jobs.js';
import { latestMatch, latestMatrix } from './matrix.js';
import { loadApplication } from './moves.js';
import { checkOffer } from './offers.js';
import { generalSettings } from './setup.js';
import { jobChannel } from './chat.js';
import type { ApplicationRecord, JobRecord } from './ports.js';

/**
 * One read model per screen (PRD §29.2, REC-060): what the shell renders,
 * computed here, for every transport. Each filters by what the viewer may
 * see, in the application layer (repo rule).
 */

const sourceLabel = (app: ApplicationRecord): string =>
  app.source.kind === 'target'
    ? app.source.target
    : app.source.kind === 'share_link'
      ? `link:${app.source.channel}`
      : app.source.kind;

async function nameOf(ctx: Ctx, personId: string | null): Promise<string | null> {
  if (personId === null) return null;
  return (await ctx.tx.members.get(personId as never))?.displayName ?? null;
}

async function counts(ctx: Ctx, job: JobRecord) {
  const apps = await ctx.tx.applications.forJob(job.id);
  const stages = await ctx.tx.jobs.stages(job.id);
  const active = apps.filter((a) => a.outcome === 'active');
  return {
    total: apps.length,
    active: active.length,
    newThisWeek: apps.filter((a) => Date.parse(ctx.at) - Date.parse(a.createdAt) < 7 * 86_400_000)
      .length,
    byStage: stages.map((s) => ({
      stageId: s.id,
      name: s.name,
      category: s.category,
      count: active.filter((a) => currentStage(a) === s.id).length,
    })),
  };
}

/** R1: my tasks and my jobs. */
export async function home(ctx: Ctx): Promise<unknown> {
  const person = ctx.viewer.personId ?? '';
  const approvals = await ctx.tx.approvals.waitingOn(person);
  const owed = await ctx.tx.interviews.owedBy(person);
  const dayEnd = new Date(Date.parse(ctx.at) + 86_400_000).toISOString() as Instant;
  const today = (await ctx.tx.interviews.forInterviewer(person, ctx.at, dayEnd)).filter(
    (i) => i.state === 'scheduled',
  );
  const jobs = await myJobs(ctx);
  const settings = await generalSettings(ctx);
  const tasks = [
    ...(await Promise.all(
      approvals.map(async (a) => {
        const subject =
          a.subject.kind === 'requisition'
            ? ((await ctx.tx.requisitions.get(a.subject.id))?.title ?? 'A requisition')
            : (await ctx.tx.offers.get(a.subject.id)) === null
              ? 'An offer'
              : 'An offer';
        return {
          kind: `approve_${a.subject.kind}`,
          id: a.subject.id,
          title: `Approve: ${subject}`,
          due: null as string | null,
        };
      }),
    )),
    ...owed.map((i) => ({
      kind: 'scorecard',
      id: i.id,
      title: `Scorecard: ${i.title}`,
      due: new Date(Date.parse(i.startsAt) + (i.minutes + 24 * 60) * 60_000).toISOString(),
    })),
    ...today.map((i) => ({
      kind: 'interview',
      id: i.id,
      title: i.title,
      due: i.startsAt,
    })),
  ];
  return {
    viewer: {
      personId: ctx.viewer.personId,
      admin: ctx.viewer.admin,
      name: ctx.member?.displayName ?? null,
    },
    company: settings.companyName,
    requisitionsOn: settings.requisitionsOn,
    tasks,
    jobs: await Promise.all(
      jobs
        .filter((j) => j.state !== 'closed')
        .map(async (j) => ({
          id: j.id,
          title: j.title,
          state: j.state,
          department: j.department,
          openings: j.openings,
          hired: j.hired,
          counts: await counts(ctx, j),
        })),
    ),
  };
}

/** R2: requisitions, with where each approval stands. */
export async function requisitionsScreen(ctx: Ctx): Promise<unknown> {
  const { listRequisitions } = await import('./requisitions.js');
  const all = await listRequisitions(ctx);
  return Promise.all(
    all.map(async (r) => {
      const approval = await ctx.tx.approvals.open('requisition', r.id);
      const state = approval === null ? null : approvalState(approval.steps, approval.decisions);
      return {
        ...r,
        hiringManager: await nameOf(ctx, r.hiringManagerId),
        approval:
          approval === null
            ? null
            : {
                step: (state?.step ?? 0) + 1,
                steps: approval.steps.length,
                waitingOn: await Promise.all((state?.waitingOn ?? []).map((p) => nameOf(ctx, p))),
                changes: approval.changes,
                mine: (state?.waitingOn ?? []).includes(ctx.viewer.personId ?? ''),
              },
      };
    }),
  );
}

/** R4–R7, R14: a job's setup in one answer. */
export async function jobScreen(ctx: Ctx, jobId: string): Promise<Result<unknown>> {
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null) return err(notFound('job'));
  const facts = await jobFacts(ctx, job);
  const permissions = jobPermissions(ctx.viewer, facts);
  if (!permissions.has('job.view')) return err(notFound('job'));
  const team = await Promise.all(
    facts.team.map(async (t) => ({ ...t, name: await nameOf(ctx, t.personId) })),
  );
  return ok({
    job,
    may: [...permissions],
    team,
    stages: await ctx.tx.jobs.stages(jobId),
    form: await ctx.tx.jobs.form(jobId),
    ads: await ctx.tx.jobs.ads(jobId),
    targets: await ctx.tx.jobs.targets(jobId),
    // Boards with an adapter configured here (Indeed once its agreement is signed).
    boards: (ctx.deps.boards ?? []).map((b) => b.target),
    // REC-137: where new applicants are posted, when the chat app is set up here.
    chat: ctx.deps.chat === undefined ? null : { channel: await jobChannel(ctx, jobId) },
    criteria: await ctx.tx.jobs.criteria(jobId),
    plan: await ctx.tx.jobs.plan(jobId),
    counts: await counts(ctx, job),
    locations: await ctx.tx.locations.list(),
    entities: await ctx.tx.entities.list(),
    // The departments a job is in: People's where present, Recruiting's own otherwise.
    orgUnits: await ctx.tx.orgUnits.list(),
    questionnaires: (await ctx.tx.questionnaires.list()).map((q) => ({
      id: q.id,
      name: q.name,
      version: q.version,
    })),
    scorecards: (await ctx.tx.scorecardTemplates.list()).map((s) => ({ id: s.id, name: s.name })),
    benefits: (await ctx.tx.benefits.list()).filter((b) => b.legalEntityId === job.entityId),
    members: (await ctx.tx.members.list()).map((m) => ({
      personId: m.personId,
      name: m.displayName,
    })),
  });
}

/** R10: the pipeline, board or table, filtered in the URL. */
export async function pipelineScreen(
  ctx: Ctx,
  jobId: string,
  filters: {
    readonly q?: string | undefined;
    readonly stage?: string | undefined;
    readonly source?: string | undefined;
    readonly sort?: string | undefined;
  },
): Promise<Result<unknown>> {
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null) return err(notFound('job'));
  const facts = await jobFacts(ctx, job);
  // The band beside the stage, never instead of it (§22.5), for those who may read the profile.
  const matrixOn = may(ctx.viewer, facts, 'candidate.profile');
  if (!may(ctx.viewer, facts, 'pipeline.view')) return err(notFound('job'));
  const stages = await ctx.tx.jobs.stages(jobId);
  const apps = await ctx.tx.applications.forJob(jobId);
  const cards = [];
  for (const app of apps) {
    const candidate = await ctx.tx.candidates.get(app.candidateId);
    if (candidate === null) continue;
    if (
      filters.q !== undefined &&
      filters.q !== '' &&
      !candidate.name.toLowerCase().includes(filters.q.toLowerCase())
    )
      continue;
    if (
      filters.source !== undefined &&
      filters.source !== '' &&
      sourceLabel(app) !== filters.source
    )
      continue;
    const stageId = currentStage(app);
    if (filters.stage !== undefined && filters.stage !== '' && stageId !== filters.stage) continue;
    const interviews = await ctx.tx.interviews.forApplication(app.id);
    const next = interviews
      .filter((i) => i.state === 'scheduled' && i.startsAt > ctx.at)
      .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    const unread = (await ctx.tx.messages.thread(candidate.id)).filter(
      (m) => m.direction === 'in' && m.readAt === null,
    ).length;
    cards.push({
      applicationId: app.id,
      candidateId: candidate.id,
      name: candidate.name,
      stageId,
      outcome: app.outcome,
      daysInStage: daysInStage(app, ctx.at),
      flagged: app.flagged,
      duplicate: candidate.tags.includes('possible_duplicate'),
      source: sourceLabel(app),
      appliedAt: app.createdAt,
      score: app.score,
      match: matrixOn ? await latestMatch(ctx, app.id) : null,
      unread,
      nextInterview: next === undefined ? null : { title: next.title, startsAt: next.startsAt },
      lastMoveId: app.history.at(-1)?.id ?? null,
    });
  }
  // Newest first by default (PRD §22.5); a choice otherwise.
  const sorted = cards.toSorted((a, b) =>
    filters.sort === 'name'
      ? a.name.localeCompare(b.name)
      : filters.sort === 'days'
        ? b.daysInStage - a.daysInStage
        : filters.sort === 'match'
          ? (b.match?.scoreBp ?? -1) - (a.match?.scoreBp ?? -1)
          : b.appliedAt.localeCompare(a.appliedAt),
  );
  const settings = await generalSettings(ctx);
  return ok({
    job: { id: job.id, title: job.title, state: job.state },
    stages,
    cards: sorted,
    may: [...jobPermissions(ctx.viewer, facts)],
    rejectionReasons: settings.rejectionReasons,
    templates: (await ctx.tx.templates.list())
      .filter((t) => t.kind === 'email')
      .map((t) => ({ id: t.id, name: t.name, purpose: t.purpose })),
    pools: await ctx.tx.pools.list(),
  });
}

/** R26: every candidate the viewer may see, searchable without any AI key (PRD §14.1). */
export async function candidatesScreen(
  ctx: Ctx,
  q: string | undefined,
  tag: string | undefined,
): Promise<unknown> {
  const jobs = new Set((await myJobs(ctx)).map((j) => j.id));
  const found = await ctx.tx.candidates.search({
    ...(q === undefined ? {} : { text: q }),
    ...(tag === undefined ? {} : { tag }),
    limit: 200,
  });
  const rows = [];
  for (const c of found) {
    const apps = (await ctx.tx.applications.forCandidate(c.id)).filter(
      (a) => ctx.viewer.admin || jobs.has(a.jobId),
    );
    if (apps.length === 0 && !ctx.viewer.admin) continue;
    const latestApp = apps[0];
    const job = latestApp === undefined ? null : await ctx.tx.jobs.get(latestApp.jobId);
    rows.push({
      candidateId: c.id,
      name: c.name,
      email: c.email,
      tags: c.tags,
      applications: apps.length,
      latest:
        latestApp === undefined || job === null
          ? null
          : { applicationId: latestApp.id, job: job.title, outcome: latestApp.outcome },
      createdAt: c.createdAt,
    });
  }
  return { rows, q: q ?? '', tag: tag ?? '' };
}

/** R11, R12: a candidate across applications, each tab as the viewer may see it. */
export async function candidateScreen(ctx: Ctx, candidateId: string): Promise<Result<unknown>> {
  const candidate = await ctx.tx.candidates.get(candidateId);
  if (candidate === null) return err(notFound('candidate'));
  const applications = [];
  for (const app of await ctx.tx.applications.forCandidate(candidateId)) {
    const loaded = await loadApplication(ctx, app.id);
    if (!loaded.ok) continue;
    const { facts, stages } = loaded.value;
    const job = await ctx.tx.jobs.get(app.jobId);
    const interviews = await ctx.tx.interviews.forApplication(app.id);
    const cards = await ctx.tx.interviews.forApplicationScorecards(app.id);
    const team = may(ctx.viewer, facts, 'scorecards.all');
    const approvers = (await ctx.tx.approvals.waitingOn(ctx.viewer.personId ?? '')).map(
      (a) => a.subject.id,
    );
    const offers = maySeeOffer(ctx.viewer, facts, [])
      ? await ctx.tx.offers.forApplication(app.id)
      : (await ctx.tx.offers.forApplication(app.id)).filter((o) => approvers.includes(o.id));
    applications.push({
      applicationId: app.id,
      job: { id: app.jobId, title: job?.title ?? '' },
      stageId: currentStage(app),
      stages,
      reached: furthestCategory(app, stages),
      outcome: app.outcome,
      rejection: app.rejection,
      source: sourceLabel(app),
      flagged: app.flagged,
      answers: may(ctx.viewer, facts, 'candidate.profile') ? app.answers : {},
      adjustments: may(ctx.viewer, facts, 'candidate.profile') ? app.adjustments : null,
      history: app.history,
      interviews,
      scorecards: team
        ? cards.filter((c) => c.submittedAt !== null)
        : visibleScorecards(cards, { kind: 'interviewer', personId: ctx.viewer.personId ?? '' }),
      offers: offers.map((o) => ({
        id: o.id,
        state: o.state,
        version: latest(o).version,
        startDate: latest(o).startDate,
        baseMinor: latest(o).pay.baseMinor,
        currency: latest(o).pay.currency,
      })),
      prehire: await ctx.tx.prehires.get(app.id),
      // The hiring team reads the answers; the token's hash never leaves Recruiting.
      matrix: may(ctx.viewer, facts, 'candidate.profile') ? await latestMatrix(ctx, app.id) : null,
      references: team
        ? (await ctx.tx.references.forApplication(app.id)).map(({ tokenHash: _hash, ...r }) => r)
        : [],
      may: [...jobPermissions(ctx.viewer, facts)],
    });
  }
  if (applications.length === 0 && !ctx.viewer.admin) return err(notFound('candidate'));
  const profile = applications.some((a) => a.may.includes('candidate.profile')) || ctx.viewer.admin;
  // Notes stay hidden from an interviewer until their scorecard is in (PRD §12.5, §16.6).
  const notes = profile ? await ctx.tx.notes.of(candidateId) : [];
  return ok({
    candidate: profile ? candidate : { id: candidate.id, name: candidate.name },
    files: (await ctx.tx.files.of(candidateId)).map(({ blobKey: _key, ...f }) => f),
    notes,
    messages: profile ? await ctx.tx.messages.thread(candidateId) : [],
    consents: profile ? await ctx.tx.consents.of(candidateId) : [],
    pools: profile ? await ctx.tx.pools.of(candidateId) : [],
    applications,
  });
}

/** R13: pools and their members. */
export async function poolsScreen(ctx: Ctx, poolId: string | undefined): Promise<Result<unknown>> {
  const allowed = await recruiterOnly(ctx);
  if (!allowed.ok) return allowed;
  const pools = await Promise.all(
    (await ctx.tx.pools.list()).map(async (p) => ({
      ...p,
      count: (await ctx.tx.pools.members(p.id)).length,
    })),
  );
  if (poolId === undefined) return ok({ pools, pool: null });
  const members = await Promise.all(
    (await ctx.tx.pools.members(poolId)).map(async (m) => {
      const c = await ctx.tx.candidates.get(m.candidateId);
      const consent =
        (await ctx.tx.consents.of(m.candidateId))
          .filter((x) => x.purpose === 'talent_pool' && x.withdrawnAt === null)
          .map((x) => x.expiresOn)
          .toSorted()
          .at(-1) ?? null;
      return { ...m, name: c?.name ?? '', email: c?.email ?? '', consentUntil: consent };
    }),
  );
  return ok({ pools, pool: { ...(await ctx.tx.pools.get(poolId)), members } });
}

/** RM1 and the interviews tab: mine coming up and scorecards I owe. */
export async function interviewsScreen(ctx: Ctx): Promise<unknown> {
  const person = ctx.viewer.personId ?? '';
  const until = new Date(Date.parse(ctx.at) + 30 * 86_400_000).toISOString() as Instant;
  const upcoming = (await ctx.tx.interviews.forInterviewer(person, ctx.at, until)).filter(
    (i) => i.state === 'scheduled',
  );
  const owed = await ctx.tx.interviews.owedBy(person);
  const withCandidate = async (i: (typeof upcoming)[number]) => {
    const app = await ctx.tx.applications.get(i.applicationId);
    const c = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
    const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
    return { ...i, candidate: c?.name ?? '', candidateId: c?.id ?? null, job: job?.title ?? '' };
  };
  return {
    upcoming: await Promise.all(upcoming.map(withCandidate)),
    owed: await Promise.all(owed.map(withCandidate)),
  };
}

/** R19, R20, R21: an offer with its checks, the composer's steps, rewards and approval. */
export async function offerScreen(ctx: Ctx, offerId: string): Promise<Result<unknown>> {
  const offer = await ctx.tx.offers.get(offerId);
  if (offer === null) return err(notFound('offer'));
  const loaded = await loadApplication(ctx, offer.applicationId);
  const approval = await ctx.tx.approvals.open('offer', offerId);
  const approver =
    approval !== null && approval.steps.some((s) => s.includes(ctx.viewer.personId ?? ''));
  if (!loaded.ok && !approver) return err(notFound('offer'));
  const app = await ctx.tx.applications.get(offer.applicationId);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  if (app === null || job === null) return err(notFound('offer'));
  if (loaded.ok && !maySeeOffer(ctx.viewer, loaded.value.facts, approval?.steps.flat() ?? []))
    return err(notFound('offer'));
  const meta = ((await ctx.tx.settings.get(`offer_meta:${offerId}`)) as {
    grade: string | null;
    outsideBandReason: string | null;
  } | null) ?? { grade: null, outsideBandReason: null };
  const version = latest(offer);
  const checked = await checkOffer(ctx, app, job, { ...version, ...meta });
  const entity = job.entityId === null ? null : await ctx.tx.entities.get(job.entityId);
  const pack = entity === null ? null : packFor(entity.country);
  const answers: TermsAnswers = { ...version.terms, contractStart: version.startDate };
  const candidate = await ctx.tx.candidates.get(app.candidateId);
  return ok({
    offer,
    hash: versionHash(version),
    candidate: {
      id: candidate?.id ?? '',
      name: candidate?.name ?? '',
      email: candidate?.email ?? '',
    },
    /** Who signs for the company when the shell sends the contract (PRD §21.2): the reader, as a member. */
    signatoryPersonId: ctx.viewer.personId,
    job: { id: job.id, title: job.title },
    meta,
    checked: checked.ok ? checked.value : null,
    composer:
      pack === null || entity === null
        ? null
        : {
            country: pack.country,
            version: pack.version,
            reviewed: pack.reviewed,
            steps: composerSteps(
              pack,
              answers,
              {
                legalEntityId: entity.id,
                country: entity.country,
                currency: entity.currency,
                fullTimeWeeklyMinutes: entity.fullTimeWeeklyMinutes,
                headcount: entity.headcount,
                foundedOn: entity.foundedOn,
                hasWorksCouncil: entity.worksCouncil,
              },
              ctx.today,
            ),
            order: TERMS_STEPS,
            regions: pack.regions,
            relationships: pack.relationships(),
            contractTypes: pack.contractTypes(answers, {
              legalEntityId: entity.id,
              country: entity.country,
              currency: entity.currency,
              fullTimeWeeklyMinutes: entity.fullTimeWeeklyMinutes,
              headcount: entity.headcount,
              foundedOn: entity.foundedOn,
              hasWorksCouncil: entity.worksCouncil,
            }),
            reasons: pack.fixedTermReasons(answers),
            rules: pack.rules(answers, {
              legalEntityId: entity.id,
              country: entity.country,
              currency: entity.currency,
              fullTimeWeeklyMinutes: entity.fullTimeWeeklyMinutes,
              headcount: entity.headcount,
              foundedOn: entity.foundedOn,
              hasWorksCouncil: entity.worksCouncil,
            }),
            asksPreviousEmployment: pack.asksPreviousEmployment(answers),
            paymentsPerYear: pack.paymentsPerYear(answers),
          },
    approval:
      approval === null
        ? null
        : {
            ...approval,
            state: approvalState(approval.steps, approval.decisions),
            mine: approvalState(approval.steps, approval.decisions).waitingOn.includes(
              ctx.viewer.personId ?? '',
            ),
          },
    contract: await ctx.tx.contracts.forOffer(offerId),
    prehire: await ctx.tx.prehires.get(app.id),
    benefits: (await ctx.tx.benefits.list()).filter((b) => b.legalEntityId === job.entityId),
    bands: await ctx.tx.payBands.list(),
  });
}

/** The offers list: drafts, awaiting approval, out, accepted. */
export async function offersScreen(ctx: Ctx): Promise<unknown> {
  const jobs = new Map((await myJobs(ctx)).map((j) => [j.id, j]));
  const approvals = new Set(
    (await ctx.tx.approvals.waitingOn(ctx.viewer.personId ?? ''))
      .filter((a) => a.subject.kind === 'offer')
      .map((a) => a.subject.id),
  );
  const rows = [];
  for (const offer of await ctx.tx.offers.list()) {
    const app = await ctx.tx.applications.get(offer.applicationId);
    if (app === null) continue;
    const job = jobs.get(app.jobId);
    if (job === undefined && !approvals.has(offer.id)) continue;
    if (
      job !== undefined &&
      !maySeeOffer(ctx.viewer, await jobFacts(ctx, job), []) &&
      !approvals.has(offer.id)
    )
      continue;
    const candidate = await ctx.tx.candidates.get(app.candidateId);
    const v = latest(offer);
    rows.push({
      id: offer.id,
      state: offer.state,
      candidate: candidate?.name ?? '',
      job: job?.title ?? '',
      startDate: v.startDate,
      expiresOn: v.expiresOn,
      baseMinor: v.pay.baseMinor,
      currency: v.pay.currency,
      needsMe: approvals.has(offer.id),
    });
  }
  return { rows };
}

/** R8: the internal board, and my referrals with whether each was hired. */
export async function boardScreen(ctx: Ctx): Promise<unknown> {
  const jobs = await internalBoard(ctx);
  const mine =
    ctx.viewer.personId === null ? [] : await ctx.tx.referrals.byReferrer(ctx.viewer.personId);
  const referrals = await Promise.all(
    mine.map(async (r) => {
      const app = r.applicationId === null ? null : await ctx.tx.applications.get(r.applicationId);
      const job = await ctx.tx.jobs.get(r.jobId);
      return {
        id: r.id,
        name: r.candidateName,
        job: job?.title ?? '',
        at: r.createdAt,
        outcome: app === null ? 'invited' : referralOutcome(app.outcome),
      };
    }),
  );
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      department: j.department,
      workMode: j.workMode,
      slug: j.slug,
    })),
    referrals,
    bonus: (await generalSettings(ctx)).referralBonus,
  };
}

/** S1–S8 in one answer. */
export async function settingsScreen(ctx: Ctx): Promise<unknown> {
  return {
    general: await generalSettings(ctx),
    entities: await ctx.tx.entities.list(),
    locations: await ctx.tx.locations.list(),
    orgUnits: await ctx.tx.orgUnits.list(),
    // For an approval chain's "person" step: a name to pick, nothing more.
    members: (await ctx.tx.members.list()).map((m) => ({
      personId: m.personId,
      name: m.displayName,
    })),
    pipelines: await ctx.tx.pipelines.list(),
    chains: await ctx.tx.chains.list(),
    questionnaires: await ctx.tx.questionnaires.list(),
    scorecards: await ctx.tx.scorecardTemplates.list(),
    templates: await ctx.tx.templates.list(),
    benefits: await ctx.tx.benefits.list(),
    payBands: await ctx.tx.payBands.list(),
    agencies: await ctx.tx.agencies.list(),
    careersDomain: await ctx.tx.public.careersDomain(),
    // Whether a company can have its own domain here at all (REC-136).
    domainsOn: ctx.deps.domains !== undefined,
    jobs: (await myJobs(ctx)).map((j) => ({ id: j.id, title: j.title })),
    admin: ctx.viewer.admin,
  };
}

/**
 * Recruiting's answer to the Inbox (PRD §5.3, REC-064): approvals waiting on
 * the person, scorecards they owe, today's interviews.
 */
export async function recruitingInbox(ctx: Ctx): Promise<{ items: InboxItem[] }> {
  const person = ctx.viewer.personId;
  if (person === null) return { items: [] };
  const items: InboxItem[] = [];
  const base = {
    area: 'Recruiting',
    tone: null,
    summary: null,
    from: null,
    status: null,
    outcome: null,
    count: null,
    team: null,
    replies: 0,
    message: null,
    detail: null,
  } as const;
  for (const a of await ctx.tx.approvals.waitingOn(person)) {
    const title =
      a.subject.kind === 'requisition'
        ? `Approve the requisition: ${(await ctx.tx.requisitions.get(a.subject.id))?.title ?? ''}`
        : 'Approve an offer';
    items.push({
      ...base,
      id: `recruiting:${a.subject.kind === 'requisition' ? 'requisition-approval' : 'offer-approval'}:${a.id}`,
      lane: 'task',
      kind:
        a.subject.kind === 'requisition'
          ? RECRUITING_INBOX_KINDS.requisitionApproval
          : RECRUITING_INBOX_KINDS.offerApproval,
      module: 'recruiting',
      icon: 'approve',
      title,
      at: a.createdAt,
      due: null,
      dueVerb: 'decide',
      link:
        a.subject.kind === 'requisition'
          ? `/recruiting/requisitions/${a.subject.id}/approve`
          : `/recruiting/offers/${a.subject.id}/approve`,
      openIn: 'Recruiting',
    });
  }
  for (const i of await ctx.tx.interviews.owedBy(person)) {
    items.push({
      ...base,
      id: `recruiting:scorecard:${i.id}`,
      lane: 'task',
      kind: RECRUITING_INBOX_KINDS.scorecard,
      module: 'recruiting',
      icon: 'edit',
      title: `Submit your scorecard: ${i.title}`,
      at: i.startsAt as Instant,
      due: new Date(Date.parse(i.startsAt) + (i.minutes + 24 * 60) * 60_000)
        .toISOString()
        .slice(0, 10) as InboxItem['due'],
      dueVerb: 'due',
      link: `/recruiting/interviews/${i.id}`,
      openIn: 'Recruiting',
    });
  }
  return { items };
}
