import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataColumn } from './data-table';

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
  { id: 'c', name: 'Radia' },
];
const columns: DataColumn<Row>[] = [{ id: 'name', header: 'Name', cell: (r) => r.name }];

describe('DataTable', () => {
  it('washes every other row, never over a selection', () => {
    render(<DataTable label="People" rows={rows} columns={columns} rowId={(r) => r.id} striped />);
    const [, first, second, third] = screen.getAllByRole('row');
    expect(first).not.toHaveClass('bg-surface-sunken');
    expect(second).toHaveClass('bg-surface-sunken');
    expect(third).not.toHaveClass('bg-surface-sunken');
  });

  it('widens a column from its header edge, by keyboard as well as pointer', () => {
    const onColumnWidthsChange = vi.fn();
    render(
      <DataTable
        label="People"
        rows={rows}
        columns={[{ ...columns[0], width: '10rem' } as DataColumn<Row>]}
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
        rows={rows}
        columns={columns}
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
