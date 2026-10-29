'use client';

import { useEffect, useRef, type JSX } from 'react';

/**
 * How long, in seconds, the bar takes to close most of the gap to the scroll:
 * GSAP's `scrub` with a number, kept short. Long enough to read as a glide,
 * short enough that it never seems to be somewhere the page is not.
 */
const CATCH_UP_S = 0.2;

/**
 * How far down the page the reader is: a hairline across the top of the
 * window that fills as the page goes down and empties as it comes back up,
 * gliding after the scroll and settling, rather than jumping with each wheel
 * tick. One for every page (`PageLayout`); no list draws its own.
 *
 * Written straight to the element, never through React state, and only while
 * it is catching up: at rest no frame is asked for. Under reduced motion it
 * keeps exact step with the scroll.
 */
export function PageProgress(): JSX.Element {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (el === null) return;
    // Not every window answers media queries (a test's DOM): it glides there.
    const still =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let shown = 0;
    let frame = 0;
    let last = 0;
    const draw = (now: number): void => {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const want = room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 0;
      // By the time since the last frame, so a 120Hz screen glides as a 60Hz one does.
      const step = last === 0 ? 1 / 60 : (now - last) / 1000;
      shown =
        still?.matches === true
          ? want
          : shown + (want - shown) * (1 - Math.exp(-step / CATCH_UP_S));
      if (Math.abs(want - shown) < 0.0005) shown = want;
      el.style.transform = `scaleX(${String(shown)})`;
      last = shown === want ? 0 : now;
      frame = shown === want ? 0 : requestAnimationFrame(draw);
    };
    const wake = (): void => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    };
    wake();
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', wake);
    return () => {
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', wake);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      ref={bar}
      aria-hidden
      style={{ transform: 'scaleX(0)' }}
      className="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.75 origin-left bg-accent will-change-transform rtl:origin-right"
    />
  );
}
