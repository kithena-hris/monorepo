import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** The Settings activity log's store: a leaf, as `photo-store.ts` is. */

type Tx = PostgresJsDatabase;

export type ActivityArea = 'fields' | 'organisation' | 'roles' | 'integrations';

export interface ActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly subject: string | null;
  /** What it did, in one plain sentence; null on entries from before it was kept. */
  readonly detail: string | null;
  readonly area: ActivityArea;
  /**
   * Kithena support's entries: the back-office operator who started the
   * session (`actor` is the company's support account), and the reason they
   * gave when the request carried it. Absent for everybody else.
   */
  readonly onBehalfOf?: string | null;
  readonly reason?: string | null;
}

export interface ActivityStore {
  /** One entry; the same command's retry (its Idempotency-Key) is not a second. */
  record(
    tx: Tx,
    tenantId: string,
    entry: ActivityEntry & { readonly idempotencyKey: string },
  ): Promise<void>;
  /** Newest first, `limit` after the entry `before` (its id), in `area` when given. */
  page(
    tx: Tx,
    tenantId: string,
    page: {
      readonly before: string | null;
      readonly limit: number;
      readonly area: ActivityArea | null;
    },
  ): Promise<readonly ActivityEntry[]>;
}

