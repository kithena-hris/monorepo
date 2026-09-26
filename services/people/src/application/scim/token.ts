import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A SCIM connection's bearer token (PEO-072).
 *
 * `kps_` then base64url of the tenant's id, the connection's id and 32
 * random bytes. The ids let the token be looked up inside its own tenant's
 * row-level security — nothing has to search every tenant for it — and the
 * random part is what authenticates. Only SHA-256 of the whole string is
 * stored; the plaintext is shown once.
 */

const PREFIX = 'kps_';
const SECRET_BYTES = 32;

const uuidBytes = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex');
const uuidOf = (bytes: Buffer) => {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function issueToken(tenantId: string, connectionId: string): string {
  const raw = Buffer.concat([uuidBytes(tenantId), uuidBytes(connectionId), randomBytes(SECRET_BYTES)]);
  return `${PREFIX}${raw.toString('base64url')}`;
}

/** Which tenant and connection a token claims to be for; null when it is not one of ours. */
export function tokenClaims(token: string): { tenantId: string; connectionId: string } | null {
  if (!token.startsWith(PREFIX) || token.length > 200) return null;
  const raw = Buffer.from(token.slice(PREFIX.length), 'base64url');
  if (raw.length !== 32 + SECRET_BYTES) return null;
  return { tenantId: uuidOf(raw.subarray(0, 16)), connectionId: uuidOf(raw.subarray(16, 32)) };
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Whether a token matches a stored hash, in constant time. */
export function tokenMatches(token: string, hash: string | null): boolean {
  if (hash === null) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
