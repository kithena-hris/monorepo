import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageProgress } from './page-progress';

const scale = (el: HTMLElement): number =>
  Number(/scaleX\(([^)]+)\)/u.exec(el.style.transform)?.[1] ?? Number.NaN);

describe('<PageProgress>', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 3000,
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const scrollTo = (y: number): void => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    window.dispatchEvent(new Event('scroll'));
  };

  it('fills going down and empties coming back up, gliding after the scroll', () => {
    const { container } = render(<PageProgress />);
    const bar = container.firstElementChild as HTMLElement;
    act(() => {
      scrollTo(1000);
      vi.advanceTimersByTime(32);
    });
    // On its way, not there at once.
    expect(scale(bar)).toBeGreaterThan(0);
    expect(scale(bar)).toBeLessThan(0.5);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(scale(bar)).toBe(0.5);
    act(() => {
      scrollTo(0);
      vi.advanceTimersByTime(32);
    });
    expect(scale(bar)).toBeLessThan(0.5);
    expect(scale(bar)).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(scale(bar)).toBe(0);
  });
});
