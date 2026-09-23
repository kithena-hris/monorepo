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

export type CallerFrom = (request: HeaderCarrier) => Result<Asking>;

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
