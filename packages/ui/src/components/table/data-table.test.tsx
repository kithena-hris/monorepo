import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, describeSorts, type DataColumn } from './data-table';

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
