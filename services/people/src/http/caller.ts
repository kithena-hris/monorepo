import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import { presentsInternalToken, type HeaderCarrier } from '@kithena/auth-kit';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Asking } from '../application/person/person-access.js';
import { effectiveRoles, SUPPORT_ROLES } from '../domain/access/roles.js';

/**
 * Who is calling, for every transport, from the request.
 *
 * The router verifies the user's token and forwards its claims; this process
 * trusts those claims only when the request also carries the internal token,
 * which proves the router — not the internet — sent it. The same mechanism
 * identity uses to reach messaging.
 *
 * Entitlement is checked here and nowhere later: a tenant that did not buy
 * People gets nothing from any transport, which is a different question from
 * whether a given person may see a given field.
 *
 * Roles are what the caller may *do*: a `people_admin` holds `hr` and
 * `finance` too (`effectiveRoles`, decided 2026-09-29), expanded here once so
 * every check of `viewer.roles` after this agrees.
 *
 * **Kithena support.** A principal with `impersonatedBy` — the router copies
 * it from the token's `act.sub`, which identity sets only on a support
 * session an operator started from the back office — is the company's
 * support agent: every tenant role, whatever the header or OpenFGA says, and
 * `viewer.support` naming the operator, so what it does is recorded as
 * theirs. `impersonationReason`, when forwarded, is the reason they gave.
 */

const Forwarded = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  roles: z.array(z.string()).default([]),
  entitlements: z.array(z.string()).default([]),
  impersonatedBy: z.uuid().nullable().optional(),
  impersonationReason: z.string().trim().max(500).nullable().optional(),
});

export type CallerFrom = (request: HeaderCarrier) => Result<Asking> | Promise<Result<Asking>>;

/**
 * The viewer's tenant roles from OpenFGA, in place of any the principal claimed
 * (PEO-092).
 *
 * With OpenFGA, roles are tuples and the forwarded principal carries none —
 * the router and the shell send `roles: []`. Every check that reads
 * `viewer.roles` (settings, legal entities, finance's full values) would then
 * refuse everybody, so the roles are resolved here, once per request, for
 * every transport. A role claimed in the header is ignored: OpenFGA is the
 * authority, and a header is not.
 */
export function withTenantRoles(
  callerFrom: CallerFrom,
  roles: (tenantId: string, accountId: string) => Promise<ReadonlySet<string>>,
): CallerFrom {
  return async (request) => {
    const asking = await callerFrom(request);
    // Support holds no tuple: its roles are its session's, set already.
    if (!asking.ok || asking.value.viewer.support !== undefined) return asking;
    const held = await roles(asking.value.tenantId, asking.value.viewer.accountId);
    return ok({ ...asking.value, viewer: { ...asking.value.viewer, roles: effectiveRoles(held) } });
  };
}

type Forwarded = z.infer<typeof Forwarded>;

/** The principal the router forwarded, if the router is the one that sent it. */
function forwardedFrom(request: HeaderCarrier, internalToken: string): Result<Forwarded> {
  if (!presentsInternalToken(request, internalToken)) {
    return err(failure('UNAUTHENTICATED', 'This service is reached through the router'));
  }
  const raw = request.headers['x-kithena-principal'];
  let parsed: z.ZodSafeParseResult<Forwarded>;
  try {
    parsed = Forwarded.safeParse(typeof raw === 'string' ? JSON.parse(raw) : null);
  } catch {
    return err(failure('UNAUTHENTICATED', 'The forwarded principal is not JSON'));
  }
  if (!parsed.success) return err(failure('UNAUTHENTICATED', 'No principal was forwarded'));
  return ok(parsed.data);
}

function askingFrom(
  request: HeaderCarrier,
  principal: Forwarded,
  entitlements: readonly string[],
): Result<Asking> {
  if (!entitlements.includes('module.people')) {
    return err(failure('NOT_ENTITLED', 'This workspace does not include People'));
  }
  const correlation = request.headers['x-correlation-id'];
  const operator = principal.impersonatedBy ?? null;
  const reason = principal.impersonationReason ?? '';
  return ok({
    tenantId: principal.tenantId,
    viewer:
      operator === null
        ? { accountId: principal.userId, roles: effectiveRoles(principal.roles) }
        : {
            accountId: principal.userId,
            roles: SUPPORT_ROLES,
            support: { operatorId: operator, reason: reason === '' ? null : reason },
          },
    correlationId:
      typeof correlation === 'string' && z.uuid().safeParse(correlation).success
        ? correlation
        : randomUUID(),
  });
}

/** Entitled by the list the caller forwarded: standalone, and the tests. */
export function callerFromHeaders(
  internalToken: string,
): (request: HeaderCarrier) => Result<Asking> {
  return (request) => {
    const principal = forwardedFrom(request, internalToken);
    return principal.ok
      ? askingFrom(request, principal.value, principal.value.entitlements)
      : principal;
  };
}

/**
 * Entitled by what the back office recorded for the company (PEO-114), kept
 * from `identity.tenant.entitlements_changed`; the forwarded list only where
 * nothing is recorded — the company then has the deployment's list, which is
 * what the router and the tenant app forward. A recorded list always wins, so
 * a caller cannot forward its way into a module the company did not buy.
 */
export function callerWithEntitlements(
  internalToken: string,
  recorded: (tenantId: string) => Promise<readonly string[] | null>,
): CallerFrom {
  return async (request) => {
    const principal = forwardedFrom(request, internalToken);
    if (!principal.ok) return principal;
    const kept = await recorded(principal.value.tenantId);
    return askingFrom(request, principal.value, kept ?? principal.value.entitlements);
  };
}
