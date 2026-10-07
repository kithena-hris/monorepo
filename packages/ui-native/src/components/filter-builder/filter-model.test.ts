import { describe, expect, it } from 'vitest';

import {
  addCondition,
  addGroup,
  conditionsOf,
  describeFilter,
  isConditionComplete,
  removeItem,
  setMatch,
  updateCondition,
  type FilterField,
  type FilterGroup,
} from './filter-model.ts';

const fields: FilterField[] = [
  {
    id: 'team',
    label: 'Team',
    operators: [
      { id: 'is', label: 'is', value: 'option' },
      { id: 'in', label: 'is any of', value: 'options' },
      { id: 'empty', label: 'is empty', value: 'none' },
    ],
    options: [
      { value: 'eng', label: 'Engineering' },
      { value: 'design', label: 'Design' },
    ],
  },
  { id: 'location', label: 'Location', operators: [{ id: 'is', label: 'is', value: 'text' }] },
  {
    id: 'start',
    label: 'Start date',
    operators: [
      { id: 'after', label: 'is after', value: 'date' },
      { id: 'between', label: 'is between', value: 'date-range' },
    ],
  },
];

const policy: FilterGroup = {
  match: 'all',
  conditions: [{ id: 'c1', field: 'team', operator: 'is', values: ['eng'] }],
  groups: [
    {
      id: 'g1',
      match: 'any',
      conditions: [
        { id: 'c2', field: 'location', operator: 'is', values: ['Berlin'] },
        { id: 'c3', field: 'location', operator: 'is', values: ['Remote'] },
      ],
    },
  ],
};

describe('describeFilter', () => {
  it('reads as a sentence, brackets a nested group, and says a repeat once', () => {
    expect(describeFilter(policy, fields)).toBe(
      'Team is Engineering and (Location is Berlin or Remote)',
    );
  });

  it('leaves out conditions without a value', () => {
    const half = addCondition(policy, null, {
      id: 'c4',
      field: 'start',
      operator: 'after',
      values: [],
    });
    expect(describeFilter(half, fields)).toBe(describeFilter(policy, fields));
  });

  it('is empty for an empty filter', () => {
    expect(describeFilter({ match: 'all', conditions: [] }, fields)).toBe('');
  });

  it('reads option labels, open ranges and operators that need no value', () => {
    expect(
      describeFilter(
        {
          match: 'all',
          conditions: [
            { id: 'a', field: 'team', operator: 'in', values: ['eng', 'design'] },
            { id: 'b', field: 'start', operator: 'between', values: ['2026-01-01', ''] },
            { id: 'c', field: 'team', operator: 'empty', values: [] },
          ],
        },
        fields,
      ),
    ).toBe(
      'Team is any of Engineering or Design and Start date is between 2026-01-01 – … and Team is empty',
    );
  });
});

describe('editing', () => {
  it('adds into a nested group', () => {
    const next = addCondition(policy, 'g1', {
      id: 'c4',
      field: 'location',
      operator: 'is',
      values: ['London'],
    });
    expect(describeFilter(next, fields)).toBe(
      'Team is Engineering and (Location is Berlin or Remote or London)',
    );
  });

  it('adds a group of its own', () => {
    const next = addGroup(
      { match: 'all', conditions: policy.conditions },
      {
        id: 'g2',
        match: 'any',
        conditions: [{ id: 'c9', field: 'team', operator: 'is', values: ['design'] }],
      },
    );
    expect(next.groups?.map((group) => group.id)).toEqual(['g2']);
  });

  it('switches a group between all and any', () => {
    expect(describeFilter(setMatch(policy, null, 'any'), fields)).toBe(
      'Team is Engineering or (Location is Berlin or Remote)',
    );
    expect(setMatch(policy, 'g1', 'all').groups?.[0]?.match).toBe('all');
  });

  it('removes a condition, and a group it leaves empty', () => {
    const once = removeItem(policy, 'c2');
    expect(conditionsOf(once).map((c) => c.id)).toEqual(['c1', 'c3']);
    const twice = removeItem(once, 'c3');
    expect(twice.groups).toEqual([]);
    expect(conditionsOf(twice).map((c) => c.id)).toEqual(['c1']);
  });

  it('resets the operator and values when the field changes', () => {
    const next = updateCondition(policy, 'c1', { field: 'start' }, fields);
    expect(conditionsOf(next)[0]).toMatchObject({ field: 'start', operator: 'after', values: [] });
  });

  it('clears the values when the operator asks for a different kind', () => {
    const next = updateCondition(policy, 'c1', { operator: 'in' }, fields);
    expect(conditionsOf(next)[0]).toMatchObject({ operator: 'in', values: [] });
  });

  it('keeps the field when only the values change', () => {
    const next = updateCondition(policy, 'c1', { values: ['design'] }, fields);
    expect(describeFilter(next, fields)).toMatch(/^Team is Design/);
  });
});

describe('isConditionComplete', () => {
  it('asks for a value only when the operator does', () => {
    const c = { id: 'x', field: 'team', operator: 'empty', values: [] };
    expect(isConditionComplete(fields, c)).toBe(true);
    expect(isConditionComplete(fields, { ...c, operator: 'is' })).toBe(false);
    expect(
      isConditionComplete(fields, {
        ...c,
        field: 'start',
        operator: 'between',
        values: ['', '2026-03-31'],
      }),
    ).toBe(true);
  });
});
