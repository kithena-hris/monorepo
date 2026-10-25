import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { adminOnly, notFound, type Ctx } from './context.js';

/**
 * The collective agreements a company hires under (PRD §19.5): a convenio, a
 * Tarifvertrag, each with its professional groups. Written once in Settings
 * and picked from a list on a job and an offer, never typed there, so the key
 * the contract carries is always one the company wrote down.
 *
 * ponytail: one JSON list for the company; a table when agreements are searched or shared.
 */
export interface Agreement {
  readonly id: string;
  /** What the contract carries: lowercase letters, digits and underscores, from the name. */
  readonly key: string;
  readonly name: string;
  readonly country: string;
  readonly groups: readonly string[];
}

const KEY = 'collective-agreements';

/** "Convenio de consultoría" → "convenio_de_consultoria". */
export const agreementKey = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replace(/^[^a-z]+/u, '')
    .replace(/_+$/u, '');

/** The company's agreements, or those of one country. */
export async function agreementsOf(ctx: Ctx, country?: string): Promise<readonly Agreement[]> {
  const all = ((await ctx.tx.settings.get(KEY)) as Agreement[] | null) ?? [];
  return country === undefined ? all : all.filter((a) => a.country === country);
}

export async function saveAgreement(
  ctx: Ctx,
  input: {
    readonly id: string;
    readonly name: string;
    readonly country: string;
    readonly groups: readonly string[];
  },
): Promise<Result<Agreement>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const name = input.name.trim();
  const key = agreementKey(name);
  if (key === '') return err(failure('NAME', 'Name the agreement with at least one letter'));
  const all = await agreementsOf(ctx);
  if (all.some((a) => a.id !== input.id && a.key === key && a.country === input.country))
    return err(failure('DUPLICATE', 'That agreement is in the list already'));
  const groups = [...new Set(input.groups.map((g) => g.trim()).filter((g) => g !== ''))];
  const saved: Agreement = { id: input.id, key, name, country: input.country, groups };
  await ctx.tx.settings.set(
    KEY,
    all.some((a) => a.id === input.id)
      ? all.map((a) => (a.id === input.id ? saved : a))
      : [...all, saved],
  );
  return ok(saved);
}

export async function removeAgreement(ctx: Ctx, id: string): Promise<Result<true>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const all = await agreementsOf(ctx);
  if (!all.some((a) => a.id === id)) return err(notFound('agreement'));
  await ctx.tx.settings.set(
    KEY,
    all.filter((a) => a.id !== id),
  );
  return ok(true);
}
