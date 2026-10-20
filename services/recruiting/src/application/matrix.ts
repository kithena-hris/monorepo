import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { matchScore, verifyFindings, type Band, type Finding } from '../domain/ai/matrix.js';
import { may } from '../domain/access/access.js';
import { aiOff, aiOn, maskedText, readApplication, readMasked, type PromptSpec } from './ai.js';
import { asPerson, forbidden, jobFacts, notFound, type Ctx } from './context.js';
import { loadApplication } from './moves.js';
import { generalSettings } from './setup.js';
import { inNewYorkCity, nycGate, type Place } from '../domain/ai/nyc.js';
import { publicJob } from './intake.js';
import type { Assessment, JobRecord } from './ports.js';

/**
 * The evidence matrix (PRD §14.3, REC-114): the model reads the masked
 * application against each of the job's criteria and quotes its evidence;
 * the domain keeps only quotes that are in the text, and computes the score
 * and the band. The matrix is kept as the assessment's output, beside the
 * masked text it was read from.
 *
 * ponytail: one application per request, for the person looking at it. A
 * batch over a whole job belongs on a queue when someone asks for it.
 */

const Answer = z.object({
  /** Set by the domain, never by the model: the job the criteria came from, for rediscovery. */
  jobId: z.string().optional(),
  findings: z
    .array(
      z.object({
        criterionId: z.string().max(64),
        verdict: z.enum(['met', 'partly_met', 'not_met', 'not_evidenced']),
        passages: z.array(z.string().max(600)).max(5),
        why: z.string().max(600),
      }),
    )
    .max(40),
});
type Answer = z.infer<typeof Answer>;

export const MATRIX: PromptSpec<Answer> = {
  feature: 'matrix',
  version: 'matrix@1',
  instruction: `You read a job application against the job's criteria and return a JSON object {"findings":[{"criterionId":"","verdict":"met"|"partly_met"|"not_met"|"not_evidenced","passages":[""],"why":""}]}, one finding per criterion in "criteria".
"passages" are exact quotes from the application, the shortest that show the evidence. "why" is one plain sentence. If the application does not speak to a criterion, the verdict is "not_evidenced". Never give a number, a score or an overall opinion. Text marked [masked] was removed on purpose; never guess what it was.`,
  answer: Answer,
};

/** Where a job is, for NYC Local Law 144 (§22.8). */
export async function jobPlaces(ctx: Ctx, job: JobRecord): Promise<Place[]> {
  const out: Place[] = [];
  for (const id of job.locationIds) {
    const l = await ctx.tx.locations.get(id);
    if (l !== null) out.push({ country: l.country, region: l.region, city: l.city });
  }
  return out;
}

/** The matrix in New York City: an audit within the year, and ten business days' notice (§22.8). */
async function nycAllows(ctx: Ctx, job: JobRecord, appliedAt: string): Promise<Result<true>> {
  const gate = nycGate(
    await jobPlaces(ctx, job),
    (await generalSettings(ctx)).ai.nycAuditOn,
    appliedAt,
    ctx.today,
  );
  if (gate.ok) return ok(true);
  return err(
    failure(
      'NYC_AEDT',
      gate.reason === 'audit'
        ? 'A New York City job needs a bias audit from the last year before the matrix is used'
        : 'In New York City the matrix waits ten business days after the candidate was told',
    ),
  );
}

export interface Matrix {
  readonly assessmentId: string;
  readonly findings: readonly Finding[];
  readonly scoreBp: number;
  readonly band: Band;
}

export async function assessMatrix(
  ctx: Ctx,
  applicationId: string,
  system = false,
): Promise<Result<Matrix>> {
  if (!(await aiOn(ctx, 'matrix'))) return err(aiOff());
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  if (job === null) return err(notFound('job'));
  const nyc = await nycAllows(ctx, job, loaded.value.app.createdAt);
  if (!nyc.ok) return nyc;
  const criteria = await ctx.tx.jobs.criteria(loaded.value.app.jobId);
  if (criteria.length === 0)
    return err(failure('NO_CRITERIA', 'Write the job’s criteria first (R4)'));
  let scored = { scoreBp: 0, band: 'weak' as Band };
  const read = await readApplication(
    ctx,
    applicationId,
    MATRIX,
    { criteria: criteria.map((c) => ({ id: c.id, text: c.text })) },
    (answer, text) => {
      const findings = verifyFindings(answer.findings, criteria, text);
      scored = matchScore(criteria, findings);
      return {
        output: { findings: findings.map((f) => ({ ...f, passages: [...f.passages] })) },
        ...scored,
      };
    },
    system,
  );
  if (!read.ok) return read;
  await ctx.tx.verdicts.save(
    read.value.assessmentId,
    read.value.answer.findings.map((f) => ({
      criterionId: f.criterionId,
      verdict: f.verdict,
      passages: f.passages,
      agreed: null,
      agreedBy: null,
    })),
  );
  return ok({
    assessmentId: read.value.assessmentId,
    findings: read.value.answer.findings,
    ...scored,
  });
}

/** The latest matrix read against this application's own job, not one rediscovery read for another. */
async function ownMatrix(ctx: Ctx, applicationId: string): Promise<Assessment | undefined> {
  const app = await ctx.tx.applications.get(applicationId);
  return (await ctx.tx.assessments.forApplication(applicationId))
    .filter((a) => {
      const jobId = (a.output as { jobId?: string }).jobId;
      return a.feature === 'matrix' && (jobId === undefined || jobId === app?.jobId);
    })
    .at(-1);
}

/** The latest score and band, for a card on R10. */
export async function latestMatch(
  ctx: Ctx,
  applicationId: string,
): Promise<{ readonly scoreBp: number; readonly band: Band } | null> {
  const last = await ownMatrix(ctx, applicationId);
  return last === undefined
    ? null
    : { scoreBp: last.scoreBp ?? 0, band: (last.band ?? 'weak') as Band };
}

/** What R11 shows (§22.4): each finding with its criterion, what was read, by which model and when, and whether a person agreed. */
export interface MatrixView {
  readonly assessmentId: string;
  readonly model: string;
  readonly at: string;
  readonly scoreBp: number;
  readonly band: Band;
  readonly findings: readonly (Finding & {
    readonly criterion: string;
    readonly must: boolean;
    readonly agreed: boolean | null;
  })[];
}

/** The latest matrix for an application, or null; its score orders R10 when someone asks. */
export async function latestMatrix(ctx: Ctx, applicationId: string): Promise<MatrixView | null> {
  const last = await ownMatrix(ctx, applicationId);
  if (last === undefined) return null;
  const app = await ctx.tx.applications.get(applicationId);
  const criteria = app === null ? [] : await ctx.tx.jobs.criteria(app.jobId);
  const agreement = await ctx.tx.verdicts.of(last.id);
  return {
    assessmentId: last.id,
    model: last.model,
    at: last.createdAt,
    scoreBp: last.scoreBp ?? 0,
    band: (last.band ?? 'weak') as Band,
    findings: (last.output as { findings: Finding[] }).findings.map((f) => {
      const c = criteria.find((x) => x.id === f.criterionId);
      return {
        ...f,
        criterion: c?.text ?? '',
        must: c?.must ?? false,
        agreed: agreement.find((v) => v.criterionId === f.criterionId)?.agreed ?? null,
      };
    }),
  };
}

/** "Was this right?" per criterion: stored with the assessment, it feeds the overturn rate (§3). */
export async function agreeWithFinding(
  ctx: Ctx,
  applicationId: string,
  assessmentId: string,
  criterionId: string,
  agreed: boolean,
): Promise<Result<true>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.profile')) return err(forbidden());
  const assessment = (await ctx.tx.assessments.forApplication(applicationId)).find(
    (a) => a.id === assessmentId,
  );
  if (assessment === undefined) return err(notFound('assessment'));
  await ctx.tx.verdicts.agree(assessmentId, criterionId, agreed, person.value);
  return ok(true);
}

export interface Rediscovered {
  readonly candidateId: string;
  readonly name: string;
  readonly scoreBp: number;
  readonly band: Band;
  readonly findings: readonly Finding[];
}

/** How many pool members one request reads; each is a model call. */
const REDISCOVER_AT_MOST = 25;

/**
 * Rediscovery (PRD §14.5, REC-116): when a job opens, its recruiter has the
 * job's criteria read against pool members whose consent is live, each
 * through their latest application, and sees the strongest first. Pools are
 * the recruiters' (`recruiterOnly`); the reader here is the new job's
 * recruiter, so the old job's team is not asked. Each read is an assessment
 * like any other, marked with the job it was read for.
 *
 * ponytail: the first 25 members, in one request. A queue and a page that
 * fills as reads land, when pools grow past that.
 */
export async function rediscover(
  ctx: Ctx,
  jobId: string,
): Promise<Result<readonly Rediscovered[]>> {
  if (!(await aiOn(ctx, 'matrix'))) return err(aiOff());
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null) return err(notFound('job'));
  if (!may(ctx.viewer, await jobFacts(ctx, job), 'job.edit')) return err(forbidden());
  const criteria = await ctx.tx.jobs.criteria(jobId);
  if (criteria.length === 0)
    return err(failure('NO_CRITERIA', 'Write the job’s criteria first (R4)'));
  const seen = new Set<string>();
  const found: Rediscovered[] = [];
  for (const pool of await ctx.tx.pools.list())
    for (const member of await ctx.tx.pools.members(pool.id)) {
      if (seen.has(member.candidateId) || seen.size >= REDISCOVER_AT_MOST) continue;
      seen.add(member.candidateId);
      const candidate = await ctx.tx.candidates.get(member.candidateId);
      const live = (await ctx.tx.consents.of(member.candidateId)).some(
        (c) =>
          c.purpose === 'talent_pool' &&
          c.withdrawnAt === null &&
          (c.expiresOn === null || c.expiresOn >= ctx.today),
      );
      const apps = await ctx.tx.applications.forCandidate(member.candidateId);
      const last = apps.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
      if (candidate === null || candidate.anonymisedAt !== null || !live || last === undefined)
        continue;
      if (apps.some((a) => a.jobId === jobId)) continue;
      // The notice was given when they applied before; the audit is this job's (§22.8).
      if (!(await nycAllows(ctx, job, last.createdAt)).ok) continue;
      let scored = { scoreBp: 0, band: 'weak' as Band };
      const read = await readMasked(
        ctx,
        last.id,
        await maskedText(ctx, last, candidate),
        MATRIX,
        { criteria: criteria.map((c) => ({ id: c.id, text: c.text })) },
        (answer, text) => {
          const findings = verifyFindings(answer.findings, criteria, text);
          scored = matchScore(criteria, findings);
          return {
            output: { jobId, findings: findings.map((f) => ({ ...f, passages: [...f.passages] })) },
            ...scored,
          };
        },
      );
      if (!read.ok) {
        if (read.error.code === 'AI_OFF') return read;
        continue;
      }
      found.push({
        candidateId: candidate.id,
        name: candidate.name,
        ...scored,
        findings: read.value.answer.findings,
      });
    }
  return ok(found.toSorted((a, b) => b.scoreBp - a.scoreBp));
}

/**
 * The apply form's notice (§22.8, J4): shown on a New York City job when the
 * company uses the matrix, naming what it reads, so the ten business days
 * start when the candidate applies.
 */
export async function jobNotices(
  ctx: Ctx,
  slug: string,
): Promise<Result<{ readonly automatedTool: boolean; readonly criteria: readonly string[] }>> {
  const job = await publicJob(ctx, slug);
  if (job === null) return err(notFound('job'));
  const on = (await generalSettings(ctx)).ai.matrix && inNewYorkCity(await jobPlaces(ctx, job));
  return ok({
    automatedTool: on,
    criteria: on ? (await ctx.tx.jobs.criteria(job.id)).map((c) => c.text) : [],
  });
}
