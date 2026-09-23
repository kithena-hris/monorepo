import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWK,
} from 'jose';

import type { TokenSigner } from '../application/mint-token.js';

/**
 * Signing, and the public half every module verifies against.
 *
 * ES256 rather than EdDSA. Ed25519 is the better algorithm and produces
 * smaller signatures, but this key is verified by the Cosmo Router and by
 * whatever a customer points at their own JWKS in headless mode, and ES256 is
 * the one every JWT library on every runtime supports without a version note.
 * That reach is worth more here than thirty bytes.
 *
 * The `kid` is the key's RFC 7638 thumbprint rather than a name someone
 * chooses. A thumbprint cannot disagree with the key it labels, which is what
 * makes rotation a matter of publishing both and letting verifiers pick.
 */
const ALG = 'ES256';

export interface Signer extends TokenSigner {
  /** The public half, in the shape `/.well-known/jwks.json` serves. */
  jwks(): { keys: JWK[] };
}

/**
 * `verification` are keys published beside the signing key and never used to
 * sign (PEO-113): the next key, published before identity switches to it, and
 * the previous one, kept until every token it signed has expired. That is the
 * whole rotation — verifiers pick by `kid`, and the router refetches the JWKS
 * when it meets a `kid` it does not know. Only their public halves are ever
 * published, whatever is passed.
 */
export async function joseSigner(
  privateJwk: JWK,
  verification: readonly JWK[] = [],
): Promise<Signer> {
  const key = await importJWK(privateJwk, ALG);

  // `importJWK` hands back a `Uint8Array` for a symmetric key and a `CryptoKey`
  // for an asymmetric one. Signing with a shared secret would work and would be
  // catastrophic: every module verifying a token would hold a key that also
  // mints them, so any subgraph could issue a principal for anyone.
  if (key instanceof Uint8Array) {
    throw new Error(
      'The identity signing key must be an asymmetric private key, not a shared secret',
    );
  }

  const publicJwk = publicHalf(privateJwk);
  const kid = await calculateJwkThumbprint(publicJwk);
  const others = await Promise.all(
    verification.map(async (jwk) => {
      const half = publicHalf(jwk);
      return { ...half, kid: await calculateJwkThumbprint(half), alg: ALG, use: 'sig' };
    }),
  );
  const published: { keys: JWK[] } = {
    keys: [
      { ...publicJwk, kid, alg: ALG, use: 'sig' },
      // Each key once, the signing key included, however a deployment lists them.
      ...others.filter(
        (other, at) => other.kid !== kid && others.findIndex((o) => o.kid === other.kid) === at,
      ),
    ],
  };

  return {
    async sign(claims, expiresAt) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: ALG, kid, typ: 'at+jwt' })
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(key);
    },

    jwks: () => published,
  };
}

/**
 * Strip the private components.
 *
 * Explicit allow-list rather than deleting `d`. A deny-list has to be right
 * about every field a key type might carry, and the cost of being wrong is
 * publishing a private key at a URL whose entire purpose is being fetched by
 * strangers.
 */
function publicHalf(jwk: JWK): JWK {
  const { kty, crv, x, y, n, e } = jwk;
  return Object.fromEntries(
    Object.entries({ kty, crv, x, y, n, e }).filter(([, value]) => value !== undefined),
  );
}

/**
 * A throwaway key, for local development only.
 *
 * Deliberately not a fallback inside `joseSigner`: a silent default is how a
 * deployment ends up signing production tokens with a key that changes on every
 * restart, and the failure looks like intermittent logouts rather than like a
 * missing configuration. The caller has to ask for this explicitly.
 */
export async function developmentKey(): Promise<JWK> {
  const { privateKey } = await generateKeyPair(ALG, { extractable: true });
  return exportJWK(privateKey);
}
