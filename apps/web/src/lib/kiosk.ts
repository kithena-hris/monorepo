/**
 * The kiosk's small rules (TOF-108), apart from React so they can be tested:
 * where its device token comes from, the sequence each tap carries, and
 * which tenant a token names.
 *
 * A kiosk has no session. HR opens `/kiosk/<id>#token=kk_…` on the tablet
 * once; the token moves to the tablet's storage and out of the address, and
 * every request after carries it as `Authorization: Bearer`.
 */

export const tokenKey = (deviceId: string): string => `kithena.kiosk.${deviceId}`;
export const sequenceKey = (deviceId: string): string => `kithena.kiosk.${deviceId}.sequence`;

/** The token in `#token=…`, which HR's link carries once. */
export function tokenFromFragment(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/u, '')).get('token');
  return token !== null && token.startsWith('kk_') ? token : null;
}

/**
 * The next tap's sequence: one more than the last, and never behind the
 * clock's milliseconds. Time Off punches a sequence once and ignores any at
 * or below the last it synced, so a tablet whose storage was wiped must not
 * start again from 1; starting from the time keeps it ahead.
 */
export const nextSequence = (last: number, nowMs: number): number => Math.max(last + 1, nowMs);

/**
 * The tenant a kiosk token names: `kk_` and base64url of the tenant's id,
 * the device's id and a secret. Checked against the host's tenant before a
 * token is forwarded, so one company's tablet cannot be pointed at another
 * company's address. Time Off checks the secret.
 */
export function tenantOfToken(token: string): string | null {
  if (!token.startsWith('kk_')) return null;
  const raw = Buffer.from(token.slice(3), 'base64url');
  if (raw.length !== 64) return null;
  const h = raw.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
