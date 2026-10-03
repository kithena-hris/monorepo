import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Sealing a provider's token before it is stored (TOF-110, TOF-111):
 * AES-256-GCM under `TIMEOFF_INTEGRATION_KEY` (32 bytes, base64), so a
 * backup or a support query yields nothing usable. Only an adapter seals and
 * opens; the application stores the sealed text and never reads it.
 *
 * `v1.` then base64url of the 12-byte nonce, the 16-byte tag and the
 * ciphertext. A provider that needs no stored secret (Google, Microsoft)
 * never calls it.
 */
export interface Sealer {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function sealerFrom(env: NodeJS.ProcessEnv): Sealer | null {
  const raw = env['TIMEOFF_INTEGRATION_KEY'];
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TIMEOFF_INTEGRATION_KEY must be 32 bytes, base64');
  return sealer(key);
}

export function sealer(key: Buffer): Sealer {
  return {
    seal(plain) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url')}`;
    },
    open(sealed) {
      if (!sealed.startsWith('v1.')) throw new Error('not a sealed secret');
      const raw = Buffer.from(sealed.slice(3), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
