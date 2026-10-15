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
 */

const Summary = z.object({
  sentences: z
    .array(z.object({ text: z.string().max(400), cites: z.array(z.string().max(8)).max(10) }))
    .max(12),
});

const SUMMARY: PromptSpec<z.infer<typeof Summary>> = {
  feature: 'writer',
  version: 'debrief-summary@1',
  instruction: `You summarise interview scorecards for a hiring debrief. Each source in "application" starts with its id in brackets. Return a JSON object {"sentences":[{"text":"","cites":["s1"]}]}: at most eight short sentences on where the interviewers agree, where they differ, and what evidence they gave. Every sentence cites the sources it draws on. Never recommend a decision, never average or score, and never guess at anything [masked].`,
  answer: Summary,
};

export interface DebriefSummary {
  readonly assessmentId: string;
  readonly sentences: readonly Cited[];
  readonly sources: readonly { readonly id: string; readonly interviewerId: string }[];
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
    },
    scoreBp: null,
    band: null,
  }));
  if (!read.ok) return read;
  return ok({
    assessmentId: read.value.assessmentId,
    sentences: read.value.answer.sentences,
    sources: sources.map((s) => ({ id: s.id, interviewerId: s.card.interviewerId })),
  });
}
