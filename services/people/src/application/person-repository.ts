import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { EmploymentPeriodRow, Person, PersonSnapshot } from '../domain/person/person.js';
import type { HistoryEntry } from '../domain/person/history.js';

/**
 * Loading and saving a person, and nothing else.
 *
 * Both methods take the transaction rather than opening one. The caller owns
 * it because the caller is what has to retry it — and because `app.tenant_id`
 * is set with `set_config(..., true)`, which is scoped to the transaction that
 * set it. A repository that opened its own would be reading a different
 * connection from the one the tenant was set on, and row-level security would
 * answer with an empty result and no explanation.
 */
export interface PersonRepository {
  load(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<PersonSnapshot | null>;

  /** The record for an identity account, which is how the provisioning consumer stays idempotent. */
  findByAccount(
    tx: PostgresJsDatabase,
    tenantId: string,
    identityAccountId: string,
  ): Promise<PersonSnapshot | null>;

  /**
   * Write a new record and drain its events into the outbox.
   *
   * Separate from `save` because a create writes a row that does not exist
   * yet, and because the two raise different events. Both drain; neither has a
   * path that does not.
   */
  create(tx: PostgresJsDatabase, person: Person, fields?: PersonFields): Promise<void>;

  /**
   * Persist the aggregate and drain its events into the outbox, in the
   * caller's transaction — which is what makes the write and its event atomic.
   *
   * There is no method here that writes without draining, and that is the
   * whole of "no dual writes": Debezium tails the WAL, so the event exists if
   * and only if the row committed.
   */
  save(
    tx: PostgresJsDatabase,
    person: Person,
    change?: { fields?: PersonFields; history?: readonly HistoryEntry[] },
  ): Promise<void>;

  /** Every employment period on a person, first first (PEO-110). */
  periods(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
  ): Promise<readonly EmploymentPeriodRow[]>;

  /** The dated facts for one person, for an `asOf` read or a correction. */
  history(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
    attributeKey?: string,
  ): Promise<readonly HistoryEntry[]>;
}

/**
 * The columns a write may set, beside the ones the state machine owns.
 *
 * `status`, `hireDate` and `lastWorkingDay` are deliberately absent: those are
 * the aggregate's, written from its own state, and a caller that could set
 * them directly is a caller that can put a record in a state no transition
 * allows.
 */
export interface PersonFields {
  readonly identityAccountId?: string | null;
  readonly employeeNumber?: string | null;
  readonly legalEntityId?: string | null;
  readonly givenName?: string | null;
  readonly familyName?: string | null;
  readonly preferredName?: string | null;
  readonly workEmail?: string | null;
  readonly seniorityDate?: string | null;
  readonly managerId?: string | null;
  readonly orgUnitId?: string | null;
  readonly locationId?: string | null;
  readonly employmentType?: string | null;
  readonly workModel?: string | null;
  readonly fte?: string | null;
  /** Minor units are transport; storage is exact, and a string keeps it that way. */
  readonly baseSalary?: string | null;
  readonly salaryCurrency?: string | null;
  readonly custom?: Record<string, unknown>;
  readonly schemaVersion?: number | null;
  readonly completeness?: 'complete' | 'incomplete' | 'not_applicable';
  readonly sourceOfRecord?: 'own' | 'external';
}
