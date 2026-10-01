/**
 * `KITHENA_TIMING=1`: one log line per call a render waits on — identity, the
 * router, the remote's files — with when it started and how long it took, so
 * a waterfall shows up as starts that wait for each other's ends.
 *
 * A log line rather than a `Server-Timing` header: a server component cannot
 * set a response header, and a navigation's payload is streamed before most
 * of these calls finish anyway. Off by default, and always in a browser.
 */
const on = process.env['KITHENA_TIMING'] === '1';

export async function timed<T>(name: string, work: Promise<T>): Promise<T> {
  if (!on) return work;
  const start = performance.now();
  try {
    return await work;
  } finally {
    console.log(
      JSON.stringify({
        msg: 'timing',
        name,
        at: Math.round(start),
        ms: Math.round(performance.now() - start),
      }),
    );
  }
}
