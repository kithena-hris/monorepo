import * as z from 'zod';
import { CalendarDate, LegalEntityId, Money, PersonId, Instant } from './primitives.js';

/**
 * The payroll compatibility contract. You are not building payroll. You are
 * guaranteeing that a payroll engine can consume this without a migration.
 *
 * Three properties do the work: effective dating on every change, corrections
 * as explicit typed events carrying what they supersede, and immutable period
 * snapshots so a run is reproducible after the fact.
 */
export const PayrollChangeKind = z.discriminatedUnion('type', [
  z.object({ type: z.literal('compensation'), previous: Money.nullable(), current: Money }),
  z.object({ type: z.literal('employment'), status: z.string() }),
  z.object({
    type: z.literal('absence'),
    days: z.number(),
    paid: z.boolean(),
    statutory: z.boolean(),
  }),
  z.object({ type: z.literal('benefit'), benefitKey: z.string(), value: Money.nullable() }),
]);

export const PayrollRelevantChange = z.object({
  personId: PersonId,
  legalEntityId: LegalEntityId,
  effectiveFrom: CalendarDate,
  effectiveTo: CalendarDate.nullable(),
  change: PayrollChangeKind,
  /** Set when this corrects an earlier statement of the same fact. */
  supersedes: z.uuidv7().nullable(),
  isRetroactive: z.boolean(),
});
export type PayrollRelevantChange = z.infer<typeof PayrollRelevantChange>;

export const PayrollEmployeeSnapshot = z.object({
  personId: PersonId,
  employmentStatus: z.string(),
  baseSalary: Money.nullable(),
  absenceDays: z.number().nonnegative(),
  unpaidAbsenceDays: z.number().nonnegative(),
});

export const PayrollPeriodSnapshot = z.object({
  tenantId: z.uuid(),
  legalEntityId: LegalEntityId,
  period: z.object({ from: CalendarDate, to: CalendarDate }),
  generatedAt: Instant,
  employees: z.array(PayrollEmployeeSnapshot),
  /** Anything that arrived after this period closed. */
  retroactiveAdjustments: z.array(PayrollRelevantChange),
  /** Frozen inputs. If the checksum changes, the run was not reproducible. */
  checksum: z.string(),
});
export type PayrollPeriodSnapshot = z.infer<typeof PayrollPeriodSnapshot>;
