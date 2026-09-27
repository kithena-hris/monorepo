import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { FileMediaType } from '../../domain/person/file.js';

/**
 * Where People keeps the files an `image` or `document_ref` field asks for
 * (`people.person_file`): a leaf of its own, as `photo-store.ts` is.
 */

type Tx = PostgresJsDatabase;

export interface StoredFileInfo {
  readonly id: string;
  readonly personId: string;
  /** The field it was uploaded for: its reader is whoever may read that field. */
  readonly attributeKey: string;
  readonly name: string;
  readonly mediaType: FileMediaType;
  readonly size: number;
}

export interface FileStore {
  put(
    tx: Tx,
    file: StoredFileInfo & {
      readonly tenantId: string;
      readonly bytes: Uint8Array;
      readonly checksum: string;
      readonly uploadedAt: string;
      readonly uploadedBy: string;
    },
  ): Promise<void>;
  get(
    tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<(StoredFileInfo & { readonly bytes: Uint8Array; readonly checksum: string }) | null>;
  /** What these files are, without their bytes; an id no row has is absent. */
  describe(
    tx: Tx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, StoredFileInfo>>;
}
