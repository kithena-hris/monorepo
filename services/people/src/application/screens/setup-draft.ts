import { ok, type Result } from '@kithena/domain-kit';

import { CORE_PACK } from '../../country-packs/core.js';
import {
  applyPack,
  COUNTRY_PACKS,
  type CountryPack,
  type PackCountry,
} from '../../country-packs/packs.js';
import { seedCountryPack } from '../../country-packs/seed.js';
import { SchemaDraft, type Attribute, type Section } from '../../domain/schema/draft.js';
import type { Asking } from '../person/person-access.js';
import type { PeopleService } from '../person/service.js';
import type { SchemaRepository } from '../schema/schema-repository.js';
import type { Tx } from './record.js';

/**
 * What setup publishes, apart from publishing it: the core fields and a
 * country's pack, seeded into the draft (the wizard's `publishSetup`), or
 * held in memory for a company's first import to be read against
 * (`setupDraft`). Its own module so the import and the wizard share it
 * without depending on each other.
 */

export const countryName = (code: string): string =>
  new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;

/** A country's pack, with the sections chosen and every one the law requires; all of them for `'all'`. */
function packFor(
  country: string | null,
  sections: readonly string[] | 'all',
): Pick<CountryPack, 'sections' | 'attributes'> | null {
  if (country === null || !Object.hasOwn(COUNTRY_PACKS, country)) return null;
  const pack = COUNTRY_PACKS[country as PackCountry];
  if (sections === 'all') return pack;
  const on = new Set(sections);
  const kept = pack.sections.filter(
    (s) =>
      on.has(s.key) ||
      pack.attributes.some((a) => a.sectionKey === s.key && a.requiredness.mode === 'conditional'),
  );
  const keys = new Set(kept.map((s) => s.key));
  return { sections: kept, attributes: pack.attributes.filter((a) => keys.has(a.sectionKey)) };
}

/**
 * Setup's seeding, in the caller's transaction and without its publish: the
 * core fields and the country's pack, written into the draft. The wizard
 * publishes right after; an import that sets a company up publishes it with
 * its own new fields.
 */
export async function seedSetup(
  tx: Tx,
  tenantId: string,
  country: string | null,
  sections: readonly string[] | 'all',
): Promise<Result<void>> {
  const core = await seedCountryPack(tx, tenantId, CORE_PACK);
  if (!core.ok) return core;
  const pack = packFor(country, sections);
  if (pack !== null) {
    const seeded = await seedCountryPack(tx, tenantId, pack);
    if (!seeded.ok) return seeded;
  }
  return ok(undefined);
}

/**
 * What setup would publish for a company with nothing published, before
 * anything is stored: its draft with the core fields and every section of
 * its legal entity's country pack, as the wizard's defaults have them. An
 * import reads a file against this, so a new company imports without a
 * detour, and setup is part of the plan HR approves.
 */
export async function setupDraft(
  deps: { readonly schema: Pick<SchemaRepository, 'loadDraft'>; readonly service: PeopleService },
  tx: Tx,
  asking: Asking,
): Promise<
  Result<{
    readonly sections: readonly Section[];
    readonly attributes: readonly Attribute[];
    readonly country: string | null;
    /** The pack's country in words; null when there is no pack for it. */
    readonly countryName: string | null;
  }>
> {
  const stored = await deps.schema.loadDraft(tx, asking.tenantId);
  const draft = SchemaDraft.rehydrate(stored.sections, stored.attributes);
  const entities = deps.service.org ? await deps.service.org.legalEntities(tx, asking) : ok([]);
  const entity = entities.ok ? entities.value.find((e) => !e.archived) : undefined;
  const country = entity?.country ?? null;
  const sections = [...stored.sections];
  const attributes = [...stored.attributes];
  const pack = packFor(country, 'all');
  for (const p of pack === null ? [CORE_PACK] : [CORE_PACK, pack]) {
    const applied = applyPack(draft, p);
    if (!applied.ok) return applied;
    sections.push(...applied.value.sections);
    attributes.push(...applied.value.attributes);
  }
  return ok({
    sections,
    attributes,
    country,
    countryName: pack === null || country === null ? null : countryName(country),
  });
}
