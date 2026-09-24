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

  /** One person's stored state, or null when there is no such person. */
  stateOf(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
  ): Promise<CompletenessState | null>;

  /** Replace each person's open gaps. Empty arrays close them without forgetting the last reminder. */
  saveGaps(
    tx: PostgresJsDatabase,
    tenantId: string,
    schemaVersion: number,
    gaps: readonly Gap[],
  ): Promise<void>;

  publish(tx: PostgresJsDatabase, events: readonly PendingEvent[]): Promise<void>;

  /**
   * Claim the reminders among `only` that are still due at `now`, and mark
   * them sent.
   *
   * Due means the person has an employee-owned gap, an address to send to, and
   * was never reminded or was last reminded at or before `reminderDueBefore(now)`.
   * The condition is repeated under the row lock, so two sweeps racing for the
   * same person claim them once.
   */
  claimReminders(
    tx: PostgresJsDatabase,
    tenantId: string,
    now: Date,
    /** Only these people: the due ones whose own clock says working hours. */
    only: readonly string[],
  ): Promise<readonly Reminder[]>;

  /**
   * One page of who `claimReminders` would claim at `now`, and where each
   * sits, in person order after `page.after`. Claims nothing. Paged so one
   * transaction never reads a whole tenant.
   */
  dueReminders(
    tx: PostgresJsDatabase,
    tenantId: string,
    now: Date,
    page: { readonly after: string | null; readonly limit: number },
  ): Promise<readonly { readonly personId: string; readonly placement: Placement }[]>;

  /**
   * HR's work, one row per missing key — the grid, never a task per person.
   *
   * Also one `confirm_termination` row: people on notice whose last working
   * day is before `today` (§8.1). Read off the record rather than stored, so
   * it closes when HR terminates or corrects the date forward, with nothing
   * to clear.
   *
   * And one `unique_conflict` row per attribute where a key rotation found a
   * value two people hold (PEO-082), naming both. It closes when either of
   * them changes the value and the next rotation re-keys the claim.
   *
   * And one `identifier_review` row per attribute with a doubted national
   * identifier waiting for HR's decision (PEO-125), read off the pending
   * reviews, so a decision or a new value closes it with nothing to clear.
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
  /** When this reminder was claimed. Makes a resend of the same claim the same message. */
  readonly remindedAt: Date;
}

export interface GridRow {
  /**
   * `missing`: `key` has no value. `confirm_termination`: `key` is
   * `last_working_day`, and it has passed. `unique_conflict`: `key` is unique
   * and these people hold the same value. `identifier_review`: `key` is a
   * national identifier these people entered that our checks doubted, waiting
   * for HR's review (PEO-125).
   */
  readonly task: 'missing' | 'confirm_termination' | 'unique_conflict' | 'identifier_review';
  readonly key: string;
  readonly personIds: readonly string[];
}
