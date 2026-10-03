import { describe, expect, it } from 'vitest';

import { policy } from '../classification.js';
import {
  AssistantAnswer,
  AssistantQuestion,
  capability,
  CapabilityOutput,
  DateOn,
  PersonRow,
  PeopleResult,
} from './capability.js';

const ADA = '0190a0b0-0000-7000-8000-000000000001';

const away = capability({
  name: 'timeoff.away',
  version: 1,
  module: 'timeoff',
  about: 'People away on leave on a date or over a range.',
  accepts: { filters: ['leave_type', 'team'], on: 'required', name: true, within: true },
  groups: ['team', 'location'],
  output: 'people',
});

const people = (extra: object = {}) => ({
  kind: 'people',
  rows: [{ personId: ADA, name: 'Ada Lovelace', detail: 'Tue 6 · Away', groups: {} }],
  total: 1,
  scope: 'everyone',
  described: 'away on Tuesday 6 October',
  notes: [],
  ...extra,
});

describe('capability (AST-001)', () => {
  it('names a capability after its module', () => {
    expect(() => capability({ ...definition(), name: 'timeoff.approvals' })).toThrow(/module/u);
    expect(() => capability({ ...definition(), name: 'away' })).toThrow(/module/u);
    expect(capability(definition()).groups).toEqual([]);
  });

  it('lets a step write only what it accepts, as dates or references', () => {
    const step = away.schemas.step;
    expect(step.safeParse({ on: 'today' }).success).toBe(true);
    expect(step.safeParse({ on: { from: 'next_week', to: '2026-10-20' } }).success).toBe(true);
    expect(
      step.safeParse({ on: 'today', filters: [{ key: 'leave_type', op: 'in', values: ['L1'] }] })
        .success,
    ).toBe(true);
    // Required, a key it does not take, an input only the assistant sets.
    expect(step.safeParse({}).success).toBe(false);
    expect(step.safeParse({ on: 'today', filters: [{ key: 'salary', op: 'empty' }] }).success).toBe(
      false,
    );
    expect(step.safeParse({ on: 'today', sort: { key: 'name', direction: 'asc' } }).success).toBe(
      false,
    );
    expect(step.safeParse({ on: 'today', limit: 5 }).success).toBe(false);
    expect(step.safeParse({ on: 'today', personIds: [ADA] }).success).toBe(false);
    expect(DateOn.safeParse('fortnight').success).toBe(false);
  });

  it('calls the module with resolved dates and the assistant’s own inputs', () => {
    const input = away.schemas.input;
    const call = { on: { from: '2026-10-06', to: '2026-10-06' }, limit: 0 };
    expect(input.safeParse(call).success).toBe(true);
    expect(input.safeParse({ ...call, ids: true, personIds: [ADA] }).success).toBe(true);
    expect(input.safeParse({ ...call, on: 'today' }).success).toBe(false);
    expect(input.safeParse({ ...call, on: { from: '2026-10-07', to: '2026-10-06' } }).success).toBe(
      false,
    );
    expect(input.safeParse({ ...call, limit: 5001 }).success).toBe(false);
    expect(
      input.safeParse({ ...call, personIds: Array.from({ length: 5001 }, () => ADA) }).success,
    ).toBe(false);
  });

  it('holds filters to ten, of twenty values each', () => {
    const filter = { key: 'team', op: 'in', values: ['a'] };
    const step = away.schemas.step;
    expect(
      step.safeParse({ on: 'today', filters: Array.from({ length: 10 }, () => filter) }).success,
    ).toBe(true);
    expect(
      step.safeParse({ on: 'today', filters: Array.from({ length: 11 }, () => filter) }).success,
    ).toBe(false);
    expect(
      step.safeParse({ on: 'today', filters: [{ ...filter, values: Array(21).fill('a') }] })
        .success,
    ).toBe(false);
  });

  it('answers with its kind, or ambiguous and not found when it takes a name', () => {
    const output = away.schemas.output;
    expect(output.safeParse(people()).success).toBe(true);
    expect(output.safeParse(people({ ids: [ADA] })).success).toBe(true);
    expect(output.safeParse({ kind: 'not_found', name: 'Zed' }).success).toBe(true);
    expect(output.safeParse({ kind: 'not_found', self: true }).success).toBe(true);
    expect(output.safeParse({ kind: 'not_found', name: 'Zed', self: true }).success).toBe(false);
    expect(output.safeParse({ kind: 'not_found' }).success).toBe(false);
    expect(
      output.safeParse({
        kind: 'ambiguous',
        name: 'Ana',
        candidates: [{ personId: ADA, name: 'Ana Ruiz' }],
      }).success,
    ).toBe(true);
    expect(output.safeParse({ kind: 'items', items: [], total: 0 }).success).toBe(false);
    expect(output.safeParse(people({ withheld: 2 })).success).toBe(false);
    expect(CapabilityOutput.safeParse({ kind: 'items', items: [], total: 0 }).success).toBe(true);
    expect(
      capability(definition()).schemas.output.safeParse({ kind: 'not_found', self: true }).success,
    ).toBe(false);
  });

  it('classifies what identifies a person, and a row’s detail as health data', () => {
    expect(policy.get(PersonRow.shape.detail)?.classification).toBe('special-category');
    expect(policy.get(PersonRow.shape.detail)?.piiKind).toBe('health');
    expect(policy.get(PersonRow.shape.name)?.piiKind).toBe('identity');
    expect(policy.get(PersonRow.shape.personId)?.piiKind).toBe('identity');
    expect(policy.get(PeopleResult.shape.ids.unwrap())?.piiKind).toBe('identity');
    expect(policy.get(PeopleResult.shape.described)?.classification).toBe('internal');
    expect(policy.get(PeopleResult.shape.notes)?.classification).toBe('internal');
  });
});

describe('the question and the answer', () => {
  it('reads a question from a channel', () => {
    const question = {
      tenantId: '0190a0b0-0000-7000-8000-0000000000aa',
      email: 'ada@acme.test',
      question: 'How many people are off today?',
      channel: 'slack',
    };
    expect(AssistantQuestion.safeParse(question).success).toBe(true);
    expect(AssistantQuestion.safeParse({ ...question, earlier: ['Who is off?'] }).success).toBe(
      true,
    );
    expect(AssistantQuestion.safeParse({ ...question, question: 'x'.repeat(501) }).success).toBe(
      false,
    );
    expect(AssistantQuestion.safeParse({ ...question, channel: 'fax' }).success).toBe(false);
    expect(policy.get(AssistantQuestion.shape.question)?.aiEligible).toBe(false);
  });

  it('reads today’s answer shape', () => {
    expect(
      AssistantAnswer.safeParse({
        text: 'Here’s who is out today: 14 people.',
        understood: 'Away on Tuesday 6 October',
        people: [{ id: ADA, name: 'Ada Lovelace', title: null }],
        answered: true,
      }).success,
    ).toBe(true);
  });
});

function definition() {
  return {
    name: 'people.approvals',
    version: 1,
    module: 'people',
    about: 'What waits for the asker’s approval.',
    accepts: {},
    output: 'items',
  } as const;
}
