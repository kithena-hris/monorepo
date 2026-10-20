import * as z from 'zod';
import { JobSearch } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { aiOff, write, type PromptSpec } from './ai.js';
import type { Ctx } from './context.js';
import { publicJob } from './intake.js';
import type { Model } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * J8, the job assistant (PRD §10.6, REC-121). On a job page it answers from
 * the ad, the company's about text and the process steps, nothing else; it
 * says it is an AI (AI Act art. 50); it never assesses, never asks for
 * personal data and never promises; and when its sources do not answer, it
 * hands over to the recruiter. On search it turns a sentence into the
 * filters a person can see and change; the database searches.
 */

const Answer = z.object({ answer: z.string().max(1200), fromSources: z.boolean() });

const ASK: PromptSpec<z.infer<typeof Answer>> = {
  feature: 'assistant',
  version: 'job-assistant@1',
  instruction: `You answer a job seeker's question about one job, only from "ad", "company" and "process". Return a JSON object {"answer":"","fromSources":true|false}. If the sources do not say, answer that you do not know and set fromSources to false. Never assess the person, never ask for personal details, never promise an outcome, a salary or a date the sources do not give. Answer in the language of the question, in at most four sentences.`,
  answer: Answer,
};

export interface JobAnswer {
  /** Always true: the page says an AI answered (AI Act art. 50). */
  readonly ai: true;
  readonly answer: string;
  /** False when the sources did not answer: the page offers to ask the recruiter. */
  readonly answered: boolean;
}

export async function askAboutJob(
  ctx: Ctx,
  slug: string,
  question: string,
): Promise<Result<JobAnswer>> {
  const job = await publicJob(ctx, slug);
  if (job === null) return err(failure('NOT_FOUND', 'No such job'));
  const settings = await generalSettings(ctx);
  const ads = await ctx.tx.jobs.ads(job.id);
  const ad = ads.find((a) => a.language === job.languages[0]) ?? ads[0];
  const steps = (await ctx.tx.jobs.stages(job.id))
    .map((s) => s.candidateName)
    .filter((n): n is string => n !== null);
  const said = await write(ctx, ASK, {
    question: question.slice(0, 500),
    ad: ad === undefined ? job.title : `${ad.title}\n${ad.plain}`.slice(0, 12_000),
    company: settings.about ?? settings.companyName,
    process: steps,
  });
  if (!said.ok) return said;
  return ok({ ai: true, answer: said.value.answer, answered: said.value.fromSources });
}

/** "Ask the recruiter": the question goes to the job's recruiters by email, with the asker's address to reply to. */
export async function askRecruiter(
  ctx: Ctx,
  slug: string,
  email: string,
  question: string,
): Promise<Result<{ sent: true }>> {
  const job = await publicJob(ctx, slug);
  if (job === null) return err(failure('NOT_FOUND', 'No such job'));
  for (const t of await ctx.tx.jobs.team(job.id)) {
    if (t.role !== 'recruiter') continue;
    const member = await ctx.tx.members.get(t.personId as never);
    if (member?.workEmail == null) continue;
    ctx.mail.push({
      to: member.workEmail,
      subject: `A question about ${job.title}`,
      text: `Someone asked on Kithena Jobs:\n\n${question.slice(0, 2000)}\n\nReply to them at ${email}.`,
      dedupeKey: `ask:${job.id}:${email}:${ctx.at}`,
    });
  }
  return ok({ sent: true });
}

const Plan = z.object({
  filters: z.record(z.string(), z.unknown()),
  say: z.string().max(200).default(''),
});

const PLAN = {
  version: 'search-plan@2',
  instruction: `You turn a job seeker's sentence into search filters. Return a JSON object {"filters":{},"say":""}. "say" is one short, friendly sentence on what you understood ("Remote design roles in Spain from 50k a year"), no questions. "filters" uses only these keys: q (keywords), country (ES, DE, GB, IN or US), city, workMode (array of onsite, hybrid, remote), hours (full_time or part_time), seniority (array of entry, mid, senior, lead, executive), salaryFromMinor (yearly, in the currency's minor units), currency (ISO code), postedWithinDays. Leave out anything the sentence does not say.`,
};

/**
 * The search's sentence to filters, with no tenant: only `JobSearch` keys
 * survive, checked by the same schema the search uses, so the model can add
 * nothing the person could not have typed.
 */
export async function planSearch(
  model: Model | undefined,
  sentence: string,
): Promise<Result<{ readonly filters: JobSearch; readonly say: string }>> {
  if (model === undefined) return err(aiOff());
  const raw = await model.complete('kithena-jobs', {
    instruction: PLAN.instruction,
    context: { sentence: sentence.slice(0, 300) },
  });
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const plan = Plan.safeParse(parsed);
  const search = plan.success ? JobSearch.safeParse(plan.data.filters) : null;
  return search?.success === true && plan.success
    ? ok({ filters: search.data, say: plan.data.say })
    : err(failure('AI_UNAVAILABLE', 'Try the filters instead'));
}
