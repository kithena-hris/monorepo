import type { PublishedVersion } from '../../domain/schema/publish.js';
import { checksumOf, type SchemaDocument } from '../../domain/schema/publish.js';
import type { Section } from '../../domain/schema/draft.js';
import { define, inMemoryPeople, TENANT, type InMemoryPeople } from '../person/in-memory.js';
import type { Viewer } from '../person/ports.js';

/**
 * A register finance would ask for: names, a salary, a level, a birth date,
 * a sealed bank account, a repeating list, a required field one person is
 * missing, and one special-category field that must never leave.
 */

export const ADA = '00000000-0000-4000-8000-0000000000a1';
export const MARCO = '00000000-0000-4000-8000-0000000000a2';
export const GRACE = '00000000-0000-4000-8000-0000000000a3';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';

const hrAndFinance = (over: Parameters<typeof define>[0]) =>
  define({ visibility: ['hr', 'finance'], ownership: ['hr'], ...over });

const personal: Section = {
  key: 'personal' as Section['key'],
  label: { default: 'Personal' } as Section['label'],
  order: 0,
  defaultVisibility: ['hr'],
  origin: 'core',
  archivedAt: null,
};
const hr: Section = {
  ...personal,
  key: 'hr_information' as Section['key'],
  label: { default: 'HR' } as Section['label'],
  order: 1,
};

export const attributes = [
  // Declared out of order: the export must put them in profile order.
  hrAndFinance({
    key: 'base_salary',
    label: { default: 'Base salary' },
    order: 2,
    dataType: 'money',
    typeConfig: { kind: 'money' },
    classification: {
      classification: 'confidential',
      piiKind: 'none',
      exportable: true,
      aiEligible: false,
    },
  }),
  hrAndFinance({ key: 'employee_number', label: { default: 'Employee number' }, order: 0 }),
  hrAndFinance({
    key: 'given_name',
    label: { default: 'Given name' },
    sectionKey: 'personal',
    order: 0,
  }),
  hrAndFinance({
    key: 'family_name',
    label: { default: 'Family name' },
    sectionKey: 'personal',
    order: 1,
  }),
  hrAndFinance({
    key: 'date_of_birth',
    label: { default: 'Date of birth' },
    sectionKey: 'personal',
    order: 2,
    dataType: 'date',
    typeConfig: { kind: 'date', range: 'past' },
  }),
  hrAndFinance({
    key: 'job_title',
    label: { default: 'Job title' },
    order: 1,
    visibility: ['hr', 'finance', 'manager'],
  }),
  hrAndFinance({
    key: 'level',
    label: { default: 'Level' },
    order: 3,
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'l1', label: { default: 'Junior' } },
        { value: 'l2', label: { default: 'Senior' } },
      ],
    },
  }),
  hrAndFinance({
    key: 'cost_centre',
    label: { default: 'Cost centre' },
    order: 4,
    requiredness: { mode: 'always' },
  }),
  hrAndFinance({
    key: 'iban',
    label: { default: 'IBAN' },
    order: 5,
    dataType: 'bank_account',
    typeConfig: { kind: 'bank_account', country: 'ES' },
    encrypted: true,
    ownership: ['employee', 'hr'],
    classification: {
      classification: 'confidential',
      piiKind: 'financial',
      exportable: true,
      aiEligible: false,
    },
  }),
  hrAndFinance({
    key: 'languages',
    label: { default: 'Languages' },
    order: 6,
    cardinality: 'repeating',
  }),
  hrAndFinance({
    key: 'health_notes',
    label: { default: 'Health notes' },
    order: 7,
    dataType: 'long_text',
    typeConfig: { kind: 'long_text' },
    classification: {
      classification: 'special-category',
      piiKind: 'health',
      exportable: true,
      aiEligible: false,
    },
  }),
];

export function register(): PublishedVersion {
  const document: SchemaDocument = { sections: [hr, personal], attributes };
  return {
    version: 4,
    document,
    checksum: checksumOf(document),
    publishedAt: '2026-09-01T00:00:00.000Z',
    publishedBy: null,
    rolledBackFrom: null,
  };
}

export const HR: Viewer = {
  accountId: '00000000-0000-4000-8000-0000000000ff',
  roles: new Set(['hr']),
};
export const FINANCE: Viewer = {
  accountId: '00000000-0000-4000-8000-0000000000fe',
  roles: new Set(['finance']),
};
export const MANAGER: Viewer = { accountId: MARCO_ACCOUNT, roles: new Set() };

export function financeTenant(versions: PublishedVersion[] = [register()]): InMemoryPeople {
  const store = inMemoryPeople(versions);
  const person = (
    id: string,
    account: string | null,
    n: string,
    salary: number,
    over: Record<string, unknown> = {},
    managerId?: string,
  ) => {
    store.seed(id, {
      account,
      fields: {
        givenName: n,
        familyName: 'Test',
        employeeNumber: `E-${n}`,
        ...(managerId ? { managerId } : {}),
      },
      custom: {
        base_salary: { amountMinor: salary, currency: 'EUR' },
        date_of_birth: '1990-04-03',
        job_title: `${n}'s job`,
        level: 'l2',
        cost_centre: 'CC-1',
        languages: ['es', 'en'],
        health_notes: 'never exported',
        ...over,
      },
    });
  };
  person(GRACE, null, 'Grace', 9_000_000);
  person(MARCO, MARCO_ACCOUNT, 'Marco', 6_000_050, { cost_centre: null }, GRACE);
  person(
    ADA,
    ADA_ACCOUNT,
    'Ada',
    5_500_025,
    { job_title: '=HYPERLINK("https://evil.test","x")' },
    MARCO,
  );
  store.secrets.set(`${ADA}:iban`, 'ES9121000418450200051332');
  return store;
}

export const asking = (
  viewer: Viewer,
): { tenantId: string; viewer: Viewer; correlationId: string } => ({
  tenantId: TENANT,
  viewer,
  correlationId: '00000000-0000-4000-8000-0000000000c2',
});
