import type { ImportStage, ProposedColumn } from './import-flow';
import type { ImportRunStatus } from './import-run';
import type { ImportDoneView, ImportPlanView, LeftEmptyRow } from './import-plan';
import type { ColumnProposal, NewFieldsView } from './new-fields';
import type { PlacesHere, WorkplaceValue } from './work-locations';

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
      ...proposal({
        column: 2,
        header: 'T-shirt size',
        key: 't_shirt_size',
        forExisting: { kind: 'ask' },
        forExistingWhy: 'About them, not their job: the employee tells us.',
      }),
      counts: {
        have: 17,
        missing: 4,
        existingWithout: 1,
        without: ['Kevin Malone', 'Oscar Martinez', 'Angela Martin'],
      },
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
        forExistingWhy: 'The company assigns it: HR fills it in.',
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
      counts: {
        have: 17,
        missing: 4,
        existingWithout: 1,
        without: ['Kevin Malone', 'Oscar Martinez', 'Angela Martin'],
      },
      sensitive: null,
    },
    {
      ...proposal({
        column: 4,
        header: 'Dietary requirements',
        key: 'dietary_requirements',
        include: true,
        why: 'Stored as special category, not encrypted, because it’s a list: HR’s alone, and a change waits for approval.',
        forExistingWhy: 'Volunteered, never chased: it can reveal health, religion or the like.',
      }),
      field: {
        label: 'Dietary requirements',
        dataType: 'select',
        options: ['Vegetarian', 'Halal'],
        required: false,
        ownership: ['hr'],
        visibility: ['hr'],
        classification: 'special-category',
        piiKind: 'health',
        encrypted: false,
        aiEligible: false,
        requiresApproval: true,
      },
      counts: { have: 16, missing: 5, existingWithout: 1, without: ['Kevin Malone'] },
      sensitive: 'Special category (GDPR Article 9)',
    },
  ],
};

/** A manager from another system's file, found nowhere here. */
const LEFT_EMPTY: LeftEmptyRow = {
  row: 14,
  name: 'Pam Beesly',
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
        'Manager on those rows points at nobody in this company or this file. The rows import without it; each is listed under See rows.',
    },
    {
      kind: 'ask',
      title: 'Ask 4 people for 1 personal detail (T-shirt size)',
      detail:
        'One request each, listing everything asked of them, answered on their profile or in onboarding. The import emails nobody: anyone without an account yet finds it when they first sign in, and nobody who has left is asked.',
    },
    {
      kind: 'hr',
      title: 'HR fills 1 employment detail for 4 people',
      detail: 'Laptop serial is in Data health, on HR’s list, until they’re filled in.',
    },
    {
      kind: 'skip',
      title: 'Leave out Dietary requirements',
      detail: 'The column is skipped and isn’t stored anywhere. Its values aren’t kept.',
    },
  ],
  short:
    'Set up the United States pack, create 2 fields, import 19 people, ask 4 people for 1 personal detail, have HR fill 1 employment detail for 4 people, and leave out Dietary requirements.',
  fields: [
    {
      key: 't_shirt_size',
      column: 2,
      label: 'T-shirt size',
      dataType: 'select',
      section: 'Equipment',
      newSection: true,
      forExisting: { kind: 'ask' },
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
  // Nothing published yet: the plan sets the company up.
  basedOn: null,
  setup: { country: 'US', countryName: 'United States' },
  blocked: null,
  problems: [],
  asked: 4,
  forHr: 4,
  review: {
    file: FILE,
    dryRun: {
      counts: { create: 19, update: 0, unchanged: 0, blocked: 1, duplicate: 0 },
      blocked: [
        {
          row: 7,
          name: 'Toby Flenderson',
          person: null,
          problem: 'a new person needs a work email',
          cell: 'D7 — empty',
        },
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
  columns: { existing: 2, created: 1, kithena: 0, leftOut: 0 },
};

/** The same file with an Office column: the work locations step comes after the mapping. */
export const MAPPING_WITH_OFFICE: Extract<ImportStage, { step: 'map' }> = {
  ...MAPPING,
  fields: [...MAPPING.fields, { key: 'location_id', label: 'Work location' }],
  columns: [
    ...MAPPING.columns,
    column({ index: 5, header: 'Office', key: 'location_id', source: 'label' }),
  ],
};

/** A work location id from the system the file came from: nobody's here. */
export const FROM_ELSEWHERE = '01a0e1d1-f26f-7000-be34-a7236a53ad47';

/** Its three values: close to one here, new, and another system's id. */
export const WORKPLACES: readonly WorkplaceValue[] = [
  {
    key: 'scranton branch',
    value: 'Scranton Branch',
    rows: 12,
    people: ['Pam Beesly', 'Jim Halpert'],
    found: null,
    suggestion: { id: 'l-scr', name: 'Scranton' },
    looksLikeId: false,
    proposed: { kind: 'map', locationId: 'l-scr' },
  },
  {
    key: 'stamford',
    value: 'Stamford',
    rows: 5,
    people: ['Andy Bernard', 'Karen Filippelli'],
    found: null,
    suggestion: null,
    looksLikeId: false,
    proposed: {
      kind: 'add',
      name: 'Stamford',
      country: 'US',
      timeZone: 'America/New_York',
      legalEntityId: 'e-us',
    },
  },
  {
    key: FROM_ELSEWHERE,
    value: FROM_ELSEWHERE,
    rows: 2,
    people: ['Toby Flenderson', 'Holly Flax'],
    found: null,
    suggestion: null,
    looksLikeId: true,
    proposed: { kind: 'leave' },
  },
];

export const PLACES_HERE: PlacesHere = {
  locations: [
    { id: 'l-ny', name: 'New York' },
    { id: 'l-scr', name: 'Scranton' },
  ],
  entities: [
    { id: 'e-us', name: 'Dunder Mifflin Inc.', country: 'US', timeZone: 'America/New_York' },
  ],
  countries: [
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
  ],
};

/** A plan whose dry run read the Office column. */
export const PLAN_WITH_OFFICE: ImportPlanView = {
  ...PLAN,
  review: {
    ...PLAN.review,
    dryRun: { ...PLAN.review.dryRun, workplaces: WORKPLACES, here: PLACES_HERE },
  },
};

/** An approved import a third of the way through its people, as People answers `importRun`. */
export const RUN_GOING: ImportRunStatus = {
  id: '01a0e1d1-0000-7000-8000-00000000a001',
  status: 'running',
  label: 'Importing',
  phase: 'people',
  step: 'Adding people',
  people: { done: 312, total: 1000 },
  fileName: 'meridian-people.xlsx',
  startedBy: { name: 'Ada Lovelace', you: false },
  approvedAt: '2026-10-01T14:02:00.000Z',
  startedAt: '2026-10-01T14:02:03.000Z',
  finishedAt: null,
  now: '2026-10-01T14:06:15.000Z',
  result: null,
  failure: null,
};

/** The same import, over: what it did, as the done step says it. */
export const RUN_DONE: ImportRunStatus = {
  ...RUN_GOING,
  status: 'succeeded',
  label: 'Imported',
  phase: 'finishing',
  step: 'Finishing',
  people: { done: 1000, total: 1000 },
  finishedAt: '2026-10-01T14:08:00.000Z',
  now: '2026-10-01T14:08:01.000Z',
  result: (({ step: _step, ...rest }) => rest)(DONE),
};

/** The same import, stopped. */
export const RUN_FAILED: ImportRunStatus = {
  ...RUN_GOING,
  status: 'failed',
  label: 'Import failed',
  finishedAt: '2026-10-01T14:07:00.000Z',
  failure:
    'Adding people stopped: the file could not be read again. 312 people were imported and stay. Upload the file again to import the rest.',
};
