import { sql } from 'drizzle-orm';

import type { PhotoStore, StoredPhoto } from '../application/screens/photo.js';

/**
 * People's photos, over `people.person_photo`
 * (`migrations/20260927160000_people_person_photo.sql`). Every method runs in
 * the caller's tenant transaction, under row-level security.
 */
export function drizzlePhotos(): PhotoStore {
  return {
    async get(tx, tenantId, personId) {
      const rows = await tx.execute<{ media_type: string; bytes: Buffer; checksum: string }>(sql`
        SELECT media_type, bytes, checksum FROM people.person_photo
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid`);
      const row = [...rows][0];
      return row === undefined
        ? null
        : {
            mediaType: row.media_type as StoredPhoto['mediaType'],
            bytes: new Uint8Array(row.bytes),
            checksum: row.checksum,
          };
    },

    async versions(tx, tenantId, personIds) {
      if (personIds.length === 0) return new Map();
      const rows = await tx.execute<{ person_id: string; checksum: string }>(sql`
        SELECT person_id, checksum FROM people.person_photo
         WHERE tenant_id = ${tenantId}::uuid
           AND person_id = ANY(${`{${personIds.join(',')}}`}::uuid[])`);
      return new Map([...rows].map((r) => [r.person_id, r.checksum]));
    },

    async put(tx, photo) {
      await tx.execute(sql`
        INSERT INTO people.person_photo
          (tenant_id, person_id, media_type, bytes, checksum, updated_at, updated_by)
        VALUES (${photo.tenantId}::uuid, ${photo.personId}::uuid, ${photo.mediaType},
                ${Buffer.from(photo.bytes)}, ${photo.checksum}, ${photo.updatedAt}::timestamptz,
                ${photo.updatedBy}::uuid)
        ON CONFLICT (tenant_id, person_id) DO UPDATE
           SET media_type = excluded.media_type, bytes = excluded.bytes,
               checksum = excluded.checksum, updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`);
    },

    async remove(tx, tenantId, personId) {
      await tx.execute(sql`
        DELETE FROM people.person_photo
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid`);
    },
  };
}

/** The same, in memory: for the unit tests and a module booted with no database. */
export function inMemoryPhotos(): PhotoStore & {
  readonly rows: Map<string, StoredPhoto & { readonly updatedBy: string }>;
} {
  const rows = new Map<string, StoredPhoto & { readonly updatedBy: string }>();
  return {
    rows,
    get: (_tx, _tenant, personId) => Promise.resolve(rows.get(personId) ?? null),
    versions: (_tx, _tenant, ids) =>
      Promise.resolve(
        new Map(ids.flatMap((id) => {
          const row = rows.get(id);
          return row === undefined ? [] : [[id, row.checksum] as const];
        })),
      ),
    put(_tx, photo) {
      rows.set(photo.personId, photo);
      return Promise.resolve();
    },
    remove(_tx, _tenant, personId) {
      rows.delete(personId);
      return Promise.resolve();
    },
  };
}
