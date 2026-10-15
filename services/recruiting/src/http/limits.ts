/**
 * How often one address may ask a public model feature (J8): a model call
 * costs money and anyone can make one. Counted per process, reset hourly.
 *
 * ponytail: in memory, per container. A shared counter (Redis) when there is
 * more than one Recruiting process.
 */
const PER_HOUR = 30;
const seen = new Map<string, { count: number; resetAt: number }>();

export function allowed(ip: string, now: number): boolean {
  const held = seen.get(ip);
  if (held === undefined || held.resetAt <= now) {
    if (seen.size > 50_000) seen.clear();
    seen.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  held.count += 1;
  return held.count <= PER_HOUR;
}
