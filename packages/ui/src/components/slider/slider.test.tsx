import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Slider } from './slider';

// Radix measures the thumb; jsdom has no layout to observe.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

describe('<Slider variant="confirm">', () => {
  it('confirms from the keyboard, and only with a forward key', async () => {
    const onConfirm = vi.fn();
    render(<Slider variant="confirm" label="Slide to confirm" onConfirm={onConfirm} />);
    const knob = screen.getByRole('slider', { name: 'Slide to confirm' });

    knob.focus();
    await userEvent.keyboard('{ArrowLeft}{Home}');
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(knob).toHaveAttribute('aria-valuenow', '0');
  });
});
