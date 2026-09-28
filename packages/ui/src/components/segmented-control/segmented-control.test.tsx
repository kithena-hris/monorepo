import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl, SegmentedControlItem } from './segmented-control';

function control(onValueChange = vi.fn()) {
  render(
    <SegmentedControl aria-label="Period" defaultValue="week" onValueChange={onValueChange}>
      <SegmentedControlItem value="day">Day</SegmentedControlItem>
      <SegmentedControlItem value="week">Week</SegmentedControlItem>
      <SegmentedControlItem value="month">Month</SegmentedControlItem>
    </SegmentedControl>,
  );
  return onValueChange;
}

describe('<SegmentedControl>', () => {
  it('is a radio group with the default segment checked', () => {
    control();
    expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps its value when the selected segment is pressed again', async () => {
    const onValueChange = control();
    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves the choice to another segment', async () => {
    const onValueChange = control();
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(onValueChange).toHaveBeenCalledWith('month');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });
});
