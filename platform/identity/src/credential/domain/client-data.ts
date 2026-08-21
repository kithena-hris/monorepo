/**
 * The challenge a browser says it signed over.
 *
 * Needed *before* the signature is checked, because the challenge is the key
 * the stored ceremony is looked up by. That means parsing attacker-controlled
 * bytes, so this function is written to return null for anything unexpected and
 * to throw for nothing at all.
 *
 * Using it as a lookup key before verification is safe: the value is only ever
 * used to find a challenge we issued, and the worst an invented one can do is
 * miss. The signature check that follows is what makes it trustworthy.
 */
export function challengeFrom(response: unknown): string | null {
  const clientDataJSON = clientDataOf(response);
  if (clientDataJSON === null) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') return null;
  const challenge: unknown = (parsed as { challenge?: unknown }).challenge;

  // Bounded. This string becomes a cache key, and an unbounded one from an
  // unauthenticated caller is a way to write very large keys very quickly.
  if (typeof challenge !== 'string' || challenge.length === 0 || challenge.length > 256) {
    return null;
  }

  return challenge;
}

function clientDataOf(response: unknown): string | null {
  if (response === null || typeof response !== 'object') return null;
  const inner: unknown = (response as { response?: unknown }).response;
  if (inner === null || typeof inner !== 'object') return null;
  const clientDataJSON: unknown = (inner as { clientDataJSON?: unknown }).clientDataJSON;
  return typeof clientDataJSON === 'string' ? clientDataJSON : null;
}
