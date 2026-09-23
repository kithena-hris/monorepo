import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import { CountryCode } from '@kithena/contracts';

import { SchemaDraft } from '../domain/schema/draft.js';
import { publish } from '../domain/schema/publish.js';
import { hasRule } from './national-id.js';
import { applyPack, COUNTRY_PACKS } from './packs.js';

const clock = fixedClock('2026-09-23T09:00:00.000Z');
const countries = Object.keys(COUNTRY_PACKS) as (keyof typeof COUNTRY_PACKS)[];

describe('the country packs', () => {
  it('are the five countries the address rules cover', () => {
    expect(countries.toSorted()).toEqual(['DE', 'ES', 'GB', 'IN', 'US']);
    for (const country of countries) expect(CountryCode.safeParse(country).success).toBe(true);
  });

  it.each(countries)('%s applied to a fresh tenant publishes as version 1', (country) => {
    const draft = SchemaDraft.empty();
    const applied = applyPack(draft, COUNTRY_PACKS[country]);
    expect(applied.ok).toBe(true);

    const version = publish(draft, null, { clock, actor: null });
    expect(version.ok).toBe(true);
    if (!version.ok) return;
    expect(version.value.version).toBe(1);
    expect(version.value.document.attributes.length).toBeGreaterThan(0);
  });

  it('all apply to one tenant without a key colliding', () => {
    const draft = SchemaDraft.empty();
    for (const country of countries) expect(applyPack(draft, COUNTRY_PACKS[country]).ok).toBe(true);

    const keys = countries.flatMap((c) => COUNTRY_PACKS[c].attributes.map((a) => a.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(draft.liveAttributes()).toHaveLength(keys.length);
    expect(publish(draft, null, { clock, actor: null }).ok).toBe(true);
  });

  it('applying a pack twice adds nothing the second time', () => {
    const draft = SchemaDraft.empty();
    applyPack(draft, COUNTRY_PACKS.ES);
    const again = applyPack(draft, COUNTRY_PACKS.ES);
    expect(again.ok && again.value).toEqual({ sections: [], attributes: [] });
  });

  it('leaves an attribute the tenant already has alone', () => {
    const draft = SchemaDraft.empty();
    applyPack(draft, COUNTRY_PACKS.GB);
    const relabelled = draft.updateAttribute('gb_ni_number', { label: { default: 'NI no.' } });
    expect(relabelled.ok).toBe(true);

    applyPack(draft, COUNTRY_PACKS.GB);
    expect(draft.attribute('gb_ni_number')?.label.default).toBe('NI no.');
  });

  it.each(countries)('%s ships every identifier encrypted, unique per tenant, confidential and out of reach', (country) => {
    for (const attribute of COUNTRY_PACKS[country].attributes) {
      expect(attribute.origin).toBe('country_pack');
      expect(attribute.key.startsWith(`${country.toLowerCase()}_`)).toBe(true);
      if (attribute.typeConfig.kind !== 'national_id') continue;

      expect(attribute.typeConfig.country).toBe(country);
      expect(hasRule(country, attribute.typeConfig.scheme)).toBe(true);
      expect(attribute.encrypted).toBe(true);
      expect(attribute.uniqueScope).toBe('tenant');
      expect(attribute.classification).toMatchObject({
        classification: 'confidential',
        piiKind: 'identity',
        aiEligible: false,
      });
      expect(attribute.includeInEvents ?? false).toBe(false);
      expect(attribute.includeInDirectory ?? false).toBe(false);
    }
  });
});
