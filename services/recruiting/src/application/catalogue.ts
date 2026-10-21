import { err, failure, ok, type Result } from '@kithena/domain-kit';

import {
  BENEFIT_LIBRARY,
  BUILT_IN_CATEGORIES,
  CATEGORY_ICONS,
  libraryBenefit,
  type Benefit,
  type CategoryInfo,
} from '../domain/benefits/benefits.js';
import { adminOnly, type Ctx } from './context.js';

/**
 * The benefits a legal entity can offer (PRD §20): its own, its country's
 * statutory ones, and the standard library, so every entity starts with the
 * full set to pick from without anyone typing it in. A library benefit is
 * kept in the catalogue the first time something uses or changes it; removed,
 * it is hidden for that entity, so it does not come back.
 *
 * Categories are the built-in ones and any the company adds, each with an
 * icon by its name in Reach.
 */

const hiddenKey = (entityId: string): string => `benefits-hidden:${entityId}`;
const CATEGORIES = 'benefit-categories';

interface CustomCategory {
  readonly key: string;
  readonly name: string;
  readonly icon: string;
}

async function hidden(ctx: Ctx, entityId: string): Promise<readonly string[]> {
  return ((await ctx.tx.settings.get(hiddenKey(entityId))) as string[] | null) ?? [];
}

/** Built in first, then the company's own, in the order they were added. */
export async function categoriesOf(ctx: Ctx): Promise<readonly CategoryInfo[]> {
  const custom = ((await ctx.tx.settings.get(CATEGORIES)) as CustomCategory[] | null) ?? [];
  return [...BUILT_IN_CATEGORIES, ...custom.map((c) => ({ ...c, custom: true }))];
}

/** One entity's catalogue: what it keeps, and the library's benefits it has not kept or removed. */
export async function catalogueOf(ctx: Ctx, entityId: string | null): Promise<readonly Benefit[]> {
  if (entityId === null) return [];
  const kept = (await ctx.tx.benefits.list()).filter((b) => b.legalEntityId === entityId);
  const keys = new Set(kept.map((b) => b.key));
  const gone = new Set(await hidden(ctx, entityId));
  const library = BENEFIT_LIBRARY.filter((i) => !keys.has(i.key) && !gone.has(i.key)).map((i) =>
    libraryBenefit(entityId, i),
  );
  return [...kept, ...library];
}

/** Every entity's catalogue, for Settings. */
export async function everyCatalogue(ctx: Ctx): Promise<readonly Benefit[]> {
  const out: Benefit[] = [];
  for (const e of await ctx.tx.entities.list()) out.push(...(await catalogueOf(ctx, e.id)));
  return out;
}

/**
 * Keep the library's benefits these ids name, so an offer, the ad and the
 * job read them from the catalogue like any other. Ids already kept, or not
 * the library's, are left as they are.
 */
export async function keepChosen(
  ctx: Ctx,
  entityId: string,
  ids: readonly string[],
): Promise<void> {
  for (const b of await catalogueOf(ctx, entityId))
    if (ids.includes(b.id) && b.id.startsWith('lib:') && (await ctx.tx.benefits.get(b.id)) === null)
      await ctx.tx.benefits.save(b);
}

/** A library benefit removed from an entity's catalogue stays removed. */
export async function hideFromLibrary(ctx: Ctx, entityId: string, key: string): Promise<void> {
  if (!BENEFIT_LIBRARY.some((i) => i.key === key)) return;
  const was = await hidden(ctx, entityId);
  if (!was.includes(key)) await ctx.tx.settings.set(hiddenKey(entityId), [...was, key]);
}

/** Put a removed library benefit back for every entity. */
export async function restoreLibrary(ctx: Ctx): Promise<Result<true>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  for (const e of await ctx.tx.entities.list()) await ctx.tx.settings.set(hiddenKey(e.id), []);
  return ok(true);
}

const keyOf = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 40);

/** S6: a category of the company's own, or a new name or icon for one. */
export async function saveCategory(
  ctx: Ctx,
  input: { readonly key: string | null; readonly name: string; readonly icon: string },
): Promise<Result<CategoryInfo>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const name = input.name.trim();
  if (name === '') return err(failure('NAME', 'A category has a name'));
  if (!(CATEGORY_ICONS as readonly string[]).includes(input.icon))
    return err(failure('ICON', 'Choose one of the icons'));
  const all = await categoriesOf(ctx);
  const key = input.key ?? `custom_${keyOf(name)}`;
  const held = all.find((c) => c.key === key);
  if (held !== undefined && !held.custom)
    return err(failure('BUILT_IN', 'The built-in categories keep their names'));
  if (input.key === null && held !== undefined)
    return err(failure('DUPLICATE', 'There is a category by that name already'));
  if (all.some((c) => c.key !== key && c.name.toLowerCase() === name.toLowerCase()))
    return err(failure('DUPLICATE', 'There is a category by that name already'));
  const custom = all.filter((c) => c.custom && c.key !== key);
  const next = { key, name, icon: input.icon };
  await ctx.tx.settings.set(CATEGORIES, [
    ...custom.map(({ key: k, name: n, icon }) => ({ key: k, name: n, icon })),
    next,
  ]);
  return ok({ ...next, custom: true });
}

/** A category of the company's own, once nothing is in it. */
export async function removeCategory(ctx: Ctx, key: string): Promise<Result<true>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const all = await categoriesOf(ctx);
  const held = all.find((c) => c.key === key);
  if (held === undefined) return err(failure('NOT_FOUND', 'No such category'));
  if (!held.custom) return err(failure('BUILT_IN', 'The built-in categories stay'));
  if ((await ctx.tx.benefits.list()).some((b) => b.category === key))
    return err(failure('IN_USE', 'Move or remove its benefits first'));
  await ctx.tx.settings.set(
    CATEGORIES,
    all
      .filter((c) => c.custom && c.key !== key)
      .map(({ key: k, name, icon }) => ({ key: k, name, icon })),
  );
  return ok(true);
}
