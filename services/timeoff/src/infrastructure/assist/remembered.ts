/**
 * A model call remembered by what it was asked, per tenant, so a screen read
 * twice with the same figures asks once. Only an answer is kept; a failure is
 * asked again next time.
 *
 * ponytail: per process and capped at 500 asks, oldest out first; a shared
 * cache when there is more than one Time Off process and the bill says so.
 */
export function remembered<A, R>(
  fn: (tenantId: string, ask: A) => Promise<R>,
  keep: (answer: R) => boolean = (answer) =>
    answer !== null && !(answer instanceof Map && answer.size === 0),
  cap = 500,
): (tenantId: string, ask: A) => Promise<R> {
  const seen = new Map<string, R>();
  return async (tenantId, ask) => {
    const key = `${tenantId}\u0000${JSON.stringify(ask)}`;
    const hit = seen.get(key);
    if (hit !== undefined) return hit;
    const answer = await fn(tenantId, ask);
    if (keep(answer)) {
      if (seen.size >= cap) seen.delete(seen.keys().next().value as string);
      seen.set(key, answer);
    }
    return answer;
  };
}
