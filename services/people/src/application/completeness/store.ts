import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PendingEvent } from '@kithena/domain-kit';
import type { AttributeDefinition, CalendarDate } from '@kithena/contracts';

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
   * Claim up to `limit` reminders that are due at `now`, and mark them sent.
   *
   * Due means the person has an employee-owned gap, an address to send to, and
   * was never reminded or was last reminded at or before `reminderDueBefore(now)`.
   * Bounded so one transaction never holds a whole tenant's rows; the sweep
   * claims batch after batch until one comes back short.
   */
  claimReminders(
    tx: PostgresJsDatabase,
    tenantId: string,
    now: Date,
    limit: number,
  ): Promise<readonly Reminder[]>;

  /** HR's gaps, one row per missing key — the grid, never a task per person. */
  staffGrid(tx: PostgresJsDatabase, tenantId: string): Promise<readonly GridRow[]>;
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
  /** When this reminder was claimed. Makes a resend of the same claim the same message. */
  readonly remindedAt: Date;
}

export interface GridRow {
  readonly key: string;
  readonly personIds: readonly string[];
}
