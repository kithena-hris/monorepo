import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './switch';

describe('<Switch loading>', () => {
  it('is busy and ignores presses while a change is saving', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Share calendar" checked loading onCheckedChange={onCheckedChange} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Share calendar' });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-busy', 'true');
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('toggles again once the change settles', () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Share calendar" onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
