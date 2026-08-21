import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

/**
 * A passkey, in software, for tests.
 *
 * Exists so the ceremony can be proven rather than assumed. Every other test in
 * this slice stubs the library and checks the rules around it; this one
 * produces a real ECDSA signature over real authenticator data and hands it to
 * the real verifier. Without it, "sign-in works" rests on a fake agreeing with
 * the code that calls it.
 *
 * It is not a security tool and does not pretend to be one: there is no secure
 * element, the key sits in process memory, and it will sign anything asked of
 * it. That is exactly what makes it useful for producing the *invalid* cases
 * too — a counter that goes backwards, a missing user-verification flag, an
 * assertion for the wrong origin.
 */
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;

export interface Authenticator {
  readonly credentialId: string;
  /** The public key in COSE_Key form, which is how WebAuthn stores it. */
  readonly cosePublicKey: Uint8Array<ArrayBuffer>;
  assert(options: AssertionOptions): AssertionResponse;
}

export interface AssertionOptions {
  readonly challenge: string;
  readonly origin: string;
  readonly rpId: string;
  readonly signCount?: number;
  readonly userVerified?: boolean;
  readonly backedUp?: boolean;
  readonly userHandle?: string;
}

export interface AssertionResponse {
  readonly id: string;
  readonly rawId: string;
  readonly type: 'public-key';
  readonly clientExtensionResults: Record<string, never>;
  readonly response: {
    readonly clientDataJSON: string;
    readonly authenticatorData: string;
    readonly signature: string;
    readonly userHandle: string | null;
  };
}

export function softwareAuthenticator(credentialId = 'test-credential'): Authenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  return {
    credentialId: Buffer.from(credentialId).toString('base64url'),
    cosePublicKey: coseKeyOf(publicKey),

    assert(options) {
      const clientData = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: options.challenge,
          origin: options.origin,
          crossOrigin: false,
        }),
      );

      const authData = authenticatorData(options);

      // WebAuthn signs over the authenticator data concatenated with the hash
      // of the client data — not over the client data itself. Getting this
      // wrong produces a signature that is perfectly valid over the wrong
      // bytes, which is the failure a hand-written verifier never notices.
      const signed = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
      const signature = createSign('sha256').update(signed).sign(privateKey);

      return {
        id: Buffer.from(credentialId).toString('base64url'),
        rawId: Buffer.from(credentialId).toString('base64url'),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: signature.toString('base64url'),
          userHandle: options.userHandle
            ? Buffer.from(options.userHandle).toString('base64url')
            : null,
        },
      };
    },
  };
}

/** `rpIdHash || flags || signCount`. */
function authenticatorData(options: AssertionOptions): Buffer {
  const rpIdHash = createHash('sha256').update(options.rpId).digest();

  let flags = FLAG_USER_PRESENT;
  if (options.userVerified !== false) flags |= FLAG_USER_VERIFIED;
  if (options.backedUp !== false) flags |= FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;

  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(options.signCount ?? 0);

  return Buffer.concat([rpIdHash, Buffer.from([flags]), counter]);
}

/**
 * A P-256 public key as a COSE_Key, hand-encoded.
 *
 * Five CBOR map entries and no library, because the shape is fixed and the
 * alternative is a CBOR dependency in the test path to write seventy-seven
 * deterministic bytes:
 *
 *   a5            map of five
 *   01 02         kty: EC2
 *   03 26         alg: ES256 (-7)
 *   20 01         crv: P-256 (-1 → 1)
 *   21 5820 x…    x coordinate, 32 bytes (-2)
 *   22 5820 y…    y coordinate, 32 bytes (-3)
 */
function coseKeyOf(publicKey: KeyObject): Uint8Array<ArrayBuffer> {
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(String(jwk.x), 'base64url');
  const y = Buffer.from(String(jwk.y), 'base64url');

  if (x.length !== 32 || y.length !== 32) {
    throw new Error('P-256 coordinates must be 32 bytes each');
  }

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      x,
      Buffer.from([0x22, 0x58, 0x20]),
      y,
    ]),
  );
}
