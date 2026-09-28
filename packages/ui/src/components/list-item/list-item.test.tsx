import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { List, ListItem, swipeOutcome } from './list-item';

describe('swipeOutcome', () => {
  const row = { tray: 152, width: 360, full: true };

  it('opens a slow drag past half the tray, and closes one short of it', () => {
    expect(swipeOutcome({ ...row, offset: 80, velocity: 0 })).toBe('open');
    expect(swipeOutcome({ ...row, offset: 70, velocity: 0 })).toBe('closed');
  });

  it('follows a flick over the distance it covered', () => {
    expect(swipeOutcome({ ...row, offset: 20, velocity: 700 })).toBe('open');
    expect(swipeOutcome({ ...row, offset: 140, velocity: -700 })).toBe('closed');
  });

  it('runs the first action past 60% of the row, and only when allowed', () => {
    expect(swipeOutcome({ ...row, offset: 220, velocity: 0 })).toBe('full');
    expect(swipeOutcome({ ...row, offset: 220, velocity: 0, full: false })).toBe('open');
    // A flick back out of a long pull is a change of mind, not a full swipe.
    expect(swipeOutcome({ ...row, offset: 220, velocity: -700 })).toBe('closed');
  });
});

describe('<ListItem swipeActions>', () => {
  it('keeps every action reachable from the keyboard, and closes after one runs', async () => {
    const archive = vi.fn();
    const remove = vi.fn();
    render(
      <List>
        <ListItem
          description="Vacation · 14–18 Oct"
          swipeActions={[
            { label: 'Archive', onSelect: archive },
            { label: 'Delete', tone: 'danger', onSelect: remove, name: 'Delete Amara’s request' },
          ]}
        >
          Amara Okafor
        </ListItem>
      </List>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(remove).toHaveBeenCalledOnce();
    expect(archive).not.toHaveBeenCalled();
  });
});
