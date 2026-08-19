import * as z from 'zod';

export const EntitlementKey = z.string().brand<'EntitlementKey'>();
export type EntitlementKey = z.infer<typeof EntitlementKey>;

export const MeterKey = z.enum([
  'active_employees',
  'api_calls',
  'documents_stored_bytes',
  'workflow_runs',
]);
export type MeterKey = z.infer<typeof MeterKey>;

export const EntitlementLimits = z.object({
  seats: z.union([z.int().positive(), z.literal('unlimited')]),
  /** Warn, keep working. */
  softLimit: z.int().positive().nullable(),
  /** Block new writes. Never blocks reads: locking a company out of its own
   *  employee records over a billing dispute loses the account and may
   *  breach a data access obligation. */
  hardLimit: z.int().positive().nullable(),
});
export type EntitlementLimits = z.infer<typeof EntitlementLimits>;

export interface EntitlementService {
  has(tenantId: string, key: EntitlementKey): Promise<boolean>;
  limits(tenantId: string, key: EntitlementKey): Promise<EntitlementLimits>;
  record(tenantId: string, meter: MeterKey, quantity: number, at: Date): Promise<void>;
}
