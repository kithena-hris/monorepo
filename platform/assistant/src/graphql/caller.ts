import * as z from 'zod';
import { presentsInternalToken, type HeaderCarrier } from '@kithena/auth-kit';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Who is asking, from the router (AST-035).
 *
 * The router verifies identity's token and forwards its claims as
 * `x-kithena-principal`; they are trusted only beside `x-internal-token`,
 * which proves the router sent the request — People's rule
 * (`services/people/src/http/caller.ts`), with this pair's own secret,
 * `ASSISTANT_API_TOKEN`. The audit service's copy, as a platform service.
 *
 * The session comes as the router built it — `impersonatedBy` for a support
 * session, `viewedBy` for a view-as — and is read here, never judged: every
 * module the question reaches decides what that session may see, as it does
 * on its own screens. The forwarded `entitlements` are not read: identity
 * says which modules a company has (assistant PRD §6.5).
 */

const Forwarded = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  impersonatedBy: z.uuid().nullable().optional(),
  viewedBy: z.uuid().nullable().optional(),
});

export interface Asking {
  readonly tenantId: string;
  readonly accountId: string;
  readonly impersonatedBy: string | null;
  readonly viewedBy: string | null;
}

export function askingFrom(request: HeaderCarrier, internalToken: string): Result<Asking> {
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
  return ok({
    tenantId: parsed.data.tenantId,
    accountId: parsed.data.userId,
    impersonatedBy: parsed.data.impersonatedBy ?? null,
    viewedBy: parsed.data.viewedBy ?? null,
  });
}
