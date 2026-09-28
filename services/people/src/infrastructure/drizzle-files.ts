import { sql } from 'drizzle-orm';

import type { FileMediaType } from '../domain/person/file.js';
import type { FileStore, StoredFileInfo } from '../application/screens/file-store.js';

/**
 * Field files, over `people.person_file`
 * (`migrations/20260927180000_people_files.sql`), in the caller's tenant
 * transaction, under row-level security.
 */
export function drizzleFiles(): FileStore {
  type Row = {
    id: string;
    person_id: string;
    attribute_key: string;
    name: string;
    media_type: string;
    size: number | string;
  };
  const info = (r: Row): StoredFileInfo => ({
    id: r.id,
    personId: r.person_id,
    attributeKey: r.attribute_key,
    name: r.name,
    mediaType: r.media_type as FileMediaType,
    size: Number(r.size),
  });
  return {
    async put(tx, f) {
      await tx.execute(sql`
        INSERT INTO people.person_file
          (tenant_id, id, person_id, attribute_key, name, media_type, bytes, checksum,
           uploaded_at, uploaded_by)
        VALUES (${f.tenantId}::uuid, ${f.id}::uuid, ${f.personId}::uuid, ${f.attributeKey},
                ${f.name}, ${f.mediaType}, ${Buffer.from(f.bytes)}, ${f.checksum},
                ${f.uploadedAt}::timestamptz, ${f.uploadedBy}::uuid)`);
    },

    async get(tx, tenantId, id) {
      const rows = await tx.execute<Row & { bytes: Buffer; checksum: string }>(sql`
        SELECT id, person_id, attribute_key, name, media_type, octet_length(bytes) AS size,
               bytes, checksum
          FROM people.person_file
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const row = [...rows][0];
      return row === undefined
        ? null
        : { ...info(row), bytes: new Uint8Array(row.bytes), checksum: row.checksum };
    },

    async describe(tx, tenantId, ids) {
      const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      if (valid.length === 0) return new Map();
      const rows = await tx.execute<Row>(sql`
        SELECT id, person_id, attribute_key, name, media_type, octet_length(bytes) AS size
          FROM people.person_file
         WHERE tenant_id = ${tenantId}::uuid
           AND id = ANY(${`{${valid.join(',')}}`}::uuid[])`);
      return new Map([...rows].map((r) => [r.id, info(r)]));
    },
  };
}
