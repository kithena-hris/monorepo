import type * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

import { may } from '../domain/access/access.js';
import { maskApplication } from '../domain/ai/mask.js';
import { asPerson, forbidden, type Ctx } from './context.js';
import { sha256 } from './intake.js';
import { loadApplication } from './moves.js';
import type { AiFeature, ApplicationRecord, Assessment, Candidate } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * The one way a model reads an application (PRD §22.2), with its limits in
 * code: only for a member of that job's hiring team, for that request; only
 * a feature the company switched on; only the masked text (§14.6); only
 * through the AI gateway, which refuses special-category words whole; and
 * every read logged with the model, the prompt's version, the masked input
 * and its hash, and the answer. What the model says is checked against the
 * feature's schema; a score is the domain's to compute, never the model's.
 */

export interface PromptSpec<T> {
  readonly feature: AiFeature;
  /** Bumped whenever the instruction changes, so an audit knows which one ran. */
  readonly version: string;
  readonly instruction: string;
  readonly answer: z.ZodType<T>;
}

export const aiOff = (): DomainFailure =>
  failure('AI_OFF', 'This needs an AI feature your company has not switched on');

/** The application's text as the model may see it: answers and its files' text, masked. Access is the caller's to check. */
export async function maskedText(
  ctx: Ctx,
  app: ApplicationRecord,
  candidate: Candidate,
): Promise<string> {
  const texts: string[] = [];
  for (const file of await ctx.tx.files.of(candidate.id)) {
    if (file.applicationId !== null && file.applicationId !== app.id) continue;
    const held = await ctx.tx.files.text(file.id);
    if (held !== null && !held.noText) texts.push(held.text);
  }
  const answers = Object.entries(app.answers)
    .filter(([k, v]) => !['name', 'email', 'phone'].includes(k) && typeof v === 'string')
    .map(([k, v]) => `${k}: ${String(v)}`);
  const settings = await generalSettings(ctx);
  return maskApplication(
    [...answers, ...texts].join('\n\n'),
    { name: candidate.name, email: candidate.email, phone: candidate.phone, city: null },
    { schools: settings.ai.maskSchools },
  ).text;
}

type Judge<T> = (
  answer: T,
  text: string,
) => { readonly output: T; readonly scoreBp: number | null; readonly band: string | null };

/** For a member of the job's hiring team: the checks of §22.2, then the read. */
export async function readApplication<T>(
  ctx: Ctx,
  applicationId: string,
  spec: PromptSpec<T>,
  extra: Readonly<Record<string, unknown>> = {},
  /** What the domain makes of the answer before it is kept: the checked output, a score, a band. */
  judge?: Judge<T>,
): Promise<Result<{ readonly assessmentId: string; readonly answer: T; readonly text: string }>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.profile')) return err(forbidden());
  return readMasked(
    ctx,
    loaded.value.app.id,
    await maskedText(ctx, loaded.value.app, loaded.value.candidate),
    spec,
    extra,
    judge,
  );
}

/**
 * The model call and its record, once the caller has decided the reader may
 * ask (`readApplication`, or rediscovery for a job's recruiter). The feature
 * must be on, the text already masked; the answer is checked and kept.
 */
export async function readMasked<T>(
  ctx: Ctx,
  applicationId: string,
  text: string,
  spec: PromptSpec<T>,
  extra: Readonly<Record<string, unknown>>,
  judge?: Judge<T>,
): Promise<Result<{ readonly assessmentId: string; readonly answer: T; readonly text: string }>> {
  const settings = await generalSettings(ctx);
  const model = ctx.deps.model;
  if (model === undefined || !settings.ai[spec.feature]) return err(aiOff());
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const raw = await model.complete(ctx.caller.tenantId, {
    instruction: spec.instruction,
    context: { ...extra, application: text },
  });
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const answer = spec.answer.safeParse(parsed);
  if (!answer.success)
    return err(failure('AI_UNAVAILABLE', 'The assistant could not read this just now'));
  const judged = judge?.(answer.data, text) ?? { output: answer.data, scoreBp: null, band: null };
  const assessment: Assessment = {
    id: ctx.deps.newId(),
    applicationId,
    feature: spec.feature,
    model: model.name,
    promptVersion: spec.version,
    inputHash: sha256(text),
    maskedInput: text,
    output: judged.output,
    scoreBp: judged.scoreBp,
    band: judged.band,
    requestedBy: person.value,
    createdAt: ctx.at,
  };
  await ctx.tx.assessments.save(assessment);
  return ok({ assessmentId: assessment.id, answer: judged.output, text });
}
