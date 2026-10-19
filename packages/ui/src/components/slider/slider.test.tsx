import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Slider } from './slider';

// Radix measures the thumb; jsdom has no layout to observe.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent under jsdom, whatever the DOM types say
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

describe('<Slider variant="meter">', () => {
  it('keeps the knob and its tip inside the meter at either end', () => {
    const { rerender } = render(
      <Slider variant="meter" label="Tone" value={[100]} tip={(v) => `${String(v)}%`} />,
    );
    const meter = screen.getByRole('meter');
    // The track is inset by half the knob, so a knob at 100% ends flush with the meter.
    expect(meter.className).toContain('px-4.5');
    expect(screen.getByText('100%').className).toContain('-right-4.5');
    rerender(<Slider variant="meter" label="Tone" value={[0]} tip={(v) => `${String(v)}%`} />);
    expect(screen.getByText('0%').className).toContain('-left-4.5');
    rerender(<Slider variant="meter" label="Tone" value={[50]} tip={(v) => `${String(v)}%`} />);
    expect(screen.getByText('50%').className).toContain('-translate-x-1/2');
  });
});
