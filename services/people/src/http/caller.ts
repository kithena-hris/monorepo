import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import { presentsInternalToken, type HeaderCarrier } from '@kithena/auth-kit';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Asking } from '../application/person/person-access.js';

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
 */

const Forwarded = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  roles: z.array(z.string()).default([]),
  entitlements: z.array(z.string()).default([]),
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
    if (!asking.ok) return asking;
    const held = await roles(asking.value.tenantId, asking.value.viewer.accountId);
    return ok({ ...asking.value, viewer: { ...asking.value.viewer, roles: held } });
  };
}

export function callerFromHeaders(
  internalToken: string,
): (request: HeaderCarrier) => Result<Asking> {
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
    if (!parsed.data.entitlements.includes('module.people')) {
      return err(failure('NOT_ENTITLED', 'This workspace does not include People'));
    }

    const correlation = request.headers['x-correlation-id'];
    return ok({
      tenantId: parsed.data.tenantId,
      viewer: { accountId: parsed.data.userId, roles: new Set(parsed.data.roles) },
      correlationId:
        typeof correlation === 'string' && z.uuid().safeParse(correlation).success
          ? correlation
          : randomUUID(),
    });
  };
}
