import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { CandidatePage, Instant, LaunchCountry } from '@kithena/contracts';

import { currentStage, effectiveHistory } from '../domain/pipeline/application.js';
import { retentionAction } from '../domain/privacy/retention.js';
import { adminOnly, event, notFound, publish, type Ctx } from './context.js';
import { sha256 } from './intake.js';
import type { Candidate } from './ports.js';
import { generalSettings } from './setup.js';
import { latest, versionHash } from '../domain/offer/offer.js';

/**
 * Candidate rights and retention (PRD §24, REC-056), and the candidate's
 * own page (PRD §10.5) that reaches them: access, deletion, objection to the
 * pool. The retention sweep anonymises: personal data deleted, the stage
 * history, source, dates and reasons kept for analytics.
 */

export async function candidateByToken(ctx: Ctx, token: string): Promise<Candidate | null> {
  const id = await ctx.tx.tokens.candidate(sha256(token), ctx.at);
  return id === null ? null : ctx.tx.candidates.get(id);
}

/** The candidate's page (J6, J7): each application under the names the candidate sees. */
export async function candidatePage(ctx: Ctx, candidate: Candidate): Promise<CandidatePage> {
  const apps = await ctx.tx.applications.forCandidate(candidate.id);
  const settings = await generalSettings(ctx);
  const out: CandidatePage['applications'][number][] = [];
  for (const app of apps) {
    const job = await ctx.tx.jobs.get(app.jobId);
    if (job === null) continue;
    const stages = (await ctx.tx.jobs.stages(app.jobId)).filter((s) => s.candidateName !== null);
    const current = currentStage(app);
    const all = await ctx.tx.jobs.stages(app.jobId);
    const currentRank = all.findIndex((s) => s.id === current);
    const steps = stages.map((s) => {
      const rank = all.findIndex((x) => x.id === s.id);
      return {
        name: s.candidateName ?? '',
        state:
          rank < currentRank
            ? ('done' as const)
            : rank === currentRank
              ? ('current' as const)
              : ('next' as const),
      };
    });
    const interviews = (await ctx.tx.interviews.forApplication(app.id))
      .filter((i) => i.state === 'scheduled' && i.startsAt > ctx.at)
      .map((i) => ({
        id: i.id,
        title: i.title,
        startsAt: i.startsAt as Instant,
        minutes: i.minutes,
        where: i.videoUrl ?? i.place,
        rescheduleUrl: null,
      }));
    // The offer that matters: one open to answer, else one accepted, else the last declined or expired.
    const offers = await ctx.tx.offers.forApplication(app.id);
    const offer =
      offers.find((o) => o.state === 'sent') ??
      offers.find((o) => o.state === 'accepted') ??
      offers.findLast((o) => ['declined', 'expired'].includes(o.state));
    const contract = offer === undefined ? null : await ctx.tx.contracts.forOffer(offer.id);
    out.push({
      applicationId: app.id,
      job: { title: job.title, company: settings.companyName, slug: job.slug },
      stage: all.find((s) => s.id === current)?.candidateName ?? null,
      steps,
      outcome: app.outcome,
      interviews,
      requests: [],
      offer:
        offer === undefined
          ? null
          : {
              offerId: offer.id,
              version: latest(offer).version,
              state: offer.state,
              expiresOn: latest(offer).expiresOn,
              hash: versionHash(latest(offer)),
            },
      contract:
        contract === null
          ? null
          : { state: contract.state, route: contract.route, signedOn: contract.signedOn },
    });
  }
  return { name: candidate.name, applications: out };
}

/** Everything held about a candidate (GDPR art. 15), as one JSON document. */
export async function exportCandidate(
  ctx: Ctx,
  candidateId: string,
): Promise<Result<Record<string, unknown>>> {
  const candidate = await ctx.tx.candidates.get(candidateId);
  if (candidate === null) return err(notFound('candidate'));
  const apps = await ctx.tx.applications.forCandidate(candidateId);
  return ok({
    candidate,
    applications: apps.map((a) => ({ ...a, history: effectiveHistory(a) })),
    files: (await ctx.tx.files.of(candidateId)).map(({ blobKey: _key, ...f }) => f),
    consents: await ctx.tx.consents.of(candidateId),
    messages: await ctx.tx.messages.thread(candidateId),
    pools: await ctx.tx.pools.of(candidateId),
    exportedAt: ctx.at,
  });
}

/**
 * Anonymise a candidate: personal data deleted, the applications kept with
 * their history, source, dates and reasons, and nothing that leads back to
 * the person. Refused under a legal hold and for a hire (PRD §24.2, §24.3).
 */
export async function anonymise(ctx: Ctx, candidateId: string): Promise<Result<true>> {
  const candidate = await ctx.tx.candidates.get(candidateId);
  if (candidate === null || candidate.anonymisedAt !== null) return err(notFound('candidate'));
  if (await ctx.tx.legalHolds.has(candidateId))
    return err(failure('LEGAL_HOLD', 'A legal hold keeps this candidate'));
  const apps = await ctx.tx.applications.forCandidate(candidateId);
  if (apps.some((a) => a.outcome === 'hired'))
    return err(failure('HIRED', 'A hire is kept and handed over, not deleted'));
  for (const file of await ctx.tx.files.removeOf(candidateId))
    await ctx.deps.blobs.delete(file.blobKey);
  for (const app of apps) {
    // What was read from the CV and the self-ID go with the person.
    await ctx.tx.selfIds.remove(app.id);
    await ctx.tx.settings.set(`parsed_profile:${app.id}`, null);
    await ctx.tx.applications.save(
      { ...app, answers: {}, adjustments: null },
      'applied',
      [],
      ctx.today,
    );
  }
  for (const member of await ctx.tx.pools.of(candidateId))
    await ctx.tx.pools.remove(member.poolId, candidateId);
  await ctx.tx.candidates.save({
    ...candidate,
    name: 'Deleted candidate',
    email: `deleted+${candidate.id}@invalid`,
    phone: null,
    cvHash: null,
    personId: null,
    location: null,
    links: [],
    tags: [],
    anonymisedAt: ctx.at,
  });
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.candidate.deleted',
      { type: 'Candidate', id: candidateId },
      { candidateId },
    ),
  );
  return ok(true);
}

export async function deleteByRequest(ctx: Ctx, candidateId: string): Promise<Result<true>> {
  return anonymise(ctx, candidateId);
}

export async function placeHold(
  ctx: Ctx,
  candidateId: string,
  reason: string,
): Promise<Result<true>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if (reason.trim() === '') return err(failure('REASON_REQUIRED', 'A legal hold says why'));
  await ctx.tx.legalHolds.place(candidateId, reason, ctx.caller.accountId);
  return ok(true);
}

/** The nightly sweep for one tenant: whom retention anonymises today. */
export async function sweepRetention(ctx: Ctx): Promise<{ anonymised: number }> {
  let anonymised = 0;
  const candidates = await ctx.tx.candidates.search({ limit: 100_000 });
  for (const candidate of candidates) {
    const apps = await ctx.tx.applications.forCandidate(candidate.id);
    if (apps.length === 0) continue;
    const countries = new Set<LaunchCountry>();
    for (const app of apps)
      for (const c of (await ctx.tx.jobs.get(app.jobId))?.countries ?? []) countries.add(c);
    const decided = apps.every((a) => a.outcome !== 'active')
      ? (apps
          .map((a) =>
            (a.rejection?.at ?? a.withdrawnAt ?? a.history.at(-1)?.at ?? ctx.at).slice(0, 10),
          )
          .toSorted()
          .at(-1) ?? null)
      : null;
    const pool =
      (await ctx.tx.consents.of(candidate.id))
        .filter((c) => c.purpose === 'talent_pool' && c.withdrawnAt === null)
        .map((c) => c.expiresOn)
        .toSorted()
        .at(-1) ?? null;
    const action = retentionAction(
      {
        candidateId: candidate.id,
        decidedOn: decided as never,
        countries: [...countries],
        hired: apps.some((a) => a.outcome === 'hired'),
        legalHold: await ctx.tx.legalHolds.has(candidate.id),
        poolConsentUntil: pool,
      },
      ctx.today,
    );
    if (action.kind === 'anonymise' && (await anonymise(ctx, candidate.id)).ok) anonymised += 1;
  }
  return { anonymised };
}
