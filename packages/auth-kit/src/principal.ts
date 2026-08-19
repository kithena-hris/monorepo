import * as z from 'zod';

/** Verified token claims. Nothing downstream reads a raw JWT. */
export const Principal = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  /** Present only during an active, time-boxed, logged impersonation. */
  impersonatedBy: z.uuid().nullable().default(null),
  /** Step-up authentication timestamp. Sensitive reads check its freshness. */
  authenticatedAt: z.iso.datetime({ offset: true }),
  amr: z.array(z.string()).default([]),
});
export type Principal = z.infer<typeof Principal>;

export interface AuthorizationContext {
  readonly tenantId: string;
  readonly principal: Principal;
  readonly entitlements: ReadonlySet<string>;
}

/** Sensitive actions require recent authentication, not merely a valid session. */
export function requiresStepUp(p: Principal, maxAgeSeconds = 300): boolean {
  const age = (Date.now() - Date.parse(p.authenticatedAt)) / 1000;
  return age > maxAgeSeconds;
}
