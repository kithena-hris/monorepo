import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  SecretDecryptionError,
  open,
  rewrap,
  sameSecret,
  seal,
  staticKeyRing,
  type MasterKey,
} from './envelope.js';

/**
 * The envelope, on its own, with no database anywhere near it.
 *
 * A bank account is the value this module exists for, and the properties
 * worth testing are the ones that fail quietly if they are wrong: that the
 * same plaintext encrypts differently every time, that a tampered byte is a
 * refusal rather than plausible garbage, and that rotation re-wraps without
 * ever touching the value.
 */

const key = (id: string): MasterKey => ({ id, key: randomBytes(32) });
const IBAN = 'ES9121000418450200051332';

describe('sealing a value', () => {
  const ring = staticKeyRing([key('k1')]);

  it('comes back as it went in', () => {
    const sealed = seal(IBAN, ring);
    expect(open(sealed, ring)).toBe(IBAN);
  });

  it('never contains the plaintext', () => {
    const sealed = seal(IBAN, ring);
    expect(sealed.ciphertext).not.toContain(IBAN);
    // And not in any obvious encoding of it either.
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain(IBAN);
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain('0200051332');
  });

  it('produces a different ciphertext every time', () => {
    // A fresh data key and nonce per value. Identical ciphertexts would let
    // anybody holding the table tell which employees bank together, without
    // decrypting anything.
    const once = seal(IBAN, ring);
    const twice = seal(IBAN, ring);
    expect(once.ciphertext).not.toBe(twice.ciphertext);
    expect(open(once, ring)).toBe(open(twice, ring));
  });

  it('keeps four characters for display and no more', () => {
    const sealed = seal(IBAN, ring);
    expect(sealed.last4).toBe('1332');
    expect(sealed.last4).toHaveLength(4);
  });

  it('records which master key wrapped it', () => {
    expect(seal(IBAN, ring).keyId).toBe('k1');
  });

  it('handles a value shorter than four characters without inventing one', () => {
    const sealed = seal('7', ring);
    expect(sealed.last4).toBe('7');
    expect(open(sealed, ring)).toBe('7');
  });

  it('handles an empty value without claiming a last4', () => {
    const sealed = seal('', ring);
    expect(sealed.last4).toBeNull();
    expect(open(sealed, ring)).toBe('');
  });

  it('handles a value that is not ASCII', () => {
    const sealed = seal('Müller-Lüdenscheidt ÑIF 12345678Z', ring);
    expect(open(sealed, ring)).toBe('Müller-Lüdenscheidt ÑIF 12345678Z');
  });
});

describe('opening a value that is not what it was', () => {
  const ring = staticKeyRing([key('k1')]);

  /**
   * Flip one bit at a byte offset in the stored envelope.
   *
   * Offsets are into the **decoded** bytes. Indexing the buffer with a
   * position taken from the base64 string lands past the end, where a Buffer
   * write is silently discarded — so the tamper did nothing and the test
   * passed by not testing anything.
   */
  function tamper(ciphertext: string, offset: number): string {
    const bytes = Buffer.from(ciphertext, 'base64');
    const at = offset < 0 ? bytes.length + offset : offset;
    if (at < 0 || at >= bytes.length) throw new Error('tamper offset is outside the envelope');
    bytes[at] = (bytes[at] ?? 0) ^ 0x01;
    return bytes.toString('base64');
  }

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    // Authenticated encryption, which is the whole reason for GCM: a payroll
    // file fed plausible garbage is worse than one that failed.
    const sealed = seal(IBAN, ring);
    const edited = { ...sealed, ciphertext: tamper(sealed.ciphertext, -1) };
    expect(() => open(edited, ring)).toThrow(SecretDecryptionError);
  });

  it('refuses a tampered wrapped key', () => {
    const sealed = seal(IBAN, ring);
    const edited = { ...sealed, ciphertext: tamper(sealed.ciphertext, 30) };
    expect(() => open(edited, ring)).toThrow(SecretDecryptionError);
  });

  it('refuses an envelope written under a version it does not know', () => {
    const sealed = seal(IBAN, ring);
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[0] = 99;
    expect(() => open({ ...sealed, ciphertext: bytes.toString('base64') }, ring)).toThrow(
      /version 99/u,
    );
  });

  it('refuses a truncated row instead of reading past the end of it', () => {
    const sealed = seal(IBAN, ring);
    const short = Buffer.from(sealed.ciphertext, 'base64').subarray(0, 20).toString('base64');
    expect(() => open({ ...sealed, ciphertext: short }, ring)).toThrow(/too short/u);
  });

  it('refuses when the key it names is not loaded', () => {
    const sealed = seal(IBAN, ring);
    expect(() => open({ ...sealed, keyId: 'k-gone' }, ring)).toThrow(/no master key/u);
  });

  it('refuses when a different key is presented under the same name', () => {
    // The rotation mistake: a deployment reusing an id for new key material.
    const sealed = seal(IBAN, ring);
    const impostor = staticKeyRing([key('k1')]);
    expect(() => open(sealed, impostor)).toThrow(SecretDecryptionError);
  });
});

describe('the key ring', () => {
  it('refuses a key that is not 32 bytes', () => {
    // A short key would otherwise fail at the first encrypt, in a request,
    // rather than at boot.
    expect(() => staticKeyRing([{ id: 'k1', key: randomBytes(16) }])).toThrow(/not 32/u);
  });

  it('refuses to exist with no keys at all', () => {
    expect(() => staticKeyRing([])).toThrow();
  });

  it('writes with the first key and still reads the rest', () => {
    // Rotation is not instant: rows written under the old key stay readable
    // until the re-wrap job has walked them.
    const older = key('k1');
    const newer = key('k2');

    const before = seal(IBAN, staticKeyRing([older]));
    const after = staticKeyRing([newer, older]);

    expect(after.current().id).toBe('k2');
    expect(open(before, after)).toBe(IBAN);
    expect(seal(IBAN, after).keyId).toBe('k2');
  });
});

describe('rotation', () => {
  const older = key('k1');
  const newer = key('k2');

  it('re-wraps without touching the value', () => {
    const before = seal(IBAN, staticKeyRing([older]));
    const ring = staticKeyRing([newer, older]);

    const after = rewrap(before, ring);
    expect(after.keyId).toBe('k2');
    expect(after.ciphertext).not.toBe(before.ciphertext);
    expect(open(after, ring)).toBe(IBAN);

    // The value's own ciphertext is copied across byte for byte. That is what
    // makes rotating 400,000 bank accounts a job somebody actually runs.
    const tail = (c: string) => Buffer.from(c, 'base64').subarray(1 + 12 + 16 + 32).toString('hex');
    expect(tail(after.ciphertext)).toBe(tail(before.ciphertext));
  });

  it('leaves a row already on the current key alone', () => {
    const ring = staticKeyRing([newer, older]);
    const sealed = seal(IBAN, ring);
    expect(rewrap(sealed, ring)).toBe(sealed);
  });

  it('refuses a row whose key has been retired', () => {
    // Loudly, rather than leaving a row nobody notices is unreadable.
    const orphan = seal(IBAN, staticKeyRing([older]));
    expect(() => rewrap(orphan, staticKeyRing([newer]))).toThrow(/no master key/u);
  });
});

describe('comparing two secrets', () => {
  const ring = staticKeyRing([key('k1')]);

  it('says two encryptions of one value are the same', () => {
    // Ciphertexts cannot be compared — a fresh data key per value is exactly
    // what stops that — so a uniqueness check on an encrypted attribute has to
    // come back here, and gets a boolean rather than a value.
    expect(sameSecret(seal(IBAN, ring), seal(IBAN, ring), ring)).toBe(true);
  });

  it('says two different values are not', () => {
    expect(sameSecret(seal(IBAN, ring), seal('ES7620770024003102575766', ring), ring)).toBe(false);
  });

  it('is not fooled by one value being a prefix of the other', () => {
    expect(sameSecret(seal('12345', ring), seal('123456', ring), ring)).toBe(false);
  });
});
