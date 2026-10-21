import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { renderAd } from '../domain/ad/render.js';
import { docFrom, textsOf, withTexts } from '../domain/ad/rewrite.js';
import { write, type PromptSpec } from './ai.js';
import { adminOnly, forbidden, notFound, type Ctx } from './context.js';
import { competenciesOf } from './interviews.js';
import { editable } from './jobs.js';
import { loadApplication, render } from './moves.js';
import { may } from '../domain/access/access.js';
import { generalSettings } from './setup.js';
import type { ScorecardTemplate } from './ports.js';

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
  version: 'ad-draft@2',
  instruction: `You draft a job ad from the facts given. Return a JSON object {"title":"","sections":[{"heading":""|null,"paragraphs":[""]}]} in the language named in "language".
Sections: the role, what you will do, what you bring, how we work. Draw on the title, the team, the level, the place and how the work is done; "intake" may add what the team said, and may be empty. Use what is typical for such a role in that place, never facts about the company it was not given. Plain, specific, warm, no clichés. Gender-neutral throughout. Never mention age, nationality, appearance, family, religion or health, and never ask for a photo. Leave out salary, contract terms and benefits: the page shows those from data.`,
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
  const place =
    job.locationIds[0] === undefined ? null : await ctx.tx.locations.get(job.locationIds[0]);
  const settings = await generalSettings(ctx);
  const drafted = await write(ctx, DRAFT, {
    language: name(input.language),
    company: settings.companyName,
    title: job.title,
    team: job.department,
    place: place === null ? null : { city: place.city, country: place.country },
    workMode: job.workMode,
    contract: job.outline.contractType,
    hours: job.outline.hours,
    openings: job.openings,
    seniority: job.outline.seniority,
    interviews: (await ctx.tx.jobs.plan(jobId)).map((p) => p.title),
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

const Kit = z.object({
  competencies: z
    .array(z.object({ key: z.string().max(64), questions: z.array(z.string().max(300)).max(6) }))
    .max(20),
});

const KIT: PromptSpec<z.infer<typeof Kit>> = {
  feature: 'writer',
  version: 'kit-questions@1',
  instruction: `You suggest interview questions for a scorecard. Return a JSON object {"competencies":[{"key":"","questions":[""]}]} with up to four open, behavioural questions for each competency, by its key. Each asks for a specific past example and can be answered by anyone with the competency, whatever their background. Never ask about age, family, health, religion, nationality or anything outside the job. Do not repeat a question the competency already has.`,
  answer: Kit,
};

/**
 * R14 (REC-118): questions suggested per competency. The domain keeps the
 * scorecard's competencies and its four-point scale; only questions are
 * added, to known competencies, without repeats, four at most each. Nothing
 * is saved until an administrator keeps them.
 */
export async function suggestQuestions(
  ctx: Ctx,
  templateId: string,
): Promise<Result<ScorecardTemplate>> {
  const allowed = adminOnly(ctx);
  if (!allowed.ok) return allowed;
  const template = await ctx.tx.scorecardTemplates.get(templateId);
  if (template === null) return err(notFound('scorecard'));
  const suggested = await write(ctx, KIT, {
    scorecard: template.name,
    competencies: template.competencies.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      questions: c.questions,
    })),
  });
  if (!suggested.ok) return suggested;
  return ok({
    ...template,
    competencies: template.competencies.map((c) => {
      const asked = new Set(c.questions.map((q) => q.trim().toLowerCase()));
      const added = (suggested.value.competencies.find((x) => x.key === c.key)?.questions ?? [])
        .map((q) => q.trim())
        .filter((q) => q !== '' && !asked.has(q.toLowerCase()))
        .slice(0, 4);
      return { ...c, questions: [...c.questions, ...added] };
    }),
  });
}

const Email = z.object({ subject: z.string().max(200), body: z.string().max(5000) });

const EMAIL: PromptSpec<z.infer<typeof Email>> = {
  feature: 'writer',
  version: 'email-draft@1',
  instruction: `You draft an email from a hiring team to a candidate. Return a JSON object {"subject":"","body":""} in the language named in "language", for the purpose in "intent". Write {{candidate}} where the candidate's name goes, {{job}} for the job's title and {{company}} for the company: never invent a name, a date, a time, a salary or a promise. Warm, plain and short.`,
  answer: Email,
};

/**
 * R12 (REC-120): an email drafted from its purpose. The model writes with
 * placeholders and never sees the candidate's name; the domain fills them
 * from data, and the draft lands in the composer for a person to edit and
 * send.
 */
export async function draftEmail(
  ctx: Ctx,
  applicationId: string,
  input: { readonly intent: string; readonly language?: string | undefined },
): Promise<Result<{ readonly subject: string; readonly body: string }>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.message')) return err(forbidden());
  const drafted = await write(ctx, EMAIL, {
    intent: input.intent.slice(0, 500),
    // The language the candidate applied in, unless the sender says otherwise.
    language: name(input.language ?? loaded.value.app.language),
  });
  if (!drafted.ok) return drafted;
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  const values = {
    candidate: loaded.value.candidate.name,
    job: job?.title ?? '',
    company: (await generalSettings(ctx)).companyName,
  };
  return ok({
    subject: render(drafted.value.subject, values),
    body: render(drafted.value.body, values),
  });
}

const AgendaDraft = z.object({
  intro: z.string().max(400),
  sections: z
    .array(
      z.object({
        heading: z.string().max(80),
        minutes: z.int().min(0).max(240).nullable(),
        points: z.array(z.string().max(240)).max(6),
      }),
    )
    .max(6),
  prepare: z.array(z.string().max(240)).max(5),
});

const AGENDA: PromptSpec<z.infer<typeof AgendaDraft>> = {
  feature: 'writer',
  version: 'interview-agenda@1',
  instruction: `You draft the agenda of a job interview, for the candidate, from the job and the interview given. Return a JSON object {"intro":"","sections":[{"heading":"","minutes":0,"points":[""]}],"prepare":[""]} in English: one warm sentence on what the interview is for; its parts in order, each with the minutes it takes (together the interview's length) and what happens in it, drawn from the competencies to be assessed; and what the candidate might prepare. Plain, specific, kind. Never ask for anything personal, never mention age, nationality, appearance, family, religion or health, and never reveal how answers are scored.`,
  answer: AgendaDraft,
};

const escapeHtml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * R16: an interview's agenda drafted from the job, the interview's length
 * and the competencies it assesses, as rich text for the editor and plain
 * text for the invitation and the calendar. Nothing about the candidate goes
 * to the model; a person edits it before it is sent.
 */
export async function draftAgenda(
  ctx: Ctx,
  applicationId: string,
  planKey: string,
): Promise<Result<{ readonly html: string; readonly text: string }>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  const plan = (await ctx.tx.jobs.plan(loaded.value.app.jobId)).find((p) => p.key === planKey);
  if (job === null || plan === undefined) return err(notFound('interview in the plan'));
  const competencies = await competenciesOf(ctx, job.id, plan.key);
  const criteria = await ctx.tx.jobs.criteria(job.id);
  const ad = (await ctx.tx.jobs.ads(job.id))[0];
  const settings = await generalSettings(ctx);
  const drafted = await write(ctx, AGENDA, {
    company: settings.companyName,
    job: job.title,
    interview: plan.title,
    minutes: plan.minutes,
    competencies: competencies.map((c) => ({ name: c.name, description: c.description })),
    mustHaves: criteria.filter((c) => c.must).map((c) => c.text),
    ad: (ad?.plain ?? '').slice(0, 3000),
  });
  if (!drafted.ok) return drafted;
  const d = drafted.value;
  const html = [
    `<p>${escapeHtml(d.intro)}</p>`,
    ...d.sections.map(
      (s) =>
        `<h3>${escapeHtml(s.minutes === null ? s.heading : `${s.heading} (${String(s.minutes)} min)`)}</h3><ul>${s.points.map((p) => `<li><p>${escapeHtml(p)}</p></li>`).join('')}</ul>`,
    ),
    ...(d.prepare.length === 0
      ? []
      : [
          `<h3>To prepare</h3><ul>${d.prepare.map((p) => `<li><p>${escapeHtml(p)}</p></li>`).join('')}</ul>`,
        ]),
  ].join('');
  const text = [
    d.intro,
    ...d.sections.map(
      (s) =>
        `\n${s.minutes === null ? s.heading : `${s.heading} (${String(s.minutes)} min)`}\n${s.points.map((p) => `- ${p}`).join('\n')}`,
    ),
    ...(d.prepare.length === 0
      ? []
      : [`\nTo prepare\n${d.prepare.map((p) => `- ${p}`).join('\n')}`]),
  ].join('\n');
  return ok({ html, text });
}
