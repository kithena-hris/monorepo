import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * The shared secret between the apps that own an origin and this service.
 *
 * Constant-time, because the obvious comparison leaks the token. `a === b` on
 * strings returns at the first differing byte, so how long it takes says how
 * many leading bytes were right, and a few thousand requests turn that into the
 * secret. `timingSafeEqual` throws on a length mismatch — itself a leak of the
 * length — so lengths are compared first and only equal-length inputs reach it.
 *
 * Lives in `shared/` because two slices need it and neither owns it. Anything
 * that lands here should be able to survive that sentence being said out loud.
 */
export function presentsInternalToken(request: IncomingMessage, expected: string): boolean {
  const presented = request.headers['x-internal-token'];
  if (typeof presented !== 'string' || expected.length === 0) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Reads a JSON body, with a cap. Returns null for anything unparseable. */
export async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 256 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    // Refused rather than truncated. A truncated body parses as invalid JSON
    // and would be reported as a client error, which is true but unhelpful.
    if (size > maxBytes) return null;
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}
