import type { IncomingMessage } from 'node:http';

/**
 * Reading an internal request: who sent it, and what they sent.
 *
 * The constant-time secret comparison moved to `@kithena/auth-kit` when the
 * messaging service needed it too. It is re-exported here rather than having
 * every call site change import, and because "is this one of ours" is the same
 * question on both sides of that wire — a second copy of a constant-time
 * comparison is a second chance to write `===`.
 */
export { presentsInternalToken } from '@kithena/auth-kit';

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
