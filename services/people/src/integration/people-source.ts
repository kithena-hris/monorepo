import type { CalendarDate } from '@hris/contracts';

/**
 * The anti-corruption layer. Every provider translates into the canonical
 * People Graph vocabulary here, and no provider-specific field reaches a
 * module. When Workday renames something, exactly one adapter changes.
 *
 * Native mode is an implementation of this interface too. Downstream modules
 * cannot tell whether the source of record is yours or the customer's, which
 * is the entire anti-sticky proposition.
 */
export type PeopleCapability = 'employees' | 'org_units' | 'managers' | 'realtime' | 'write_back';

export interface SyncCursor {
  readonly value: string;
  readonly fetchedAt: string;
}

export interface ExternalEmployee {
  readonly externalId: string;
  readonly emails: readonly string[];
  readonly employment: {
    readonly start: CalendarDate;
    readonly end: CalendarDate | null;
    readonly status: string;
  };
  readonly managerExternalId: string | null;
  readonly orgUnitExternalId: string | null;
  /** Kept verbatim. You will need it when a sync produces something absurd. */
  readonly raw: unknown;
}

export interface PeopleSourceAdapter {
  readonly provider: string;
  readonly capabilities: ReadonlySet<PeopleCapability>;

  syncEmployees(cursor: SyncCursor | null): AsyncIterable<ExternalEmployee>;
  syncOrgUnits(cursor: SyncCursor | null): AsyncIterable<unknown>;
  resolveIdentity(externalId: string): Promise<{ personId: string } | null>;
  subscribe?(handler: (change: unknown) => Promise<void>): Promise<{ close(): void }>;
}

/**
 * Sync rules that prevent the classic disasters:
 *  - incremental with a cursor, plus a periodic full reconcile
 *  - conflict policy per field, per tenant; external wins in BYO mode
 *  - never hard-delete because an external system stopped returning a record.
 *    External systems lie during their own outages. Soft-delete, flag, ask.
 *  - circuit break per provider: sync failures degrade to stale data,
 *    never to a broken module
 */
export interface SyncPolicy {
  readonly conflictResolution: 'external_wins' | 'local_wins' | 'newest_wins';
  readonly reconcileIntervalHours: number;
  readonly onMissingRecord: 'soft_delete' | 'flag_for_review';
}
