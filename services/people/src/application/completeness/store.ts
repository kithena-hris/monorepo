import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PendingEvent } from '@kithena/domain-kit';
import type { AttributeDefinition, CalendarDate } from '@kithena/contracts';

import type { Placement } from '../../domain/org/calendar.js';
import type { CompletenessState } from '../../domain/person/completeness.js';

/**
 * What the completeness recompute and the reminder sweep read and write.
 *
 * Every method takes the transaction, for the reason `unit-of-work.ts` gives:
 * `app.tenant_id` is transaction-scoped, and a store that opened its own would
 * be reading a connection with no tenant set.
 */
export interface CompletenessStore {
  /**
   * One published version's attributes and the date its preview evaluated
   * `requiredFrom` on, or null when there is no such version. `evaluatedOn` is
   * null for a version written before that was recorded.
   */
  versionAt(
    tx: PostgresJsDatabase,
    tenantId: string,
    version: number,
  ): Promise<{
    attributes: readonly AttributeDefinition[];
    evaluatedOn: CalendarDate | null;
    /** The instant the preview evaluated at; null for a version from before PEO-099. */
    evaluatedAt: string | null;
  } | null>;

  /**
   * Set the stored state for these people, and say whose actually changed.
   *
   * The returned set is what makes a redelivered `schema.published` harmless:
   * a record already marked incomplete by the first run is not changed by the
   * second, so it raises nothing twice.
   */
  setState(
    tx: PostgresJsDatabase,
    tenantId: string,
    state: CompletenessState,
    personIds: readonly string[],
  ): Promise<ReadonlySet<string>>;

  /** Replace each person's open gaps. Empty arrays close them without forgetting the last reminder. */
  saveGaps(
    tx: PostgresJsDatabase,
    tenantId: string,
    schemaVersion: number,
    gaps: readonly Gap[],
  ): Promise<void>;

  publish(tx: PostgresJsDatabase, events: readonly PendingEvent[]): Promise<void>;

  /**
   * Claim every reminder that is due at `now`, and mark it sent.
   *
   * Due means the person has an employee-owned gap, an address to send to, and
   * has not been emailed in the last 168 hours. Hours, not `interval '7 days'`: a day in Postgres
   * interval arithmetic follows the session time zone across a DST change and
   * is 23 or 25 hours long, which would let two emails through 167 hours apart.
   */
  claimReminders(
    tx: PostgresJsDatabase,
    tenantId: string,
    now: Date,
    /** Only these people, when given: the ones whose own clock says working hours. */
    only?: readonly string[],
  ): Promise<readonly Reminder[]>;

  /** Who `claimReminders` would claim at `now`, and where each sits. Claims nothing. */
  dueReminders(
    tx: PostgresJsDatabase,
    tenantId: string,
    now: Date,
  ): Promise<readonly { readonly personId: string; readonly placement: Placement }[]>;

  /**
   * HR's work, one row per missing key — the grid, never a task per person.
   *
   * Also one `confirm_termination` row: people on notice whose last working
   * day is before `today` (§8.1). Read off the record rather than stored, so
   * it closes when HR terminates or corrects the date forward, with nothing
   * to clear.
   */
  staffGrid(tx: PostgresJsDatabase, tenantId: string, today: string): Promise<readonly GridRow[]>;
}

export interface Gap {
  readonly personId: string;
  readonly employeeKeys: readonly string[];
  readonly staffKeys: readonly string[];
}

export interface Reminder {
  readonly personId: string;
  readonly workEmail: string;
  readonly keys: readonly string[];
}

export interface GridRow {
  /** `missing`: `key` has no value. `confirm_termination`: `key` is `last_working_day`, and it has passed. */
  readonly task: 'missing' | 'confirm_termination';
  readonly key: string;
  readonly personIds: readonly string[];
}
