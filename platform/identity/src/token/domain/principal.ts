/**
 * What a module is told about the person making a request.
 *
 * The shape is `Principal` from `@kithena/auth-kit`, which already exists and
 * already has the fields this needs — `authenticatedAt` for step-up freshness,
 * `amr` for the tenant's policy floor, `impersonatedBy` for support access.
 * Building it is pure, so what a token will claim can be asserted without
 * signing anything.
 *
 * `userId` is the **account** id, not the identity id and not a person id.
 *
 * The account is the tenant-scoped thing, which is what an authorization
 * decision is made against. The identity id is deliberately not here: it is the
 * one value that links a human across employers, and putting it in a token
 * every module can read would tell Acme's subgraph that this person also works
 * for Globex.
 */
export interface PrincipalClaims {
  readonly userId: string;
  readonly tenantId: string;
  readonly impersonatedBy: string | null;
  readonly authenticatedAt: string;
  readonly amr: readonly string[];
}

/**
 * What this slice needs to know about a session, and no more.
 *
 * Declared here rather than imported from the account slice, because
 * `no-cross-slice-imports` and `no-domain-importing-infrastructure` both
 * refused the import — correctly. A domain reaching sideways into another
 * slice's application layer is how two slices quietly become one.
 *
 * `CachedSession` satisfies this structurally, so a caller passes one straight
 * in with no mapping. The dependency runs the right way: the token slice states
 * what it requires, and the account slice happens to meet it.
 */
export interface AuthenticatedSession {
  readonly accountId: string;
  readonly tenantId: string;
  readonly authenticatedAt: string;
  readonly amr: readonly string[];
}

export interface ImpersonationContext {
  /** The support agent's account. Always logged, never silent. */
  readonly by: string;
}

export function principalFrom(
  session: AuthenticatedSession,
  impersonation: ImpersonationContext | null = null,
): PrincipalClaims {
  return {
    userId: session.accountId,
    tenantId: session.tenantId,
    impersonatedBy: impersonation?.by ?? null,
    authenticatedAt: session.authenticatedAt,
    amr: session.amr,
  };
}
