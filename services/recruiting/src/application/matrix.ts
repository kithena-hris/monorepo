import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { matchScore, verifyFindings, type Band, type Finding } from '../domain/ai/matrix.js';
import { may } from '../domain/access/access.js';
import { readApplication, type PromptSpec } from './ai.js';
import { asPerson, forbidden, notFound, type Ctx } from './context.js';
import { loadApplication } from './moves.js';

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

export interface Matrix {
  readonly assessmentId: string;
  readonly findings: readonly Finding[];
  readonly scoreBp: number;
  readonly band: Band;
}

export async function assessMatrix(ctx: Ctx, applicationId: string): Promise<Result<Matrix>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
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

/** The latest score and band, for a card on R10. */
export async function latestMatch(
  ctx: Ctx,
  applicationId: string,
): Promise<{ readonly scoreBp: number; readonly band: Band } | null> {
  const last = (await ctx.tx.assessments.forApplication(applicationId))
    .filter((a) => a.feature === 'matrix')
    .at(-1);
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
  const last = (await ctx.tx.assessments.forApplication(applicationId))
    .filter((a) => a.feature === 'matrix')
    .at(-1);
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
