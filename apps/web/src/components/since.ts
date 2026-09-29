/**
 * How long ago, the way a list of things waiting says it: "12m", "3h",
 * "Yesterday", "Mon", "12 Sep". Read against the time People answered, not the
 * browser's clock, so the server's render and the browser's agree.
 */
export function since(at: string, now: string): string {
  const then = new Date(at);
  const ms = Date.parse(now) - then.getTime();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${String(Math.max(1, minutes))}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
