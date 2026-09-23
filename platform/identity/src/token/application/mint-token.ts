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
   * Fifteen minutes.
   *
   * The access half of the pair: this is a bearer token that cannot be recalled
   * once handed out, and the session row behind it is the refresh credential —
   * deletable, capped at four devices, good for thirty days.
   *
   * It was two minutes, which bought a tighter revocation window at the cost of
   * re-minting on almost every navigation. Fifteen is the industry's answer to
   * the same trade and what this deployment asked for. **The cost is real and
   * worth stating: a revoked session keeps working for up to fifteen minutes**,
   * because nothing can reach a token already in somebody's hands. Anything
   * that must take effect immediately — a termination, a compromised device —
   * has to invalidate at the resource rather than rely on this expiring.
   */
  readonly lifetimeSeconds?: number;
}

/**
 * `entitlements`, when given, is the company's modules as the back office
 * recorded them (PEO-114), claimed as `ent` so a verifier can refuse a module
 * the company did not buy without asking anybody.
 */
export type MintToken = (
  claims: PrincipalClaims,
  context?: { readonly entitlements?: readonly string[] },
) => Promise<string>;

export function mintToken({
  signer,
  clock,
  issuer,
  audience,
  lifetimeSeconds = 15 * 60,
}: MintTokenDeps): MintToken {
  return async (claims, context = {}) => {
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
        ...(context.entitlements === undefined ? {} : { ent: [...context.entitlements] }),
        iat: Math.floor(now.getTime() / 1000),
      },
      expiresAt,
    );
  };
}
