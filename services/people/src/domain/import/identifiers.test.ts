import { describe, expect, it } from 'vitest';

import { kithenaCreates, personRefOf, placeOf, PERSON_ID_COLUMN } from './identifiers.js';

/**
 * Identifiers are Kithena's (the user, in production: "Employee id should not
 * be considered in import as that will be created by us"). A file from
 * another Kithena, or any other system, brings its own person ids and
 * employee numbers; none of them is ever written, matched on, or allowed to
 * block a row. Its references to people and places are resolved here, or
 * left empty and named, never written as a raw id.
 */
describe('identifiers Kithena creates', () => {
  it.each([
    [PERSON_ID_COLUMN, true],
    ['employee_number', true],
    ['work_email', false],
    ['manager_id', false],
    ['given_name', false],
    [null, false],
  ])('%s is Kithena’s to create: %s', (key, expected) => {
    expect(kithenaCreates(key)).toBe(expected);
  });
});

const DAVID = { row: 3, fileId: 'dev-david', email: 'david@dm.example', name: 'David Wallace' };
const JAN = { row: 4, fileId: 'dev-jan', email: 'jan@dm.example', name: 'Jan Levinson' };
const HERE = [{ id: 'here-ada', email: 'ada@dm.example', name: 'Ada Lovelace' }];

describe('a reference to a person', () => {
  const ctx = { rows: [DAVID, JAN], people: HERE, self: JAN.row };

  it('is another row of the same file when it holds that row’s id from the other Kithena', () => {
    expect(personRefOf('dev-david', ctx)).toEqual({ kind: 'row', row: DAVID.row });
  });

  it('is somebody already here, by their id, work email or full name', () => {
    expect(personRefOf('here-ada', ctx)).toEqual({ kind: 'person', id: 'here-ada' });
    expect(personRefOf('ADA@dm.example', ctx)).toEqual({ kind: 'person', id: 'here-ada' });
    expect(personRefOf(' ada  lovelace ', ctx)).toEqual({ kind: 'person', id: 'here-ada' });
  });

  it('is a row of the file by its work email or full name', () => {
    expect(personRefOf('david@dm.example', ctx)).toEqual({ kind: 'row', row: DAVID.row });
    expect(personRefOf('David Wallace', ctx)).toEqual({ kind: 'row', row: DAVID.row });
  });

  it('never points a row at itself', () => {
    expect(personRefOf('dev-jan', ctx).kind).toBe('none');
  });

  it('is nobody, with the reason, when an id is from somewhere else or a name is ambiguous', () => {
    expect(personRefOf('01a0e1d1-f3ac-7000-9ba4-99702898f6ac', ctx)).toEqual({
      kind: 'none',
      reason: 'nobody in this company or this file has this id',
    });
    const twice = { ...ctx, people: [...HERE, { id: 'here-ada-2', email: null, name: 'Ada Lovelace' }] };
    expect(personRefOf('Ada Lovelace', twice)).toEqual({
      kind: 'none',
      reason: 'more than one person is called “Ada Lovelace”',
    });
    expect(personRefOf('Michael Scott', ctx)).toEqual({
      kind: 'none',
      reason: 'nobody in this company or this file is called “Michael Scott”',
    });
  });
});

describe('a reference to a place', () => {
  const places = [
    { id: 'loc-1', name: 'Scranton Branch' },
    { id: 'loc-2', name: 'Nashua Branch' },
    { id: 'loc-3', name: 'Utica Branch', archived: true },
  ];

  it('is a place here, by id or by name', () => {
    expect(placeOf('loc-2', places)).toEqual({ kind: 'id', id: 'loc-2' });
    expect(placeOf('scranton  branch', places)).toEqual({ kind: 'id', id: 'loc-1' });
  });

  it('is a new one, by name, when nothing here is called that', () => {
    expect(placeOf('Corporate, New York', places)).toEqual({
      kind: 'new',
      name: 'Corporate, New York',
    });
  });

  it('is nothing for an id from another company, or an archived place', () => {
    expect(placeOf('01a0e1d1-f26f-7000-be34-a7236a53ad47', places)).toEqual({
      kind: 'none',
      reason: 'not in this company: an id from another system',
    });
    expect(placeOf('Utica Branch', places)).toEqual({ kind: 'none', reason: '“Utica Branch” is archived' });
  });
});
