import { describe, expect, it } from 'vitest';

import { sift, suggestions } from './clarify.js';
import {
  directoryByRules,
  forModel,
  isEmail,
  readDirectoryAnswer,
  type PlannedField,
} from './selection.js';

const TODAY = '2026-09-30';

const fields: readonly PlannedField[] = [
  {
    key: 'location_id',
    label: 'Work location',
    kind: 'select',
    options: [
      { value: 'ber', label: 'Berlin' },
      { value: 'mad', label: 'Madrid' },
    ],
    ai: true,
  },
  {
    key: 'department',
    label: 'Department',
    kind: 'select',
    options: [{ value: 'eng', label: 'Engineering' }],
    ai: true,
  },
  {
    key: 'contract_type',
    label: 'Contract type',
    kind: 'select',
    options: [
      { value: 'permanent', label: 'Permanent' },
      { value: 'fixed', label: 'Fixed-term' },
    ],
    ai: true,
  },
  { key: 'job_title', label: 'Job title', kind: 'text', options: [], ai: true },
  { key: 'skills', label: 'Skills', kind: 'text', options: [], ai: true },
  { key: 'hire_date', label: 'Start date', kind: 'date', options: [], ai: true },
  { key: 'contract_end', label: 'Contract end date', kind: 'date', options: [], ai: true },
  { key: 'emergency_contact', label: 'Emergency contact', kind: 'text', options: [], ai: false },
  {
    key: 'status',
    label: 'Status',
    kind: 'status',
    options: [
      { value: 'pre_hire', label: 'Starting soon' },
      { value: 'active', label: 'Active' },
      { value: 'notice', label: 'On notice' },
    ],
    ai: true,
  },
];

describe('asking instead of guessing', () => {
  it('“people leaving soon”: notice, a contract ending in 90 days, or both', () => {
    const s = sift('people leaving soon', fields, TODAY, {});
    expect(s.clarify).toEqual({
      topic: 'leaving',
      phrase: 'leaving soon',
      readings: [
        {
          label: 'Have given notice',
          conditions: [{ key: 'status', op: 'in', values: ['notice'] }],
          match: 'all',
        },
        {
          label: 'Contract end date in the next 90 days',
          conditions: [{ key: 'contract_end', op: 'between', values: [TODAY, '2026-12-29'] }],
          match: 'all',
        },
        {
          label: 'Both',
          conditions: [
            { key: 'status', op: 'in', values: ['notice'] },
            { key: 'contract_end', op: 'between', values: [TODAY, '2026-12-29'] },
          ],
          match: 'any',
        },
      ],
    });
    expect(s.reading).toBeNull();
    // The phrase is the question's, so the rules make nothing of it either.
    expect(directoryByRules(s.rest, fields, TODAY).unused).toEqual([]);
  });

  it('with something else asked too, “both” is not offered: all of one and any of another cannot be one query', () => {
    const s = sift('engineers leaving soon', fields, TODAY, {});
    expect(s.clarify?.readings.map((r) => r.label)).toEqual([
      'Have given notice',
      'Contract end date in the next 90 days',
    ]);
    expect(directoryByRules(s.rest, fields, TODAY).conditions).toEqual([
      { key: 'job_title', op: 'contains', values: ['engineer'] },
    ]);
  });

  it('a reading chosen before is taken, and said', () => {
    const s = sift('people leaving soon', fields, TODAY, { leaving: 'Have given notice' });
    expect(s.clarify).toBeNull();
    expect(s.reading?.conditions).toEqual([{ key: 'status', op: 'in', values: ['notice'] }]);
    expect(s.remembered).toEqual({ topic: 'leaving', phrase: 'leaving soon', label: 'Have given notice' });
  });

  it('only one reading possible is no question: it is used', () => {
    const noEnd = fields.filter((f) => f.key !== 'contract_end');
    const s = sift('leavers', noEnd, TODAY, {});
    expect(s.clarify).toBeNull();
    expect(s.reading?.conditions).toEqual([{ key: 'status', op: 'in', values: ['notice'] }]);
  });

  it('no reading possible leaves the words unused, as any other', () => {
    const none = fields.filter((f) => f.key !== 'contract_end' && f.key !== 'status');
    const s = sift('people leaving soon', none, TODAY, {});
    expect(s.clarify).toBeNull();
    expect(s.reading).toBeNull();
    expect(s.rest).toBe('people leaving soon');
  });

  it('new joiners: the last 30 days, the last 90, or this year', () => {
    const s = sift('new joiners in Berlin', fields, TODAY, {});
    expect(s.clarify?.readings).toEqual([
      {
        label: 'Joined in the last 30 days',
        conditions: [{ key: 'hire_date', op: 'between', values: ['2026-08-31', TODAY] }],
        match: 'all',
      },
      {
        label: 'Joined in the last 90 days',
        conditions: [{ key: 'hire_date', op: 'between', values: ['2026-07-02', TODAY] }],
        match: 'all',
      },
      {
        label: 'Joined this year',
        conditions: [{ key: 'hire_date', op: 'between', values: ['2026-01-01', TODAY] }],
        match: 'all',
      },
    ]);
  });
});

describe('refusing judgements', () => {
  it('“good at Go” is a judgement of skill: refused, and the Skills field offered instead', () => {
    const s = sift('engineers in Berlin who are good at Go', fields, TODAY, {});
    expect(s.refused).toEqual([
      {
        text: 'who are good at Go',
        kind: 'skills',
        why: 'Kithena doesn’t rate people’s skills.',
        instead: {
          key: 'skills',
          label: 'Skills',
          subject: 'Go',
          condition: { key: 'skills', op: 'contains', values: ['Go'] },
        },
      },
    ]);
    const rest = directoryByRules(s.rest, fields, TODAY);
    expect(rest.conditions).toEqual([
      { key: 'location_id', op: 'in', values: ['ber'] },
      { key: 'job_title', op: 'contains', values: ['engineer'] },
    ]);
    expect(rest.unused).toEqual([]);
  });

  it('performance, predictions, health and other special-category data are never searched', () => {
    const kinds = (sentence: string) => sift(sentence, fields, TODAY, {}).refused.map((r) => r.kind);
    expect(kinds('top performers in Madrid')).toEqual(['performance']);
    expect(kinds('who is underperforming')).toEqual(['performance']);
    expect(kinds('engineers likely to quit')).toEqual(['prediction']);
    expect(kinds('people who are pregnant')).toEqual(['special']);
    expect(kinds('muslim engineers')).toEqual(['special']);
    expect(kinds('people on sick leave')).toEqual(['special']);
    expect(kinds('people with mental health issues')).toEqual(['special']);
    // A department called Healthcare is a department.
    expect(kinds('everyone in Healthcare')).toEqual([]);
    expect(sift('top performers', fields, TODAY, {}).refused[0]?.instead).toBeNull();
  });

  it('a refused part never reaches the rules, nor anything asked after', () => {
    const s = sift('top performers in Madrid', fields, TODAY, {});
    expect(s.rest).not.toMatch(/perform/u);
    expect(directoryByRules(s.rest, fields, TODAY).conditions).toEqual([
      { key: 'location_id', op: 'in', values: ['mad'] },
    ]);
  });

  it('nothing to refuse is nothing refused', () => {
    expect(sift('engineers in Madrid', fields, TODAY, {}).refused).toEqual([]);
    // "good" alone is not a judgement of anybody.
    expect(sift('Goodwin', fields, TODAY, {}).refused).toEqual([]);
  });
});

describe('suggestions, from the company’s own fields', () => {
  it('each one something People reads in full, by its own rules', () => {
    const said = suggestions(fields, TODAY);
    expect(said).toEqual([
      'Who joins in the next 30 days?',
      'People in Berlin on a permanent contract',
      'Everyone in Engineering who joined this year',
      'Everyone missing an emergency contact',
    ]);
    for (const s of said) {
      const plan = directoryByRules(s, fields, TODAY);
      expect(plan.conditions.length).toBeGreaterThan(0);
      expect(plan.unused).toEqual([]);
    }
  });

  it('a company without those fields is offered fewer, never one it cannot answer', () => {
    const bare: readonly PlannedField[] = [
      { key: 'job_title', label: 'Job title', kind: 'text', options: [], ai: true },
    ];
    expect(suggestions(bare, TODAY)).toEqual(['Everyone missing a job title']);
  });

  it('never an option of a field the assistant may not use', () => {
    const secret = fields.map((f) => (f.key === 'location_id' ? { ...f, ai: false } : f));
    expect(suggestions(secret, TODAY).some((s) => s.includes('Berlin'))).toBe(false);
  });
});

describe('the directory’s rules, for smart search', () => {
  it('the next or the last so many days, weeks or months', () => {
    const at = (s: string) => directoryByRules(s, fields, TODAY).conditions;
    expect(at('Who joins in the next 30 days?')).toEqual([
      { key: 'hire_date', op: 'between', values: [TODAY, '2026-10-30'] },
    ]);
    expect(at('joined in the last 2 weeks')).toEqual([
      { key: 'hire_date', op: 'between', values: ['2026-09-16', TODAY] },
    ]);
  });

  it('an email address is one, and goes to whoever has it', () => {
    expect(isEmail('ada@acme.example')).toBe(true);
    expect(isEmail(' Ada.Lovelace@acme.example ')).toBe(true);
    expect(isEmail('ada at acme')).toBe(false);
    expect(isEmail('ada@acme.example and grace@acme.example')).toBe(false);
  });

  it('the model may ask too, with readings read as strictly as any answer', () => {
    const shown = forModel(fields);
    const asked = readDirectoryAnswer(
      JSON.stringify({
        conditions: [{ key: 'location_id', op: 'in', values: ['Berlin'] }],
        ask: {
          phrase: 'senior',
          options: [
            {
              label: 'Job title mentions senior',
              conditions: [{ key: 'job_title', op: 'contains', values: ['senior'] }],
            },
            {
              label: 'Joined before 2020',
              conditions: [{ key: 'hire_date', op: 'before', values: ['2019-12-31'] }],
            },
          ],
        },
      }),
      shown,
    );
    expect(asked?.conditions).toEqual([{ key: 'location_id', op: 'in', values: ['ber'] }]);
    expect(asked?.ask).toEqual({
      phrase: 'senior',
      readings: [
        {
          label: 'Job title mentions senior',
          conditions: [{ key: 'job_title', op: 'contains', values: ['senior'] }],
          match: 'all',
        },
        {
          label: 'Joined before 2020',
          conditions: [{ key: 'hire_date', op: 'before', values: ['2019-12-31'] }],
          match: 'all',
        },
      ],
    });
    // A reading over a field not shown, or a label shaped like somebody's value, refuses the lot.
    const bad = (label: string, key: string) =>
      readDirectoryAnswer(
        JSON.stringify({
          ask: {
            phrase: 'x',
            options: [
              { label, conditions: [{ key, op: 'not_empty', values: [] }] },
              { label: 'Other', conditions: [{ key: 'job_title', op: 'empty', values: [] }] },
            ],
          },
        }),
        shown,
      );
    expect(bad('Salary set', 'salary')).toBeNull();
    expect(bad('ada@acme.example', 'job_title')).toBeNull();
    expect(bad('Has a title', 'job_title')).not.toBeNull();
  });
});
