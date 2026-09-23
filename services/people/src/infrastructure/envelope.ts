import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Envelope encryption for the values that must never be readable from a dump.
 *
 * A bank account, a national identifier and a tax identifier are encrypted
 * with a **data key generated for that one value**, and the data key is then
 * wrapped with a master key the service holds. The wrapped key travels with
 * the ciphertext; the master key never does.
 *
 * Why an envelope rather than encrypting with the master key directly:
 *
 *   - **Rotation is cheap.** Rotating the master key re-wraps 32 bytes per
 *     row rather than decrypting and re-encrypting every bank account a
 *     customer has. `key_id` on the row is what a rotation selects by.
 *   - **One key, one value.** A master key used directly encrypts every secret
 *     in the system under one key and one nonce space, and AES-GCM fails
 *     catastrophically on a nonce reused across messages — not "some
 *     plaintext leaks", but the authentication key itself becomes recoverable.
 *     A fresh data key per value makes a reused nonce impossible by
 *     construction rather than by remembering a counter.
 *   - **Blast radius.** A leaked ciphertext is one value. A leaked data key is
 *     one value. Only the master key is worth an incident.
 *
 * AES-256-GCM for both layers: authenticated, so a tampered ciphertext is a
 * refusal rather than plausible garbage that reaches a payroll file.
 *
 * The master key arrives from the deployment — `docs/environments.md` is where
 * key material is described — and this module never reads a file, an
 * environment variable or a network. It is given keys and does arithmetic.
 */

/** Format marker. A stored blob says which layout it was written under. */
const VERSION = 1;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * One master key, named.
 *
 * `id` is stored beside the ciphertext, so a rotation knows which rows it has
 * yet to re-wrap and a decrypt knows which key to ask for. Never the key
 * itself, obviously, and never anything derived from it.
 */
export interface MasterKey {
  readonly id: string;
  /** 32 bytes. Anything shorter is refused rather than stretched. */
  readonly key: Buffer;
}

/**
 * The keys this service can reach.
 *
 * A port, not a class: the production implementation reads a secret manager,
 * and a test hands over two buffers. Both answer the same two questions —
 * which key should I write with, and where is the one this row was written
 * with.
 */
export interface KeyRing {
  /** The key new secrets are written under. Rotation changes what this returns. */
  current(): MasterKey;
  /** A key by id, for reading a row written before the last rotation. */
  byId(id: string): MasterKey | undefined;
  /**
   * Every key, current first. A unique claim is a keyed hash, and during a
   * rotation a value has to be looked for under each key it may be held under.
   */
  all(): readonly MasterKey[];
}

export interface SealedSecret {
  /** The whole envelope, base64, as the `bytea` column stores it. */
  readonly ciphertext: string;
  /** Which master key wrapped the data key. */
  readonly keyId: string;
  /** The last four characters of the plaintext, for display. Never more. */
  readonly last4: string | null;
}

export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptionError';
  }
}

/**
 * A static key ring, for a deployment holding one master key and its
 * predecessor.
 *
 * Two keys rather than one because rotation is not instant: rows written under
 * the old key stay readable until the re-wrap job has walked them, and a
 * deployment that dropped the old key at the moment it took the new one would
 * make every unrotated row unreadable.
 */
export function staticKeyRing(keys: readonly MasterKey[]): KeyRing {
  if (keys.length === 0) throw new Error('a key ring with no keys cannot encrypt anything');
  for (const key of keys) {
    if (key.key.length !== KEY_BYTES) {
      throw new Error(`master key ${key.id} is ${String(key.key.length)} bytes, not 32`);
    }
  }

  const byId = new Map(keys.map((k) => [k.id, k]));
  // The first is current by convention: a deployment lists the key it writes
  // with, then the ones it can still read.
  const [head] = keys;

  return {
    current: () => head as MasterKey,
    byId: (id) => byId.get(id),
    all: () => keys,
  };
}

/** `id:base64,id:base64`, as `PEOPLE_SECRET_KEYS` holds them: the first is current. */
export function keysFrom(value: string | undefined): MasterKey[] {
  return (value ?? '')
    .split(',')
    .filter((pair) => pair.includes(':'))
    .map((pair) => {
      const [id = '', key = ''] = pair.split(':');
      return { id, key: Buffer.from(key, 'base64') };
    });
}

/**
 * Encrypt one value.
 *
 * `last4` is computed here rather than by the caller, so the one place that
 * has the plaintext is the one place that decides how much of it survives.
 * Four characters is enough to confirm which account somebody meant and
 * useless to anybody who dumps the table.
 */
export function seal(plaintext: string, ring: KeyRing): SealedSecret {
  const master = ring.current();

  const dataKey = randomBytes(KEY_BYTES);
  const valueIv = randomBytes(IV_BYTES);
  const valueCipher = createCipheriv('aes-256-gcm', dataKey, valueIv);
  const value = Buffer.concat([valueCipher.update(plaintext, 'utf8'), valueCipher.final()]);
  const valueTag = valueCipher.getAuthTag();

  const wrapIv = randomBytes(IV_BYTES);
  const wrapCipher = createCipheriv('aes-256-gcm', master.key, wrapIv);
  const wrappedKey = Buffer.concat([wrapCipher.update(dataKey), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();

  // Fixed layout, so there are no lengths to parse and nothing to get wrong
  // when reading a blob written by an older process.
  const envelope = Buffer.concat([
    Buffer.from([VERSION]),
    wrapIv,
    wrapTag,
    wrappedKey,
    valueIv,
    valueTag,
    value,
  ]);

  // The data key is finished with. Zeroing it does not protect against a heap
  // dump taken mid-call, but it does shorten the window, and it costs one line.
  dataKey.fill(0);

  return {
    ciphertext: envelope.toString('base64'),
    keyId: master.id,
    last4: plaintext.length === 0 ? null : plaintext.slice(-4),
  };
}

/**
 * Decrypt one value, or refuse.
 *
 * Every failure is the same kind of failure to a caller: a tampered blob, a
 * missing key and a truncated row all produce a refusal rather than a value.
 * What differs is the message, which goes to a log the person presenting the
 * ciphertext cannot read.
 */
export function open(sealed: { ciphertext: string; keyId: string }, ring: KeyRing): string {
  const master = ring.byId(sealed.keyId);
  if (!master) {
    throw new SecretDecryptionError(`no master key called ${sealed.keyId} is loaded`);
  }

  const envelope = Buffer.from(sealed.ciphertext, 'base64');
  const minimum = 1 + IV_BYTES + TAG_BYTES + KEY_BYTES + IV_BYTES + TAG_BYTES;
  if (envelope.length < minimum) {
    throw new SecretDecryptionError('the stored envelope is too short to be one');
  }

  const version = envelope[0];
  if (version !== VERSION) {
    throw new SecretDecryptionError(`envelope version ${String(version)} is not one this reads`);
  }

  let at = 1;
  const take = (n: number): Buffer => {
    const slice = envelope.subarray(at, at + n);
    at += n;
    return slice;
  };

  const wrapIv = take(IV_BYTES);
  const wrapTag = take(TAG_BYTES);
  const wrappedKey = take(KEY_BYTES);
  const valueIv = take(IV_BYTES);
  const valueTag = take(TAG_BYTES);
  const value = envelope.subarray(at);

  let dataKey: Buffer;
  try {
    const unwrap = createDecipheriv('aes-256-gcm', master.key, wrapIv);
    unwrap.setAuthTag(wrapTag);
    dataKey = Buffer.concat([unwrap.update(wrappedKey), unwrap.final()]);
  } catch {
    // Wrong key or a tampered wrap. Both mean the same thing to a caller.
    throw new SecretDecryptionError('the data key did not unwrap');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, valueIv);
    decipher.setAuthTag(valueTag);
    return Buffer.concat([decipher.update(value), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretDecryptionError('the value did not authenticate');
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Re-wrap a secret under the ring's current key, without touching the value.
 *
 * This is what makes rotation cheap: 32 bytes are decrypted and re-encrypted
 * per row, and the value's own ciphertext is copied across untouched. A
 * rotation that decrypted every bank account would be a rotation nobody runs.
 */
export function rewrap(
  sealed: { ciphertext: string; keyId: string },
  ring: KeyRing,
): { ciphertext: string; keyId: string } {
  const master = ring.byId(sealed.keyId);
  if (!master) {
    throw new SecretDecryptionError(`no master key called ${sealed.keyId} is loaded`);
  }

  const target = ring.current();
  if (target.id === sealed.keyId) return sealed;

  const envelope = Buffer.from(sealed.ciphertext, 'base64');
  const wrapIv = envelope.subarray(1, 1 + IV_BYTES);
  const wrapTag = envelope.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const wrappedKey = envelope.subarray(
    1 + IV_BYTES + TAG_BYTES,
    1 + IV_BYTES + TAG_BYTES + KEY_BYTES,
  );
  const rest = envelope.subarray(1 + IV_BYTES + TAG_BYTES + KEY_BYTES);

  let dataKey: Buffer;
  try {
    const unwrap = createDecipheriv('aes-256-gcm', master.key, wrapIv);
    unwrap.setAuthTag(wrapTag);
    dataKey = Buffer.concat([unwrap.update(wrappedKey), unwrap.final()]);
  } catch {
    throw new SecretDecryptionError('the data key did not unwrap');
  }

  const newIv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', target.key, newIv);
  const newWrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const newTag = cipher.getAuthTag();
  dataKey.fill(0);

  return {
    ciphertext: Buffer.concat([
      Buffer.from([VERSION]),
      newIv,
      newTag,
      newWrapped,
      rest,
    ]).toString('base64'),
    keyId: target.id,
  };
}

/**
 * Whether two secrets hold the same plaintext, without either being returned.
 *
 * A uniqueness check on an encrypted attribute cannot compare ciphertexts —
 * a fresh data key per value means the same account number encrypts
 * differently every time, which is the property that makes the ciphertext
 * useless to an attacker who has the table. So the comparison happens on
 * plaintext, in memory, and the answer is a boolean rather than a value.
 */
export function sameSecret(
  a: { ciphertext: string; keyId: string },
  b: { ciphertext: string; keyId: string },
  ring: KeyRing,
): boolean {
  const left = Buffer.from(open(a, ring), 'utf8');
  const right = Buffer.from(open(b, ring), 'utf8');
  try {
    return left.length === right.length && timingSafeEqual(left, right);
  } finally {
    left.fill(0);
    right.fill(0);
  }
}
