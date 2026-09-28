import { describe, expect, it } from 'vitest';

import {
  addItem,
  conditionsOf,
  describeFilter,
  removeItem,
  setMatch,
  updateCondition,
  type FilterField,
  type FilterGroup,
} from './filter-model';

const fields: FilterField[] = [
  {
    id: 'team',
    label: 'Team',
    operators: [
      { id: 'is', label: 'is' },
      { id: 'not', label: 'is not' },
    ],
    options: [
      { value: 'eng', label: 'Engineering' },
      { value: 'design', label: 'Design' },
    ],
  },
  { id: 'location', label: 'Location', operators: [{ id: 'is', label: 'is' }] },
  {
    id: 'start',
    label: 'Start date',
    operators: [{ id: 'after', label: 'is after' }],
    inputType: 'date',
  },
];

const policy: FilterGroup = {
  kind: 'group',
  id: 'root',
  match: 'all',
  items: [
    { kind: 'condition', id: 'c1', field: 'team', operator: 'is', value: 'eng' },
    {
      kind: 'group',
      id: 'g1',
      match: 'any',
      items: [
        { kind: 'condition', id: 'c2', field: 'location', operator: 'is', value: 'Berlin' },
        { kind: 'condition', id: 'c3', field: 'location', operator: 'is', value: 'Remote' },
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
    const half = addItem(policy, 'root', {
      kind: 'condition',
      id: 'c4',
      field: 'start',
      operator: 'after',
      value: '',
    });
    expect(describeFilter(half, fields)).toBe(describeFilter(policy, fields));
  });

  it('is empty for an empty filter', () => {
    expect(describeFilter({ kind: 'group', id: 'r', match: 'all', items: [] }, fields)).toBe('');
  });
});

describe('editing', () => {
  it('adds into a nested group', () => {
    const next = addItem(policy, 'g1', {
      kind: 'condition',
      id: 'c4',
      field: 'location',
      operator: 'is',
      value: 'London',
    });
    expect(describeFilter(next, fields)).toBe(
      'Team is Engineering and (Location is Berlin or Remote or London)',
    );
  });

  it('switches a group between all and any', () => {
    expect(describeFilter(setMatch(policy, 'root', 'any'), fields)).toBe(
      'Team is Engineering or (Location is Berlin or Remote)',
    );
  });

  it('removes a condition, and a group it leaves empty', () => {
    const once = removeItem(policy, 'c2');
    expect(conditionsOf(once).map((c) => c.id)).toEqual(['c1', 'c3']);
    const twice = removeItem(once, 'c3');
    expect(twice.items.map((item) => item.id)).toEqual(['c1']);
  });

  it('resets the operator and value when the field changes', () => {
    const next = updateCondition(policy, 'c1', { field: 'start' }, fields);
    expect(conditionsOf(next)[0]).toMatchObject({ field: 'start', operator: 'after', value: '' });
  });

  it('keeps the field when only the value changes', () => {
    const next = updateCondition(policy, 'c1', { value: 'design' }, fields);
    expect(describeFilter(next, fields)).toMatch(/^Team is Design/);
  });
});
