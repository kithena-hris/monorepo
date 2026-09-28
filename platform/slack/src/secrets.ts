import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The two secrets the Slack service handles: a workspace's bot token, kept
 * encrypted, and the `state` an "Add to Slack" round trip carries.
 *
 * The token is sealed with AES-256-GCM under `SLACK_TOKEN_KEY` before it is
 * written, so the database holds nothing a backup could use; the key's id is
 * stored beside it, so the key can be rotated.
 *
 * The state names the company, the administrator and the company's origin,
 * signed, and lasts ten minutes. Its claims are readable (the auth origin
 * reads the origin to pass the browser on); its signature is what makes them
 * believed, checked here when the company's origin completes the round trip.
 */

export interface TokenKey {
  readonly id: string;
  readonly key: Buffer;
}

/** `SLACK_TOKEN_KEY` is 32 bytes, base64. Its id is the first 8 hex of its hash. */
export function tokenKeyFrom(encoded: string): TokenKey | null {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) return null;
  return { id: createHmac('sha256', key).update('kithena-slack-key-id').digest('hex').slice(0, 8), key };
}

export function seal(key: TokenKey, plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function unseal(key: TokenKey, sealed: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key.key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8');
}

export interface StateClaims {
  /** The company. */
  readonly t: string;
  /** The administrator who started it. */
  readonly a: string;
  /** The company's origin, where the browser is sent back to. */
  readonly o: string;
  /** Expiry, epoch milliseconds. */
  readonly e: number;
}

const STATE_LIFETIME_MS = 10 * 60 * 1000;

const mac = (secret: Buffer, claims: string) =>
  createHmac('sha256', secret).update(`slack-state.${claims}`).digest('base64url');

export function signState(
  secret: Buffer,
  claims: Omit<StateClaims, 'e'>,
  now: number,
): string {
  const body = Buffer.from(JSON.stringify({ ...claims, e: now + STATE_LIFETIME_MS })).toString(
    'base64url',
  );
  return `${body}.${mac(secret, body)}`;
}

export function verifyState(secret: Buffer, state: string, now: number): StateClaims | null {
  const [body, signature, ...rest] = state.split('.');
  if (body === undefined || signature === undefined || rest.length > 0) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StateClaims;
    if (typeof claims.t !== 'string' || typeof claims.a !== 'string') return null;
    if (typeof claims.o !== 'string' || typeof claims.e !== 'number' || claims.e < now) return null;
    return claims;
  } catch {
    return null;
  }
}
