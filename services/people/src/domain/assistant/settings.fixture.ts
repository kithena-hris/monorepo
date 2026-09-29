import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import type { SettingsSnapshot } from './settings-plan.js';

/**
 * A company's settings for the AI settings tests: two sections, a handful of
 * fields, a Spanish entity with numbering, one office and three people with
 * roles. Settings only — the people are names and roles, never a record.
 */

export const ADA = '00000000-0000-4000-8000-00000000a0a1';
export const GRACE = '00000000-0000-4000-8000-00000000a0a2';
export const ALAN = '00000000-0000-4000-8000-00000000a0a3';
export const MADRID_SL = '00000000-0000-4000-8000-0000000e0001';
export const MADRID_OFFICE = '00000000-0000-4000-8000-0000000f0001';

export function attribute(
  input: Partial<AttributeDefinitionInput> & { key: string; sectionKey: string },
): AttributeDefinition {
  return AttributeDefinition.parse({
    label: { default: input.key.replaceAll('_', ' ') },
    dataType: 'text',
    typeConfig: { kind: input.dataType ?? 'text' },
    requiredness: { mode: 'never' },
    ownership: ['hr'],
    visibility: ['self', 'hr'],
    collectAt: 'anytime',
    classification: {
      classification: 'internal',
      piiKind: 'none',
      exportable: true,
      aiEligible: true,
    },
    classificationSource: 'human',
    origin: 'tenant',
    ...input,
  });
}

export const FIELDS: readonly AttributeDefinition[] = [
  attribute({
    key: 'given_name',
    sectionKey: 'personal',
    label: { default: 'Given name' },
    requiredness: { mode: 'always' },
    ownership: ['employee', 'hr'],
    visibility: ['self', 'manager', 'hr', 'directory'],
    collectAt: 'signup',
    origin: 'core',
  }),
  attribute({
    key: 'shirt_size',
    sectionKey: 'personal',
    label: { default: 'Shirt size' },
    description: { default: 'For the welcome pack' },
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 's', label: { default: 'S' } },
        { value: 'm', label: { default: 'M' } },
        { value: 'l', label: { default: 'L' } },
      ],
    },
    ownership: ['employee'],
    collectAt: 'onboarding',
  }),
  attribute({
    key: 'contract_type',
    sectionKey: 'bank',
    label: { default: 'Contract type' },
    requiredness: {
      mode: 'conditional',
      when: { combine: 'all', clauses: [{ operand: 'country', in: ['ES'] }] },
    },
    ownership: ['hr'],
    visibility: ['self', 'manager', 'hr'],
    collectAt: 'hr_only',
  }),
];

export function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    sections: [
      { key: 'personal', label: 'Personal information', origin: 'core' },
      { key: 'bank', label: 'Bank', origin: 'tenant' },
    ],
    fields: FIELDS,
    published: { version: 3, fieldKeys: ['given_name', 'shirt_size'] },
    organisation: {
      defaultTimeZone: 'Europe/Madrid',
      cohortMinimum: 10,
      entities: [
        {
          id: MADRID_SL,
          name: 'Acme Iberia SL',
          country: 'ES',
          timeZone: 'Europe/Madrid',
          numbering: { prefix: 'ES-', digits: 5, next: 100 },
        },
      ],
      locations: [
        {
          id: MADRID_OFFICE,
          name: 'Madrid office',
          country: 'ES',
          legalEntityId: MADRID_SL,
          timeZone: 'Europe/Madrid',
        },
      ],
    },
    people: [
      { accountId: ADA, name: 'Ada Lovelace', roles: ['people_admin', 'hr'] },
      { accountId: GRACE, name: 'Grace Hopper', roles: [] },
      { accountId: ALAN, name: 'Alan Turing', roles: ['finance'] },
    ],
    viewerAccountId: ADA,
    ...overrides,
  };
}
