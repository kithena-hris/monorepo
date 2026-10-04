import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  AccessMatrix,
  accessLevel,
  toggleAccess,
  withAccessLevel,
  type AccessValue,
} from './access-matrix';

describe('toggleAccess', () => {
  const start: AccessValue = { see: ['self'], change: [] };

  it('turns a change on together with the see beside it', () => {
    expect(toggleAccess(start, 'hr', 'change')).toEqual({ see: ['self', 'hr'], change: ['hr'] });
  });

  it('keeps the see when a change is turned off', () => {
    const on = toggleAccess(start, 'hr', 'change');
    expect(toggleAccess(on, 'hr', 'change')).toEqual({ see: ['self', 'hr'], change: [] });
  });

  it('refuses to hide what somebody may still change', () => {
    const on = toggleAccess(start, 'hr', 'change');
    expect(toggleAccess(on, 'hr', 'see')).toBe(on);
  });

  it('toggles a see on its own', () => {
    expect(toggleAccess(start, 'self', 'see')).toEqual({ see: [], change: [] });
  });
});

describe('one level per audience', () => {
  const start: AccessValue = { see: ['self', 'hr'], change: ['self'] };

  it('reads changing as the level above seeing', () => {
    expect(accessLevel(start, 'self')).toBe('change');
    expect(accessLevel(start, 'hr')).toBe('see');
    expect(accessLevel(start, 'finance')).toBe('none');
  });

  it('sets a level with the same rule: changing always sees', () => {
    expect(withAccessLevel(start, 'finance', 'change')).toEqual({
      see: ['self', 'hr', 'finance'],
      change: ['self', 'finance'],
    });
    expect(withAccessLevel(start, 'self', 'see')).toEqual({ see: ['hr', 'self'], change: [] });
    expect(withAccessLevel(start, 'hr', 'none')).toEqual({ see: ['self'], change: ['self'] });
  });
});

function Live() {
  const [value, setValue] = useState<AccessValue>({ see: [], change: [] });
  return <AccessMatrix audiences={[{ id: 'hr', label: 'HR' }]} value={value} onChange={setValue} />;
}

describe('<AccessMatrix>', () => {
  it('locks the see cell of an audience that can change it', async () => {
    render(<Live />);
    await userEvent.click(screen.getByRole('button', { name: 'HR changes it' }));
    const see = screen.getByRole('button', { name: 'HR sees it, because they can change it' });
    expect(see).toHaveAttribute('aria-pressed', 'true');
    expect(see).toHaveAttribute('aria-disabled', 'true');
  });
});
