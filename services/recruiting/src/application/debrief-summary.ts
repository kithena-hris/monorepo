import * as z from 'zod';
import { err, ok, type Result } from '@kithena/domain-kit';

import { may } from '../domain/access/access.js';
import { maskApplication } from '../domain/ai/mask.js';
import { keepCited, type Cited } from '../domain/ai/citations.js';
import { readMasked, type PromptSpec } from './ai.js';
import { forbidden, type Ctx } from './context.js';
import { loadApplication } from './moves.js';
import { generalSettings } from './setup.js';

/**
 * R17's summary (PRD §22.3, REC-119): the model summarises the submitted
 * scorecards and cites each sentence's sources; the domain keeps only cited
 * sentences and computes every average and disagreement itself, as the
 * debrief already does. Scorecards are about a person, so the read is the
 * hiring team's (`scorecards.all`), the notes are masked, and the read is
 * kept like any assessment. Interviewers are `s1`, `s2`… to the model, never
 * names.
 *
 * It also reads the room (the owner's decision, 2026-10-21): the panel's
 * tone, where the evidence points, and a suggestion to proceed, reject or
 * gather more evidence, with a why drawn from the scorecards. A suggestion,
 * kept with the read; the job's recruiter or hiring manager decides.
 */

const Summary = z.object({
  sentences: z
    .array(z.object({ text: z.string().max(400), cites: z.array(z.string().max(8)).max(10) }))
    .max(12),
  /** How the panel reads overall, from what they wrote and rated. */
  tone: z.enum(['positive', 'mixed', 'negative']).catch('mixed'),
  /** Where the evidence points, in a sentence. */
  direction: z.string().max(300).catch(''),
  /** A suggestion for the person deciding, never a decision. */
  suggestion: z.enum(['proceed', 'reject', 'more_evidence']).catch('more_evidence'),
  why: z.string().max(400).catch(''),
});

const SUMMARY: PromptSpec<z.infer<typeof Summary>> = {
  feature: 'writer',
  version: 'debrief-summary@2',
  instruction: `You summarise interview scorecards for a hiring debrief. Each source in "application" starts with its id in brackets. Return a JSON object {"sentences":[{"text":"","cites":["s1"]}],"tone":"positive|mixed|negative","direction":"","suggestion":"proceed|reject|more_evidence","why":""}: at most eight short sentences on where the interviewers agree, where they differ, and what evidence they gave, every sentence citing the sources it draws on; then the overall tone of the panel, the direction the evidence points in one sentence, and a suggestion for the person deciding, to proceed, to reject, or to gather more evidence where the scorecards are too few or split, with a one-sentence why drawn only from the scorecards. A person decides. Never average or score, never judge anything but the evidence written, and never guess at anything [masked].`,
  answer: Summary,
};

export interface DebriefSummary {
  readonly assessmentId: string;
  readonly sentences: readonly Cited[];
  readonly sources: readonly { readonly id: string; readonly interviewerId: string }[];
  readonly tone: 'positive' | 'mixed' | 'negative';
  readonly direction: string;
  /** A suggestion only: the job's recruiter or hiring manager decides (`decideDebrief`). */
  readonly suggestion: 'proceed' | 'reject' | 'more_evidence';
  readonly why: string;
}

export async function summariseDebrief(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<DebriefSummary>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'scorecards.all')) return err(forbidden());
  const { candidate } = loaded.value;
  const cards = (await ctx.tx.interviews.forApplicationScorecards(applicationId)).filter(
    (c) => c.submittedAt !== null,
  );
  const notes = await ctx.tx.interviews.scorecardNotes(applicationId);
  const settings = await generalSettings(ctx);
  const sources = cards.map((c, i) => ({ id: `s${String(i + 1)}`, card: c }));
  const text = sources
    .map(({ id, card }) => {
      const said = notes.find(
        (n) => n.interviewId === card.interviewId && n.interviewerId === card.interviewerId,
      )?.notes;
      const ratings = Object.entries(card.ratings)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(', ');
      return `[${id}] recommendation: ${card.recommendation ?? 'none'}; ratings: ${ratings}${said === undefined ? '' : `; notes: ${said}`}`;
    })
    .join('\n');
  const masked = maskApplication(
    text,
    { name: candidate.name, email: candidate.email, phone: candidate.phone, city: null },
    { schools: settings.ai.maskSchools },
  ).text;
  const ids = new Set(sources.map((s) => s.id));
  const read = await readMasked(ctx, applicationId, masked, SUMMARY, {}, (answer) => ({
    output: {
      sentences: keepCited(answer.sentences, ids).map((s) => ({ ...s, cites: [...s.cites] })),
      tone: answer.tone,
      direction: answer.direction,
      suggestion: answer.suggestion,
      why: answer.why,
    },
    scoreBp: null,
    band: null,
  }));
  if (!read.ok) return read;
  return ok({
    assessmentId: read.value.assessmentId,
    sentences: read.value.answer.sentences,
    sources: sources.map((s) => ({ id: s.id, interviewerId: s.card.interviewerId })),
    // Too little to go on is said, not guessed: with one scorecard or none, more evidence.
    tone: read.value.answer.tone,
    direction: read.value.answer.direction,
    suggestion: cards.length === 0 ? 'more_evidence' : read.value.answer.suggestion,
    why: read.value.answer.why,
  });
}
