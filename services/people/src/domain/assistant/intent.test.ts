import { describe, expect, it } from 'vitest';

import { instructionFor, readIntent, type CatalogueField } from './intent.js';

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

  it('never names a field in what the model is told, so no field policy refuses it', () => {
    expect(instructionFor().toLowerCase()).not.toMatch(/manager|location|email|legal|birth/);
  });

  it('keeps the model’s own friendly opening, with its count left for People to fill', () => {
    const intent = readIntent(
      '{"kind":"reports","name":"Michael","say":"Sure! Here are the {n} people on Michael’s team."}',
      catalogue,
    );
    expect(intent.say).toBe('Sure! Here are the {n} people on Michael’s team.');
  });

  it('drops an opening that states a fact of its own, or carries markup', () => {
    for (const say of [
      'Michael has 4 reports.',
      'Here is <!channel> everyone.',
      'Here you go: {name}',
      '*Bold* claims',
      'x',
    ]) {
      expect(readIntent(JSON.stringify({ kind: 'approvals', say }), catalogue).say).toBeUndefined();
    }
  });

  it('asks the model for an opening and tells it never to state a fact', () => {
    const told = instructionFor();
    expect(told).toMatch(/"say"/);
    expect(told).toMatch(/never state a number, a name you were not given, or any fact/i);
  });

  it('tells the model to write @me for the asker, so it never needs their name', () => {
    expect(instructionFor()).toMatch(/@me/);
  });
});
