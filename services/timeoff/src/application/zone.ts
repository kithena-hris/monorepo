/**
 * Wall-clock time in a member's zone, for the jobs and timers that run at
 * "09:00" or "20:00" where the person is rather than in UTC.
 */

/** Minutes after local midnight. */
export function localMinutes(at: Date, timeZone: string): number {
  const [h = 0, m = 0] = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(at)
    .split(':')
    .map(Number);
  return h * 60 + m;
}

/**
 * Milliseconds until the local clock next reads `minuteOfDay`, never zero.
 *
 * ponytail: on a daylight-saving night this is an hour off; whatever wakes on
 * it checks the time again, so the worst case is a reminder an hour late once
 * a year.
 */
export function msUntilLocal(at: Date, timeZone: string, minuteOfDay: number): number {
  const now = localMinutes(at, timeZone);
  const minutes = (((minuteOfDay - now) % 1440) + 1440) % 1440 || 1440;
  return minutes * 60_000 - at.getUTCSeconds() * 1000 - at.getUTCMilliseconds();
}
