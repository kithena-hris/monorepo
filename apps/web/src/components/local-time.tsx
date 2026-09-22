'use client';

import { icons } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

/**
 * The time where this person works, and what the sky is doing there.
 *
 * Their zone, not the browser's. Somebody travelling, or working for a company
 * in another country, has two answers to "what time is it" and only one of them
 * is the one their colleagues are working to. The zone is on their account —
 * they confirm it when they enrol, and HR can set it when they are invited — so
 * it is the honest one to render.
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

  const band = BANDS[bandFor(hour)];
  const Glyph = band.glyph;

  return (
    <span className="text-fg-muted inline-flex items-center gap-1.5 text-sm">
      <Glyph aria-hidden className={`size-4 ${band.tint}`} />
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
 * Which part of the day an hour falls in.
 *
 * Five bands rather than the two this had, and the two extra ones are the
 * point: `dawn` and `dusk` are the hours where "are my colleagues at their
 * desks" has a different answer at each end, and a light-or-dark split reported
 * both as whichever side of 19:00 they landed on. 18:30 in Madrid is people
 * finishing; 18:30 rendered as a bright sun said the working day was in full
 * swing.
 *
 * Still the clock, still not a sunrise calculation. That needs a latitude this
 * app does not have and is wrong in a different way at the poles. The glyph
 * answers a question about a working day, and an hour is the right resolution
 * for it.
 */
export type Band = 'lateNight' | 'dawn' | 'daytime' | 'dusk' | 'night';

export function bandFor(hour: number): Band {
  // Anything a clock could not have produced reads as night rather than
  // throwing: a glyph is not worth a crashed page.
  if (!Number.isFinite(hour)) return 'night';
  if (hour < 5) return 'lateNight';
  if (hour < 8) return 'dawn';
  if (hour < 17) return 'daytime';
  if (hour < 20) return 'dusk';
  return 'night';
}

/**
 * The glyph and its tint, per band.
 *
 * Tints are literal palette steps rather than Reach tokens on purpose: this is
 * a sky, not a state. `text-accent` here would re-point with the company's
 * brand and make a customer on Plum have a purple midday, which is the one
 * thing the colour is meant not to say.
 */
const BANDS: Record<Band, { glyph: typeof icons.daytime; tint: string }> = {
  lateNight: { glyph: icons.lateNight, tint: 'text-indigo-300' },
  dawn: { glyph: icons.dawn, tint: 'text-orange-400' },
  daytime: { glyph: icons.daytime, tint: 'text-amber-500' },
  dusk: { glyph: icons.dusk, tint: 'text-rose-400' },
  night: { glyph: icons.night, tint: 'text-indigo-400' },
};
