import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MaskedValue, timeLeft } from './masked-value';

describe('timeLeft', () => {
  it('counts minutes and seconds, never below zero', () => {
    expect(timeLeft(892_000)).toBe('14:52 left');
    expect(timeLeft(-5)).toBe('0:00 left');
  });
});

describe('<MaskedValue>', () => {
  it('asks to reveal, by name', async () => {
    const reveal = vi.fn();
    render(<MaskedValue masked="•• ••• 1994" label="date of birth" onReveal={reveal} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show date of birth' }));
    expect(reveal).toHaveBeenCalledOnce();
  });
});
