import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AttributeDefinition } from '@kithena/contracts';

import { canWrite, visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import type { Candidate, SignalRow } from '../../domain/person/merge.js';
import { LIFECYCLE_KEYS } from './core.js';

/**
 * HR's review of suspected duplicates (PEO-074; PRD §12.4, §14.5): the port
 * the use cases in `PersonAccess` read and record through, and the two rules
 * they share with the comparison screen, so the screen offers exactly what a
 * merge would accept.
 */

type Tx = PostgresJsDatabase;

/** `drizzleDuplicates` satisfies this. */
export interface DuplicateStore {
  /** Pairs of live records sharing a blocking signal, at most `limit` rows. */
  signals(tx: Tx, tenantId: string, limit: number): Promise<readonly SignalRow[]>;
  /** Every pair a reviewer has decided, by `pairKey`. */
  decided(tx: Tx, tenantId: string): Promise<ReadonlySet<string>>;
  /** Append a decision. A repeated dismissal of the same pair is a no-op. */
  record(tx: Tx, tenantId: string, decision: DuplicateDecision): Promise<void>;
  /** Give up every unique claim a record holds: a tombstone claims nothing. */
  releaseClaims(tx: Tx, tenantId: string, personId: string): Promise<void>;
  /** How many live people name this one as their manager. */
  reports(tx: Tx, tenantId: string, personId: string): Promise<number>;
  /**
   * Unique attributes whose keyed hash both records hold under the same key:
   * "these match" for a sealed value, with nothing decrypted. Never a value.
   */
  sameClaims(tx: Tx, tenantId: string, a: string, b: string): Promise<readonly string[]>;
}

export interface DuplicateDecision {
  readonly id: string;
  readonly personIds: readonly [string, string];
  readonly decision: 'not_duplicate' | 'merged';
  readonly survivorId?: string;
  readonly absorbedId?: string;
  readonly attributesTaken?: readonly string[];
  readonly decidedBy: string;
  readonly decidedAt: string;
}

/**
 * Keys a merge never copies, whatever the reviewer may write: the lifecycle's
 * dates, the register's number, and where somebody sits and to whom they
 * report. Each moves through its own use case with its own events — a
 * transfer, a renumbering, a new reporting line — and a merge that did them
 * in passing would move payroll and authorization as a side effect.
 */
const NEVER_TAKEN: ReadonlySet<string> = new Set([
  ...LIFECYCLE_KEYS,
  'employee_number',
  'legal_entity_id',
  'location_id',
  'org_unit_id',
  'cost_centre',
  'manager_id',
]);

/**
 * What a reviewer may copy from the absorbed record onto the survivor: a live
 * attribute they may read on the absorbed record and write on the survivor,
 * never a sealed one (it would need its plaintext, and a merge reveals
 * nothing) and never one of `NEVER_TAKEN`.
 */
export function takeable(
  definitions: readonly AttributeDefinition[],
  onSurvivor: ViewerRelations,
  onAbsorbed: ViewerRelations,
): ReadonlySet<string> {
  return new Set(
    definitions
      .filter(
        (d) =>
          d.deprecatedAt === null &&
          !d.encrypted &&
          !NEVER_TAKEN.has(d.key) &&
          visibleTo(d, onAbsorbed) &&
          canWrite(d, onSurvivor).ok,
      )
      .map((d) => d.key),
  );
}

/** The attributes each signal is read from: shown only to a viewer who may read them all. */
const BASIS: Record<SignalRow['signal'], readonly string[]> = {
  work_email: ['work_email'],
  name_and_birth_date: ['given_name', 'family_name', 'date_of_birth'],
  unique_value: [],
};

/**
 * The candidates with only the signals this viewer may read on everybody:
 * "same work email" says the two emails are equal, which is a read of both.
 * A pair left with no signal is left out.
 */
export function shownTo(
  ranked: readonly Candidate[],
  definitions: readonly AttributeDefinition[],
  everyone: ViewerRelations,
): Candidate[] {
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  const readable = (key: string) => {
    const d = byKey.get(key);
    return d !== undefined && visibleTo(d, everyone);
  };
  return ranked.flatMap((c) => {
    const signals = c.signals.filter((s) =>
      [...BASIS[s.signal], ...(s.attributeKey === null ? [] : [s.attributeKey])].every(readable),
    );
    return signals.length === 0 ? [] : [{ ...c, signals }];
  });
}
