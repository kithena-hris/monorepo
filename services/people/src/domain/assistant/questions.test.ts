import { describe, expect, it } from 'vitest';

import { METRICS } from '../person/metrics.js';
import type { IntentCondition } from './intent.js';
import {
  directoryByRules,
  forModel,
  readDirectoryAnswer,
  type DirectoryPlan,
  type PlannedField,
} from './selection.js';

/**
 * Smart search's accuracy table: realistic questions HR asks of a
 * directory, each with the plan it should become. Every row is read twice:
 * by People's own rules, with no model at all, and as a model's structured
 * answer replayed through the same strict reading a real one gets. A row
 * that only one reader gets right is a row that fails.
 *
 * Wednesday 30 September 2026.
 */

const TODAY = '2026-09-30';

const select = (
  key: string,
  label: string,
  options: readonly [string, string][],
  kind = 'select',
): PlannedField => ({
  key,
  label,
  kind,
  options: options.map(([value, text]) => ({ value, label: text })),
  ai: true,
});
const plain = (key: string, label: string, kind: string, ai = true): PlannedField => ({
  key,
  label,
  kind,
  options: [],
  ai,
});

const fields: readonly PlannedField[] = [
  select('location_id', 'Work location', [
    ['mad', 'Madrid'],
    ['bcn', 'Barcelona'],
    ['lon', 'London Office'],
    ['chi', 'Chicago HQ'],
  ]),
  select('department', 'Department', [
    ['sales', 'Sales'],
    ['eng', 'Engineering'],
    ['fin', 'Finance'],
    ['people', 'People'],
    ['ops', 'Operations'],
  ]),
  select('employment_type', 'Employment type', [
    ['full_time', 'Full-time'],
    ['part_time', 'Part-time'],
    ['contractor', 'Contractor'],
  ]),
  plain('job_title', 'Job title', 'text'),
  plain('hire_date', 'Start date', 'date'),
  plain('last_working_day', 'Last working day', 'date'),
  plain('manager_id', 'Manager', 'person'),
  plain('annual_salary', 'Annual salary', 'number'),
  plain('work_phone', 'Work phone', 'text'),
  plain('emergency_contact', 'Emergency contact', 'text', false),
  plain('bank_account', 'Bank account', 'text', false),
  select(
    'status',
    'Status',
    [
      ['provisional', 'Not started'],
      ['pre_hire', 'Starting soon'],
      ['active', 'Active'],
      ['on_leave', 'On leave'],
      ['notice', 'On notice'],
      ['terminated', 'Left'],
    ],
    'status',
  ),
];

interface Expected {
  readonly conditions?: readonly IntentCondition[];
  readonly sort?: DirectoryPlan['sort'];
  readonly limit?: number | null;
  readonly group?: string | null;
  readonly manager?: DirectoryPlan['manager'];
}

const c = (key: string, op: IntentCondition['op'], ...values: string[]): IntentCondition => ({
  key,
  op,
  values,
});
const desc = (key: string) => ({ key, direction: 'desc' as const });
const asc = (key: string) => ({ key, direction: 'asc' as const });

const QUESTIONS: readonly (readonly [string, Expected])[] = [
  // The user's sentence.
  ['person with the highest missing fields', { sort: desc('missing_count'), limit: 1 }],
  ['who has the most missing details', { sort: desc('missing_count'), limit: 1 }],
  [
    'the person with the highest number of missing fields',
    { sort: desc('missing_count'), limit: 1 },
  ],
  ['top 5 people with the most missing details', { sort: desc('missing_count'), limit: 5 }],
  ['people with the fewest missing details', { sort: asc('missing_count') }],
  [
    'fewest missing fields in Engineering',
    { conditions: [c('department', 'in', 'eng')], sort: asc('missing_count') },
  ],
  ['who has the most complete profile', { sort: desc('completeness'), limit: 1 }],
  ['least complete profiles', { sort: asc('completeness') }],
  ['newest joiner', { sort: desc('hire_date'), limit: 1 }],
  ['the 3 newest joiners', { sort: desc('hire_date'), limit: 3 }],
  ['who has the longest tenure', { sort: desc('tenure_days'), limit: 1 }],
  ['longest serving employees', { sort: desc('tenure_days') }],
  [
    'top 10 longest serving employees in Sales',
    { conditions: [c('department', 'in', 'sales')], sort: desc('tenure_days'), limit: 10 },
  ],
  ['the manager with the biggest team', { sort: desc('team_size'), limit: 1 }],
  ['biggest teams', { sort: desc('team_size') }],
  ['who has the most direct reports', { sort: desc('direct_reports'), limit: 1 }],
  ['show me the 5 people with the most direct reports', { sort: desc('direct_reports'), limit: 5 }],
  ['people with more than 5 direct reports', { conditions: [c('direct_reports', 'after', '6')] }],
  ['most pending changes', { sort: desc('pending_changes') }],
  ['who has the most pending approvals', { sort: desc('pending_changes'), limit: 1 }],
  ['documents expiring soonest', { sort: asc('next_expiry') }],
  ['who has the soonest expiring document', { sort: asc('next_expiry'), limit: 1 }],
  [
    'people whose documents expire in the next 30 days',
    { conditions: [c('next_expiry', 'between', '2026-09-30', '2026-10-30')] },
  ],
  ['most recently updated records', { sort: desc('updated_at') }],
  ['least recently updated profiles', { sort: asc('updated_at') }],
  // Compound.
  [
    'engineers in Madrid with more than 3 missing fields who joined in the last 6 months, newest first',
    {
      conditions: [
        c('location_id', 'in', 'mad'),
        c('job_title', 'contains', 'engineer'),
        c('missing_count', 'after', '4'),
        c('hire_date', 'between', '2026-03-30', '2026-09-30'),
      ],
      sort: desc('hire_date'),
    },
  ],
  [
    'contractors in London hired this year',
    {
      conditions: [
        c('employment_type', 'in', 'contractor'),
        c('location_id', 'in', 'lon'),
        c('hire_date', 'between', '2026-01-01', '2026-12-31'),
      ],
    },
  ],
  [
    'part-time engineers in Barcelona',
    {
      conditions: [
        c('employment_type', 'in', 'part_time'),
        c('location_id', 'in', 'bcn'),
        c('job_title', 'contains', 'engineer'),
      ],
    },
  ],
  [
    'sales people with over 2 pending changes',
    { conditions: [c('department', 'in', 'sales'), c('pending_changes', 'after', '3')] },
  ],
  // Numbers.
  ['salary above 80k', { conditions: [c('annual_salary', 'after', '80000')] }],
  [
    'people earning more than 100k in London',
    { conditions: [c('location_id', 'in', 'lon'), c('annual_salary', 'after', '100000')] },
  ],
  ['annual salary under 30000', { conditions: [c('annual_salary', 'before', '30000')] }],
  // Relative dates.
  ['who joins next month', { conditions: [c('hire_date', 'between', '2026-10-01', '2026-10-31')] }],
  [
    'people who left last quarter',
    { conditions: [c('last_working_day', 'between', '2026-04-01', '2026-06-30')] },
  ],
  [
    'people who joined in the last 30 days',
    { conditions: [c('hire_date', 'between', '2026-08-31', '2026-09-30')] },
  ],
  ['joined this quarter', { conditions: [c('hire_date', 'between', '2026-07-01', '2026-09-30')] }],
  ['starting next week', { conditions: [c('hire_date', 'between', '2026-10-05', '2026-10-11')] }],
  // Negations.
  ['everyone not in Sales', { conditions: [c('department', 'not_in', 'sales')] }],
  ['people outside Engineering', { conditions: [c('department', 'not_in', 'eng')] }],
  [
    'everyone except Finance and People',
    { conditions: [c('department', 'not_in', 'fin', 'people')] },
  ],
  ['people without a manager', { conditions: [c('manager_id', 'empty')] }],
  ['employees with no work phone', { conditions: [c('work_phone', 'empty')] }],
  ['people not on leave', { conditions: [c('status', 'not_in', 'on_leave')] }],
  // Manager and team: a name for People to find, never a value the model resolves.
  ['reports of Marco', { manager: { name: 'Marco', scope: 'direct' } }],
  ['who reports to Ana Lopez', { manager: { name: 'Ana Lopez', scope: 'direct' } }],
  ["Marco's team", { manager: { name: 'Marco', scope: 'all' } }],
  [
    "engineers on Marco's team",
    {
      conditions: [c('job_title', 'contains', 'engineer')],
      manager: { name: 'Marco', scope: 'all' },
    },
  ],
  // Status.
  ['people on leave', { conditions: [c('status', 'in', 'on_leave')] }],
  ['who is serving notice', { conditions: [c('status', 'in', 'notice')] }],
  [
    'pre-hires in Barcelona',
    { conditions: [c('status', 'in', 'pre_hire'), c('location_id', 'in', 'bcn')] },
  ],
  // Group-by.
  [
    'which department has the most people missing a bank account',
    { conditions: [c('bank_account', 'empty')], group: 'department' },
  ],
  ['headcount by location', { group: 'location_id' }],
  ['how many people in each department', { group: 'department' }],
  // Plain filters, as before.
  [
    'people missing an emergency contact in Madrid',
    { conditions: [c('location_id', 'in', 'mad'), c('emergency_contact', 'empty')] },
  ],
  ['people in Sales or Finance', { conditions: [c('department', 'in', 'sales', 'fin')] }],
  [
    'everyone in Engineering sorted by start date',
    { conditions: [c('department', 'in', 'eng')], sort: asc('hire_date') },
  ],
];

const whole = (e: Expected) => ({
  conditions: e.conditions ?? [],
  sort: e.sort ?? null,
  limit: e.limit ?? null,
  group: e.group ?? null,
  manager: e.manager ?? null,
});

describe('smart search, question by question', () => {
  it('has at least forty realistic questions, the user’s own sentence first', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(40);
    expect(QUESTIONS[0]?.[0]).toBe('person with the highest missing fields');
  });

  it.each(QUESTIONS)('People’s rules read “%s”', (sentence, expected) => {
    const plan = directoryByRules(sentence, fields, TODAY, METRICS);
    expect({ ...whole(plan), unused: plan.unused }).toEqual({ ...whole(expected), unused: [] });
  });

  it.each(QUESTIONS)('a model’s answer for “%s” is read as the rules read it', (_s, expected) => {
    const e = whole(expected);
    const answer = JSON.stringify({
      conditions: e.conditions,
      match: 'all',
      sort: e.sort,
      limit: e.limit,
      groupBy: e.group,
      manager: e.manager,
      search: null,
    });
    const plan = readDirectoryAnswer(answer, forModel(fields), METRICS);
    // A field not for the assistant is named to it for "is empty" alone, so the
    // model may still ask for it missing.
    expect(plan === null ? null : whole(plan)).toEqual(e);
  });

  it('says why a grouped question is not ranked', () => {
    const plan = directoryByRules(
      'which department has the most people missing a bank account',
      fields,
      TODAY,
      METRICS,
    );
    expect(plan.notes).toEqual([
      'The directory doesn’t rank groups, so the people found are grouped by department, each group with how many it holds.',
    ]);
  });

  it('a metric the viewer may not use is not read, and its words are said as not understood', () => {
    const plan = directoryByRules('person with the highest missing fields', fields, TODAY, []);
    expect(plan.sort).toBeNull();
    expect(plan.unused).toEqual(['highest', 'missing', 'fields']);
  });

  it('refuses a model’s answer that orders by a metric not offered, or names nobody as a name', () => {
    const shown = forModel(fields);
    const without = METRICS.filter((m) => m.key !== 'missing_count');
    expect(
      readDirectoryAnswer(
        '{"sort":{"key":"missing_count","direction":"desc"},"limit":1}',
        shown,
        without,
      ),
    ).toBeNull();
    expect(readDirectoryAnswer('{"conditions":[],"search":"null"}', shown, METRICS)).toBeNull();
    expect(
      readDirectoryAnswer('{"manager":{"name":"none","scope":"all"}}', shown, METRICS),
    ).toBeNull();
    // A condition on a metric that only orders is not one.
    expect(
      readDirectoryAnswer(
        '{"conditions":[{"key":"completeness","op":"after","values":["50"]}]}',
        shown,
        METRICS,
      ),
    ).toBeNull();
  });
});
