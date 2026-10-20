import * as z from 'zod';
import { err, ok, type Result } from '@kithena/domain-kit';

import { may } from '../domain/access/access.js';
import { checkProfile, type Profile, type ProfileIssue } from '../domain/ai/profile.js';
import { readApplication, type PromptSpec } from './ai.js';
import { forbidden, notFound, type Ctx } from './context.js';
import { loadApplication } from './moves.js';

/**
 * The CV parser (PRD §14.2, REC-113): a member of the hiring team asks, the
 * model reads the masked application and returns a typed profile with the
 * passage behind every value, the domain drops what the text does not say and
 * flags odd dates, and the candidate confirms it on their own page. Nothing
 * here decides anything: it fills a profile a person checks.
 */

const Passaged = z.object({ value: z.string().max(300), passage: z.string().max(600) });

const ProfileAnswer = z.object({
  work: z
    .array(
      z.object({
        employer: Passaged,
        title: Passaged,
        from: Passaged,
        to: Passaged.nullable(),
      }),
    )
    .max(30),
  education: z
    .array(
      z.object({
        institution: Passaged,
        qualification: Passaged.nullable(),
        to: Passaged.nullable(),
      }),
    )
    .max(15),
  skills: z.array(Passaged).max(60),
  languages: z.array(Passaged.extend({ level: z.string().max(20).nullable() })).max(15),
  certifications: z.array(Passaged).max(30),
});

export const PARSER: PromptSpec<Profile> = {
  feature: 'parser',
  version: 'parser@1',
  instruction: `You read a job application's text and return a JSON object with the keys work, education, skills, languages and certifications, exactly in this shape:
{"work":[{"employer":{"value":"","passage":""},"title":{...},"from":{...},"to":{...}|null}],"education":[{"institution":{...},"qualification":{...}|null,"to":{...}|null}],"skills":[{...}],"languages":[{"value":"","level":"C1"|null,"passage":""}],"certifications":[{...}]}
Every value is copied from the text, and "passage" is the shortest exact quote from the text that contains it. Dates are YYYY-MM or YYYY. Leave out anything the text does not say. Never guess, never judge, never add a score. Text marked [masked] was removed on purpose; do not try to restore it.`,
  answer: ProfileAnswer,
};

export interface Parsed {
  readonly assessmentId: string;
  readonly profile: Profile;
  readonly issues: readonly ProfileIssue[];
  readonly confirmedAt: string | null;
  /** What the candidate said was wrong, in their words. */
  readonly note: string | null;
}

const key = (applicationId: string) => `parsed_profile:${applicationId}`;

export async function parseCv(
  ctx: Ctx,
  applicationId: string,
  system = false,
): Promise<Result<Parsed>> {
  const read = await readApplication(ctx, applicationId, PARSER, {}, undefined, system);
  if (!read.ok) return read;
  const checked = checkProfile(read.value.answer, read.value.text, ctx.today);
  const parsed: Parsed = {
    assessmentId: read.value.assessmentId,
    profile: checked.profile,
    issues: checked.issues,
    confirmedAt: null,
    note: null,
  };
  await ctx.tx.settings.set(key(applicationId), parsed);
  return ok(parsed);
}

/** For the hiring team, beside the CV on R11. */
export async function parsedProfile(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<Parsed | null>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.profile')) return err(forbidden());
  return ok((await ctx.tx.settings.get(key(applicationId))) as Parsed | null);
}

async function ownApplication(ctx: Ctx, candidateId: string, applicationId: string) {
  const app = await ctx.tx.applications.get(applicationId);
  return app?.candidateId === candidateId ? app : null;
}

/** The candidate's own view of what was read (J6): the profile, never the assessment. */
export async function myParsedProfile(
  ctx: Ctx,
  candidateId: string,
  applicationId: string,
): Promise<Result<Omit<Parsed, 'assessmentId'> | null>> {
  if ((await ownApplication(ctx, candidateId, applicationId)) === null)
    return err(notFound('application'));
  const held = (await ctx.tx.settings.get(key(applicationId))) as Parsed | null;
  if (held === null) return ok(null);
  const { assessmentId: _id, ...mine } = held;
  return ok(mine);
}

export async function confirmParsedProfile(
  ctx: Ctx,
  candidateId: string,
  applicationId: string,
  note: string | null,
): Promise<Result<true>> {
  if ((await ownApplication(ctx, candidateId, applicationId)) === null)
    return err(notFound('application'));
  const held = (await ctx.tx.settings.get(key(applicationId))) as Parsed | null;
  if (held === null) return err(notFound('profile'));
  await ctx.tx.settings.set(key(applicationId), {
    ...held,
    confirmedAt: ctx.at,
    note: note === null || note.trim() === '' ? null : note.trim().slice(0, 2000),
  });
  return ok(true);
}
