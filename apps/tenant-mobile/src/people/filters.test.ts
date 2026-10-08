import { describe, expect, it } from 'vitest';

import { describeCondition, type DirectoryField } from './filters';

const fields: DirectoryField[] = [
  {
    key: 'dept',
    label: 'Department',
    kind: 'select',
    options: [
      { value: 's', label: 'Sales' },
      { value: 'a', label: 'Accounting' },
    ],
  },
  { key: 'start', label: 'Start date', kind: 'date', options: [] },
];

describe('describeCondition', () => {
  it('reads a condition back as somebody would say it', () => {
    expect(describeCondition(fields, { key: 'dept', op: 'in', values: ['s', 'a'] })).toBe(
      'Department is any of Sales, Accounting',
    );
    expect(describeCondition(fields, { key: 'dept', op: 'empty', values: [] })).toBe(
      'Department is empty',
    );
    expect(
      describeCondition(fields, { key: 'start', op: 'between', values: ['', '2026-06-30'] }),
    ).toMatch(/^Start date is on or before /);
  });
});
