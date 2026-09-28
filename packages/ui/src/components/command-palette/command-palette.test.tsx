import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Command, filterCommands, type CommandItem } from './command-palette';

// jsdom has no layout, and so no `scrollIntoView`.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/** The text of the option `aria-selected` marks. */
function active(): string | undefined {
  return (
    screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')
      ?.textContent ?? undefined
  );
}

const items: CommandItem[] = [
  { id: 'priya', label: 'Priya Shah', description: 'Senior Engineer', group: 'People' },
  { id: 'pria', label: 'Pria Mendes', description: 'Recruiter', group: 'People' },
  { id: 'time-off', label: 'Request time off for Priya', group: 'Actions' },
  { id: 'payroll', label: 'Payroll', keywords: ['salary'], group: 'Go to' },
];

describe('filterCommands', () => {
  it('ranks a label prefix above a word prefix above a description or keyword match', () => {
    const ids = (query: string): string[] => filterCommands(items, query).map((item) => item.id);
    expect(ids('pri')).toEqual(['priya', 'pria', 'time-off']);
    expect(ids('salary')).toEqual(['payroll']);
    expect(ids('recruit')).toEqual(['pria']);
    expect(ids('  ')).toHaveLength(items.length);
    expect(ids('zzz')).toEqual([]);
  });
});

describe('<Command>', () => {
  it('moves the active option with the arrows, wrapping, and skips disabled ones', async () => {
    const user = userEvent.setup();
    const list: CommandItem[] = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Bravo', disabled: true },
      { id: 'c', label: 'Charlie' },
    ];
    render(<Command items={list} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(active()).toBe('Alpha');
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe('Charlie');
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe('Alpha');
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe('Charlie');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Charlie' }).id,
    );
  });

  it('runs the command on Enter, opens a page, and goes back on Backspace', async () => {
    const user = userEvent.setup();
    const onDark = vi.fn();
    const onClose = vi.fn();
    render(
      <Command
        onClose={onClose}
        items={[
          {
            id: 'theme',
            label: 'Change theme',
            items: [
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark', onSelect: onDark },
            ],
          },
        ]}
      />,
    );
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Back from Change theme' })).toBeInTheDocument();
    expect(input).toHaveFocus();

    await user.keyboard('da{Enter}');
    expect(onDark).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    await user.clear(input);
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('option', { name: 'Change theme' })).toBeInTheDocument();
  });
});
