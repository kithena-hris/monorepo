import { describe, expect, it } from 'vitest';

import { checkNewUnit, checkUnitChange, unitPaths, type OrgUnit } from './org-unit.js';

/**
 * A company's org units: departments and teams, a tree by `parentId`,
 * archived rather than deleted because people and history point at them.
 */

const units: OrgUnit[] = [
  { id: 'eng', name: 'Engineering', parentId: null, archived: false },
  { id: 'plat', name: 'Platform', parentId: 'eng', archived: false },
  { id: 'web', name: 'Web', parentId: 'plat', archived: false },
  { id: 'sales', name: 'Sales', parentId: null, archived: false },
  { id: 'old', name: 'Old team', parentId: 'sales', archived: true },
  { id: 'gone', name: 'Gone', parentId: null, archived: true },
];

const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);

describe('a new org unit', () => {
  it('takes a trimmed name and an optional live parent', () => {
    expect(checkNewUnit(units, { name: '  Data ', parentId: 'eng' })).toEqual({
      ok: true,
      value: { name: 'Data', parentId: 'eng' },
    });
    expect(checkNewUnit(units, { name: 'Finance', parentId: null }).ok).toBe(true);
  });

  it('refuses an empty or overlong name', () => {
    expect(code(checkNewUnit(units, { name: '  ', parentId: null }))).toBe('NAME_REQUIRED');
    expect(code(checkNewUnit(units, { name: 'x'.repeat(201), parentId: null }))).toBe(
      'NAME_REQUIRED',
    );
  });

  it('refuses a parent that is not here or is archived', () => {
    expect(code(checkNewUnit(units, { name: 'Data', parentId: 'nope' }))).toBe(
      'ORG_UNIT_PARENT_NOT_FOUND',
    );
    expect(code(checkNewUnit(units, { name: 'Data', parentId: 'gone' }))).toBe(
      'ORG_UNIT_PARENT_ARCHIVED',
    );
  });

  it('is unique by name among its live siblings, whatever the case or spacing', () => {
    expect(code(checkNewUnit(units, { name: 'platform', parentId: 'eng' }))).toBe(
      'ORG_UNIT_NAME_TAKEN',
    );
    expect(code(checkNewUnit(units, { name: ' SALES ', parentId: null }))).toBe(
      'ORG_UNIT_NAME_TAKEN',
    );
    // A cousin or an archived sibling does not count.
    expect(checkNewUnit(units, { name: 'Platform', parentId: 'sales' }).ok).toBe(true);
    expect(checkNewUnit(units, { name: 'Old team', parentId: 'sales' }).ok).toBe(true);
    expect(checkNewUnit(units, { name: 'Gone', parentId: null }).ok).toBe(true);
  });
});

describe('changing an org unit', () => {
  it('renames, unique among its siblings, and may keep its own name', () => {
    expect(checkUnitChange(units, 'plat', { name: 'Infrastructure' })).toMatchObject({
      ok: true,
      value: { id: 'plat', name: 'Infrastructure', parentId: 'eng' },
    });
    expect(checkUnitChange(units, 'plat', { name: 'PLATFORM' }).ok).toBe(true);
    expect(code(checkUnitChange(units, 'sales', { name: 'Engineering' }))).toBe(
      'ORG_UNIT_NAME_TAKEN',
    );
  });

  it('moves under another live unit or to the top', () => {
    expect(checkUnitChange(units, 'web', { parentId: 'sales' })).toMatchObject({
      ok: true,
      value: { parentId: 'sales' },
    });
    expect(checkUnitChange(units, 'web', { parentId: null })).toMatchObject({
      ok: true,
      value: { parentId: null },
    });
    expect(code(checkUnitChange(units, 'web', { parentId: 'gone' }))).toBe(
      'ORG_UNIT_PARENT_ARCHIVED',
    );
  });

  it('never moves under itself or anything beneath it', () => {
    expect(code(checkUnitChange(units, 'eng', { parentId: 'eng' }))).toBe('ORG_UNIT_CYCLE');
    expect(code(checkUnitChange(units, 'eng', { parentId: 'web' }))).toBe('ORG_UNIT_CYCLE');
  });

  it('refuses a move that lands beside a namesake', () => {
    const withTwin = [...units, { id: 'web2', name: 'Web', parentId: 'sales', archived: false }];
    expect(code(checkUnitChange(withTwin, 'web2', { parentId: 'plat' }))).toBe(
      'ORG_UNIT_NAME_TAKEN',
    );
  });

  it('archives a unit with no live units beneath it, and not one with', () => {
    expect(checkUnitChange(units, 'web', { archived: true })).toMatchObject({
      ok: true,
      value: { archived: true },
    });
    expect(code(checkUnitChange(units, 'plat', { archived: true }))).toBe('ORG_UNIT_HAS_UNITS');
    // Only archived units beneath: fine.
    expect(checkUnitChange(units, 'sales', { archived: true }).ok).toBe(true);
  });

  it('restores under a live parent, unless a live sibling took the name meanwhile', () => {
    expect(checkUnitChange(units, 'gone', { archived: false }).ok).toBe(true);
    const archivedParent = units.map((u) => (u.id === 'sales' ? { ...u, archived: true } : u));
    expect(code(checkUnitChange(archivedParent, 'old', { archived: false }))).toBe(
      'ORG_UNIT_PARENT_ARCHIVED',
    );
    const taken = [...units, { id: 'new', name: 'Old team', parentId: 'sales', archived: false }];
    expect(code(checkUnitChange(taken, 'old', { archived: false }))).toBe('ORG_UNIT_NAME_TAKEN');
  });

  it('says so for a unit that is not here', () => {
    expect(code(checkUnitChange(units, 'nope', { name: 'X' }))).toBe('NOT_FOUND');
  });
});

describe('a unit’s path', () => {
  it('names every unit from the top down', () => {
    const paths = unitPaths(units);
    expect(paths.get('eng')).toBe('Engineering');
    expect(paths.get('web')).toBe('Engineering › Platform › Web');
    expect(paths.get('old')).toBe('Sales › Old team');
  });

  it('stops at a parent it cannot find, and never loops', () => {
    const odd: OrgUnit[] = [
      { id: 'a', name: 'A', parentId: 'b', archived: false },
      { id: 'b', name: 'B', parentId: 'a', archived: false },
      { id: 'c', name: 'C', parentId: 'missing', archived: false },
    ];
    const paths = unitPaths(odd);
    expect(paths.get('c')).toBe('C');
    expect(paths.get('a')).toBe('B › A');
  });
});
