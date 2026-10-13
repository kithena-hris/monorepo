import { toggleAccess } from '@reach/ui';
import { describe, expect, it } from 'vitest';

import { accessOf, fromAccess, seenByEveryone, withEveryone } from './access';

describe('who can see and change a field', () => {
  const was = { visibility: ['self', 'hr'] as const, ownership: ['hr'] as const };

  it('turns Everyone on and off, keeping every group as it was ticked', () => {
    const on = withEveryone(true, was.visibility);
    expect(seenByEveryone(on)).toBe(true);
    expect(withEveryone(false, on)).toEqual(['self', 'hr']);
  });

  it('keeps Everyone when a group is ticked under it', () => {
    const visibility = withEveryone(true, was.visibility);
    const next = toggleAccess(accessOf(visibility, was.ownership), 'finance', 'change');
    expect(fromAccess(next, { visibility, ownership: was.ownership })).toEqual({
      visibility: ['self', 'hr', 'finance', 'directory'],
      ownership: ['hr', 'finance'],
    });
  });

  it('lets a group that can change it see it too', () => {
    const next = toggleAccess(accessOf(was.visibility, was.ownership), 'manager', 'change');
    expect(fromAccess(next, was).visibility).toContain('manager');
  });
});
