import { describe, expect, it } from 'vitest';

import {
  PeopleApprovals,
  peopleCapabilities,
  PeopleFind,
  PeopleManagers,
  PeoplePerson,
  PeopleReports,
} from './people.js';

const ADA = '0190a0b0-0000-7000-8000-000000000001';
const MARCO = '0190a0b0-0000-7000-8000-000000000002';

const found = {
  kind: 'people',
  rows: [{ personId: ADA, name: 'Ada Lovelace', title: 'Engineer', groups: { department: 'Eng' } }],
  total: 1,
  scope: 'visible',
  described: 'in Engineering',
  notes: [],
};

describe('People’s capabilities (AST-002)', () => {
  it('are the five Slack answers today, in People', () => {
    expect(peopleCapabilities.map((c) => c.name)).toEqual([
      'people.find',
      'people.person',
      'people.reports',
      'people.managers',
      'people.approvals',
    ]);
    expect(peopleCapabilities.every((c) => c.module === 'people' && c.version === 1)).toBe(true);
  });

  it('people.find: filters, a manager by name, a sort, a group, within', () => {
    const step = {
      filters: [{ key: 'department', op: 'in', values: ['engineering'] }],
      match: 'all',
      sort: { key: 'hire_date', direction: 'desc' },
      name: 'Marco',
      groupBy: 'location',
    };
    expect(PeopleFind.schemas.step.safeParse(step).success).toBe(true);
    expect(
      PeopleFind.schemas.input.safeParse({ ...step, limit: 25, ids: true, personIds: [ADA] })
        .success,
    ).toBe(true);
    expect(PeopleFind.schemas.output.safeParse(found).success).toBe(true);
    expect(PeopleFind.schemas.step.safeParse({ on: 'today' }).success).toBe(false);
    expect(PeopleFind.groups).toEqual(['field:*']);
  });

  it('people.person: a name, a profile, or who it could be', () => {
    expect(PeoplePerson.schemas.step.safeParse({ name: '@me' }).success).toBe(true);
    expect(PeoplePerson.schemas.step.safeParse({}).success).toBe(false);
    expect(PeoplePerson.schemas.input.safeParse({ name: 'Michael' }).success).toBe(true);
    expect(PeoplePerson.schemas.input.safeParse({ name: 'Michael', limit: 1 }).success).toBe(false);
    const output = PeoplePerson.schemas.output;
    expect(
      output.safeParse({
        kind: 'profile',
        personId: MARCO,
        name: 'Marco Ruiz',
        manager: 'Ada Lovelace',
        hireDate: '2021-03-01',
        email: 'marco@acme.test',
        self: false,
      }).success,
    ).toBe(true);
    expect(output.safeParse({ kind: 'not_found', self: true }).success).toBe(true);
    expect(output.safeParse(found).success).toBe(false);
  });

  it('people.reports: a name, the people reporting to them', () => {
    expect(PeopleReports.schemas.input.safeParse({ name: 'Michael', limit: 25 }).success).toBe(
      true,
    );
    expect(PeopleReports.schemas.output.safeParse(found).success).toBe(true);
    expect(
      PeopleReports.schemas.output.safeParse({
        kind: 'ambiguous',
        name: 'Michael',
        candidates: [{ personId: ADA, name: 'Michael Scott' }],
      }).success,
    ).toBe(true);
  });

  it('people.managers: only ever within an earlier step', () => {
    expect(PeopleManagers.schemas.step.safeParse({}).success).toBe(true);
    expect(PeopleManagers.schemas.step.safeParse({ name: 'Marco' }).success).toBe(false);
    expect(PeopleManagers.schemas.input.safeParse({ limit: 25, personIds: [ADA] }).success).toBe(
      true,
    );
    expect(PeopleManagers.schemas.input.safeParse({ limit: 25 }).success).toBe(false);
    expect(PeopleManagers.schemas.output.safeParse(found).success).toBe(true);
  });

  it('people.approvals: nothing in, what waits out', () => {
    expect(PeopleApprovals.schemas.step.safeParse({}).success).toBe(true);
    expect(PeopleApprovals.schemas.input.safeParse({ limit: 10 }).success).toBe(true);
    expect(
      PeopleApprovals.schemas.output.safeParse({
        kind: 'items',
        items: [{ name: 'Ada Lovelace', label: 'Work email' }],
        total: 1,
      }).success,
    ).toBe(true);
    expect(PeopleApprovals.schemas.output.safeParse({ kind: 'not_found', name: 'x' }).success).toBe(
      false,
    );
  });
});
