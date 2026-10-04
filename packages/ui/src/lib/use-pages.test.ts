import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePages } from './use-pages';

describe('usePages', () => {
  it('appends each page once, however often the end is reached, and starts over on a new first page', async () => {
    const load = vi.fn((cursor: string) =>
      Promise.resolve({ items: [`${cursor}-x`], next: cursor === 'c1' ? 'c2' : null }),
    );
    const first = ['a'];
    const initialProps: { f: string[]; n: string | null } = { f: first, n: 'c1' };
    const { result, rerender } = renderHook(({ f, n }) => usePages(f, n, load), { initialProps });
    await act(async () => {
      result.current.loadMore?.();
      result.current.loadMore?.();
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual(['a', 'c1-x']);
    await act(async () => {
      result.current.loadMore?.();
      await Promise.resolve();
    });
    expect(result.current.items).toEqual(['a', 'c1-x', 'c2-x']);
    expect(result.current.loadMore).toBeUndefined();

    rerender({ f: ['b'], n: null });
    expect(result.current.items).toEqual(['b']);
  });
});
