import { ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinitionInput } from '@kithena/contracts';

import type { Attribute, SchemaDraft, Section, SectionInput } from '../domain/schema/draft.js';

/**
 * Country packs (PRD §6.3, §8.2 step 6b): the sections and attributes a
 * tenant's draft is seeded with for the country its legal entity is in.
 *
 * Registry data with `origin: 'country_pack'`, not a migration and not a code
 * path. A tenant accepts or adjusts the pack in the setup wizard and publishes
 * version 1; after that every row is theirs to relabel and tighten, and the
 * registry's floor stops them loosening it.
 *
 * The countries are the ones `address.ts` has rules for. Each pack is a claim
 * that its paperwork rules are right, and PEO-059 is explicit that a person
 * who knows that country's employment paperwork has to review it before it is
 * sold there.
 */

export type PackCountry = 'ES' | 'GB' | 'DE' | 'IN' | 'US';

export interface CountryPack {
  readonly country: PackCountry;
  readonly sections: readonly SectionInput[];
  readonly attributes: readonly AttributeDefinitionInput[];
}

/** PRD §6.3: "Identification & right to work", visible to HR by default. */
const identification: SectionInput = {
  key: 'identification',
  label: { default: 'Identification & right to work', translations: {} },
  order: 10,
  defaultVisibility: ['hr'],
  origin: 'country_pack',
};

/**
 * A national identifier, with the policy every one of them shares.
 *
 * Confidential identity data, encrypted into `people.person_secret`, never
 * sent to a model and never on an event — the contract and the table both
 * refuse the combinations that would leak it.
 *
 * Visible to `self` as well as HR, which is wider than the section's default:
 * the employee is who types it (§6.6), and a required field its owner cannot
 * read back is a nag they cannot answer.
 *
 * Unique per **tenant**, not per legal entity. An identifier names one human,
 * and a tenant holds one record per human — a transfer between its legal
 * entities moves that record, a rehire reopens it (PRD §8.1) — so the same NIF
 * on two records in one tenant is a duplicate wherever each is employed. The
 * claim is a keyed hash of the value as `checkNationalId` normalises it
 * (PEO-082), so `12345678 z` collides with `12345678Z` and the plaintext never
 * leaves `people.person_secret`.
 *
 * `required` means required of people whose country is this one: incomplete
 * until given, never blocked (§8.4). Payroll in each of these countries cannot
 * run without the identifiers marked so.
 */
function identifier(
  country: PackCountry,
  key: string,
  scheme: string,
  order: number,
  label: string,
  description: string,
  required: boolean,
): AttributeDefinitionInput {
  return {
    key,
    sectionKey: identification.key,
    label: { default: label, translations: {} },
    description: { default: description, translations: {} },
    order,
    dataType: 'national_id',
    typeConfig: { kind: 'national_id', country, scheme },
    requiredness: required
      ? { mode: 'conditional', when: { combine: 'all', clauses: [{ operand: 'country', in: [country] }] } }
      : { mode: 'never' },
    ownership: ['employee', 'hr'],
    visibility: ['self', 'hr'],
    collectAt: 'onboarding',
    classification: {
      classification: 'confidential',
      piiKind: 'identity',
      exportable: true,
      aiEligible: false,
    },
    classificationSource: 'human',
    encrypted: true,
    uniqueScope: 'tenant',
    includeInEvents: false,
    origin: 'country_pack',
  };
}

export const COUNTRY_PACKS: Readonly<Record<PackCountry, CountryPack>> = {
  ES: {
    country: 'ES',
    sections: [identification],
    attributes: [
      identifier('ES', 'es_nif', 'nif', 0, 'NIF / NIE', 'DNI for Spanish nationals, NIE for foreign nationals.', true),
      identifier('ES', 'es_naf', 'naf', 1, 'Social Security number (NAF)', 'Número de afiliación a la Seguridad Social.', true),
    ],
  },
  GB: {
    country: 'GB',
    sections: [identification],
    attributes: [
      identifier('GB', 'gb_ni_number', 'nino', 0, 'National Insurance number', 'Two letters, six digits and a letter, e.g. AB 12 34 56 C.', true),
    ],
  },
  DE: {
    country: 'DE',
    sections: [identification],
    attributes: [
      identifier('DE', 'de_steuer_id', 'steuer_id', 0, 'Tax ID (Steuer-ID)', 'Steuerliche Identifikationsnummer, eleven digits.', true),
      identifier('DE', 'de_sv_nummer', 'sv_nummer', 1, 'Social insurance number', 'Sozialversicherungsnummer, from the Rentenversicherung.', true),
    ],
  },
  IN: {
    country: 'IN',
    sections: [identification],
    attributes: [
      identifier('IN', 'in_pan', 'pan', 0, 'PAN', 'Permanent Account Number, e.g. ABCPD1234E.', true),
      // Optional: a first job has no UAN until the employer's first EPF filing creates one.
      identifier('IN', 'in_uan', 'uan', 1, 'UAN', 'Universal Account Number for the Employees’ Provident Fund.', false),
    ],
  },
  US: {
    country: 'US',
    sections: [identification],
    attributes: [
      identifier('US', 'us_ssn', 'ssn', 0, 'Social Security number', 'Nine digits, as on the Social Security card.', true),
    ],
  },
};

/**
 * Seed a draft with a pack, through the draft's own checks.
 *
 * Idempotent, and never overwrites: a section or attribute the draft already
 * holds is left as the tenant has it, so re-applying a pack, or a second
 * country's pack sharing a section, adds only what is missing. On failure the
 * draft may be part-applied and should be discarded, which is what the
 * caller's rolled-back transaction does.
 */
export function applyPack(
  draft: SchemaDraft,
  pack: CountryPack,
): Result<{ sections: Section[]; attributes: Attribute[] }> {
  const sections: Section[] = [];
  const attributes: Attribute[] = [];

  for (const input of pack.sections) {
    if (draft.section(input.key) !== undefined) continue;
    const added = draft.addSection(input);
    if (!added.ok) return added;
    sections.push(added.value);
  }

  for (const input of pack.attributes) {
    if (draft.attribute(input.key) !== undefined) continue;
    const added = draft.addAttribute(input);
    if (!added.ok) return added;
    attributes.push(added.value);
  }

  return ok({ sections, attributes });
}
