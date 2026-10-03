import * as z from 'zod';

import { CountryCode } from '../address.js';
import { asInternal, asPublic, policy } from '../classification.js';
import { keySchema, LocalizedString } from '../people/primitives.js';
import { EmploymentType } from '../people/requiredness.js';
import { LegalEntityId } from '../primitives.js';
import {
  LeaveCategory,
  LeaveTypeKey,
  LeaveUnit,
  LocationKey,
  NonNegativeDayAmount,
} from './primitives.js';

/**
 * Leave types and the policies attached to them (PRD §6.1, §6.2, §7.4).
 *
 * Configuration rather than personal data, so almost everything is
 * `asInternal` or `asPublic`. A rule is versioned and published (§6.3); these
 * shapes are what a version holds.
 */

/**
 * Who a leave type or a policy applies to.
 *
 * A **closed grammar**, the same shape as People's requiredness predicate and
 * for the same reason: every population an HR team actually names is a
 * country, a legal entity, an employment type or a location, and a predicate
 * language somebody can write loops in is a support incident. An operand
 * outside the enum fails to parse, so a mistake surfaces on the settings
 * screen rather than in the nightly entitlement fold.
 */
export const TimeOffPredicateOperand = z.enum([
  'country',
  'legalEntity',
  'employmentType',
  'location',
]);
export type TimeOffPredicateOperand = z.infer<typeof TimeOffPredicateOperand>;

const NONE = 'a clause with no values can never hold';

export const TimeOffPredicateClause = z.discriminatedUnion('operand', [
  z.object({ operand: z.literal('country'), in: z.array(CountryCode).min(1, NONE) }),
  z.object({ operand: z.literal('legalEntity'), in: z.array(LegalEntityId).min(1, NONE) }),
  z.object({ operand: z.literal('employmentType'), in: z.array(EmploymentType).min(1, NONE) }),
  z.object({ operand: z.literal('location'), in: z.array(LocationKey).min(1, NONE) }),
]);
export type TimeOffPredicateClause = z.infer<typeof TimeOffPredicateClause>;

/** `all` or `any` over a flat, bounded list. No nesting, for People's reasons. */
export const TimeOffPredicate = z
  .object({
    combine: z.enum(['all', 'any']).default('all'),
    clauses: z
      .array(TimeOffPredicateClause)
      .min(1, 'a predicate needs at least one clause')
      .max(10, 'a predicate is ten clauses at most'),
  })
  // Classified whole: the codegen walk does not descend into unions or arrays.
  .register(policy, asInternal());
export type TimeOffPredicate = z.infer<typeof TimeOffPredicate>;

/** `null` is everybody. */
const appliesTo = TimeOffPredicate.nullable().default(null);

/**
 * A day of the year with no year: when a leave year starts, when carried days
 * must be used by. Checked against a non-leap year, because a rule that only
 * exists one year in four is a rule that silently skips three.
 */
export const MonthDay = z
  .object({
    month: z.int().min(1).max(12).register(policy, asPublic()),
    day: z.int().min(1).max(31).register(policy, asPublic()),
  })
  .refine(
    ({ month, day }) => new Date(Date.UTC(2001, month - 1, day)).getUTCDate() === day,
    'no year has that day',
  );
export type MonthDay = z.infer<typeof MonthDay>;

/* ------------------------------------------------------------ leave type -- */

/** The chart series and the two neutral fills the calendar uses (PRD §6.1). */
export const LeaveColorToken = z
  .enum(['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'fg-3', 'fill-strong'])
  .register(policy, asPublic());

/** Lucide names from the design's set. */
export const LeaveIcon = z
  .enum(['sun', 'coffee', 'thermometer', 'baby', 'timer', 'circle-slash', 'plane', 'flag'])
  .register(policy, asPublic());

export const LeaveTypeDefinition = z.object({
  key: LeaveTypeKey,
  name: LocalizedString,
  category: LeaveCategory,
  colorToken: LeaveColorToken,
  icon: LeaveIcon,
  unit: LeaveUnit.default('day'),
  /** Whether it draws a balance. Sick does not. */
  tracked: z.boolean().register(policy, asPublic()),
  /** `statutory` is paid by a third party, such as Social Security. */
  paid: z.enum(['paid', 'unpaid', 'statutory']).register(policy, asPublic()),
  /** The approval rule (§9.1). `null` is the tenant's default rule. */
  approvalRuleKey: keySchema('approval rule').nullable().default(null).register(policy, asPublic()),
  /**
   * What teammates see. `off_only` shows "Off" and nothing else; the type and
   * the reason stay with the manager and HR (MT14). The domain refuses to
   * loosen it for sick and parental (TOF-012).
   */
  visibility: z.enum(['type', 'off_only']).register(policy, asPublic()),
  /** A note required once an absence runs past this many days. */
  requiresNote: z
    .object({ afterDays: z.int().min(1).register(policy, asPublic()) })
    .nullable()
    .default(null),
  appliesTo,
  /** Pre-filled by a country pack. Can be hidden, never deleted. */
  statutory: z.boolean().default(false).register(policy, asPublic()),
});
export type LeaveTypeDefinition = z.infer<typeof LeaveTypeDefinition>;

/* ---------------------------------------------------------------- policy -- */

/**
 * The yearly allowance by tenure band (T30: 0–2 years 25, 3–5 26, 6–9 27,
 * 10+ 28). A flat allowance is one band from year zero. Starting at zero and
 * climbing strictly is what lets the fold pick a band without a gap or a tie.
 */
export const TenureBands = z
  .array(
    z.object({
      fromYears: z.int().min(0).register(policy, asPublic()),
      days: NonNegativeDayAmount,
    }),
  )
  .min(1, 'an allowance needs at least one band')
  .refine((bands) => bands[0]?.fromYears === 0, 'the first band starts at year zero')
  .refine(
    (bands) => bands.every((band, i) => i === 0 || band.fromYears > (bands[i - 1]?.fromYears ?? 0)),
    'tenure bands climb, one start year each',
  )
  .register(policy, asInternal());

/** Going below zero (§7.4). `null` on the policy means it is not allowed. */
export const NegativeBalanceRule = z.object({
  /** How far. A limit is a distance below zero, never itself negative. */
  limit: NonNegativeDayAmount,
  approvers: z
    .enum(['manager', 'manager_then_hr', 'hr'])
    .default('manager_then_hr')
    .register(policy, asPublic()),
  atYearEnd: z
    .enum(['next_year', 'unpaid', 'write_off'])
    .default('next_year')
    .register(policy, asPublic()),
  onLeaving: z
    .enum(['final_pay', 'write_off', 'hr_decides'])
    .default('final_pay')
    .register(policy, asPublic()),
});
export type NegativeBalanceRule = z.infer<typeof NegativeBalanceRule>;

const flag = (value: boolean) => z.boolean().default(value).register(policy, asPublic());

export const PolicyDefinition = z.object({
  leaveTypeKey: LeaveTypeKey,
  allowance: TenureBands,
  /** When the leave year starts. 1 January by default. */
  year: MonthDay.default({ month: 1, day: 1 }),
  /** `monthly` credits allowance/12 on the 1st (25/12 = 2.08). */
  earning: z.enum(['upfront', 'monthly']).default('upfront').register(policy, asPublic()),
  /** Joiners and leavers, rounded up to the half day by the domain. */
  proRata: flag(true),
  /** Required by law in Spain, so on unless switched off. */
  keepEarningOnParental: flag(true),
  /** Can book after this many months, counted from day one. */
  probationMonths: z.int().min(0).max(24).default(0).register(policy, asPublic()),
  /** Up to `maxDays` carry into next year and must be used by `useBy`. */
  carryOver: z.object({ maxDays: NonNegativeDayAmount, useBy: MonthDay }).nullable().default(null),
  requests: z
    .object({
      halfDays: flag(true),
      showWhoIsOff: flag(true),
      /** Off by default: warn and let the manager decide. */
      blockBelowMinimum: flag(false),
    })
    .prefault({}),
  negativeBalance: NegativeBalanceRule.nullable().default(null),
  appliesTo,
});
export type PolicyDefinition = z.infer<typeof PolicyDefinition>;
