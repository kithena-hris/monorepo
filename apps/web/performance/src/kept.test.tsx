import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeptFilters } from './kept';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useKeptFilters', () => {
  it('remembers a filter, and puts it back on a visit whose address names none', () => {
    const apply = vi.fn();
    const first = renderHook(() => useKeptFilters('k.a', { sort: null, team: null }, apply));
    expect(apply).not.toHaveBeenCalled();
    act(() => {
      first.result.current({ sort: 'newest' });
    });
    expect(apply).toHaveBeenLastCalledWith({ sort: 'newest' });
    first.unmount();

    // Another page load: a key of its own, as a module would be loaded again.
    window.localStorage.setItem('k.b', window.localStorage.getItem('k.a') ?? '');
    const again = vi.fn();
    renderHook(() => useKeptFilters('k.b', { sort: null, team: null }, again));
    expect(again).toHaveBeenCalledWith({ sort: 'newest' });
  });

  it('leaves an address that names a filter alone, and puts nothing back twice', () => {
    window.localStorage.setItem('k.c', JSON.stringify({ sort: 'newest' }));
    const apply = vi.fn();
    const linked = renderHook(() => useKeptFilters('k.c', { sort: 'oldest' }, apply));
    expect(apply).not.toHaveBeenCalled();
    linked.unmount();
    // Back to the bare address in the same page load: it stays bare.
    renderHook(() => useKeptFilters('k.c', { sort: null }, apply));
    expect(apply).not.toHaveBeenCalled();
  });

  it('forgets a filter set back to its default, and ignores what it does not know', () => {
    window.localStorage.setItem('k.d', JSON.stringify({ sort: 'newest', other: 'x', n: 3 }));
    const apply = vi.fn();
    const { result } = renderHook(() => useKeptFilters('k.d', { sort: null }, apply));
    expect(apply).toHaveBeenCalledWith({ sort: 'newest' });
    act(() => {
      result.current({ sort: null });
    });
    expect(JSON.parse(window.localStorage.getItem('k.d') ?? '{}')).toEqual({ other: 'x' });
  });
});
