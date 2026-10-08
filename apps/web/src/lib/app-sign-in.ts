import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Signing in to the phone app, through this company's own sign-in page.
 *
 * The app opens `/login?app=<redirect>&challenge=<c>` in the system's
 * authentication sheet (ASWebAuthenticationSession, a Custom Tab). The passkey
 * ceremony then happens on this origin exactly as it does in a browser, so
 * nothing about the relying party changes and no app has to be associated with
 * the domain. What changes is the ending: no cookie is set, because the sheet's
 * cookie jar is not the app's. The page is sent to the app's redirect instead,
 * carrying identity's one-time handoff code.
 *
 * A custom scheme is not owned by anybody — on Android a second app can
 * register `kithena://` and catch the redirect — so the code is bound to the
 * challenge the app sent, PKCE style (RFC 7636, S256). Only the app that made
 * the challenge holds the verifier, and without it the code opens nothing.
 *
 * **Sealed, not signed.** Identity's code is also what `/auth/callback`
 * redeems, so a code that merely carried a MAC beside it could be stripped of
 * the MAC and spent there, in a browser, by whoever caught the redirect. The
 * code is encrypted (AES-256-GCM) with the challenge as associated data: the
 * redirect never holds anything identity would accept, and only the verifier's
 * challenge opens it. No row is stored — the code already lives sixty seconds
 * in identity, and the challenge only has to survive the same trip.
 */
export interface AppSignIn {
  readonly redirect: string;
  readonly challenge: string;
}

/**
 * The schemes a code may be sent to: the app's own, and Expo Go's while it is
 * developed. Never `http(s)`, which would hand the code to a web page.
 */
const APP_SCHEMES = new Set(['kithena:', 'exp:', 'exps:']);

/** 32 bytes, base64url: what `sha256` of a verifier is. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636's length range, base64url. */
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;

export function appSignIn(
  redirect: string | undefined,
  challenge: string | undefined,
): AppSignIn | null {
  if (redirect === undefined || challenge === undefined || !CHALLENGE.test(challenge)) return null;
  try {
    return APP_SCHEMES.has(new URL(redirect).protocol) ? { redirect, challenge } : null;
  } catch {
    return null;
  }
}

/**
 * A key of its own, derived with HKDF, so the secret it comes from is never
 * used as a key directly and a key for anything else derives differently.
 */
function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', 'kithena app sign-in', 32));
}

/** What goes in the redirect: identity's code, sealed to the app's challenge. */
export function bindCode(code: string, challenge: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv).setAAD(Buffer.from(challenge));
  const sealed = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString('base64url');
}

/** Identity's code, if `verifier` is the one the challenge was made from; otherwise null. */
export function openCode(bound: string, verifier: string, secret: string): string | null {
  if (!VERIFIER.test(verifier)) return null;
  const raw = Buffer.from(bound, 'base64url');
  // An IV, at least a byte of code, and the tag.
  if (raw.length < 12 + 1 + 16) return null;
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12))
      .setAAD(Buffer.from(challenge))
      .setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // A wrong verifier, a wrong key or a changed byte: the tag does not verify.
    return null;
  }
}
