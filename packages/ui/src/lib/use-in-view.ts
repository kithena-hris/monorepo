'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseInViewOptions {
  /**
   * How far outside the scrollport to start reporting. A positive bottom
   * margin is what makes an infinite list feel infinite: the next page is
   * already loading when the sentinel is still a screen away.
   */
  rootMargin?: string;
  /** Stop observing after the first intersection. */
  once?: boolean;
  /** Set false to pause: e.g. once the last page has loaded. */
  enabled?: boolean;
}

/**
 * Reports whether an element is in the scrollport.
 *
 * `IntersectionObserver`, never a scroll listener: a scroll handler fires on
 * the main thread for every frame of a flick on a phone, and the arithmetic
 * it does (`scrollTop + clientHeight >= scrollHeight - n`) is wrong the moment
 * the list is inside a container rather than the window.
 */
export function useInView<T extends Element>(
  options: UseInViewOptions = {},
): [RefObject<T | null>, boolean] {
  const { rootMargin = '0px', once = false, enabled = true } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) observer.disconnect();
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [rootMargin, once, enabled]);

  return [ref, inView];
}
