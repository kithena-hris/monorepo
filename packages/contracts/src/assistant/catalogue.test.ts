import { describe, expect, it } from 'vitest';

import { RuntimeCatalogue } from './catalogue.js';

const people = {
  module: 'people',
  serves: [{ name: 'people.find', version: 1 }],
  fields: {
    'people.find': [
      {
        key: 'department',
        label: 'Department',
        kind: 'select',
        options: [{ value: 'engineering', label: 'Engineering' }],
      },
    ],
  },
  metrics: [{ key: 'team_size', label: 'Team size' }],
  denied: [{ key: 'salary', labels: ['Salary', 'Pay'] }],
};

describe('the runtime catalogue (AST-004)', () => {
  it('reads what People and Time Off offer an asker', () => {
    expect(RuntimeCatalogue.safeParse(people).success).toBe(true);
    const timeoff = RuntimeCatalogue.parse({
      module: 'timeoff',
      serves: [{ name: 'timeoff.away', version: 1 }],
      leaveTypes: [
        { key: 'vacation', name: 'Vacation', private: false },
        { key: 'sick', name: 'Baja médica', private: true },
      ],
    });
    expect(timeoff.fields).toEqual({});
    expect(timeoff.metrics).toEqual([]);
    expect(timeoff.denied).toEqual([]);
  });

  it('refuses an extra key at every level, and a value where a field is', () => {
    expect(RuntimeCatalogue.safeParse({ ...people, values: [] }).success).toBe(false);
    expect(
      RuntimeCatalogue.safeParse({ ...people, serves: [{ name: 'people.find', version: 1, x: 1 }] })
        .success,
    ).toBe(false);
    expect(
      RuntimeCatalogue.safeParse({
        ...people,
        fields: {
          'people.find': [
            { key: 'department', label: 'D', kind: 'select', options: [], value: 'x' },
          ],
        },
      }).success,
    ).toBe(false);
    expect(RuntimeCatalogue.safeParse({ ...people, fields: { find: [] } }).success).toBe(false);
    expect(RuntimeCatalogue.safeParse({ ...people, module: 'payroll' }).success).toBe(false);
  });
});
