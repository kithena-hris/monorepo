import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { Sealer } from '../application/ports.js';

/**
 * AES-256-GCM under `RECRUITING_ENCRYPTION_KEY`, the key that seals stored
 * files, with the row's id bound in so a sealed value copied to another row
 * does not open. Layout: 12-byte IV, ciphertext, 16-byte tag.
 */
export function aesSealer(key: Uint8Array): Sealer {
  if (key.byteLength !== 32) throw new Error('RECRUITING_ENCRYPTION_KEY must be 32 bytes, base64');
  return {
    seal(plain, boundTo) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(boundTo));
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return new Uint8Array(Buffer.concat([iv, body, cipher.getAuthTag()]));
    },
    open(sealed, boundTo) {
      try {
        const all = Buffer.from(sealed);
        const decipher = createDecipheriv('aes-256-gcm', key, all.subarray(0, 12));
        decipher.setAAD(Buffer.from(boundTo));
        decipher.setAuthTag(all.subarray(all.length - 16));
        return new Uint8Array(
          Buffer.concat([decipher.update(all.subarray(12, all.length - 16)), decipher.final()]),
        );
      } catch {
        return null;
      }
    },
  };
}

export function sealerFrom(env: Readonly<Record<string, string | undefined>>): Sealer | undefined {
  const key = env['RECRUITING_ENCRYPTION_KEY'];
  return key ? aesSealer(Buffer.from(key, 'base64')) : undefined;
}
