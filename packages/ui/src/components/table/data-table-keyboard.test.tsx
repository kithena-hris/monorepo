import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { armSequence, setShortcutKeys } from '../../lib/shortcut-keys';
import { DataTable, type DataColumn } from './data-table';

interface Person {
  id: string;
  name: string;
}

const people: Person[] = [
  { id: '1', name: 'Priya Shah' },
  { id: '2', name: 'Amara Okafor' },
  { id: '3', name: 'Jonas Weber' },
  { id: '4', name: 'Lucas Moreau' },
];
const columns: DataColumn<Person>[] = [{ id: 'name', header: 'Name', cell: (p) => p.name }];

afterEach(() => {
  setShortcutKeys({ keys: {}, characterKeys: true });
});

/** The body's rows, as the grid has them. */
const rows = (): HTMLElement[] =>
  within(screen.getByRole('grid'))
    .getAllByRole('row')
    .filter((r) => r.hasAttribute('data-row-id'));
const row = (i: number): HTMLElement => {
  const found = rows()[i];
  if (found === undefined) throw new Error(`no row ${String(i)}`);
  return found;
};
/** A key on a row; focus moves a frame later, once the row is drawn. */
async function press(i: number, key: string, init: KeyboardEventInit = {}): Promise<void> {
  fireEvent.keyDown(row(i), { key, ...init });
  await act(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          done();
        });
      }),
  );
}

describe('<DataTable> from the keyboard', () => {
  it('is a grid with one row in the tab order, moved by J and K, the arrows, Home and End', async () => {
    render(
      <DataTable
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        label="People"
        onRowClick={vi.fn()}
      />,
    );
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    row(0).focus();
    await press(0, 'j');
    expect(document.activeElement).toBe(row(1));
    await press(1, 'ArrowDown');
    expect(document.activeElement).toBe(row(2));
    await press(2, 'k');
    expect(document.activeElement).toBe(row(1));
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
    await press(1, 'End');
    expect(document.activeElement).toBe(row(3));
    await press(3, 'Home');
    expect(document.activeElement).toBe(row(0));
  });

  it('opens with Enter or O, previews with Space, and runs a row action by its key', async () => {
    const open = vi.fn();
    const preview = vi.fn();
    const edit = vi.fn();
    setShortcutKeys({ keys: { 'test.edit': ['e'] }, characterKeys: true });
    render(
      <DataTable
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        label="People"
        onRowClick={open}
        onRowPreview={preview}
        rowActions={(p) => [
          {
            id: 'edit',
            label: 'Edit',
            shortcut: 'test.edit',
            onSelect: () => {
              edit(p.id);
            },
          },
        ]}
      />,
    );
    await press(0, 'Enter');
    await press(0, 'o');
    await press(0, ' ');
    await press(0, 'e');
    expect(open).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith('1');
    // The second key of an app's sequence (G then E) is left alone.
    armSequence(1000);
    await press(0, 'e');
    armSequence(0);
    expect(edit).toHaveBeenCalledTimes(1);
    // The row's menu lists the action with its key.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for 1' }), {
      button: 0,
      pointerType: 'mouse',
    });
    const item = await screen.findByRole('menuitem', { name: /Edit/ });
    expect(item.textContent).toContain('E');
  });

  it('selects with X, extends with Shift+J and Shift+K, and Escape clears, then leaves', async () => {
    const onSelectedChange = vi.fn();
    render(
      <DataTable
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        label="People"
        selectable
        onSelectedChange={onSelectedChange}
      />,
    );
    expect(screen.getByRole('grid').getAttribute('aria-multiselectable')).toBe('true');
    row(0).focus();
    await press(0, 'x');
    expect(row(0).getAttribute('aria-selected')).toBe('true');
    expect(row(1).getAttribute('aria-selected')).toBe('false');
    await press(0, 'J', { shiftKey: true });
    await press(1, 'J', { shiftKey: true });
    expect(onSelectedChange).toHaveBeenLastCalledWith(['1', '2', '3']);
    // Back over the run: what it selected goes, what was there before stays.
    await press(2, 'K', { shiftKey: true });
    expect(onSelectedChange).toHaveBeenLastCalledWith(['1', '2']);
    await press(1, 'Escape');
    expect(onSelectedChange).toHaveBeenLastCalledWith([]);
    await press(1, 'Escape');
    expect(document.activeElement).not.toBe(row(1));
  });

  it('leaves the letters alone once character keys are off, and keeps the arrows', async () => {
    setShortcutKeys({ keys: {}, characterKeys: false });
    const onSelectedChange = vi.fn();
    render(
      <DataTable
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        label="People"
        selectable
        onSelectedChange={onSelectedChange}
      />,
    );
    row(0).focus();
    await press(0, 'j');
    await press(0, 'x');
    expect(document.activeElement).toBe(row(0));
    expect(onSelectedChange).not.toHaveBeenCalled();
    await press(0, 'ArrowDown');
    expect(document.activeElement).toBe(row(1));
  });

  it('keeps a table only to read a plain table', () => {
    render(<DataTable rows={people} columns={columns} rowId={(p) => p.id} label="People" />);
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByRole('table', { name: 'People' })).toBeTruthy();
  });
});
