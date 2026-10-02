import { describe, expect, it } from 'vitest';

import { closestPlace, placeChoiceRef, placeKey, workplacesIn } from './workplaces.js';

/**
 * The work locations a file names, as HR decides them inside the import: map
 * each to one here, add it as a new one, or leave it empty for HR (the user:
 * "Set up workplaces inline").
 */
const HERE = [
  { id: 'l-ny', name: 'New York', country: 'US' },
  { id: 'l-scr', name: 'Scranton', country: 'US' },
  { id: 'l-old', name: 'Nashua', country: 'US', archived: true },
];
const DEFAULTS = { country: 'US', timeZone: 'America/New_York', legalEntityId: 'e-1' };

const seen = (value: string, row: number, name: string | null = null) => ({ value, row, name });

describe('the work locations in a file', () => {
  it('lists each value once, with how many rows and who, in the file’s first spelling', () => {
    const [ny] = workplacesIn(
      [seen('New York', 2, 'Pam Beesly'), seen(' new  york ', 3, 'Jim Halpert'), seen('New York', 4)],
      HERE,
      DEFAULTS,
    );
    expect(ny).toMatchObject({
      key: 'new york',
      value: 'New York',
      rows: 3,
      people: ['Pam Beesly', 'Jim Halpert'],
      found: { id: 'l-ny', name: 'New York' },
      suggestion: null,
      proposed: { kind: 'map', locationId: 'l-ny' },
    });
  });

  it('finds one by its id here too', () => {
    const [byId] = workplacesIn([seen('l-scr', 2)], HERE, DEFAULTS);
    expect(byId?.found).toEqual({ id: 'l-scr', name: 'Scranton' });
  });

  it('suggests a close name, and proposes it', () => {
    const [branch] = workplacesIn([seen('Scranton Branch', 2)], HERE, DEFAULTS);
    expect(branch?.found).toBeNull();
    expect(branch?.suggestion).toEqual({ id: 'l-scr', name: 'Scranton' });
    expect(branch?.proposed).toEqual({ kind: 'map', locationId: 'l-scr' });
  });

  it('proposes a new one by the file’s name, its country and zone prefilled', () => {
    const [stamford] = workplacesIn([seen('Stamford', 2)], HERE, DEFAULTS);
    expect(stamford?.proposed).toEqual({
      kind: 'add',
      name: 'Stamford',
      country: 'US',
      timeZone: 'America/New_York',
      legalEntityId: 'e-1',
    });
  });

  it('leaves another system’s id empty: there is no name to add it by', () => {
    const [id] = workplacesIn([seen('01a0e1d1-f26f-7000-be34-a7236a53ad47', 2)], HERE, DEFAULTS);
    expect(id?.looksLikeId).toBe(true);
    expect(id?.proposed).toEqual({ kind: 'leave' });
  });

  it('never matches or suggests an archived one', () => {
    const [nashua] = workplacesIn([seen('Nashua', 2)], HERE, DEFAULTS);
    expect(nashua?.found).toBeNull();
    expect(nashua?.suggestion).toBeNull();
    expect(nashua?.proposed.kind).toBe('add');
  });

  it('with nowhere to add one, proposes leaving it', () => {
    const [stamford] = workplacesIn([seen('Stamford', 2)], HERE, null);
    expect(stamford?.proposed).toEqual({ kind: 'leave' });
  });

  it('names at most twenty people for a value', () => {
    const many = Array.from({ length: 30 }, (_, i) => seen('Stamford', i + 2, `P${String(i)}`));
    expect(workplacesIn(many, HERE, DEFAULTS)[0]?.people).toHaveLength(20);
  });
});

describe('a close name', () => {
  it.each([
    ['Scranton Branch', 'l-scr'],
    ['Scrantn', 'l-scr'],
    ['NYC', null],
    ['Utica', null],
    ['ny', null],
  ])('%s is close to %s', (value, id) => {
    expect(closestPlace(value, HERE)?.id ?? null).toBe(id);
  });
});

describe('what HR chose for a value, as the import reads it', () => {
  it('maps to one here', () => {
    expect(placeChoiceRef({ kind: 'map', locationId: 'l-ny' }, HERE)).toEqual({
      kind: 'id',
      id: 'l-ny',
    });
  });

  it('refuses a mapping to one that is gone or archived', () => {
    expect(placeChoiceRef({ kind: 'map', locationId: 'l-old' }, HERE).kind).toBe('none');
    expect(placeChoiceRef({ kind: 'map', locationId: 'nope' }, HERE).kind).toBe('none');
  });

  it('adds a new one, or finds it once it has been added', () => {
    const add = {
      kind: 'add' as const,
      name: 'Stamford',
      country: 'US',
      timeZone: 'America/New_York',
    };
    expect(placeChoiceRef(add, HERE)).toEqual({ ...add, kind: 'new' });
    expect(placeChoiceRef(add, [...HERE, { id: 'l-st', name: 'stamford' }])).toEqual({
      kind: 'id',
      id: 'l-st',
    });
  });

  it('leaves it empty, and says HR chose so', () => {
    expect(placeChoiceRef({ kind: 'leave' }, HERE)).toEqual({
      kind: 'none',
      reason: 'left empty, as chosen in the import',
    });
  });

  it('keys a value as the file’s spelling varies', () => {
    expect(placeKey('  New   YORK ')).toBe(placeKey('new york'));
  });
});
