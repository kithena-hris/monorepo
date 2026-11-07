/**
 * `KITHENA_TIMING=1`: one log line per call a render waits on — identity, the
 * router, the remote's files — with when it started and how long it took, so
 * a waterfall shows up as starts that wait for each other's ends.
 *
 * A log line rather than a `Server-Timing` header: a server component cannot
 * set a response header, and a navigation's payload is streamed before most
 * of these calls finish anyway. Off by default, except a call past `SLOW_MS`.
 */
const on = process.env['KITHENA_TIMING'] === '1';

/** Past this, a call is logged even with timing off. */
const SLOW_MS = 500;

export async function timed<T>(name: string, work: Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work;
  } finally {
    const ms = Math.round(performance.now() - start);
    // A slow call is logged whatever the switch says: production finds its
    // own slow reads in the runtime logs without a deploy to turn this on.
    if (on || ms >= SLOW_MS) {
      console.log(JSON.stringify({ msg: 'timing', name, at: Math.round(start), ms }));
    }
  }
}
