import {
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  createCipheriv,
} from 'node:crypto';

/**
 * Web Push from Messaging (RFC 8030), with nothing beyond `node:crypto`: the
 * payload encrypted for the one browser that subscribed (RFC 8291, the
 * `aes128gcm` coding of RFC 8188), and the request signed as Kithena's
 * application server (VAPID, RFC 8292). The push service carries bytes it
 * cannot read; only the browser, holding the subscription's keys, can.
 */

export interface WebSubscription {
  readonly endpoint: string;
  /** The browser's P-256 key and auth secret, base64url, as `PushSubscription.toJSON()` gives them. */
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface Vapid {
  /** The application server's key pair, base64url: 65-byte public point, 32-byte private scalar. */
  readonly publicKey: string;
  readonly privateKey: string;
  /** Who to reach about these pushes: `mailto:` or `https:`. */
  readonly subject: string;
}

const b64 = (bytes: Buffer): string => bytes.toString('base64url');
const unb64 = (text: string): Buffer => Buffer.from(text, 'base64url');

/** One record, the whole payload: `aes128gcm` with Kithena's key in the header (RFC 8291 §4). */
export function encryptPayload(plaintext: Buffer, subscription: WebSubscription['keys']): Buffer {
  const uaPublic = unb64(subscription.p256dh);
  const authSecret = unb64(subscription.auth);
  // Fresh keys and salt for every push.
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // The last (and only) record ends with 0x02 and carries no padding.
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed, cipher.getAuthTag()]);
}

/** The `Authorization` header for one push service (RFC 8292 §2): a JWT for its origin, 12 hours. */
export function vapidHeader(endpoint: string, vapid: Vapid, nowSeconds: number): string {
  const publicKey = unb64(vapid.publicKey);
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: b64(publicKey.subarray(1, 33)),
      y: b64(publicKey.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const part = (value: unknown) => b64(Buffer.from(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: nowSeconds + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64(signature)}, k=${vapid.publicKey}`;
}

/** What became of one push: delivered to the push service, or the subscription is gone for good. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Send one encrypted push; `gone` when the push service no longer knows the subscription (404, 410). */
export async function sendWebPush(
  subscription: WebSubscription,
  payload: unknown,
  vapid: Vapid,
  options: { readonly urgency: 'high' | 'normal'; readonly topic?: string },
): Promise<PushOutcome> {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), subscription.keys);
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      authorization: vapidHeader(subscription.endpoint, vapid, Math.floor(Date.now() / 1000)),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(24 * 3600),
      urgency: options.urgency,
      // A topic replaces an undelivered push with the same one: one item, one notification.
      ...(options.topic === undefined ? {} : { topic: options.topic.slice(0, 32) }),
    },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (response === null) return 'failed';
  if (response.status === 404 || response.status === 410) return 'gone';
  return response.ok ? 'sent' : 'failed';
}
