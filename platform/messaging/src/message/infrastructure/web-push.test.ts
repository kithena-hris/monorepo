import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { encryptPayload, vapidHeader } from './web-push.js';

/** A browser's side of a subscription: its key pair and auth secret. */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
}

/** What the browser does with the body (RFC 8291 §3.4, RFC 8188 §2): the plaintext back. */
function decrypt(body: Buffer, b: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const sealed = body.subarray(21 + idlen);
  const uaPublic = b.ecdh.getPublicKey();
  const shared = b.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, b.auth, info, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

describe('a web push', () => {
  it('is read by the browser that subscribed, and by nobody else', () => {
    const b = browser();
    const body = encryptPayload(Buffer.from('{"title":"Approve the offer"}'), b.keys);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(decrypt(body, b)).toBe('{"title":"Approve the offer"}');
    expect(() => decrypt(body, browser())).toThrow();
  });

  it('is signed as Kithena for the push service it goes to', () => {
    const server = createECDH('prime256v1');
    server.generateKeys();
    const vapid = {
      publicKey: server.getPublicKey().toString('base64url'),
      privateKey: server.getPrivateKey().toString('base64url'),
      subject: 'mailto:admin@kithena.com',
    };
    const header = vapidHeader('https://fcm.googleapis.com/fcm/send/abc', vapid, 1_800_000_000);
    const [, token = '', key = ''] = /^vapid t=([^,]+), k=(.+)$/u.exec(header) ?? [];
    expect(key).toBe(vapid.publicKey);
    const [h = '', c = '', s = ''] = token.split('.');
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toMatchObject({
      aud: 'https://fcm.googleapis.com',
      sub: 'mailto:admin@kithena.com',
      exp: 1_800_000_000 + 12 * 3600,
    });
    const pub = server.getPublicKey();
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(s, 'base64url'),
      ),
    ).toBe(true);
  });
});
