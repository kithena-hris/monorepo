import type { ImportStage, ProposedColumn } from './import-flow';
import type { ImportDoneView, ImportPlanView, LeftEmptyRow } from './import-plan';
import type { ColumnProposal, NewFieldsView } from './new-fields';

/**
 * A company's file with columns it has no field for, as People proposes,
 * plans and reports it: the screens' tests and the phone checks share it.
 */

export const FILE = { name: 'dunder-people.csv', rows: 20, sheet: null };

export const column = (
  over: Partial<ProposedColumn> & Pick<ProposedColumn, 'index' | 'header'>,
): ProposedColumn => ({
  status: 'mapped',
  key: null,
  source: 'label',
  confidence: null,
  reason: null,
  ...over,
});

export const MAPPING: Extract<ImportStage, { step: 'map' }> = {
  step: 'map',
  file: FILE,
  fields: [
    { key: 'given_name', label: 'Legal first name' },
    { key: 'work_email', label: 'Work email' },
    { key: 'cost_centre', label: 'Cost centre' },
  ],
  columns: [
    column({ index: 0, header: 'First Name', key: 'given_name', source: 'alias' }),
    column({ index: 1, header: 'Email', key: 'work_email', source: 'alias' }),
    column({ index: 2, header: 'T-shirt size', status: 'ignored', source: null }),
    column({ index: 3, header: 'Laptop serial', status: 'ignored', source: null }),
    column({ index: 4, header: 'Dietary requirements', status: 'ignored', source: null }),
  ],
};

/**
 * A file exported from here and imported back: 23 columns, so a mapping
 * taller than any screen. Its last column is the export's own bookkeeping.
 */
const EXPORTED = [
  'Person id',
  'Legal first name',
  'Legal family name',
  'Preferred name',
  'Emergency contact',
  'Date of birth',
  'Marital status',
  'Spouse or partner',
  'Children',
  'Hometown',
  'Work email',
  'Employee number',
  'Manager',
  'Legal entity',
  'Work location',
  'Job title',
  'Department',
  'Work phone',
  'Start date',
  'Working hours',
  'Social Security number',
];
const keyOf = (label: string): string => label.toLowerCase().replaceAll(' ', '_');

export const EXPORT_MAPPING: Extract<ImportStage, { step: 'map' }> = {
  step: 'map',
  file: { name: 'people-export.csv', rows: 31, sheet: null },
  fields: EXPORTED.map((label) => ({ key: keyOf(label), label })),
  columns: [
    ...EXPORTED.map((header, index) =>
      column({ index, header, key: keyOf(header), source: 'key' }),
    ),
    column({ index: 21, header: 'Cab service needed', status: 'ignored', source: null }),
    column({
      index: 22,
      header: '__missing_required',
      key: '__missing_required',
      status: 'ignored',
      source: 'system',
    }),
  ],
};

const proposal = (
  over: Partial<ColumnProposal> & Pick<ColumnProposal, 'column' | 'header' | 'key'>,
): ColumnProposal => ({
  shape: '5 distinct short values',
  include: true,
  field: {
    label: over.header,
    dataType: 'select',
    options: ['XS', 'S', 'M', 'L', 'XL'],
    required: false,
    ownership: ['employee', 'hr'],
    visibility: ['self', 'hr'],
    classification: 'internal',
    piiKind: 'none',
    encrypted: false,
    aiEligible: true,
  },
  placement: { newSection: 'Equipment' },
  why: 'Ordinary, not sensitive: the employee fills it in, and the assistant may use it.',
  forExisting: { kind: 'leave' },
  forExistingWhy: 'Nice to have: nobody is chased for it.',
  confidence: 'high',
  ...over,
});

export const NEW_FIELDS: NewFieldsView = {
  canCreate: true,
  blocked: null,
  sections: [
    { key: 'personal', label: 'Personal information' },
    { key: 'employment', label: 'Employment' },
  ],
  existingPeople: 1,
  totalPeople: 21,
  byModel: false,
  version: 1,
  setup: { country: 'US', countryName: 'United States' },
  proposals: [
    {
      ...proposal({ column: 2, header: 'T-shirt size', key: 't_shirt_size' }),
      counts: { have: 17, missing: 4, existingWithout: 1 },
      sensitive: null,
    },
    {
      ...proposal({
        column: 3,
        header: 'Laptop serial',
        key: 'laptop_serial',
        shape: 'free text, up to 12 characters',
        confidence: 'medium',
        forExisting: { kind: 'hr' },
        forExistingWhy: 'HR records it: it goes to HR’s completeness list.',
      }),
      field: {
        label: 'Laptop serial',
        dataType: 'text',
        required: false,
        ownership: ['hr'],
        visibility: ['self', 'manager', 'hr'],
        classification: 'internal',
        piiKind: 'none',
        encrypted: false,
        aiEligible: true,
      },
      counts: { have: 17, missing: 4, existingWithout: 1 },
      sensitive: null,
    },
    {
      ...proposal({
        column: 4,
        header: 'Dietary requirements',
        key: 'dietary_requirements',
        include: false,
        why: 'This can reveal health or religion, which GDPR treats as special-category data. I suggest not importing it. If you need it, it should be optional, private to HR and asked with consent.',
        forExistingWhy: 'Health information is volunteered, never chased.',
      }),
      field: {
        label: 'Dietary requirements',
        dataType: 'select',
        options: ['Vegetarian', 'Halal'],
        required: false,
        ownership: ['employee', 'hr'],
        visibility: ['self', 'hr'],
        classification: 'special-category',
        piiKind: 'health',
        encrypted: false,
        aiEligible: false,
      },
      counts: { have: 6, missing: 15, existingWithout: 1 },
      sensitive: 'Special category (GDPR Article 9)',
    },
  ],
};

/** A manager from another system's file, found nowhere here. */
const LEFT_EMPTY: LeftEmptyRow = {
  row: 14,
  cell: 'M14 — “Gabe Lewis”',
  label: 'Manager',
  reason: 'nobody in this company or this file is called “Gabe Lewis”',
};

export const PLAN: ImportPlanView = {
  steps: [
    {
      kind: 'setup',
      title: 'Set up the employee record with the United States pack',
      detail:
        'The fields every company has, and the ones the law there requires. Every section can be changed later in Settings.',
    },
    {
      kind: 'fields',
      title: 'Create 2 fields in Settings › Employee fields',
      detail:
        'T-shirt size and Laptop serial in a new Equipment section. Published with the pack as version 1.',
    },
    {
      kind: 'people',
      title: 'Create 19 people',
      detail: '1 row has no name and no work email, so it’s skipped: nobody to create.',
    },
    {
      kind: 'ids',
      title: 'Employee IDs in the file are ignored; Kithena gives each new person one',
      detail:
        'Rows match people already here by work email; a row that matches nobody is a new person.',
    },
    {
      kind: 'refs',
      title: 'Leave 1 reference empty for HR',
      detail:
        'Manager on those rows points at nobody in this company or this file. The rows import without it; each is listed below.',
    },
    {
      kind: 'hr',
      title: 'Give HR 4 laptop serial values to fill in',
      detail: 'They’re in Data health, on HR’s list, until they’re filled in.',
    },
    {
      kind: 'skip',
      title: 'Leave out Dietary requirements',
      detail: 'The column is skipped and isn’t stored anywhere. Its values aren’t kept.',
    },
  ],
  short:
    'Set up the United States pack, create 2 fields, import 19 people, give HR 4 laptop serial values, and leave out Dietary requirements.',
  fields: [
    {
      key: 't_shirt_size',
      column: 2,
      label: 'T-shirt size',
      dataType: 'select',
      section: 'Equipment',
      newSection: true,
      forExisting: { kind: 'leave' },
      missing: 4,
    },
    {
      key: 'laptop_serial',
      column: 3,
      label: 'Laptop serial',
      dataType: 'text',
      section: 'Equipment',
      newSection: true,
      forExisting: { kind: 'hr' },
      missing: 4,
    },
  ],
  version: 1,
  setup: { country: 'US', countryName: 'United States' },
  blocked: null,
  problems: [],
  asked: 0,
  forHr: 4,
  review: {
    file: FILE,
    dryRun: {
      counts: { create: 19, update: 0, unchanged: 0, blocked: 1, duplicate: 0 },
      blocked: [
        { row: 7, person: null, problem: 'a new person needs a work email', cell: 'D7 — empty' },
      ],
      leftEmpty: [LEFT_EMPTY],
      leftEmptyCount: 1,
    },
    blockedUrl: 'https://store.test/blocked.csv',
  },
};

export const DONE: ImportDoneView = {
  leftEmpty: [LEFT_EMPTY],
  leftEmptyCount: 1,
  step: 'done',
  file: FILE,
  created: 19,
  updated: 0,
  blocked: 1,
  reportUrl: 'https://store.test/report.csv',
  forReview: 0,
  held: 0,
  appliedWithoutApproval: false,
  fields: PLAN.fields,
  version: 1,
  asked: 0,
  forHr: 4,
  finishedAt: '2026-10-01T12:02:00.000Z',
  tookMs: 4100,
};
