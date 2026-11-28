import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKept, useKeptFilters } from './use-kept';

const word = (raw: unknown): string => (typeof raw === 'string' ? raw : 'due');

beforeEach(() => {
  window.localStorage.clear();
});

describe('useKept', () => {
  it('opens on the default, then on what this browser kept', () => {
    window.localStorage.setItem('k.sort', JSON.stringify('newest'));
    const { result } = renderHook(() => useKept('k.sort', word));
    expect(result.current[0]).toBe('newest');
  });

  it('keeps a choice as it is made', () => {
    const { result } = renderHook(() => useKept('k.sort', word));
    expect(result.current[0]).toBe('due');
    act(() => {
      result.current[1]('oldest');
    });
    expect(result.current[0]).toBe('oldest');
    expect(window.localStorage.getItem('k.sort')).toBe('"oldest"');
  });

  it('never hands the screen what it cannot read', () => {
    window.localStorage.setItem('k.sort', '{not json');
    const { result } = renderHook(() => useKept('k.sort', word));
    expect(result.current[0]).toBe('due');
  });
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
