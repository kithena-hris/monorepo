import type { IncomingMessage } from 'node:http';

/**
 * Reads a JSON body, with a cap. Returns null for anything unparseable.
 *
 * A local copy of the same twenty lines the identity service has, deliberately.
 * The constant-time secret comparison next to it there was worth sharing — a
 * second copy of that is a second chance to write `===` — but this one has no
 * such property to get wrong: the failure mode is a request refused as
 * malformed, which is what it would be anyway. Extracting it would mean a
 * package existing to hold one utility, and every service depending on it to
 * read a body.
 */
export async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 64 * 1024,
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
