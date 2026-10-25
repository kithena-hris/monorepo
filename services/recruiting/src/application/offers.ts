import { everyCatalogue, keepChosen } from './catalogue.js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type {
  CalendarDate,
  ConditionKind,
  ConditionState,
  PrehireCancelReason,
  ResolvedTerms,
} from '@kithena/contracts';

import { may, worksCouncilMay } from '../domain/access/access.js';
import { hire as hireApplication, toContract } from '../domain/pipeline/application.js';
import { withContractStage } from '../domain/pipeline/pipeline.js';
import {
  isEligible,
  offerBenefits,
  statutoryBenefits,
  totalRewards,
  type TotalRewards,
} from '../domain/benefits/benefits.js';
import {
  generateContract,
  markSigned,
  sendForSignature,
  signedByEnvelope,
  type Contract,
} from '../domain/contract/contract.js';
import { hireInto } from '../domain/job/job.js';
import {
  acceptOffer,
  approvalOutcome,
  declineOffer,
  draftOffer,
  editDraft,
  latest,
  offerChecks,
  reviseOffer,
  sendOffer,
  submitOffer,
  versionHash,
  withdrawOffer,
  yearlyBase,
  type Offer,
  type OfferCheck,
  type OfferVersion,
} from '../domain/offer/offer.js';
import {
  cancelPrehire,
  decideCondition,
  openPrehire,
  type Prehire,
} from '../domain/prehire/prehire.js';
import {
  approvalState,
  chainFor,
  mayDecide,
  recordHire,
  resolveSteps,
} from '../domain/requisition/requisition.js';
import { addDays, addMonths } from '../domain/dates.js';
import { packFor } from '../domain/terms/packs.js';
import {
  validateTerms,
  type EntityFacts,
  type MinimumLeave,
  type TermsAnswers,
} from '../domain/terms/pack.js';
import { termsOf, weeklyMinutesOf } from './job-terms.js';
import type { TermsIssue } from '@kithena/contracts';
import { asPerson, event, forbidden, notFound, publish, type Ctx, mailWords } from './context.js';
import { refreshProjection } from './jobs.js';
import { askApprovers } from './chat.js';
import { emailFor, emailValues } from './emails.js';
import { loadApplication, render, sendNow, worksCouncilCleared, type Loaded } from './moves.js';
import { appUrl, inboxTask, tellMembers } from './notify.js';
import { generalSettings } from './setup.js';
import type { ApplicationRecord, Candidate, JobRecord } from './ports.js';
import { reportingOf } from './requisitions.js';
import { signedInLink } from './intake.js';

/**
 * Offers to the hire (PRD §18, §21, REC-054, REC-055, REC-058): composed on
 * the country's pack, checked before anyone sees them, approved, sent,
 * accepted against the hash of what was read; then the contract, its
 * signature, the pre-hire and `recruiting.candidate.hired`.
 */

type VersionInput = Omit<OfferVersion, 'version' | 'supersededAt'> & {
  readonly grade: string | null;
  readonly outsideBandReason: string | null;
};

const PAY_TRANSPARENCY_FROM = '2026-06-07';

async function entityFor(ctx: Ctx, job: JobRecord): Promise<EntityFacts | null> {
  const entity = job.entityId === null ? null : await ctx.tx.entities.get(job.entityId);
  if (entity === null) return null;
  return {
    legalEntityId: entity.id,
    country: entity.country,
    currency: entity.currency,
    fullTimeWeeklyMinutes: entity.fullTimeWeeklyMinutes,
    headcount: entity.headcount,
    foundedOn: entity.foundedOn,
    hasWorksCouncil: entity.worksCouncil,
  };
}

export interface Checked {
  readonly terms: ResolvedTerms | null;
  readonly termsIssues: readonly TermsIssue[];
  readonly checks: readonly OfferCheck[];
  readonly rewards: TotalRewards;
  /** Every pack is awaiting a country reviewer (REC-150): said on the offer. */
  readonly packReviewed: boolean;
}

/** Everything the offer editor shows (R19): the terms by the pack, the checks, total rewards. */
export async function checkOffer(
  ctx: Ctx,
  app: ApplicationRecord,
  job: JobRecord,
  input: VersionInput,
): Promise<Result<Checked>> {
  const entity = await entityFor(ctx, job);
  if (entity === null) return err(failure('NO_ENTITY', 'Choose the job’s legal entity first'));
  const pack = packFor(entity.country);
  const terms = validateTerms(
    pack,
    { ...input.terms, contractStart: input.startDate },
    entity,
    ctx.today,
  );
  const band =
    input.grade === null
      ? null
      : ((await ctx.tx.payBands.list()).find(
          (b) =>
            b.grade === input.grade && (b.entityId === null || b.entityId === entity.legalEntityId),
        ) ?? null);
  let budgetMax: number | null = null;
  for (const id of job.requisitionIds) {
    const r = await ctx.tx.requisitions.get(id);
    if (r?.budget != null) budgetMax = Math.max(budgetMax ?? 0, r.budget.to.amountMinor);
  }
  const checks = offerChecks(
    { ...input, version: 1, supersededAt: null },
    {
      today: ctx.today,
      band:
        band === null
          ? null
          : { minMinor: band.minMinor, maxMinor: band.maxMinor, currency: band.currency },
      advertised:
        job.salaryShown && job.salary !== null
          ? {
              minMinor: job.salary.minMinor,
              maxMinor: job.salary.maxMinor,
              currency: job.salary.currency,
            }
          : null,
      payTransparency:
        (entity.country === 'DE' || entity.country === 'ES') && ctx.today >= PAY_TRANSPARENCY_FROM,
      budgetMaxMinor: budgetMax,
      currency: entity.currency,
      outsideBandReason: input.outsideBandReason,
    },
  );
  // The library's benefits chosen here are kept, so the offer reads them back like any other.
  await keepChosen(ctx, entity.legalEntityId, input.benefitIds);
  const catalogue = (await ctx.tx.benefits.list()).filter(
    (b) => b.legalEntityId === entity.legalEntityId,
  );
  const who = {
    employmentType: terms.ok ? terms.value.terms.employmentType : 'permanent',
    weeklyMinutes: input.terms.weeklyMinutes ?? entity.fullTimeWeeklyMinutes,
    workMode: input.terms.workMode ?? job.workMode,
    locationId: job.locationIds[0] ?? null,
  } as const;
  const chosen = offerBenefits(
    input.benefitIds,
    catalogue.filter((b) => !b.statutory),
    [
      ...catalogue.filter((b) => b.statutory),
      ...statutoryBenefits(entity.country, input.terms.region ?? null, entity.legalEntityId).filter(
        (s) => !catalogue.some((c) => c.id === s.id),
      ),
    ],
    who,
  );
  const rewards = totalRewards(
    yearlyBase(input.pay, who.weeklyMinutes),
    input.pay.variableTargetMinor,
    chosen.filter((b) => isEligible(b, who)),
    entity.currency,
    'en',
    input.pay.equity?.units ?? null,
  );
  return ok({
    // The resolved terms themselves; their warnings are in `termsIssues`.
    terms: terms.ok ? terms.value.terms : null,
    termsIssues: terms.ok ? terms.value.warnings : terms.error,
    checks,
    // What was written in has no value to add up; it is listed beside the benefits that do.
    rewards: { ...rewards, descriptive: [...rewards.descriptive, ...(input.extraBenefits ?? [])] },
    packReviewed: pack.reviewed,
  });
}

export async function editableOffer(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<Loaded & { readonly job: JobRecord }>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'offer.edit')) return err(forbidden());
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  if (job === null) return err(notFound('job'));
  return ok({ ...loaded.value, job });
}

/**
 * A new offer, filled from the job before anyone types (PRD §19.2): the terms
 * set on the job, the law's defaults for what the job does not say (probation,
 * notice, payments a year), the pay at the middle of the range the job ad
 * gave, the job's benefits and the dates. The advertised range comes with it
 * to show beside the pay. Every figure is a suggestion the recruiter keeps or
 * changes; the composer still checks the result.
 */
export async function offerStart(
  ctx: Ctx,
  applicationId: string,
): Promise<
  Result<{
    readonly input: VersionInput;
    readonly advertised: {
      readonly minMinor: number;
      readonly maxMinor: number;
      readonly currency: string;
      readonly period: 'year' | 'month' | 'hour';
    } | null;
    readonly candidate: { readonly name: string };
    readonly job: { readonly title: string };
  }>
> {
  const loaded = await editableOffer(ctx, applicationId);
  if (!loaded.ok) return loaded;
  const { job, candidate } = loaded.value;
  const held = await termsOf(ctx, job);
  const entity = await entityFor(ctx, job);
  const location =
    held.locationId === null
      ? null
      : ((await ctx.tx.locations.list()).find((l) => l.id === held.locationId) ?? null);
  const startDate = addDays(ctx.today, 60);
  const expiresOn = addDays(ctx.today, 10);
  const weeklyMinutes = weeklyMinutesOf(held) ?? entity?.fullTimeWeeklyMinutes ?? 40 * 60;
  const salary = job.salary;
  const pay = {
    baseMinor: salary === null ? 0 : Math.round((salary.minMinor + salary.maxMinor) / 2),
    currency: salary?.currency ?? entity?.currency ?? 'EUR',
    frequency: salary?.period ?? 'year',
    variableTargetMinor: 0,
    signOnMinor: 0,
    relocationMinor: 0,
    equity: null,
  } as const;
  let terms: TermsAnswers = {
    region: location?.region ?? null,
    ...(held.relationship === null
      ? {}
      : { relationship: held.relationship as NonNullable<TermsAnswers['relationship']> }),
    ...(held.contractType === null ? {} : { contractType: held.contractType }),
    ...(held.fixedTermReason === null ? {} : { fixedTermReason: held.fixedTermReason }),
    ...(held.workMode === null ? {} : { workMode: held.workMode }),
    ...(held.workMode === 'hybrid' ? { hybridDaysOnsite: held.hybridDaysOnsite } : {}),
    ...(held.workMode === 'remote' && entity !== null ? { remoteCountry: entity.country } : {}),
    previouslyEmployed: false,
    contractStart: startDate,
    weeklyMinutes,
    benefitIds: job.benefitIds,
    nonCompeteMonths: null,
    mobilityClause: false,
  };
  if (entity !== null) {
    const pack = packFor(entity.country);
    const type = pack
      .contractTypes(terms, entity)
      .find((c) => c.key === held.contractType && c.unavailable === undefined);
    const limits = pack.limits(terms, entity, startDate);
    const months =
      type?.fixedTerm === true && limits.durationMonths !== null
        ? Math.min(12, limits.durationMonths.max ?? 12)
        : null;
    terms = {
      ...terms,
      contractEnd: months === null ? null : addDays(addMonths(startDate, months), -1),
      probation: limits.probation.allowed ? limits.probation.default : null,
      noticeEmployee: limits.noticeEmployee,
      noticeEmployer: limits.noticeEmployer,
      annualPayMinor: yearlyBase(pay, weeklyMinutes),
      ...(pack.paymentsPerYear(terms)[0] === undefined
        ? {}
        : { paymentsPerYear: pack.paymentsPerYear(terms)[0] }),
    };
  }
  return ok({
    input: {
      terms,
      pay,
      // The job's own list, which its ad shows: the terms setting can lag behind an edit of the ad.
      benefitIds: job.benefitIds,
      startDate,
      expiresOn,
      letterTemplateId: null,
      grade: null,
      outsideBandReason: null,
    },
    advertised: salary,
    candidate: { name: candidate.name },
    job: { title: job.title },
  });
}

export async function composeOffer(
  ctx: Ctx,
  applicationId: string,
  input: VersionInput,
): Promise<Result<Offer>> {
  const loaded = await editableOffer(ctx, applicationId);
  if (!loaded.ok) return loaded;
  const { grade: _grade, outsideBandReason: _reason, ...version } = input;
  // A declined offer is answered with a new version of it, so the declined terms and the reason stay beside the new ones.
  const existing = (await ctx.tx.offers.forApplication(applicationId)).find(
    (o) => o.state !== 'withdrawn' && o.state !== 'expired',
  );
  let offer: Offer;
  if (existing === undefined) offer = draftOffer(ctx.deps.newId(), applicationId, version);
  else {
    const edited =
      existing.state === 'draft'
        ? editDraft(existing, version)
        : reviseOffer(existing, ctx.at, version);
    if (!edited.ok) return edited;
    offer = edited.value;
  }
  await ctx.tx.offers.save(offer);
  await ctx.tx.settings.set(`offer_meta:${offer.id}`, {
    grade: input.grade,
    outsideBandReason: input.outsideBandReason,
  });
  return ok(offer);
}

export async function submitOfferForApproval(ctx: Ctx, offerId: string): Promise<Result<Offer>> {
  const offer = await ctx.tx.offers.get(offerId);
  if (offer === null) return err(notFound('offer'));
  const loaded = await editableOffer(ctx, offer.applicationId);
  if (!loaded.ok) return loaded;
  const meta = ((await ctx.tx.settings.get(`offer_meta:${offerId}`)) as {
    grade: string | null;
    outsideBandReason: string | null;
  } | null) ?? { grade: null, outsideBandReason: null };
  const version = latest(offer);
  const checked = await checkOffer(ctx, loaded.value.app, loaded.value.job, {
    ...version,
    ...meta,
  });
  if (!checked.ok) return checked;
  const termsErrors =
    checked.value.terms === null
      ? checked.value.termsIssues.filter((i) => i.severity === 'error').length
      : 0;
  const reasons = checked.value.checks.filter((c) => c.severity === 'approval');
  const chain = chainFor(await ctx.tx.chains.list(), 'offer', {
    budgetToMinor: null,
    reason: null,
    legalEntityId: loaded.value.job.entityId,
    outsideBand: reasons.some((r) => r.code === 'outside_band'),
    aboveBudget: reasons.some((r) => r.code === 'above_budget'),
    grade: meta.grade,
  });
  const submitted = submitOffer(offer, checked.value.checks, termsErrors, chain !== null);
  if (!submitted.ok) return submitted;
  await ctx.tx.offers.save(submitted.value);
  if (submitted.value.state === 'pending_approval') {
    const steps =
      chain === null
        ? { ok: true as const, value: [[]] as string[][] }
        : resolveSteps(
            chain,
            loaded.value.facts.team.find((t) => t.role === 'hiring_manager')?.personId ?? null,
            await reportingOf(ctx),
          );
    if (!steps.ok) return steps;
    // Approval reasons without a chain go to the company's administrators.
    const resolved = chain === null ? [(await reportingOf(ctx)).holdersOf('hr')] : steps.value;
    await ctx.tx.approvals.save({
      id: ctx.deps.newId(),
      subject: { kind: 'offer', id: offerId, version: version.version },
      chainId: chain?.id ?? null,
      steps: resolved,
      decisions: [],
      outcome: 'pending',
      changes: [],
      createdAt: ctx.at,
    });
    await askOfferApprovers(ctx, offerId, loaded.value.app.candidateId, loaded.value.job.title);
  } else {
    await publish(ctx, offerEvent(ctx, 'approved', submitted.value));
  }
  return ok(submitted.value);
}

const offerEvent = (
  ctx: Ctx,
  what: 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn',
  offer: Offer,
) =>
  event(
    ctx,
    `recruiting.offer.${what}`,
    { type: 'Offer', id: offer.id },
    { offerId: offer.id, applicationId: offer.applicationId, version: latest(offer).version },
  );

/** The chat app asks the offer's next approvers (REC-137). */
async function askOfferApprovers(ctx: Ctx, offerId: string, candidateId: string, title: string) {
  const name = (await ctx.tx.candidates.get(candidateId))?.name ?? 'a candidate';
  await askApprovers(
    ctx,
    'offer',
    offerId,
    `An offer to ${name} for ${title} waits for your approval.`,
    `/recruiting/offers/${offerId}/approve`,
  );
  // And by email, as every Inbox task is: its button opens the approver's task.
  const approval = await ctx.tx.approvals.open('offer', offerId);
  if (approval === null) return;
  const state = approvalState(approval.steps, approval.decisions);
  if (state.outcome !== 'pending') return;
  const { t } = await mailWords(ctx);
  const vars = { name, job: title };
  const href = await appUrl(ctx, inboxTask(`recruiting:offer-approval:${approval.id}`));
  await tellMembers(
    ctx,
    state.waitingOn,
    t('email.offer.approve_subject', 'Approve an offer: {{name}}, {{job}}', vars),
    t(
      'email.offer.approve_body',
      'An offer to {{name}} for {{job}} waits for your approval. Open it to read the terms and their checks, then approve or reject it.',
      vars,
    ),
    `offer-approval:${approval.id}:${String(state.step)}`,
    {
      heading: t('email.offer.approve_heading', 'An offer waits for you'),
      facts: [{ label: t('email.offer.role', 'Role'), value: title }],
      ...(href === null
        ? {}
        : { action: { label: t('email.offer.approve_action', 'Open the approval'), href } }),
    },
  );
}

export async function decideOffer(
  ctx: Ctx,
  offerId: string,
  decision: 'approved' | 'rejected',
  comment: string | null,
): Promise<Result<Offer>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const offer = await ctx.tx.offers.get(offerId);
  const approval = await ctx.tx.approvals.open('offer', offerId);
  if (offer === null || approval === null) return err(notFound('approval'));
  if (!mayDecide(approval.steps, approval.decisions, person.value))
    return err(forbidden('This approval is not waiting on you'));
  if (decision === 'rejected' && (comment ?? '').trim() === '')
    return err(failure('REASON_REQUIRED', 'Say why'));
  const step = approvalState(approval.steps, approval.decisions).step;
  const decisions = [...approval.decisions, { step, by: person.value, decision }];
  const outcome = approvalState(approval.steps, decisions).outcome;
  await ctx.tx.approvals.save({ ...approval, decisions, outcome });
  if (outcome === 'pending') {
    const app = await ctx.tx.applications.get(offer.applicationId);
    const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
    if (app !== null && job !== null)
      await askOfferApprovers(ctx, offerId, app.candidateId, job.title);
    return ok(offer);
  }
  const decided = approvalOutcome(offer, outcome);
  if (!decided.ok) return decided;
  await ctx.tx.offers.save(decided.value);
  if (outcome === 'approved') await publish(ctx, offerEvent(ctx, 'approved', decided.value));
  return ok(decided.value);
}

export async function sendTheOffer(ctx: Ctx, offerId: string): Promise<Result<Offer>> {
  const offer = await ctx.tx.offers.get(offerId);
  if (offer === null) return err(notFound('offer'));
  const loaded = await editableOffer(ctx, offer.applicationId);
  if (!loaded.ok) return loaded;
  const sent = sendOffer(offer, ctx.today, await worksCouncilCleared(ctx, loaded.value));
  if (!sent.ok) return sent;
  await ctx.tx.offers.save(sent.value);
  await publish(ctx, offerEvent(ctx, 'sent', sent.value));
  // The company's offer email when it has one (`emails.ts`), with the page link and the date it is open until.
  const words = await emailFor(ctx, 'offer', loaded.value.candidate.language);
  // Through the job site's sign-in: accepting an offer is a signed-in act.
  const values = {
    ...(await emailValues(ctx, loaded.value, { link: false })),
    link: await signedInLink(ctx, { offer: offerId }),
  };
  ctx.mail.push({
    to: loaded.value.candidate.email,
    subject: render(words.subject, values),
    text: `${render(words.body, values)}\n\n${(await mailWords(ctx)).t(
      'email.offer.open_until',
      'The offer is open until {{date}}.',
      { date: latest(sent.value).expiresOn },
    )}`,
    dedupeKey: `offer:${offerId}:${String(latest(sent.value).version)}`,
  });
  return ok(sent.value);
}

export async function withdrawTheOffer(ctx: Ctx, offerId: string): Promise<Result<Offer>> {
  const offer = await ctx.tx.offers.get(offerId);
  if (offer === null) return err(notFound('offer'));
  const loaded = await editableOffer(ctx, offer.applicationId);
  if (!loaded.ok) return loaded;
  const withdrawn = withdrawOffer(offer);
  if (!withdrawn.ok) return withdrawn;
  await ctx.tx.offers.save(withdrawn.value);
  await publish(ctx, offerEvent(ctx, 'withdrawn', withdrawn.value));
  return ok(withdrawn.value);
}

/**
 * The candidate went back before the offer stage: every offer still open is
 * withdrawn, as a press of Withdraw would, and arriving at the stage again
 * starts a new one (`draftOnArrival`). Allowed by the move that caused it.
 */
export async function withdrawOpenOffers(ctx: Ctx, applicationId: string): Promise<void> {
  for (const offer of await ctx.tx.offers.forApplication(applicationId)) {
    if (offer.state === 'expired') continue;
    const withdrawn = withdrawOffer(offer);
    if (!withdrawn.ok) continue;
    await ctx.tx.offers.save(withdrawn.value);
    await publish(ctx, offerEvent(ctx, 'withdrawn', withdrawn.value));
  }
}

/**
 * The application's open offer, or a new draft filled from the job
 * (`offerStart`): "Prepare offer" opens an offer rather than a form to make one.
 */
export async function prepareOffer(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<{ readonly id: string }>> {
  const open = (await ctx.tx.offers.forApplication(applicationId)).find(
    (o) => o.state !== 'withdrawn' && o.state !== 'expired',
  );
  if (open !== undefined) return ok({ id: open.id });
  const started = await offerStart(ctx, applicationId);
  if (!started.ok) return started;
  const drafted = await composeOffer(ctx, applicationId, started.value.input);
  return drafted.ok ? ok({ id: drafted.value.id }) : drafted;
}

/** Arriving at the offer stage drafts one; null when the mover may not write offers, or the job cannot fill one. */
export async function draftOnArrival(ctx: Ctx, applicationId: string): Promise<string | null> {
  const drafted = await prepareOffer(ctx, applicationId);
  return drafted.ok ? drafted.value.id : null;
}

/** The candidate, on their page (J7): accept against the hash of the version they read. */
export async function candidateAccepts(
  ctx: Ctx,
  candidateId: string,
  offerId: string,
  hash: string,
  ip: string,
): Promise<Result<Offer>> {
  const offer = await ctx.tx.offers.get(offerId);
  const app = offer === null ? null : await ctx.tx.applications.get(offer.applicationId);
  if (offer === null || app?.candidateId !== candidateId) return err(notFound('offer'));
  const accepted = acceptOffer(offer, hash, ctx.at, ip, ctx.today);
  if (!accepted.ok) return accepted;
  await ctx.tx.offers.save(accepted.value);
  await publish(ctx, offerEvent(ctx, 'accepted', accepted.value));
  await prepareContract(ctx, accepted.value, app);
  // Accepted moves to the contract stage: the contract is prepared and signed there, and the signature hires.
  if (app.outcome === 'active') {
    const placed = await placeInContract(ctx, app);
    if (!placed.ok) return placed;
  }
  await tellReaction(ctx, accepted.value, app);
  return ok(accepted.value);
}

export async function candidateDeclines(
  ctx: Ctx,
  candidateId: string,
  offerId: string,
  reason: string | null,
): Promise<Result<Offer>> {
  const offer = await ctx.tx.offers.get(offerId);
  const app = offer === null ? null : await ctx.tx.applications.get(offer.applicationId);
  if (offer === null || app?.candidateId !== candidateId) return err(notFound('offer'));
  const declined = declineOffer(offer, reason);
  if (!declined.ok) return declined;
  await ctx.tx.offers.save(declined.value);
  await publish(ctx, offerEvent(ctx, 'declined', declined.value));
  await tellReaction(ctx, declined.value, app);
  return ok(declined.value);
}

/**
 * The candidate's answer, by email to them and to the hiring team: the
 * candidate keeps a record of what they said, and the recruiter and the
 * hiring manager know at once, with the reason on a decline and where to go
 * next (the contract, or a new version of the terms).
 */
async function tellReaction(ctx: Ctx, offer: Offer, app: ApplicationRecord): Promise<void> {
  const { t } = await mailWords(ctx);
  const candidate = await ctx.tx.candidates.get(app.candidateId);
  const job = await ctx.tx.jobs.get(app.jobId);
  if (candidate === null || job === null) return;
  const settings = await generalSettings(ctx);
  const first = candidate.name.split(' ')[0] ?? candidate.name;
  const accepted = offer.state === 'accepted';
  const version = latest(offer).version;
  const vars = {
    first,
    name: candidate.name,
    job: job.title,
    company: settings.companyName,
    reason: offer.declineReason ?? '',
    version,
  };
  await sendNow(
    ctx,
    candidate,
    app.id,
    accepted
      ? t('email.offer.you_accepted', 'You accepted: {{job}} at {{company}}', vars)
      : t('email.offer.you_declined', 'You declined the offer: {{job}} at {{company}}', vars),
    accepted
      ? t(
          'email.offer.you_accepted_body',
          'Thank you, {{first}}, and welcome. {{company}} now prepares your contract, and you will get it to sign. Nothing else is needed from you until then.',
          vars,
        )
      : t(
          'email.offer.you_declined_body',
          'Thank you for telling us, {{first}}. {{company}} has your reason: “{{reason}}”. If they can change the terms, they will send you a new version.',
          vars,
        ),
    {
      heading: accepted
        ? t('email.offer.accepted_heading', 'Offer accepted')
        : t('email.offer.declined_heading', 'Offer declined'),
      facts: [
        { label: t('email.offer.role', 'Role'), value: job.title },
        { label: t('email.offer.version', 'Version'), value: String(version) },
        ...(accepted ? [] : [{ label: t('email.offer.reason', 'Reason'), value: vars.reason }]),
      ],
    },
  );
  const link = await appLink(
    ctx,
    accepted
      ? `/recruiting/candidates/${candidate.id}?application=${app.id}`
      : `/recruiting/offers/${offer.id}`,
  );
  await tellMembers(
    ctx,
    await hiringTeam(ctx, job.id),
    accepted
      ? t('email.offer.team_accepted', '{{name}} accepted the offer for {{job}}', vars)
      : t('email.offer.team_declined', '{{name}} declined the offer for {{job}}', vars),
    accepted
      ? t(
          'email.offer.team_accepted_contract',
          '{{name}} accepted version {{version}} and is in the contract stage now.\n\nNext: prepare the contract. Open their profile and the contract card: Kithena drafts it from the accepted terms and the law of {{entity}}, you check every fact, and send it to sign.\n\n{{link}}',
          {
            ...vars,
            entity:
              (job.entityId === null ? null : await ctx.tx.entities.get(job.entityId))?.name ??
              settings.companyName,
            link,
          },
        )
      : t(
          'email.offer.team_declined_body',
          '{{name}} declined version {{version}}.\n\nTheir reason: “{{reason}}”\n\nChange the terms and send a new version from the offer.\n\n{{link}}',
          { ...vars, link },
        ),
    `offer-${offer.state}:${offer.id}:${String(version)}`,
  );
}

/** The job's recruiters and hiring manager, who hear each step of a hire. */
async function hiringTeam(ctx: Ctx, jobId: string): Promise<string[]> {
  return (await ctx.tx.jobs.team(jobId))
    .filter((m) => m.role === 'recruiter' || m.role === 'hiring_manager')
    .map((m) => m.personId);
}

/** A page of the tenant app, on the company's own host when the chat apps know it. */
async function appLink(ctx: Ctx, path: string): Promise<string> {
  const base = ctx.deps.chat?.appBase;
  if (base === undefined) return path;
  return `${base.replace('{slug}', (await generalSettings(ctx)).companySlug)}${path}`;
}

/**
 * The contract is signed: the candidate hears they are hired and that an
 * invitation to set up their account comes next, and the hiring team is
 * told to send or schedule that invitation from the candidate's profile.
 */
async function tellSigned(
  ctx: Ctx,
  app: ApplicationRecord,
  candidate: Candidate,
  job: JobRecord,
  startDate: CalendarDate,
): Promise<void> {
  const { t } = await mailWords(ctx);
  const settings = await generalSettings(ctx);
  const vars = {
    first: candidate.name.split(' ')[0] ?? candidate.name,
    name: candidate.name,
    job: job.title,
    company: settings.companyName,
    start: startDate,
  };
  await sendNow(
    ctx,
    candidate,
    app.id,
    t('email.contract.you_signed', 'Signed: welcome to {{company}}', vars),
    t(
      'email.contract.you_signed_body',
      'Your contract for {{job}} is signed by you and by {{company}}, and you start on {{start}}.\n\nNext, {{company}} invites you to set up your account. The invitation has most of your details filled in already; you confirm them and add what is still missing.',
      vars,
    ),
    {
      heading: t('email.contract.signed_heading', 'Contract signed'),
      facts: [
        { label: t('email.offer.role', 'Role'), value: job.title },
        { label: t('email.contract.start', 'Start'), value: startDate },
      ],
    },
  );
  await tellMembers(
    ctx,
    await hiringTeam(ctx, job.id),
    t('email.contract.team_signed', '{{name}} signed: invite them to {{company}}', vars),
    t(
      'email.contract.team_signed_body',
      '{{name}} signed the contract for {{job}} and is hired, starting {{start}}.\n\nNext: send their account invitation, now or on a date you choose, from their profile. They confirm the details already on file and add what is missing, and become an employee in onboarding.\n\n{{link}}',
      {
        ...vars,
        link: await appLink(ctx, `/recruiting/candidates/${candidate.id}?application=${app.id}`),
      },
    ),
    `contract-signed:${app.id}`,
  );
}

/** What an offer is read beside: the role, the company, and the benefits it names, in words. */
/** The offer's contract as the law of the employer's country reads it (PRD §19). */
export interface OfferLaw {
  readonly country: string;
  readonly region: string | null;
  readonly contractType: string | null;
  /** The contract's name in the country pack: "Autónomo", "Unbefristet". */
  readonly contract: string | null;
  readonly relationship: string | null;
  /** Every term resolved for the start date; null while one of them is not lawful. */
  readonly terms: ResolvedTerms | null;
  /** The paid leave the law gives at least, and where it says so. */
  readonly leave: MinimumLeave;
  /** Each rule of the country that applies to these terms, with its source. */
  readonly rules: readonly {
    readonly step: string;
    readonly text: string;
    readonly source: string;
  }[];
}

export interface OfferSetting {
  readonly job: { readonly title: string };
  readonly contract: OfferLaw | null;
  readonly company: { readonly name: string; readonly logoUrl: string | null };
  readonly benefits: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
  }[];
}

/** Offer the candidate reads (J7): the version, its hash, total rewards and the plain terms. */
export async function offerForCandidate(
  ctx: Ctx,
  candidateId: string,
  offerId: string,
): Promise<Result<{ offer: Offer; hash: string; setting: OfferSetting }>> {
  const offer = await ctx.tx.offers.get(offerId);
  const app = offer === null ? null : await ctx.tx.applications.get(offer.applicationId);
  if (
    offer === null ||
    app?.candidateId !== candidateId ||
    offer.state === 'draft' ||
    offer.state === 'pending_approval' ||
    offer.state === 'approved'
  )
    return err(notFound('offer'));
  const job = await ctx.tx.jobs.get(app.jobId);
  const settings = await generalSettings(ctx);
  const chosen = new Set(latest(offer).benefitIds);
  const { language } = await mailWords(ctx);
  const benefits = [
    ...(await everyCatalogue(ctx))
      .filter((b) => chosen.has(b.id))
      .map((b) => ({
        id: b.id,
        name: b.names[language] ?? b.names['en'] ?? Object.values(b.names)[0] ?? b.key,
        description: b.description ?? null,
      })),
    ...(latest(offer).extraBenefits ?? []).map((name, i) => ({
      id: `extra:${String(i)}`,
      name,
      description: null,
    })),
  ];
  return ok({
    offer,
    hash: versionHash(latest(offer)),
    setting: {
      job: { title: job?.title ?? '' },
      contract: job === null ? null : await offerLaw(ctx, offer, job),
      company: { name: settings.companyName, logoUrl: settings.logoUrl },
      benefits,
    },
  });
}

/** The offer's contract by the country pack: its name, the resolved terms, the leave and every rule that applies. */
async function offerLaw(ctx: Ctx, offer: Offer, job: JobRecord): Promise<OfferLaw | null> {
  const entity = await entityFor(ctx, job);
  if (entity === null) return null;
  const pack = packFor(entity.country);
  const version = latest(offer);
  const answers: TermsAnswers = { ...version.terms, contractStart: version.startDate };
  const resolved = await resolvedTermsOf(ctx, offer, job, version.startDate);
  return {
    country: entity.country,
    region: answers.region ?? null,
    contractType: answers.contractType ?? null,
    contract:
      pack.contractTypes(answers, entity).find((t) => t.key === answers.contractType)?.label ??
      null,
    relationship: pack.relationships().find((r) => r.key === answers.relationship)?.label ?? null,
    terms: resolved.ok ? resolved.value : null,
    leave: pack.minimumLeave(answers, 5),
    rules: pack.rules(answers, entity),
  };
}

/* ------------------------------------------------------------- contract -- */

async function documentsPresent(ctx: Ctx): Promise<boolean> {
  const entitlements =
    ((await ctx.tx.settings.get('entitlements')) as { entitlements: string[] } | null)
      ?.entitlements ?? [];
  return entitlements.includes('module.documents');
}

export async function resolvedTermsOf(
  ctx: Ctx,
  offer: Offer,
  job: JobRecord,
  on: CalendarDate,
): Promise<Result<ResolvedTerms>> {
  const entity = await entityFor(ctx, job);
  if (entity === null) return err(failure('NO_ENTITY', 'The job has no legal entity'));
  const version = latest(offer);
  const terms = validateTerms(
    packFor(entity.country),
    { ...version.terms, contractStart: version.startDate },
    entity,
    on,
  );
  if (!terms.ok) return err(failure('TERMS', terms.error.map((i) => i.message).join('; ')));
  return ok(terms.value.terms);
}

async function prepareContract(
  ctx: Ctx,
  offer: Offer,
  app: ApplicationRecord,
): Promise<Result<Contract>> {
  const job = await ctx.tx.jobs.get(app.jobId);
  if (job === null) return err(notFound('job'));
  // Validated again for the start date (PRD §21.1).
  const terms = await resolvedTermsOf(ctx, offer, job, latest(offer).startDate);
  if (!terms.ok) return terms;
  const contract = generateContract(
    ctx.deps.newId(),
    offer.id,
    latest(offer).version,
    terms.value,
    await documentsPresent(ctx),
  );
  await ctx.tx.contracts.save({ ...contract, fileId: null });
  return ok(contract);
}

/**
 * The shell filed the contract in Documents and sent its envelope, carrying
 * the contract's `subjectRef` (PRD §21.2, §28): from now on only Documents'
 * `envelope.completed` signs it. A retry on a contract already out is the
 * same answer, not a second send.
 */
export async function contractSent(ctx: Ctx, offerId: string): Promise<Result<true>> {
  const offer = await ctx.tx.offers.get(offerId);
  if (offer === null) return err(notFound('offer'));
  const loaded = await editableOffer(ctx, offer.applicationId);
  if (!loaded.ok) return loaded;
  const contract = await ctx.tx.contracts.forOffer(offerId);
  if (contract === null) return err(notFound('contract'));
  if (contract.state === 'out_for_signature') return ok(true);
  const out = sendForSignature(contract);
  if (!out.ok) return out;
  await ctx.tx.contracts.save({ ...out.value, fileId: contract.fileId });
  return ok(true);
}

/** Documents' `envelope.completed`, matched on the subject reference (PRD §21.2). */
export async function contractSignedByEnvelope(
  ctx: Ctx,
  subjectRef: string,
  on: CalendarDate,
  signatures: readonly { readonly email: string | null; readonly mark: string }[] = [],
): Promise<Result<true>> {
  const contract = await ctx.tx.contracts.bySubjectRef(subjectRef);
  if (contract === null) return ok(true);
  const signed = signedByEnvelope(contract, subjectRef, on);
  if (!signed.ok) return signed;
  await ctx.tx.contracts.save({ ...signed.value, fileId: contract.fileId });
  return hireFromContract(ctx, signed.value, signatures);
}

/** A signed copy uploaded by HR: wet ink, or no Documents (PRD §21.2). */
export async function uploadSignedContract(
  ctx: Ctx,
  offerId: string,
  fileId: string,
  signedOn: CalendarDate,
): Promise<Result<true>> {
  const offer = await ctx.tx.offers.get(offerId);
  if (offer === null) return err(notFound('offer'));
  const loaded = await editableOffer(ctx, offer.applicationId);
  if (!loaded.ok) return loaded;
  const contract = await ctx.tx.contracts.forOffer(offerId);
  if (contract === null) return err(notFound('contract'));
  const file = await ctx.tx.files.get(fileId);
  if (file?.candidateId !== loaded.value.candidate.id) return err(notFound('file'));
  const signed = markSigned(
    contract,
    ctx.caller.personId ?? ctx.caller.accountId,
    signedOn,
    latest(offer).startDate,
  );
  if (!signed.ok) return signed;
  await ctx.tx.contracts.save({ ...signed.value, fileId });
  return hireFromContract(ctx, signed.value);
}

/**
 * The accepted offer's application, in the contract stage. A pipeline made
 * before that stage existed gains it first, between the offer and the hire.
 */
async function placeInContract(ctx: Ctx, app: ApplicationRecord): Promise<Result<true>> {
  const before = await ctx.tx.jobs.stages(app.jobId);
  const stages = withContractStage(before, ctx.deps.newId);
  if (stages.length !== before.length) await ctx.tx.jobs.setStages(app.jobId, stages);
  const moved = toContract(app, stages, 'system', ctx.at, ctx.deps.newId());
  if (!moved.ok) return moved;
  const move = moved.value.move;
  if (move === null) return ok(true);
  await ctx.tx.applications.save(
    { ...app, history: moved.value.application.history },
    'contract',
    [move],
    ctx.today,
  );
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.application.moved',
      { type: 'Application', id: app.id },
      {
        applicationId: app.id,
        jobId: app.jobId,
        from: move.from ?? move.to,
        to: move.to,
        category: 'contract',
        by: 'system',
        supersedes: null,
      },
    ),
  );
  return ok(true);
}

/**
 * The candidate is placed in the hired stage and counted against the job and
 * its requisition when the contract is signed (PRD §21.3), from the contract
 * stage the acceptance moved them to.
 */
async function placeHire(
  ctx: Ctx,
  offer: Offer,
  app: ApplicationRecord,
  job: JobRecord,
): Promise<Result<true>> {
  const stages = await ctx.tx.jobs.stages(job.id);
  const hired = hireApplication(app, stages, 'system', ctx.at, ctx.deps.newId());
  if (!hired.ok) return hired;
  await ctx.tx.applications.save(
    { ...app, ...hired.value.application },
    'hired',
    [hired.value.move],
    latest(offer).startDate,
  );
  const filled = hireInto(job);
  if (filled.ok) {
    await ctx.tx.jobs.save({ ...job, ...filled.value });
    if (filled.value.state === 'filled') {
      await publish(
        ctx,
        event(
          ctx,
          'recruiting.job.filled',
          { type: 'Job', id: job.id },
          { jobId: job.id, requisitionIds: job.requisitionIds },
        ),
      );
      await refreshProjection(ctx, { ...job, ...filled.value });
    }
  }
  for (const id of job.requisitionIds) {
    const r = await ctx.tx.requisitions.get(id);
    if (r === null) continue;
    const counted = recordHire(r);
    if (counted.ok) {
      await ctx.tx.requisitions.save(counted.value);
      break;
    }
  }
  return ok(true);
}

/**
 * The contract is signed: the candidate becomes a pre-hire with its
 * conditions and `recruiting.candidate.hired` hands the person on (PRD
 * §21.3, §21.4), and moves to the hired stage, counted against the job. The
 * hiring team is told to invite them to the company's Kithena next.
 */
async function hireFromContract(
  ctx: Ctx,
  contract: Contract,
  /** Who signed the envelope with what: the candidate's becomes the signature on their record. */
  signatures: readonly { readonly email: string | null; readonly mark: string }[] = [],
): Promise<Result<true>> {
  const offer = await ctx.tx.offers.get(contract.offerId);
  const app = offer === null ? null : await ctx.tx.applications.get(offer.applicationId);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
  if (offer === null || app === null || job === null || candidate === null)
    return err(notFound('offer'));
  if (app.outcome === 'active') {
    const placed = await placeHire(ctx, offer, app, job);
    if (!placed.ok) return placed;
  }
  const terms = await resolvedTermsOf(ctx, offer, job, latest(offer).startDate);
  if (!terms.ok) return terms;
  const references = (await ctx.tx.references.forApplication(app.id)).some(
    (r) => r.state !== 'completed',
  );
  const conditions: ConditionKind[] = [
    ...terms.value.conditions,
    ...(references ? (['references'] as const) : []),
  ];
  const prehire = openPrehire(app.id, candidate.id, latest(offer).startDate, conditions);
  await ctx.tx.prehires.save(prehire);
  const version = latest(offer);
  const manager =
    (await ctx.tx.jobs.team(job.id)).find((t) => t.role === 'hiring_manager')?.personId ?? null;
  const [given, ...rest] = candidate.name.trim().split(/\s+/u);
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.candidate.hired',
      { type: 'Application', id: app.id },
      {
        candidateId: candidate.id,
        applicationId: app.id,
        jobId: job.id,
        offerId: offer.id,
        offerVersion: version.version,
        candidate: {
          givenName: given ?? candidate.name,
          familyName: rest.join(' '),
          email: candidate.email,
          phone: candidate.phone,
        },
        terms: terms.value,
        pay: {
          base: { amountMinor: version.pay.baseMinor, currency: version.pay.currency },
          frequency: version.pay.frequency,
        },
        benefits: version.benefitIds.map((benefitId) => ({
          benefitId,
          statutory: benefitId.startsWith('statutory:'),
        })),
        startDate: version.startDate,
        managerId: manager,
        orgUnitId: null,
        locationId: job.locationIds[0] ?? null,
        legalEntityId: job.entityId,
        conditions: prehire.conditions.map((c) => ({ kind: c.kind, state: c.state })),
        signature:
          signatures.find((s) => s.email?.toLowerCase() === candidate.email.toLowerCase())?.mark ??
          null,
      },
      version.startDate,
    ),
  );
  if (prehire.state === 'conditions_met' && prehire.conditions.length > 0) {
    await publish(
      ctx,
      event(
        ctx,
        'recruiting.prehire.conditions_met',
        { type: 'Application', id: app.id },
        { candidateId: candidate.id, applicationId: app.id },
      ),
    );
  }
  await tellSigned(ctx, app, candidate, job, version.startDate);
  return ok(true);
}

export async function decidePrehireCondition(
  ctx: Ctx,
  applicationId: string,
  kind: ConditionKind,
  state: Exclude<ConditionState, 'open'>,
  note: string | null,
): Promise<Result<Prehire>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'offer.edit')) return err(forbidden());
  const held = await ctx.tx.prehires.get(applicationId);
  if (held === null) return err(notFound('pre-hire'));
  const decided = decideCondition(
    held,
    kind,
    state,
    ctx.caller.personId ?? ctx.caller.accountId,
    ctx.at,
    note,
  );
  if (!decided.ok) return decided;
  await ctx.tx.prehires.save(decided.value.prehire);
  if (decided.value.allMet) {
    await publish(
      ctx,
      event(
        ctx,
        'recruiting.prehire.conditions_met',
        { type: 'Application', id: applicationId },
        { candidateId: held.candidateId, applicationId },
      ),
    );
  }
  return ok(decided.value.prehire);
}

export async function cancelThePrehire(
  ctx: Ctx,
  applicationId: string,
  reason: PrehireCancelReason,
): Promise<Result<Prehire>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'offer.edit')) return err(forbidden());
  const held = await ctx.tx.prehires.get(applicationId);
  if (held === null) return err(notFound('pre-hire'));
  const cancelled = cancelPrehire(held, reason);
  if (!cancelled.ok) return cancelled;
  await ctx.tx.prehires.save(cancelled.value);
  const candidate = await ctx.tx.candidates.get(held.candidateId);
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.prehire.cancelled',
      { type: 'Application', id: applicationId },
      {
        candidateId: held.candidateId,
        applicationId,
        reasonKey: reason,
        email: candidate?.email ?? null,
      },
    ),
  );
  return ok(cancelled.value);
}

/* ------------------------------------------------------ works council -- */

/** Present a hire to the works council (PRD §19.9): its members get a read-only view. */
export async function presentToWorksCouncil(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<true>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'pipeline.move')) return err(forbidden());
  if (!loaded.value.stages.some((s) => s.category === 'works_council'))
    return err(failure('NO_COUNCIL', 'This job has no works council stage'));
  await ctx.tx.settings.set(`works_council:${applicationId}`, {
    state: 'presented',
    presentedAt: ctx.at,
    reason: null,
  });
  return ok(true);
}

export async function worksCouncilDecides(
  ctx: Ctx,
  applicationId: string,
  decision: 'consented' | 'refused',
  reason: string | null,
): Promise<Result<true>> {
  const app = await ctx.tx.applications.get(applicationId);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  const entity = job?.entityId == null ? null : await ctx.tx.entities.get(job.entityId);
  const held = (await ctx.tx.settings.get(`works_council:${applicationId}`)) as {
    state: string;
  } | null;
  if (
    entity === null ||
    !worksCouncilMay(ctx.caller.personId, entity.worksCouncilIds, held !== null)
  )
    return err(notFound('application'));
  if (decision === 'refused' && (reason ?? '').trim() === '')
    return err(failure('REASON_REQUIRED', 'A refusal gives its reasons (§ 99(3) BetrVG)'));
  await ctx.tx.settings.set(`works_council:${applicationId}`, {
    ...held,
    state: decision,
    reason,
    decidedAt: ctx.at,
  });
  return ok(true);
}
