import { CalendarDate, LeaveTypeDefinition } from '@kithena/contracts';

import type { HolidayLayer } from '../domain/calendar/holiday-calendar.js';
import type { ParentalRules } from '../domain/parental/entitlement.js';

/**
 * A country pack (PRD §12.3): the statutory leave types, entitlements,
 * holiday layers and attendance limits a tenant in that country starts with.
 * Data, not code paths. Every pack ships `reviewed: false` until somebody who
 * knows that country's employment law signs it off, and is not enabled for a
 * tenant before then.
 */
export interface TimeOffCountryPack {
  readonly country: 'ES' | 'DE' | 'GB';
  readonly version: number;
  readonly reviewed: boolean;
  readonly leaveTypes: readonly LeaveTypeDefinition[];
  /** How much of a statutory type the law grants. Read by the policy fold and the request rules. */
  readonly entitlements: Readonly<
    Record<
      string,
      {
        readonly days: number;
        readonly counted: 'calendar' | 'working';
        readonly per: 'year' | 'event';
      }
    >
  >;
  readonly holidayLayers: readonly HolidayLayer[];
  /** Layers by work location, most general first (§10.2). */
  readonly calendars: Readonly<Record<string, readonly HolidayLayer[]>>;
  readonly attendance: { readonly minimumRestHours: number; readonly retentionYears: number };
  /**
   * The parental planner's rules (TOF-100), shaped by Spain's law: the same
   * weeks for each parent. `null` where the law gives each parent a different
   * leave (Germany's Mutterschutz, the UK's maternity and paternity leave);
   * the planner needs a per-role shape before it can plan those.
   */
  readonly parental: ParentalRules | null;
}

/** A statutory leave type, with its name in the country's language. */
export const statutoryType = (
  key: string,
  name: string,
  translations: Readonly<Record<string, string>>,
  rest: Pick<
    LeaveTypeDefinition,
    'category' | 'colorToken' | 'icon' | 'tracked' | 'paid' | 'visibility'
  > &
    Partial<Pick<LeaveTypeDefinition, 'requiresNote'>>,
): LeaveTypeDefinition =>
  LeaveTypeDefinition.parse({
    key,
    name: { default: name, translations },
    statutory: true,
    ...rest,
  });

export const holidayLayer = (
  key: string,
  name: string,
  level: HolidayLayer['level'],
  weekendRule: HolidayLayer['weekendRule'],
  holidays: readonly (readonly [string, string])[],
): HolidayLayer => ({
  key,
  name,
  level,
  weekendRule,
  holidays: holidays.map(([date, holiday]) => ({ date: CalendarDate.parse(date), name: holiday })),
});
