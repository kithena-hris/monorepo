import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * A Recruiting hire whose pre-start conditions are still open (Recruiting PRD
 * §21.3): "an open condition on the start date blocks the start and tells
 * HR". Held from `recruiting.candidate.hired` while any condition is open,
 * released by `recruiting.prehire.conditions_met` or the hire's cancellation.
 * The start job passes over anyone held (`Arrivals.due`); HR's Inbox names
 * them once their start date has come (`due` here).
 */
export interface StartHold {
  readonly applicationId: string;
  readonly personId: string;
  /** The kinds still open, by Recruiting's keys (`right_to_work`, `references`). */
  readonly conditions: readonly string[];
  readonly offerId: string | null;
}

export interface StartHolds {
  hold(tx: PostgresJsDatabase, tenantId: string, hold: StartHold): Promise<void>;
  /** Whether a hold was there to release. */
  release(tx: PostgresJsDatabase, tenantId: string, applicationId: string): Promise<boolean>;
  /** People held past their start date, earliest start first. */
  due(
    tx: PostgresJsDatabase,
    tenantId: string,
    onOrBefore: string,
    limit: number,
  ): Promise<readonly (StartHold & { readonly startsOn: string })[]>;
}
