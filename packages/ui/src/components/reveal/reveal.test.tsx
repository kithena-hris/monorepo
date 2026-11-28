import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataTable } from '../table/data-table';
import { useArrival } from './reveal';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useArrival', () => {
  it('has the first rows arrive one after another, and the rest just drawn', () => {
    const { result } = renderHook(() => useArrival());
    expect(result.current(0).className).toBe('motion-safe:animate-arrive');
    expect(result.current(3).style).toEqual({
      animationDelay: 'min(calc(3 * var(--animate-stagger-step)), var(--animate-stagger-max))',
    });
    expect(result.current(40)).toEqual({});
  });

  it('is over once the list has settled: a row drawn later does not arrive', () => {
    const { result } = renderHook(() => useArrival());
    const during = result.current;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current(0)).toEqual({});
    // One object for every settled row, and a new function only when it changed.
    expect(result.current(1)).toBe(result.current(2));
    expect(result.current).not.toBe(during);
  });
});

describe('a table that arrives', () => {
  const rows = [
    { id: 'a', name: 'Ada' },
    { id: 'b', name: 'Bao' },
  ];
  const table = (arrive: boolean) => (
    <DataTable
      label="People"
      rows={rows}
      rowId={(r) => r.id}
      arrive={arrive}
      columns={[{ id: 'name', header: 'Name', cell: (r) => r.name }]}
    />
  );

  it('draws its first rows arriving, then leaves them be', () => {
    render(table(true));
    const row = screen.getByText('Bao').closest('tr');
    expect(row?.className).toContain('animate-arrive');
    expect(row?.style.animationDelay).toContain('1 *');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText('Bao').closest('tr')?.className).not.toContain('animate-arrive');
  });

  it('does not unless asked', () => {
    render(table(false));
    expect(screen.getByText('Bao').closest('tr')?.className).not.toContain('animate-arrive');
  });
});
