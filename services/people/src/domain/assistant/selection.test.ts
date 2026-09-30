import { describe, expect, it } from 'vitest';

import type { CatalogueField } from './intent.js';
import {
  directoryByRules,
  exportByRules,
  forModel,
  isPlainSearch,
  readDirectoryAnswer,
  readExportAnswer,
  type ExportCatalogue,
  type PlannedField,
} from './selection.js';

const TODAY = '2026-09-30';

const fields: readonly PlannedField[] = [
  {
    key: 'location_id',
    label: 'Work location',
    kind: 'select',
    options: [
      { value: 'bcn', label: 'Barcelona' },
      { value: 'mad-office', label: 'Madrid office' },
    ],
    ai: true,
  },
  {
    key: 'legal_entity_id',
    label: 'Legal entity',
    kind: 'select',
    options: [
      { value: 'mad', label: 'Acme Madrid SL' },
      { value: 'uk', label: 'Acme UK Ltd' },
    ],
    ai: true,
  },
  {
    key: 'department',
    label: 'Department',
    kind: 'select',
    options: [
      { value: 'sales', label: 'Sales' },
      { value: 'eng', label: 'Engineering' },
    ],
    ai: true,
  },
  { key: 'job_title', label: 'Job title', kind: 'text', options: [], ai: true },
  { key: 'hire_date', label: 'Start date', kind: 'date', options: [], ai: true },
  { key: 'emergency_contact', label: 'Emergency contact', kind: 'text', options: [], ai: false },
  {
    key: 'emergency_contact_phone',
    label: 'Emergency contact phone',
    kind: 'text',
    options: [],
    ai: false,
  },
];

describe('a sentence read by People’s own rules, for the directory', () => {
  it('engineers in Barcelona starting next month: the place, the role and the month', () => {
    const plan = directoryByRules('engineers in Barcelona starting next month', fields, TODAY);
    expect(plan.conditions).toEqual([
      { key: 'location_id', op: 'in', values: ['bcn'] },
      { key: 'job_title', op: 'contains', values: ['engineer'] },
      { key: 'hire_date', op: 'between', values: ['2026-10-01', '2026-10-31'] },
    ]);
    expect(plan.unused).toEqual([]);
    expect(plan.search).toBeNull();
  });

  it('people missing an emergency contact: that field empty, not its phone', () => {
    const plan = directoryByRules('people missing an emergency contact', fields, TODAY);
    expect(plan.conditions).toEqual([{ key: 'emergency_contact', op: 'empty', values: [] }]);
    expect(plan.unused).toEqual([]);
  });

  it('managers in Sales hired before 2024: the department, the role, and on or before the last day of 2023', () => {
    const plan = directoryByRules('managers in Sales hired before 2024', fields, TODAY);
    expect(plan.conditions).toEqual([
      { key: 'department', op: 'in', values: ['sales'] },
      { key: 'job_title', op: 'contains', values: ['manager'] },
      { key: 'hire_date', op: 'before', values: ['2023-12-31'] },
    ]);
    expect(plan.unused).toEqual([]);
  });

  it('a name ending in s is not a role; an everyday word is an option only as a name is written', () => {
    const withPeople: readonly PlannedField[] = [
      ...fields,
      {
        key: 'team',
        label: 'Team',
        kind: 'select',
        options: [{ value: 'people', label: 'People' }],
        ai: true,
      },
    ];
    expect(directoryByRules('James Lewis', withPeople, TODAY).conditions).toEqual([]);
    expect(directoryByRules('people missing a job title', withPeople, TODAY).conditions).toEqual([
      { key: 'job_title', op: 'empty', values: [] },
    ]);
    expect(directoryByRules('everyone in People', withPeople, TODAY).conditions).toEqual([
      { key: 'team', op: 'in', values: ['people'] },
    ]);
    expect(directoryByRules('people team', withPeople, TODAY).conditions).toEqual([
      { key: 'team', op: 'in', values: ['people'] },
    ]);
  });

  it('since, after, in and between, each with its bounds', () => {
    const at = (s: string) => directoryByRules(s, fields, TODAY).conditions;
    expect(at('joined since March 2025')).toEqual([
      { key: 'hire_date', op: 'after', values: ['2025-03-01'] },
    ]);
    expect(at('hired after 2024')).toEqual([
      { key: 'hire_date', op: 'after', values: ['2025-01-01'] },
    ]);
    expect(at('started in February 2024')).toEqual([
      { key: 'hire_date', op: 'between', values: ['2024-02-01', '2024-02-29'] },
    ]);
    expect(at('hired between 1 January 2020 and 2022-06-30')).toEqual([
      { key: 'hire_date', op: 'between', values: ['2020-01-01', '2022-06-30'] },
    ]);
  });

  it('two options of one field are either of them', () => {
    expect(directoryByRules('Sales or Engineering', fields, TODAY).conditions).toEqual([
      { key: 'department', op: 'in', values: ['sales', 'eng'] },
    ]);
  });

  it('an order: the newest first', () => {
    expect(directoryByRules('newest in Sales', fields, TODAY).sort).toEqual({
      key: 'hire_date',
      direction: 'desc',
    });
  });

  it('a word of a long option counts only beside its field', () => {
    expect(directoryByRules('the Madrid entity', fields, TODAY).conditions).toEqual([
      { key: 'legal_entity_id', op: 'in', values: ['mad'] },
    ]);
    // "Madrid" alone is the office, whose whole name is not in the sentence either.
    expect(directoryByRules('people in Madrid', fields, TODAY).conditions).toEqual([]);
  });
});

describe('a plain search', () => {
  it('a name is a name: no model, no rules', () => {
    expect(isPlainSearch('Pam Beesly', fields)).toBe(true);
    expect(isPlainSearch('o’brien', fields)).toBe(true);
  });

  it('a sentence, a field’s option or a number is not', () => {
    expect(isPlainSearch('engineers in Barcelona', fields)).toBe(false);
    expect(isPlainSearch('Sales', fields)).toBe(false);
    expect(isPlainSearch('hired 2024', fields)).toBe(false);
    expect(isPlainSearch('one two three four five', fields)).toBe(false);
  });
});

describe('what the model is shown', () => {
  it('a field not for the assistant is named, for empty or not, with no options', () => {
    const shown = forModel([
      ...fields,
      {
        key: 'shirt',
        label: 'Shirt size',
        kind: 'select',
        options: [{ value: 'm', label: 'Medium' }],
        ai: false,
      },
    ]);
    expect(shown.find((f) => f.key === 'shirt')).toEqual({
      key: 'shirt',
      label: 'Shirt size',
      kind: 'presence',
      options: [],
    });
    expect(shown.find((f) => f.key === 'department')?.options).toHaveLength(2);
  });
});

describe('reading the model’s answer for the directory, strictly', () => {
  const model: readonly CatalogueField[] = forModel(fields);

  it('takes conditions over the fields shown, reading an option by its label', () => {
    const plan = readDirectoryAnswer(
      JSON.stringify({
        conditions: [
          { key: 'job_title', op: 'contains', values: ['engineer'] },
          { key: 'location_id', op: 'in', values: ['Barcelona'] },
          { key: 'hire_date', op: 'between', values: ['2026-10-01', '2026-10-31'] },
        ],
        match: 'all',
        sort: null,
        search: null,
      }),
      model,
    );
    expect(plan).toEqual({
      search: null,
      conditions: [
        { key: 'job_title', op: 'contains', values: ['engineer'] },
        { key: 'location_id', op: 'in', values: ['bcn'] },
        { key: 'hire_date', op: 'between', values: ['2026-10-01', '2026-10-31'] },
      ],
      match: 'all',
      sort: null,
      unused: [],
    });
  });

  it('refuses the whole answer for a field not shown, a value on a presence field, a bad date or an extra key', () => {
    const one = (condition: object, extra: object = {}) =>
      readDirectoryAnswer(JSON.stringify({ conditions: [condition], ...extra }), model);
    expect(one({ key: 'salary', op: 'after', values: ['1'] })).toBeNull();
    expect(one({ key: 'emergency_contact', op: 'contains', values: ['Ana'] })).toBeNull();
    expect(one({ key: 'hire_date', op: 'before', values: ['next month'] })).toBeNull();
    expect(one({ key: 'department', op: 'contains', values: ['Sa'] })).toBeNull();
    expect(one({ key: 'department', op: 'in', values: ['sales'] }, { note: 'hi' })).toBeNull();
    expect(readDirectoryAnswer('not json', model)).toBeNull();
  });

  it('an answer that understood nothing is no answer', () => {
    expect(readDirectoryAnswer('{"conditions":[]}', model)).toBeNull();
  });

  it('an order only by a field shown, or by name', () => {
    const sorted = (key: string) =>
      readDirectoryAnswer(
        JSON.stringify({ conditions: [], sort: { key, direction: 'desc' } }),
        model,
      )?.sort ?? null;
    expect(sorted('hire_date')).toEqual({ key: 'hire_date', direction: 'desc' });
    expect(sorted('name')).toEqual({ key: 'name', direction: 'desc' });
    expect(sorted('salary')).toBeNull();
  });
});

const exportable: ExportCatalogue = {
  today: '2026-10-02',
  fields: [
    { key: 'given_name', label: 'First name', section: 'Personal' },
    { key: 'family_name', label: 'Last name', section: 'Personal' },
    { key: 'work_email', label: 'Work email', section: 'Contact' },
    { key: 'employee_number', label: 'Employee number', section: 'Employment' },
    { key: 'hire_date', label: 'Start date', section: 'Employment' },
    { key: 'salary', label: 'Base salary', section: 'Pay' },
    { key: 'iban', label: 'Bank account', section: 'Pay' },
    { key: 'shirt', label: 'T-shirt size', section: 'Other' },
  ],
  audiences: [
    { value: 'everyone', label: 'Everybody you can see' },
    { value: 'segment:s1', label: 'Sales team' },
  ],
  filters: fields,
};

describe('an export described in words, read by People’s own rules', () => {
  it('everything payroll needs for the Madrid entity as of 1 October', () => {
    const plan = exportByRules(
      'everything payroll needs for the Madrid entity as of 1 October',
      exportable,
    );
    expect(plan.audience).toEqual({
      kind: 'conditions',
      conditions: [{ key: 'legal_entity_id', op: 'in', values: ['mad'] }],
      match: 'all',
    });
    expect(plan.fields).toEqual([
      'given_name',
      'family_name',
      'employee_number',
      'hire_date',
      'salary',
      'iban',
    ]);
    expect(plan.asOf).toBe('2026-10-01');
    expect(plan.format).toBe('xlsx');
    expect(plan.reason).toBe('Payroll for Acme Madrid SL, as of 1 October 2026');
    expect(plan.notes).toEqual([]);
  });

  it('a date still to come is today, and says so', () => {
    const plan = exportByRules('payroll as of 1 November', exportable);
    expect(plan.asOf).toBe('2026-10-02');
    expect(plan.notes).toEqual(['1 November 2026 is still to come, so the export is as of today.']);
  });

  it('a saved view by its name, a format, and photos', () => {
    const plan = exportByRules('the sales team as a CSV with photos', exportable);
    expect(plan.audience).toEqual({ kind: 'segment', value: 'segment:s1' });
    expect(plan.format).toBe('csv');
    expect(plan.photos).toBe(true);
  });

  it('named fields and sections; nothing named is every field', () => {
    expect(exportByRules('work email and start date', exportable).fields).toEqual([
      'work_email',
      'hire_date',
    ]);
    expect(exportByRules('the pay section', exportable).fields).toEqual(['salary', 'iban']);
    expect(exportByRules('a roster as a pdf', exportable).fields).toHaveLength(8);
  });
});

describe('reading the model’s answer for an export, strictly', () => {
  const answer = (over: object) =>
    readExportAnswer(
      JSON.stringify({
        fields: ['given_name', 'salary'],
        audience: { kind: 'everyone' },
        asOf: '2026-10-01',
        format: 'xlsx',
        photos: false,
        reason: 'Monthly payroll for Madrid',
        ...over,
      }),
      exportable,
    );

  it('takes a selection of fields offered, an audience offered, a date and a reason', () => {
    expect(answer({})).toEqual({
      fields: ['given_name', 'salary'],
      audience: { kind: 'everyone' },
      asOf: '2026-10-01',
      format: 'xlsx',
      photos: false,
      reason: 'Monthly payroll for Madrid',
      notes: [],
    });
  });

  it('conditions for an audience, read as the directory’s are', () => {
    expect(
      answer({
        audience: {
          kind: 'conditions',
          conditions: [{ key: 'legal_entity_id', op: 'in', values: ['Acme Madrid SL'] }],
        },
      })?.audience,
    ).toEqual({
      kind: 'conditions',
      conditions: [{ key: 'legal_entity_id', op: 'in', values: ['mad'] }],
      match: 'all',
    });
  });

  it('refuses a field not offered, a segment not offered, or conditions on an unknown field', () => {
    expect(answer({ fields: ['given_name', 'health'] })).toBeNull();
    expect(answer({ audience: { kind: 'segment', value: 'segment:other' } })).toBeNull();
    expect(
      answer({
        audience: { kind: 'conditions', conditions: [{ key: 'x', op: 'in', values: ['1'] }] },
      }),
    ).toBeNull();
    expect(answer({ format: 'docx' })).toBeNull();
  });

  it('a date still to come is today; a reason with markup or a number is not kept', () => {
    const later = answer({ asOf: '2027-01-01' });
    expect(later?.asOf).toBe('2026-10-02');
    expect(later?.notes).toHaveLength(1);
    expect(answer({ reason: '<b>payroll</b>' })?.reason).toBeNull();
    expect(answer({ reason: 'Pay for ES12 3456 7890' })?.reason).toBeNull();
  });
});
