import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { PhotoMediaType } from '../../domain/person/photo.js';

/**
 * Where People keeps photos: a leaf of its own, so retention can erase one
 * without reaching the screens that show it.
 */

type Tx = PostgresJsDatabase;

export interface StoredPhoto {
  readonly tenantId?: string;
  readonly personId?: string;
  readonly mediaType: PhotoMediaType;
  readonly bytes: Uint8Array;
  /** SHA-256 of `bytes`, hex: the version a URL names. */
  readonly checksum: string;
}

export interface PhotoStore {
  get(tx: Tx, tenantId: string, personId: string): Promise<StoredPhoto | null>;
  /** Each of these people's photo version, in one read; somebody with none is absent. */
  versions(
    tx: Tx,
    tenantId: string,
    personIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  put(
    tx: Tx,
    photo: StoredPhoto & {
      readonly tenantId: string;
      readonly personId: string;
      readonly updatedAt: string;
      readonly updatedBy: string;
    },
  ): Promise<void>;
  remove(tx: Tx, tenantId: string, personId: string): Promise<void>;
}
