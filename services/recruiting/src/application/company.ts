import { createHash } from 'node:crypto';
import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { aiOff } from './ai.js';
import { adminOnly, type Ctx } from './context.js';
import { refreshProjection } from './jobs.js';
import { generalSettings, saveGeneralSettings } from './setup.js';
import type { GeneralSettings } from './setup.js';

/**
 * The company on its careers page (S1): its settings kept and shown on every
 * open job at once, its logo uploaded here, and an "about" an AI writes from
 * the company's own website and a web search, said to be the AI's.
 */

/**
 * Keep the general settings and rewrite every open job's public listing, so
 * a new name, logo or address shows on the jobs already out, in search as on
 * their own pages.
 */
export async function saveSettings(ctx: Ctx, input: unknown): Promise<Result<GeneralSettings>> {
  const saved = await saveGeneralSettings(ctx, input);
  if (!saved.ok) return saved;
  for (const job of await ctx.tx.jobs.list())
    if (job.state === 'open') await refreshProjection(ctx, job);
  return saved;
}

const LOGO_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const LOGO_MAX = 1_000_000;

export const LogoUpload = z.object({
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  /** The file, base64. */
  data: z.string().max(Math.ceil((LOGO_MAX * 4) / 3) + 4),
});

/** The name a logo is kept and served under: its own hash, so a cached copy is never stale. */
export const LOGO_NAME = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/u;

/**
 * A logo for the careers page, every job and every email: kept by its hash
 * and served by Kithena Jobs. Answers its address, which the settings keep
 * when saved. PNG, JPEG or WebP up to a megabyte; never SVG, which can carry
 * a script.
 */
export async function uploadLogo(
  ctx: Ctx,
  input: z.infer<typeof LogoUpload>,
): Promise<Result<{ readonly logoUrl: string }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const bytes = Buffer.from(input.data, 'base64');
  if (bytes.length === 0 || bytes.length > LOGO_MAX)
    return err(failure('LOGO_SIZE', 'A logo is up to 1 MB'));
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${LOGO_TYPES[input.mediaType] ?? 'png'}`;
  await ctx.deps.blobs.put(`logos/${name}`, bytes, input.mediaType);
  return ok({ logoUrl: `${ctx.deps.jobsOrigin}/logos/${name}` });
}

const ABOUT = {
  instruction: `You write the short "about the company" a company's careers page opens with. Return a JSON object {"about":"","sources":[""]} and nothing else.
"about": two to four plain sentences, at most 90 words, in English: what the company does, for whom, and where, and what it is like to work there only if a source says so. Use only what "website" (the company's own site, as text) and your web search show about this company; never invent a number, a date, a customer, an award or a claim. If you cannot tell which company this is, or found nothing reliable, return an empty "about".
"sources": the addresses you took it from.`,
} as const;

const Answer = z.object({
  about: z.string().max(1200),
  sources: z.array(z.string().max(500)).max(10).default([]),
});

/** The likely homes of a company called this: name.com, its words hyphenated, and the like. */
export function domainsFor(name: string): string[] {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((w) => w !== '' && !['gmbh', 'ltd', 'inc', 'llc', 'sl', 'sa', 'ag', 'plc'].includes(w));
  if (words.length === 0) return [];
  const joined = words.join('');
  const hyphened = words.join('-');
  return [...new Set([`${joined}.com`, `${hyphened}.com`, `${joined}.de`, `${joined}.co.uk`])];
}

/**
 * The company's "about", written by AI: from its own website, found from the
 * domains given (the reply address's, the careers domain's) and those its
 * name suggests, and from a web search where the model has one. Always the
 * AI's words, to be read and changed before they are kept.
 */
export async function describeCompany(
  ctx: Ctx,
  input: { readonly name: string; readonly domains: readonly string[] },
): Promise<
  Result<{
    readonly about: string;
    readonly sources: readonly string[];
    readonly searched: boolean;
  }>
> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const model = ctx.deps.model;
  if (model === undefined || !(await generalSettings(ctx)).ai.writer) return err(aiOff());
  const name = input.name.trim();
  if (name === '') return err(failure('NAME', 'Name the company first'));
  // The first site that names the company is taken as its own.
  const first = name.toLowerCase().split(/\s+/u)[0] ?? '';
  let site: { readonly url: string; readonly text: string } | null = null;
  for (const host of [...new Set([...input.domains, ...domainsFor(name)])].slice(0, 6)) {
    const page = (await ctx.deps.web?.read(host.toLowerCase())) ?? null;
    if (page !== null && page.text.toLowerCase().includes(first)) {
      site = page;
      break;
    }
  }
  const prompt = {
    instruction: ABOUT.instruction,
    context: {
      company: name,
      website: site === null ? null : { address: site.url, text: site.text.slice(0, 6_000) },
    },
  };
  const research = model.research?.bind(model);
  const searched = research !== undefined;
  const raw =
    research === undefined
      ? await model.complete(ctx.caller.tenantId, prompt)
      : await research(ctx.caller.tenantId, prompt);
  // With a search the JSON sits in the text: the outermost braces are the answer.
  const json = raw === null ? null : (/\{[\s\S]*\}/u.exec(raw)?.[0] ?? null);
  let parsed: unknown = null;
  try {
    parsed = json === null ? null : JSON.parse(json);
  } catch {
    parsed = null;
  }
  const answer = Answer.safeParse(parsed);
  if (!answer.success)
    return err(failure('AI_UNAVAILABLE', 'The assistant could not write this just now'));
  if (answer.data.about.trim() === '')
    return err(
      failure('NOT_FOUND', `Nothing reliable was found about ${name}; write it in your own words`),
    );
  const sources = [
    ...new Set([...(site === null ? [] : [site.url]), ...answer.data.sources]),
  ].filter((s) => s.startsWith('https://'));
  return ok({ about: answer.data.about.trim(), sources, searched });
}
