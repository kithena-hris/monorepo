import * as z from 'zod';
import { presentsInternalToken, type HeaderCarrier } from '@kithena/auth-kit';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Reader } from '../application/read.js';

/**
 * Who is asking, from the router.
 *
 * The router verifies identity's token and forwards its claims as
 * `x-kithena-principal`; they are trusted only beside `x-internal-token`, which
 * proves the router sent the request — People's rule (`services/people/src/
 * http/caller.ts`), with this service's own secret. `impersonatedBy` is the
 * operator behind a Kithena support session, from the token's `act.sub`.
 */

const Principal = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  impersonatedBy: z.uuid().nullable().optional(),
});

export function readerFrom(request: HeaderCarrier, internalToken: string): Result<Reader> {
  if (!presentsInternalToken(request, internalToken)) {
    return err(failure('UNAUTHENTICATED', 'This service is reached through the router'));
  }
  const raw = request.headers['x-kithena-principal'];
  let parsed: z.ZodSafeParseResult<z.infer<typeof Principal>>;
  try {
    parsed = Principal.safeParse(typeof raw === 'string' ? JSON.parse(raw) : null);
  } catch {
    return err(failure('UNAUTHENTICATED', 'The forwarded principal is not JSON'));
  }
  if (!parsed.success) return err(failure('UNAUTHENTICATED', 'No principal was forwarded'));
  return ok({
    tenantId: parsed.data.tenantId,
    accountId: parsed.data.userId,
    supportOperator: parsed.data.impersonatedBy ?? null,
  });
}
