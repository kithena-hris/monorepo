import type { AttributeDefinitionInput } from '@kithena/contracts';

import { builtInChoices } from '../domain/import/aliases.js';
import type { SectionInput } from '../domain/schema/draft.js';

/**
 * The fields every company has, whatever its country (PRD §8.2 step 6c,
 * Appendix A "core"): what the setup wizard publishes beside a country pack.
 *
 * Every company has the same personal, employment and pay fields, under the
 * same keys and types, so a company is set up without designing a form first
 * and payroll (and a preliminary payroll export) reads one shape everywhere.
 * A company relabels them and may make them stricter; it cannot archive one or
 * change its type (`SchemaDraft`). The rest of Appendix A is the tenant's to add.
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

/** Pay: the person, HR and finance, never the manager or the directory. */
const compensation: SectionInput = {
  key: 'compensation',
  label: text('Compensation'),
  order: 2,
  defaultVisibility: ['self', 'hr', 'finance'],
  origin: 'core',
};

/** Seen by the company, which is what a name and a work email are for. */
const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;

/**
 * Names and contact details: internal, and not shared with the assistant
 * unless the company chooses to. Where somebody works and who they report to
 * are shared by default (`aiEligible: true` on each): the assistant is asked
 * "who is in Scranton" and "who reports to Michael" more than anything else.
 */
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

/**
 * People's own choice fields, each in a typed column (`core.ts`), and not
 * seeded: a company gets one when a file it imports carries it. Its options
 * are People's values (`builtInChoices`) and whatever the company adds.
 */
export const CHOICE_LABELS: Readonly<Record<string, string>> = {
  employment_type: 'Employment type',
  work_model: 'Work model',
  working_pattern: 'Working pattern',
  pay_frequency: 'Pay frequency',
  pay_basis: 'Pay basis',
};

export const choiceField = (
  key: string,
  at: { readonly sectionKey: string; readonly order: number },
  options: readonly { readonly value: string; readonly label: string }[],
): AttributeDefinitionInput =>
  field({
    key,
    ...at,
    label: CHOICE_LABELS[key] ?? key,
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: options.map((o) => ({ value: o.value, label: text(o.label) })),
    },
    ownership: ['hr'],
    visibility: ['self', 'manager', 'hr'],
    collectAt: 'hr_only',
    classification: { ...identity, piiKind: 'none', aiEligible: true },
    effectiveDated: true,
  });

/**
 * Somebody's department: one of the company's own (Settings › Organisation),
 * picked from a list, never typed, so every module groups people the same
 * way. Existing companies get it from `pickedFields`.
 */
export const DEPARTMENT_FIELD: AttributeDefinitionInput = field({
  key: 'org_unit_id',
  sectionKey: 'employment',
  label: 'Department',
  order: 5,
  dataType: 'org_unit_ref',
  typeConfig: { kind: 'org_unit_ref' },
  ownership: ['hr'],
  visibility: [...everyone],
  collectAt: 'hr_only',
  classification: { ...identity, piiKind: 'none', aiEligible: true },
  effectiveDated: true,
});

/**
 * Somebody's signature, as they drew or typed it: the one a hire signed
 * their contract with arrives here (`hiresFromRecruiting`), and the first
 * document they sign in Kithena is signed with it. Theirs and HR's alone.
 * Existing companies get it from `pickedFields`.
 */
export const SIGNATURE_FIELD: AttributeDefinitionInput = field({
  key: 'signature',
  sectionKey: 'personal',
  label: 'Signature',
  order: 3,
  dataType: 'signature',
  typeConfig: { kind: 'signature' },
  ownership: ['employee', 'hr'],
  visibility: ['self', 'hr'],
  collectAt: 'onboarding',
  classification: identity,
});

/** What somebody tells HR about themselves: theirs to fill in while onboarding. */
const own = {
  ownership: ['employee', 'hr'],
  visibility: ['self', 'hr'],
  collectAt: 'onboarding',
} satisfies Partial<AttributeDefinitionInput>;

/** How to reach somebody outside work: theirs and HR's, and confidential. */
const personalContact = {
  classification: 'confidential',
  piiKind: 'contact',
  exportable: true,
  aiEligible: false,
} as const;

/** Somebody's job and terms, HR's to fill in, filled from the contract on a hire. */
const terms = {
  sectionKey: 'employment',
  ownership: ['hr'],
  visibility: ['self', 'manager', 'hr'],
  collectAt: 'hr_only',
  classification: { ...identity, piiKind: 'none' },
} satisfies Partial<AttributeDefinitionInput>;

/** Pay, HR's and finance's to fill in, filled from the offer on a hire. */
const pay = {
  sectionKey: 'compensation',
  ownership: ['hr', 'finance'],
  visibility: ['self', 'hr', 'finance'],
  collectAt: 'hr_only',
  classification: {
    classification: 'confidential',
    piiKind: 'financial',
    exportable: true,
    aiEligible: false,
  },
} satisfies Partial<AttributeDefinitionInput>;

const date = (range: 'any' | 'past' | 'future' = 'any') =>
  ({
    dataType: 'date',
    typeConfig: { kind: 'date', range },
  }) satisfies Partial<AttributeDefinitionInput>;

/** In the record's own currency, sealed as financial data always is (`people.person_secret`). */
const money = {
  dataType: 'money',
  typeConfig: { kind: 'money', currency: null, minMinor: null, maxMinor: null },
  encrypted: true,
} satisfies Partial<AttributeDefinitionInput>;

/** How pay is paid, not an amount: confidential, and plain so it can be a choice. */
const howPaid = {
  classification: { ...pay.classification, piiKind: 'none' },
} satisfies Partial<AttributeDefinitionInput>;

/**
 * The personal, employment and pay fields beyond the name, the work email and
 * the placement. Existing companies get any they lack from `pickedFields`.
 */
export const STANDARD_FIELDS: readonly AttributeDefinitionInput[] = [
  field({
    ...own,
    key: 'date_of_birth',
    sectionKey: 'personal',
    label: 'Date of birth',
    order: 4,
    ...date('past'),
    classification: identity,
  }),
  field({
    ...own,
    key: 'personal_email',
    sectionKey: 'personal',
    label: 'Personal email',
    order: 5,
    dataType: 'email',
    typeConfig: { kind: 'email' },
    classification: personalContact,
  }),
  field({
    ...own,
    key: 'mobile_phone',
    sectionKey: 'personal',
    label: 'Mobile phone',
    order: 6,
    dataType: 'phone',
    typeConfig: { kind: 'phone' },
    classification: personalContact,
  }),
  field({
    ...own,
    key: 'home_address',
    sectionKey: 'personal',
    label: 'Home address',
    order: 7,
    dataType: 'address',
    typeConfig: { kind: 'address' },
    classification: personalContact,
  }),
  field({
    ...terms,
    key: 'job_title',
    label: 'Job title',
    order: 6,
    dataType: 'text',
    typeConfig: { kind: 'text' },
    visibility: [...everyone],
    classification: { ...identity, piiKind: 'none', aiEligible: true },
    effectiveDated: true,
  }),
  choiceField('employment_type', { sectionKey: 'employment', order: 7 }, builtInChoices('employment_type')),
  field({ ...terms, key: 'contract_start', label: 'Contract start', order: 8, ...date() }),
  field({ ...terms, key: 'contract_end', label: 'Contract end', order: 9, ...date() }),
  field({ ...terms, key: 'probation_end', label: 'Probation end', order: 10, ...date() }),
  choiceField('working_pattern', { sectionKey: 'employment', order: 11 }, [
    { value: 'full_time', label: 'Full-time' },
    { value: 'part_time', label: 'Part-time' },
  ]),
  field({
    ...terms,
    key: 'fte',
    label: 'FTE',
    order: 12,
    dataType: 'decimal',
    typeConfig: { kind: 'decimal', min: 0, max: 1, decimals: 4 },
    effectiveDated: true,
  }),
  choiceField('work_model', { sectionKey: 'employment', order: 13 }, builtInChoices('work_model')),
  field({
    ...terms,
    key: 'notice_period_employee',
    label: 'Notice period (employee)',
    order: 14,
    dataType: 'text',
    typeConfig: { kind: 'text' },
  }),
  field({
    ...terms,
    key: 'notice_period_employer',
    label: 'Notice period (employer)',
    order: 15,
    dataType: 'text',
    typeConfig: { kind: 'text' },
  }),
  field({ ...pay, ...money, key: 'base_salary', label: 'Base salary', order: 0 }),
  // What the base salary is quoted per, as the offer states it.
  {
    ...choiceField('pay_basis', { sectionKey: 'compensation', order: 1 }, [
      { value: 'year', label: 'Per year' },
      { value: 'month', label: 'Per month' },
      { value: 'hour', label: 'Per hour' },
    ]),
    ownership: pay.ownership,
    visibility: pay.visibility,
    ...howPaid,
    effectiveDated: false,
  },
  // How often payroll pays; a company's own (an import's) are added to these.
  {
    ...choiceField(
      'pay_frequency',
      { sectionKey: 'compensation', order: 2 },
      builtInChoices('pay_frequency'),
    ),
    ownership: pay.ownership,
    visibility: pay.visibility,
    ...howPaid,
    effectiveDated: false,
  },
  field({
    ...pay,
    ...howPaid,
    key: 'payments_per_year',
    label: 'Payments per year',
    order: 3,
    dataType: 'number',
    typeConfig: { kind: 'number', min: 1, max: 14, decimals: 0 },
  }),
  field({ ...pay, ...money, key: 'variable_pay_target', label: 'Variable pay target', order: 4 }),
  field({ ...pay, ...money, key: 'sign_on_bonus', label: 'Sign-on bonus', order: 5 }),
  field({ ...pay, ...money, key: 'relocation_allowance', label: 'Relocation allowance', order: 6 }),
  field({
    ...pay,
    key: 'equity',
    label: 'Equity',
    order: 7,
    dataType: 'text',
    // "1200 × options vesting over four years": an offer's description runs to 300.
    typeConfig: { kind: 'text', maxLength: 400 },
    encrypted: true,
  }),
];

/**
 * The employee number: given by People to every record as it is created, in
 * its entity's scheme (Settings › Organisation, `00001` until HR sets one),
 * and never typed or changed. Existing companies' fields become this from
 * `pickedFields`.
 */
export const EMPLOYEE_NUMBER_FIELD: AttributeDefinitionInput = field({
    key: 'employee_number',
    sectionKey: 'employment',
    label: 'Employee number',
    order: 1,
    dataType: 'text',
    typeConfig: { kind: 'text' },
    // People writes it on every new record (`nextNumber`); nobody types it.
    ownership: ['system'],
    required: true,
    visibility: ['self', 'manager', 'hr'],
    collectAt: 'hr_only',
    classification: { ...identity, piiKind: 'none' },
  });

export const CORE_PACK: {
  readonly sections: readonly SectionInput[];
  readonly attributes: readonly AttributeDefinitionInput[];
} = {
  sections: [personal, employment, compensation],
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
      ownership: ['employee', 'hr'],
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
    EMPLOYEE_NUMBER_FIELD,
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
      classification: { ...identity, piiKind: 'none', aiEligible: true },
      effectiveDated: true,
    }),
    // Where somebody works (§6.8, PEO-123): whose day it is, which entity
    // numbers them, and what the placement control on the profile writes.
    // Dated, so an "as of" read and a transfer's periods agree.
    field({
      key: 'legal_entity_id',
      sectionKey: 'employment',
      label: 'Legal entity',
      order: 3,
      dataType: 'legal_entity_ref',
      typeConfig: { kind: 'legal_entity_ref' },
      ownership: ['hr'],
      visibility: ['self', 'manager', 'hr'],
      collectAt: 'hr_only',
      classification: { ...identity, piiKind: 'none', aiEligible: true },
      effectiveDated: true,
    }),
    field({
      key: 'location_id',
      sectionKey: 'employment',
      label: 'Work location',
      order: 4,
      dataType: 'location_ref',
      typeConfig: { kind: 'location_ref' },
      ownership: ['hr'],
      visibility: [...everyone],
      collectAt: 'hr_only',
      classification: { ...identity, piiKind: 'none', aiEligible: true },
      effectiveDated: true,
    }),
    DEPARTMENT_FIELD,
    SIGNATURE_FIELD,
    ...STANDARD_FIELDS,
  ],
};
