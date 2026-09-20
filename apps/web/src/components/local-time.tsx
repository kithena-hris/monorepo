'use client';

import { icons } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

const Sun = icons.theme;
const Moon = icons.themeDark;

/**
 * The time where this person works, and whether it is light there.
 *
 * Their zone, not the browser's. Somebody travelling, or working for a company
 * in another country, has two answers to "what time is it" and only one of them
 * is the one their colleagues are working to. The zone is on their account —
 * HR sets it when they are invited — so it is the honest one to render.
 *
 * `initial` is computed on the server and used as the first state, so the
 * hydrated markup matches what was sent. The interval then takes over: a clock
 * that is right on load and wrong an hour later is a clock nobody looks at
 * twice.
 *
 * Every minute, not every second. There are no seconds on screen, so a
 * per-second timer would be fifty-nine wakeups that change no pixels.
 */
export function LocalTime({
  timeZone,
  initial,
  initialHour,
}: {
  readonly timeZone: string;
  readonly initial: string;
  /** The hour in that zone, 0–23, so the first paint picks the right glyph. */
  readonly initialHour: number;
}): JSX.Element {
  const [now, setNow] = useState(initial);
  const [hour, setHour] = useState(initialHour);

  useEffect(() => {
    const tick = (): void => {
      const at = new Date();
      setNow(
        at.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }),
      );
      setHour(Number(at.toLocaleString('en-GB', { timeZone, hour: '2-digit', hour12: false })));
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [timeZone]);

  const daytime = isDaytime(hour);
  const Glyph = daytime ? Sun : Moon;

  return (
    <span className="text-fg-muted inline-flex items-center gap-1.5 text-sm">
      <Glyph
        aria-hidden
        className={daytime ? 'size-4 text-amber-500' : 'size-4 text-indigo-400'}
      />
      <time className="tabular-nums">{now}</time>
      {/*
        Said in words, not as a zone abbreviation.
        
        `UTC` or `Europe/Madrid` is a label somebody has to translate before it
        means anything, and beside a clock that disagrees with the one in the
        corner of their screen it reads as a bug. "Workplace time" is the whole
        of what this number is, and it needs no decoding.
      */}
      <span className="text-fg-subtle">workplace time</span>
    </span>
  );
}

/**
 * Daylight, roughly.
 *
 * 07:00 to 18:59, and deliberately not a sunrise calculation: that needs a
 * latitude this app does not have and would be wrong in a different way at the
 * poles. The glyph answers "are your colleagues likely at their desks", and an
 * hour of the clock is the right resolution for that question.
 */
function isDaytime(hour: number): boolean {
  return hour >= 7 && hour < 19;
}
