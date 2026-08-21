import type { Clock } from '@kithena/domain-kit';

import type { PrincipalClaims } from '../domain/principal.js';

/**
 * Signing, as a port.
 *
 * The use case decides what a token says and how long it lives; the adapter
 * decides how it is signed. Keeping them apart is what lets the claim rules be
 * tested without a key and the key handling be swapped for a KMS later without
 * touching them.
 */
export interface TokenSigner {
  sign(claims: Record<string, unknown>, expiresAt: Date): Promise<string>;
}

export interface MintTokenDeps {
  readonly signer: TokenSigner;
  readonly clock: Clock;
  readonly issuer: string;
  readonly audience: string;
  /**
   * Two minutes.
   *
   * Long enough that a single server-rendered page does not re-mint mid-render,
   * short enough that a revoked session is dead within a window nobody would
   * describe as "still logged in". It is deliberately not the session lifetime:
   * the session is a row that can be deleted, and this is a bearer token that
   * cannot be recalled once handed out.
   */
  readonly lifetimeSeconds?: number;
}

export type MintToken = (claims: PrincipalClaims) => Promise<string>;

export function mintToken({
  signer,
  clock,
  issuer,
  audience,
  lifetimeSeconds = 120,
}: MintTokenDeps): MintToken {
  return async (claims) => {
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + lifetimeSeconds * 1000);

    return signer.sign(
      {
        iss: issuer,
        aud: audience,
        sub: claims.userId,
        // `tid` rather than `tenant_id`: short, and it is what every consumer
        // of this token will index on.
        tid: claims.tenantId,
        amr: [...claims.amr],
        // Seconds since the epoch, per RFC 9068. `authenticatedAt` is an
        // instant in the domain because that is what a human reads in an audit
        // log; a token says it the way a verifier expects to read it.
        auth_time: Math.floor(Date.parse(claims.authenticatedAt) / 1000),
        // RFC 8693's actor claim. Present only during impersonation, so a
        // subgraph can refuse a write it would allow from the person
        // themselves, and absent rather than null so its presence is the signal.
        ...(claims.impersonatedBy === null ? {} : { act: { sub: claims.impersonatedBy } }),
        iat: Math.floor(now.getTime() / 1000),
      },
      expiresAt,
    );
  };
}
