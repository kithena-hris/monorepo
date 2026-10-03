import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Scheduler } from './scheduler';
import { dayColumns } from './scheduler-model';

const week = dayColumns('2026-10-19', 5, 'en-GB');
const rows = [{ id: 'p1', label: 'Nora Becker' }];

describe('a day’s detail', () => {
  it('opens from the selected day of a month, named by it, and asks to be dismissed', () => {
    const onDismiss = vi.fn();
    render(
      <Scheduler
        view="month"
        label="October"
        columns={week}
        events={[]}
        selected="2026-10-21"
        onSelect={vi.fn()}
        detail={<p>Two people away</p>}
        onDismiss={onDismiss}
      />,
    );
    const panel = screen.getByRole('dialog', { name: 'Wednesday 21 October' });
    expect(panel.textContent).toBe('Two people away');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('makes each day’s heading a button in rows', () => {
    const onSelect = vi.fn();
    render(
      <Scheduler
        variant="rows"
        label="Team"
        columns={week}
        rows={rows}
        events={[]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thursday 22 October' }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-22');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the headings out of the way when nothing can be picked', () => {
    render(<Scheduler variant="rows" label="Team" columns={week} rows={rows} events={[]} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
