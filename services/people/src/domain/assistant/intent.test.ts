import { describe, expect, it } from 'vitest';

import { readIntent, type CatalogueField } from './intent.js';

const catalogue: readonly CatalogueField[] = [
  {
    key: 'location_id',
    label: 'Work location',
    kind: 'select',
    options: [{ value: 'l1', label: 'Scranton Branch' }],
  },
  {
    key: 'department',
    label: 'Department',
    kind: 'select',
    options: [{ value: 'sales', label: 'Sales' }],
  },
  { key: 'hire_date', label: 'Start date', kind: 'date', options: [] },
];

describe('reading what the model made of a question', () => {
  it('takes a query over fields the asker may filter on', () => {
    const intent = readIntent(
      '{"kind":"people","conditions":[{"key":"department","op":"in","values":["sales"]}],"match":"all"}',
      catalogue,
    );
    expect(intent).toEqual({
      kind: 'people',
      conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
      match: 'all',
      limit: 10,
    });
  });

  it('reads an option by its label as well as its value, as a model may write either', () => {
    const intent = readIntent(
      'Sure! {"kind":"count","conditions":[{"key":"location_id","op":"is","values":["Scranton Branch"]}]}',
      catalogue,
    );
    expect(intent).toMatchObject({
      kind: 'count',
      conditions: [{ key: 'location_id', op: 'in', values: ['l1'] }],
    });
  });

  it('never runs a field the asker may not filter on, or anything malformed', () => {
    expect(
      readIntent(
        '{"kind":"people","conditions":[{"key":"salary","op":"is","values":["1"]}]}',
        catalogue,
      ).kind,
    ).toBe('unclear');
    expect(readIntent('not json at all', catalogue).kind).toBe('unclear');
    expect(readIntent('{"kind":"drop_table"}', catalogue).kind).toBe('unclear');
  });

  it('keeps a person’s name, and a group-by only on a choice', () => {
    expect(readIntent('{"kind":"reports","name":"Michael Scott"}', catalogue)).toEqual({
      kind: 'reports',
      name: 'Michael Scott',
    });
    expect(
      readIntent('{"kind":"count","conditions":[],"groupBy":"hire_date"}', catalogue),
    ).toMatchObject({ kind: 'count', groupBy: null });
  });
});
