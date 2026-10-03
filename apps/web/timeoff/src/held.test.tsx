import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TYPING_MS, useHeld, useTyped } from './held';

describe('useHeld', () => {
  it('is the host’s value when the host holds it, and its fallback when it holds none', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook<
      readonly [string, (next: string) => void],
      { held: string | null }
    >(({ held }) => useHeld(held, onChange, 'mine'), { initialProps: { held: 'asked' } });
    expect(result.current[0]).toBe('asked');
    act(() => {
      result.current[1]('mine');
    });
    expect(onChange).toHaveBeenCalledWith('mine');
    rerender({ held: null });
    expect(result.current[0]).toBe('mine');
  });

  it('is the screen’s own state in a host that holds nothing', () => {
    const { result } = renderHook(() => useHeld<string>(undefined, undefined, 'vertical'));
    act(() => {
      result.current[1]('horizontal');
    });
    expect(result.current[0]).toBe('horizontal');
  });
});

describe('useTyped', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows every key at once and tells the host once typing rests', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useTyped('', onCommit));
    for (const text of ['a', 'ad', 'ada']) {
      act(() => {
        result.current[1](text);
      });
    }
    expect(result.current[0]).toBe('ada');
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('ada');
  });

  it('keeps what is typed while the host echoes an earlier commit', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(({ held }) => useTyped(held, onCommit), {
      initialProps: { held: '' },
    });
    act(() => {
      result.current[1]('ad');
      vi.advanceTimersByTime(TYPING_MS);
      result.current[1]('ada');
    });
    // The address catches up with "ad" after "a" was typed again.
    rerender({ held: 'ad' });
    expect(result.current[0]).toBe('ada');
  });

  it('takes a value the address changed by itself (Back, a link), and drops what was pending', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(({ held }) => useTyped(held, onCommit), {
      initialProps: { held: 'ada' },
    });
    act(() => {
      result.current[1]('adam');
    });
    rerender({ held: '' });
    act(() => {
      vi.advanceTimersByTime(TYPING_MS);
    });
    expect(result.current[0]).toBe('');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
