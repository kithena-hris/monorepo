import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, describeSorts, stretchOverflowing, type DataColumn } from './data-table';

interface Person {
  id: string;
  name: string;
  team: string;
  start: string;
  salary: number;
}

const people: Person[] = [
  { id: '1', name: 'Priya Shah', team: 'Engineering', start: '2024-09-02', salary: 92000 },
  { id: '2', name: 'Amara Okafor', team: 'Design', start: '2022-06-20', salary: 84000 },
  { id: '3', name: 'Jonas Weber', team: 'Engineering', start: '2021-01-14', salary: 118000 },
  { id: '4', name: 'Lucas Moreau', team: 'Sales', start: '2026-09-21', salary: 71000 },
];

const columns: DataColumn<Person>[] = [
  { id: 'name', header: 'Name', sortBy: (p) => p.name, cell: (p) => p.name },
  { id: 'team', header: 'Team', sortBy: (p) => p.team, cell: (p) => p.team },
  { id: 'start', header: 'Start date', sortBy: (p) => p.start, cell: (p) => p.start },
  {
    id: 'salary',
    header: 'Salary',
    numeric: true,
    sortBy: (p) => p.salary,
    cell: (p) => String(p.salary),
    aggregate: (rows) => `Σ ${String(rows.reduce((sum, p) => sum + p.salary, 0))}`,
  },
];

const names = (): string[] =>
  within(screen.getAllByRole('rowgroup')[1] ?? document.body)
    .getAllByRole('row')
    .map((row) => within(row).queryAllByRole('cell')[0]?.textContent ?? '');

describe('<DataTable multiSort>', () => {
  it('replaces the sort on a click and adds to it on a shift-click', () => {
    const onSortsChange = vi.fn();
    render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        multiSort
        onSortsChange={onSortsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Team/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Start date/ }), { shiftKey: true });

    expect(onSortsChange).toHaveBeenLastCalledWith([
      { columnId: 'team', direction: 'ascending' },
      { columnId: 'start', direction: 'ascending' },
    ]);
    // Design first, then Engineering by start date, then Sales.
    expect(names()).toEqual(['Amara Okafor', 'Jonas Weber', 'Priya Shah', 'Lucas Moreau']);
    // One sorted header for ARIA; the second says its place in words.
    expect(screen.getByRole('columnheader', { name: /Team/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByRole('columnheader', { name: /Start date/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    expect(screen.getByRole('button', { name: /^Start date, sort 2/ })).toBeInTheDocument();
  });

  it('flips a column already in the sort without dropping the others', () => {
    const onSortsChange = vi.fn();
    render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        multiSort
        defaultSort={[
          { columnId: 'team', direction: 'ascending' },
          { columnId: 'start', direction: 'ascending' },
        ]}
        onSortsChange={onSortsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Start date/ }), { shiftKey: true });

    expect(onSortsChange).toHaveBeenLastCalledWith([
      { columnId: 'team', direction: 'ascending' },
      { columnId: 'start', direction: 'descending' },
    ]);
  });
});

describe('describeSorts', () => {
  it('names the columns in order', () => {
    expect(
      describeSorts(
        [
          { columnId: 'team', direction: 'ascending' },
          { columnId: 'start', direction: 'descending' },
        ],
        columns,
      ),
    ).toBe('Team, then start date');
  });
});

describe('<DataTable groupBy>', () => {
  it('draws a header per group with its count and aggregates, and collapses it', () => {
    render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        groupBy={(p) => p.team}
        defaultCollapsedGroups={['Sales']}
      />,
    );

    const engineering = screen.getByRole('button', { name: 'Engineering, 2 rows' });
    expect(engineering).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Σ 210000')).toBeInTheDocument();
    // Sales is collapsed: its header and count stay, its row does not.
    expect(screen.getByRole('button', { name: 'Sales, 1 row' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Lucas Moreau')).not.toBeInTheDocument();

    fireEvent.click(engineering);

    expect(engineering).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Priya Shah')).not.toBeInTheDocument();
    expect(screen.getByText('Amara Okafor')).toBeInTheDocument();
  });
});

interface Scientist {
  id: string;
  name: string;
}

const scientists: Scientist[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
  { id: 'c', name: 'Radia' },
];
const nameColumn: DataColumn<Scientist>[] = [{ id: 'name', header: 'Name', cell: (r) => r.name }];

describe('<DataTable> striped, resizable, paged and grouped', () => {
  it('washes every other row, never over a selection', () => {
    render(
      <DataTable
        label="People"
        rows={scientists}
        columns={nameColumn}
        rowId={(r) => r.id}
        striped
      />,
    );
    const [, first, second, third] = screen.getAllByRole('row');
    expect(first).not.toHaveAttribute('data-striped');
    expect(second).toHaveAttribute('data-striped');
    expect(third).not.toHaveAttribute('data-striped');
  });

  it('widens a column from its header edge, by keyboard as well as pointer', () => {
    const onColumnWidthsChange = vi.fn();
    render(
      <DataTable
        label="People"
        rows={scientists}
        columns={[{ ...nameColumn[0], width: '10rem' } as DataColumn<Scientist>]}
        rowId={(r) => r.id}
        resizable
        onColumnWidthsChange={onColumnWidthsChange}
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize Name' });
    expect(handle).toHaveAttribute('aria-valuenow', '160');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ name: 176 });
    expect(handle).toHaveAttribute('aria-valuenow', '176');
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ name: 112 });
  });

  it('asks for more when what is loaded does not fill the container', () => {
    const onEndReached = vi.fn();
    render(
      <DataTable
        label="People"
        rows={scientists}
        columns={nameColumn}
        rowId={(r) => r.id}
        onEndReached={onEndReached}
      />,
    );
    // jsdom measures nothing, so everything is "near the end".
    expect(onEndReached).toHaveBeenCalled();
  });

  it('puts rows under a heading per group, counting each', () => {
    render(
      <DataTable
        label="People"
        rows={[
          { id: 'a', name: 'Ada', team: 'Research' },
          { id: 'b', name: 'Grace', team: 'Research' },
          { id: 'c', name: 'Radia', team: 'Networks' },
        ]}
        columns={[{ id: 'name', header: 'Name', cell: (r) => r.name }]}
        rowId={(r) => r.id}
        groupBy={(r) => r.team}
      />,
    );
    const headings = screen.getAllByRole('rowheader');
    expect(headings.map((h) => h.textContent)).toEqual(['Research2', 'Networks1']);
  });
});

describe('stretchOverflowing', () => {
  it('gives spare width only to columns that overflow, up to what each needs', () => {
    expect(stretchOverflowing(500, { name: 40, team: 0, email: 120 })).toEqual({
      name: 40,
      email: 120,
    });
  });

  it('shares too little spare in proportion to the need', () => {
    expect(stretchOverflowing(80, { name: 40, email: 120 })).toEqual({ name: 20, email: 60 });
  });

  it('moves nothing when nothing overflows or nothing is spare', () => {
    expect(stretchOverflowing(500, { name: 0 })).toEqual({});
    expect(stretchOverflowing(0, { name: 40 })).toEqual({});
  });
});
