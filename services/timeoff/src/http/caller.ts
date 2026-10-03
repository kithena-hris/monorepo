import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import { presentsInternalToken, type HeaderCarrier } from '@kithena/auth-kit';
import { PersonId, TenantId } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Caller, UnitOfWork } from '../application/ports.js';

/**
 * Who is calling, for every transport, from the request: People's rule
 * (`services/people/src/http/caller.ts`), in Time Off's own copy because a
 * module does not import another.
 *
 * The router verifies the user's token and forwards its claims as
 * `x-kithena-principal`; they are trusted only beside `x-internal-token`,
 * which proves the router sent the request. Entitlement is checked here and
 * nowhere later: a tenant that did not buy Time Off gets nothing from any
 * transport.
 *
 * `personId` is the member the account signs in as. Identity's token does not
 * carry one, and the router forwards none, so `withMember` finds it in the
 * projection. A forwarded one is still honoured, beside the internal token.
 *
 * A support session (`impersonatedBy`) or an administrator viewing as an
 * employee (`viewedBy`) is refused: People makes the first an administrator
 * and the second read-only, and Time Off has neither rule yet. Closed rather
 * than treating either as the employee, who may approve and request.
 */

const Forwarded = z.object({
  userId: z.uuid(),
  tenantId: TenantId,
  personId: PersonId.nullable().optional(),
  entitlements: z.array(z.string()).default([]),
  impersonatedBy: z.uuid().nullable().optional(),
  viewedBy: z.uuid().nullable().optional(),
});

export type CallerFrom = (request: HeaderCarrier) => Result<Caller> | Promise<Result<Caller>>;

export function callerFromHeaders(internalToken: string): CallerFrom {
  return (request) => {
    if (!presentsInternalToken(request, internalToken)) {
      return err(failure('UNAUTHENTICATED', 'This service is reached through the router'));
    }
    const raw = request.headers['x-kithena-principal'];
    let parsed: z.ZodSafeParseResult<z.infer<typeof Forwarded>>;
    try {
      parsed = Forwarded.safeParse(typeof raw === 'string' ? JSON.parse(raw) : null);
    } catch {
      return err(failure('UNAUTHENTICATED', 'The forwarded principal is not JSON'));
    }
    if (!parsed.success) return err(failure('UNAUTHENTICATED', 'No principal was forwarded'));
    if ((parsed.data.impersonatedBy ?? parsed.data.viewedBy ?? null) !== null) {
      return err(failure('FORBIDDEN', 'Time Off cannot be used in a support or view-as session'));
    }
    if (!parsed.data.entitlements.includes('module.timeoff')) {
      return err(failure('NOT_ENTITLED', 'This workspace does not include Time Off'));
    }
    const correlation = request.headers['x-correlation-id'];
    return ok({
      tenantId: parsed.data.tenantId,
      accountId: parsed.data.userId,
      personId: parsed.data.personId ?? null,
      correlationId:
        typeof correlation === 'string' && z.uuid().safeParse(correlation).success
          ? correlation
          : randomUUID(),
    });
  };
}

/**
 * The member the caller's account signs in as, from Time Off's own
 * projection (TOF-050a): People's `hired` and `identity_linked` put the
 * account on the member, and an import may. Once per request, for every
 * transport, the way People resolves a caller's roles (`withTenantRoles`).
 *
 * Nobody, when no member holds the account or more than one does: the caller
 * is then an account and nothing more — HR's shape, refused on every screen
 * that is somebody's own.
 */
export function withMember(callerFrom: CallerFrom, uow: UnitOfWork): CallerFrom {
  return async (request) => {
    const asking = await callerFrom(request);
    if (!asking.ok || asking.value.personId !== null) return asking;
    const { tenantId, accountId } = asking.value;
    const member = await uow.run(tenantId, (tx) => tx.members.byAccount(accountId));
    return ok({ ...asking.value, personId: member?.personId ?? null });
  };
}
