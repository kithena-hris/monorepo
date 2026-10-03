import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { ImportRun } from '../../domain/import/run.js';

/** Import runs' store: a leaf, as `activity-store.ts` is, so the screens and the run both read it. */

type Tx = PostgresJsDatabase;

/** A run as stored: the domain's state, and whose and which upload it is. */
export interface StoredRun extends ImportRun {
  readonly tenantId: string;
  readonly uploadId: string;
  readonly actorId: string;
  readonly name: string | null;
  /** When it was approved. */
  readonly createdAt: string;
  /** The file's checksum once the run has written its `people.import` row; null before. */
  readonly checksum: string | null;
}

/** `people.import_run` (`migrations/20261003120000_people_import_run.sql`). */
export interface RunStore {
  /** False when the company already has a run going: the partial unique index decides. */
  insert(tx: Tx, run: StoredRun): Promise<boolean>;
  /** With `lock`, the row is held until the transaction ends: one chunk at a time. */
  find(tx: Tx, tenantId: string, id: string, lock?: boolean): Promise<StoredRun | null>;
  save(tx: Tx, tenantId: string, run: ImportRun): Promise<void>;
  /** The company's queued or running run. */
  active(tx: Tx, tenantId: string): Promise<StoredRun | null>;
  /** This person's runs finished since `since`, newest first. */
  finished(tx: Tx, tenantId: string, actorId: string, since: string): Promise<readonly StoredRun[]>;
  /** Whether a file with this checksum has been imported already. */
  imported(tx: Tx, tenantId: string, checksum: string): Promise<boolean>;
}

/** What the bell says of a person's finished runs: two weeks of them. */
export interface ImportNotice {
  readonly id: string;
  readonly status: 'succeeded' | 'failed';
  readonly finishedAt: string;
  /** People created or updated. */
  readonly people: number;
  /** New fields it added. */
  readonly fields: number;
  readonly fileName: string | null;
}
