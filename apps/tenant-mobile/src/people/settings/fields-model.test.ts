import { describe, expect, it } from 'vitest';

import {
  accessFor,
  accessOf,
  draftFrom,
  fromAccess,
  seenByEveryone,
  withEveryone,
  keyFromLabel,
  problemsIn,
  withAccess,
  type RegistrySection,
} from './fields-model';

const section: RegistrySection = {
  key: 'work',
  label: 'Work',
  visibility: ['self', 'hr'],
  ownership: ['hr'],
  origin: 'core',
  fixed: false,
};

describe('the access rows', () => {
  it('reads and writes None / See / Change, keeping what is not a row', () => {
    const was = {
      visibility: ['self', 'hr', 'admin'] as const,
      ownership: ['hr', 'system'] as const,
    };
    expect(accessFor('hr', was.visibility, was.ownership)).toBe('change');
    expect(accessFor('self', was.visibility, was.ownership)).toBe('see');
    expect(accessFor('manager', was.visibility, was.ownership)).toBe('none');
    const next = withAccess('self', 'change', was);
    expect(next.ownership).toEqual(['hr', 'system', 'employee']);
    expect(withAccess('hr', 'none', was)).toEqual({
      visibility: ['self', 'admin'],
      ownership: ['system'],
    });
  });
});

describe('the access table', () => {
  const was = {
    visibility: ['self', 'hr', 'admin'] as const,
    ownership: ['hr', 'system'] as const,
  };

  it('keeps Everyone apart from the groups, so turning it off leaves them as ticked', () => {
    const on = withEveryone(true, was.visibility);
    expect(seenByEveryone(on)).toBe(true);
    expect(accessOf(on, was.ownership)).toEqual({ see: ['self', 'hr'], change: ['hr'] });
    expect(withEveryone(false, on)).toEqual(['self', 'hr', 'admin']);
  });

  it('writes the groups back, keeping the directory, an administrator and a system', () => {
    const visibility = withEveryone(true, was.visibility);
    expect(
      fromAccess({ see: ['self', 'hr'], change: ['hr', 'finance'] }, { ...was, visibility }),
    ).toEqual({
      visibility: ['self', 'hr', 'finance', 'admin', 'directory'],
      ownership: ['hr', 'finance', 'system'],
    });
  });
});

describe('a new field', () => {
  it('needs a name, a key and somebody to read it', () => {
    const draft = {
      ...draftFrom(section, null),
      label: 'T-shirt size',
      key: keyFromLabel('T-shirt size'),
    };
    expect(draft.key).toBe('t_shirt_size');
    expect(problemsIn(0, draft, () => false, [])).toEqual({});
    expect(problemsIn(0, { ...draft, dataType: 'select' }, () => false, [])).toHaveProperty(
      'options',
    );
    expect(problemsIn(1, { ...draft, visibility: [] }, () => false, [])).toHaveProperty(
      'visibility',
    );
    expect(problemsIn(3, draft, () => false, [])).toHaveProperty('kind');
  });
});
