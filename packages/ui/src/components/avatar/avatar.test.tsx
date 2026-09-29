import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar, avatarToneOf } from './avatar';

describe('avatarToneOf', () => {
  it('gives a name the same tone every time', () => {
    expect(avatarToneOf('Priya Shah')).toBe(avatarToneOf('Priya Shah'));
  });

  it('spreads a team across more than one tone', () => {
    const names = ['Priya Shah', 'Jonas Weber', 'Amara Okafor', 'Omar Haddad', 'Yuki Tanaka'];
    expect(new Set(names.map(avatarToneOf)).size).toBeGreaterThan(1);
  });
});

describe('<Avatar>', () => {
  it('lets an explicit tone win over the hash', () => {
    const { container } = render(<Avatar name="Priya Shah" tone="neutral" />);
    expect(container.firstElementChild?.className).toContain('bg-surface-active');
  });
});
