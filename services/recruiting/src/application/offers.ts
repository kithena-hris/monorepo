import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type {
  CalendarDate,
  ConditionKind,
  ConditionState,
  PrehireCancelReason,
  ResolvedTerms,
} from '@kithena/contracts';

import { may, worksCouncilMay } from '../domain/access/access.js';
import { hire as hireApplication } from '../domain/application/application.js';
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
import { packFor } from '../domain/terms/packs.js';
import { validateTerms, type EntityFacts, type Validated } from '../domain/terms/pack.js';
import type { TermsIssue } from '@kithena/contracts';
import { asPerson, event, forbidden, notFound, publish, type Ctx } from './context.js';
import { refreshProjection } from './jobs.js';
import { portalLink } from './intake.js';
import { loadApplication, worksCouncilCleared } from './moves.js';
import type { ApplicationRecord, JobRecord } from './ports.js';
import { reportingOf } from './requisitions.js';
import { generalSettings } from './setup.js';

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
  readonly terms: Validated | null;
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
    terms: terms.ok ? terms.value : null,
    termsIssues: terms.ok ? terms.value.warnings : terms.error,
    checks,
    rewards,
    packReviewed: pack.reviewed,
  });
}

async function editableOffer(ctx: Ctx, applicationId: string) {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'offer.edit')) return err(forbidden());
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  if (job === null) return err(notFound('job'));
  return ok({ ...loaded.value, job });
}

export async function composeOffer(
  ctx: Ctx,
  applicationId: string,
  input: VersionInput,
): Promise<Result<Offer>> {
  const loaded = await editableOffer(ctx, applicationId);
  if (!loaded.ok) return loaded;
  const { grade: _grade, outsideBandReason: _reason, ...version } = input;
  const existing = (await ctx.tx.offers.forApplication(applicationId)).find(
    (o) => o.state !== 'withdrawn' && o.state !== 'declined' && o.state !== 'expired',
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
  if (outcome === 'pending') return ok(offer);
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
  const settings = await generalSettings(ctx);
  ctx.mail.push({
    to: loaded.value.candidate.email,
    subject: `Your offer from ${settings.companyName}`,
    text: `Hello ${loaded.value.candidate.name},\n\nWe are delighted to offer you the role of ${loaded.value.job.title}. Read the offer, and accept or decline it, on your page:\n${await portalLink(ctx, loaded.value.candidate.id)}\n\nThe offer is open until ${latest(sent.value).expiresOn}.`,
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
  return ok(declined.value);
}

/** Offer the candidate reads (J7): the version, its hash, total rewards and the plain terms. */
export async function offerForCandidate(
  ctx: Ctx,
  candidateId: string,
  offerId: string,
): Promise<Result<{ offer: Offer; hash: string }>> {
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
  return ok({ offer, hash: versionHash(latest(offer)) });
}

/* ------------------------------------------------------------- contract -- */

async function documentsPresent(ctx: Ctx): Promise<boolean> {
  const entitlements =
    ((await ctx.tx.settings.get('entitlements')) as { entitlements: string[] } | null)
      ?.entitlements ?? [];
  return entitlements.includes('module.documents');
}

async function resolvedTermsOf(
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
  const out = contract.route === 'documents' ? sendForSignature(contract) : ok(contract);
  if (!out.ok) return out;
  await ctx.tx.contracts.save({ ...out.value, fileId: null });
  return ok(out.value);
}

/** Documents' `envelope.completed`, matched on the subject reference (PRD §21.2). */
export async function contractSignedByEnvelope(
  ctx: Ctx,
  subjectRef: string,
  on: CalendarDate,
): Promise<Result<true>> {
  const contract = await ctx.tx.contracts.bySubjectRef(subjectRef);
  if (contract === null) return ok(true);
  const signed = signedByEnvelope(contract, subjectRef, on);
  if (!signed.ok) return signed;
  await ctx.tx.contracts.save({ ...signed.value, fileId: contract.fileId });
  return hireFromContract(ctx, signed.value);
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
 * The contract is signed: the application is hired, the candidate a pre-hire
 * with its conditions, the job and requisition count the hire, and
 * `recruiting.candidate.hired` hands the person on (PRD §21.3, §21.4).
 */
async function hireFromContract(ctx: Ctx, contract: Contract): Promise<Result<true>> {
  const offer = await ctx.tx.offers.get(contract.offerId);
  const app = offer === null ? null : await ctx.tx.applications.get(offer.applicationId);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
  if (offer === null || app === null || job === null || candidate === null)
    return err(notFound('offer'));
  const stages = await ctx.tx.jobs.stages(job.id);
  const hired = hireApplication(app, stages, 'system', ctx.at, ctx.deps.newId());
  if (!hired.ok) return hired;
  await ctx.tx.applications.save(
    { ...app, ...hired.value.application },
    'hired',
    [hired.value.move],
    latest(offer).startDate,
  );
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
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.prehire.cancelled',
      { type: 'Application', id: applicationId },
      { candidateId: held.candidateId, applicationId, reasonKey: reason },
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
