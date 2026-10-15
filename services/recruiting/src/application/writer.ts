import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { renderAd } from '../domain/ad/render.js';
import { docFrom, textsOf, withTexts } from '../domain/ad/rewrite.js';
import { write, type PromptSpec } from './ai.js';
import type { Ctx } from './context.js';
import { editable } from './jobs.js';

/**
 * Writing a job ad with a model (PRD §22.3, REC-117): drafting from the
 * intake, explaining a flagged phrase, and translating the prose. Nothing is
 * saved here: the draft lands in the editor, a person edits it and saves, and
 * saving runs the ad checks (§8.3) as it always does. Salary, terms and
 * benefits stay data the page renders, never prose a model wrote.
 */

const LANGUAGES = { en: 'English', es: 'Spanish', de: 'German', hi: 'Hindi' } as const;
const name = (language: string): string =>
  (LANGUAGES as Readonly<Record<string, string | undefined>>)[language] ?? language;

const Draft = z.object({
  title: z.string().max(160),
  sections: z
    .array(
      z.object({
        heading: z.string().max(120).nullable(),
        paragraphs: z.array(z.string().max(1500)).max(8),
      }),
    )
    .max(8),
});

const DRAFT: PromptSpec<z.infer<typeof Draft>> = {
  feature: 'writer',
  version: 'ad-draft@1',
  instruction: `You draft a job ad from the facts given. Return a JSON object {"title":"","sections":[{"heading":""|null,"paragraphs":[""]}]} in the language named in "language".
Sections: the role, what you will do, what you bring, how we work. Plain, specific, warm, no clichés. Gender-neutral throughout. Never mention age, nationality, appearance, family, religion or health, and never ask for a photo. Leave out salary, contract terms and benefits: the page shows those from data.`,
  answer: Draft,
};

export async function draftAd(
  ctx: Ctx,
  jobId: string,
  input: { readonly language: string; readonly intake: string },
): Promise<Result<{ readonly title: string; readonly doc: unknown; readonly html: string }>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const job = held.value;
  const criteria = await ctx.tx.jobs.criteria(jobId);
  const drafted = await write(ctx, DRAFT, {
    language: name(input.language),
    title: job.title,
    workMode: job.workMode,
    seniority: job.outline.seniority,
    mustHaves: criteria.filter((c) => c.must).map((c) => c.text),
    niceToHaves: criteria.filter((c) => !c.must).map((c) => c.text),
    intake: input.intake.slice(0, 4000),
  });
  if (!drafted.ok) return drafted;
  const doc = docFrom(drafted.value.sections);
  return ok({ title: drafted.value.title, doc, html: renderAd(doc).html });
}

const Hint = z.object({ explanation: z.string().max(600), suggestion: z.string().max(300) });

const EXPLAIN: PromptSpec<z.infer<typeof Hint>> = {
  feature: 'writer',
  version: 'ad-explain@1',
  instruction: `A phrase in a job ad was flagged by an inclusive-language check. Return a JSON object {"explanation":"","suggestion":""} in the language named in "language": one or two sentences on who the phrase may put off and why, and a neutral phrase to use instead that keeps the meaning.`,
  answer: Hint,
};

export async function explainPhrase(
  ctx: Ctx,
  jobId: string,
  input: { readonly language: string; readonly phrase: string; readonly check: string },
): Promise<Result<z.infer<typeof Hint>>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  return write(ctx, EXPLAIN, {
    language: name(input.language),
    phrase: input.phrase.slice(0, 300),
    flaggedBecause: input.check.slice(0, 300),
  });
}

const Pieces = z.object({ title: z.string().max(160), pieces: z.array(z.string().max(1500)) });

const TRANSLATE: PromptSpec<z.infer<typeof Pieces>> = {
  feature: 'writer',
  version: 'ad-translate@1',
  instruction: `You translate a job ad. "pieces" is the ad's text in order, split where its formatting changes. Return a JSON object {"title":"","pieces":[""]} with the title and every piece translated into the language named in "to": exactly as many pieces, in the same order, keeping each piece's leading and trailing spaces. Gender-neutral throughout; in German use a form such as (m/w/d) in the title.`,
  answer: Pieces,
};

/** A translation for a person to approve: they save it, and the checks run then. */
export async function translateAd(
  ctx: Ctx,
  jobId: string,
  input: { readonly from: string; readonly to: string },
): Promise<Result<{ readonly title: string; readonly doc: unknown; readonly html: string }>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const ad = (await ctx.tx.jobs.ads(jobId)).find((a) => a.language === input.from);
  if (ad === undefined) return err(failure('NOT_FOUND', 'There is no ad in that language yet'));
  const pieces = textsOf(ad.doc);
  const translated = await write(ctx, TRANSLATE, {
    to: name(input.to),
    title: ad.title,
    pieces,
  });
  if (!translated.ok) return translated;
  const doc = withTexts(ad.doc, translated.value.pieces);
  if (!doc.ok) return doc;
  return ok({ title: translated.value.title, doc: doc.value, html: renderAd(doc.value).html });
}
