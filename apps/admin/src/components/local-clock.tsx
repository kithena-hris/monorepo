'use client';

import { useEffect, useState, type JSX } from 'react';

/**
 * The time where the company is.
 *
 * `initial` is rendered on the server and used as the first state, so the
 * hydrated markup matches what was sent and React has nothing to complain
 * about. The interval then takes over — a clock that is right when the page
 * loads and wrong for the next hour is a clock nobody trusts twice.
 *
 * Every minute, not every second: the display has no seconds in it, so a
 * per-second timer would be 59 wakeups that change no pixels.
 */
export function LocalClock({
  timeZone,
  initial,
}: {
  readonly timeZone: string;
  readonly initial: string;
}): JSX.Element {
  const [now, setNow] = useState(initial);

  useEffect(() => {
    const tick = (): void => {
      setNow(
        new Date().toLocaleTimeString('en-GB', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [timeZone]);

  return <time>{now}</time>;
}
