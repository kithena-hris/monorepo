import type { AttributeDefinitionInput } from '@kithena/contracts';

import type { SectionInput } from '../domain/schema/draft.js';

/**
 * The fields every company has, whatever its country (PRD §8.2 step 6c,
 * Appendix A "core"): what the setup wizard publishes beside a country pack.
 *
 * Only the ones Kithena's own screens and the importer read by key — the
 * name, the work email, the manager, the employee number — each in the typed
 * column `core.ts` maps it to. The rest of Appendix A is the tenant's to add;
 * a default nobody asked for is a field somebody must later explain to a
 * works council.
 *
 * Seeded like a pack, through the draft's own checks, and never overwriting
 * what a tenant already has.
 */

const text = (label: string) => ({ default: label, translations: {} });

const personal: SectionInput = {
  key: 'personal',
  label: text('Personal information'),
  order: 0,
  defaultVisibility: ['self', 'hr'],
  origin: 'core',
};

const employment: SectionInput = {
  key: 'employment',
  label: text('Employment'),
  order: 1,
  defaultVisibility: ['self', 'manager', 'hr'],
  origin: 'core',
};

/** Seen by the company, which is what a name and a work email are for. */
const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;

const identity = {
  classification: 'internal',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
} as const;

function field(
  over: Omit<
    AttributeDefinitionInput,
    'requiredness' | 'classificationSource' | 'origin' | 'label'
  > & {
    readonly label: string;
    readonly required?: boolean;
  },
): AttributeDefinitionInput {
  const { label, required = false, ...rest } = over;
  return {
    ...rest,
    label: text(label),
    requiredness: required ? { mode: 'always' } : { mode: 'never' },
    classificationSource: 'human',
    origin: 'core',
  };
}

export const CORE_PACK: {
  readonly sections: readonly SectionInput[];
  readonly attributes: readonly AttributeDefinitionInput[];
} = {
  sections: [personal, employment],
  attributes: [
    field({
      key: 'given_name',
      sectionKey: 'personal',
      label: 'Legal first name',
      order: 0,
      dataType: 'text',
      typeConfig: { kind: 'text' },
      required: true,
      ownership: ['employee', 'hr'],
      visibility: [...everyone],
      collectAt: 'onboarding',
      classification: identity,
    }),
    field({
      key: 'family_name',
      sectionKey: 'personal',
      label: 'Legal family name',
      order: 1,
      dataType: 'text',
      typeConfig: { kind: 'text' },
      required: true,
      ownership: ['employee', 'hr'],
      visibility: [...everyone],
      collectAt: 'onboarding',
      classification: identity,
    }),
    field({
      key: 'preferred_name',
      sectionKey: 'personal',
      label: 'Preferred name',
      order: 2,
      dataType: 'text',
      typeConfig: { kind: 'text' },
      ownership: ['employee'],
      visibility: [...everyone],
      collectAt: 'onboarding',
      classification: identity,
    }),
    field({
      key: 'work_email',
      sectionKey: 'employment',
      label: 'Work email',
      order: 0,
      dataType: 'email',
      typeConfig: { kind: 'email' },
      ownership: ['hr'],
      visibility: [...everyone],
      collectAt: 'hr_only',
      classification: { ...identity, piiKind: 'contact' },
      includeInDirectory: true,
    }),
    field({
      key: 'employee_number',
      sectionKey: 'employment',
      label: 'Employee number',
      order: 1,
      dataType: 'text',
      typeConfig: { kind: 'text' },
      ownership: ['hr'],
      visibility: ['self', 'manager', 'hr'],
      collectAt: 'hr_only',
      classification: { ...identity, piiKind: 'none' },
    }),
    field({
      key: 'manager_id',
      sectionKey: 'employment',
      label: 'Manager',
      order: 2,
      dataType: 'person_ref',
      typeConfig: { kind: 'person_ref' },
      ownership: ['hr'],
      visibility: [...everyone],
      collectAt: 'hr_only',
      classification: { ...identity, piiKind: 'none' },
      effectiveDated: true,
    }),
  ],
};
