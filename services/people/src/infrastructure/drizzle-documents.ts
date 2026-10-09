import { sql } from 'drizzle-orm';

import type { DocumentState, DocumentStore, SentDocument } from '../application/inbox/documents.js';
import type { FileMediaType } from '../domain/person/file.js';

/**
 * Documents sent to somebody, over `people.document`
 * (`migrations/20261010110000_people_document.sql`), in the caller's tenant
 * transaction. The bytes are read only when the file itself is asked for.
 */

type Row = {
  id: string;
  person_id: string;
  name: string;
  media_type: FileMediaType;
  size: number;
  mode: SentDocument['mode'];
  message: string | null;
  due_on: string | null;
  sent_by: string;
  sent_at: string | Date;
  countersigner: string | null;
  state: DocumentState;
  signed_name: string | null;
  signed_how: 'typed' | 'drawn' | null;
  signature: string | null;
  signed_at: string | Date | null;
  signed_place: string | null;
  countersigned_by: string | null;
  countersigned_name: string | null;
  countersigned_at: string | Date | null;
  note: string | null;
  closed_at: string | Date | null;
};

const iso = (v: string | Date): string => new Date(v).toISOString();
const isoOrNull = (v: string | Date | null): string | null => (v === null ? null : iso(v));

const documentOf = (r: Row): SentDocument => ({
  id: r.id,
  personId: r.person_id,
  name: r.name,
  mediaType: r.media_type,
  size: r.size,
  mode: r.mode,
  message: r.message,
  dueOn: r.due_on,
  sentBy: r.sent_by,
  sentAt: iso(r.sent_at),
  countersigner: r.countersigner,
  state: r.state,
  signature:
    r.signed_at === null || r.signed_name === null || r.signed_how === null
      ? null
      : {
          name: r.signed_name,
          how: r.signed_how,
          mark: r.signature ?? r.signed_name,
          at: iso(r.signed_at),
          place: r.signed_place,
        },
  countersignedBy: r.countersigned_by,
  countersignedName: r.countersigned_name,
  countersignedAt: isoOrNull(r.countersigned_at),
  note: r.note,
  closedAt: isoOrNull(r.closed_at),
});

const COLUMNS = sql.raw(
  `id, person_id, name, media_type, octet_length(bytes) AS size, mode, message,
   due_on::text AS due_on, sent_by, sent_at, countersigner, state, signed_name, signed_how,
   signature, signed_at, signed_place, countersigned_by, countersigned_name, countersigned_at,
   note, closed_at`,
);

export function drizzleDocuments(): DocumentStore {
  return {
    async insert(tx, tenantId, d, file) {
      await tx.execute(sql`
        INSERT INTO people.document
          (tenant_id, id, person_id, name, media_type, bytes, checksum, mode, message, due_on,
           sent_by, sent_at, countersigner, state, closed_at)
        VALUES (${tenantId}::uuid, ${d.id}::uuid, ${d.personId}::uuid, ${d.name}, ${d.mediaType},
                ${Buffer.from(file.bytes)}, ${file.checksum}, ${d.mode}, ${d.message},
                ${d.dueOn}::date, ${d.sentBy}::uuid, ${d.sentAt}::timestamptz,
                ${d.countersigner}::uuid, ${d.state}, ${d.closedAt}::timestamptz)`);
    },

    async find(tx, tenantId, id) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.document
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const [row] = [...rows];
      return row === undefined ? null : documentOf(row);
    },

    async bytes(tx, tenantId, id) {
      const rows = await tx.execute<{ bytes: Buffer }>(sql`
        SELECT bytes FROM people.document WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const [row] = [...rows];
      return row === undefined ? null : new Uint8Array(row.bytes);
    },

    async forPerson(tx, tenantId, personId) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.document
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
         ORDER BY sent_at DESC`);
      return [...rows].map(documentOf);
    },

    async involving(tx, tenantId, accountId, since) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.document
         WHERE tenant_id = ${tenantId}::uuid
           AND (sent_by = ${accountId}::uuid OR countersigner = ${accountId}::uuid)
           AND (sent_at >= ${since}::timestamptz OR state IN ('open', 'signed'))
         ORDER BY sent_at DESC`);
      return [...rows].map(documentOf);
    },

    async openDueBy(tx, tenantId, personIds, day) {
      if (personIds.length === 0) return [];
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.document
         WHERE tenant_id = ${tenantId}::uuid AND state = 'open'
           AND person_id = ANY(${`{${personIds.join(',')}}`}::uuid[])
           AND due_on <= ${day}::date
         ORDER BY due_on`);
      return [...rows].map(documentOf);
    },

    async move(tx, tenantId, id, from, to) {
      const s = to.signature;
      const c = to.countersigned;
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.document
           SET state = ${to.state}, note = ${to.note},
               closed_at = COALESCE(closed_at, ${to.closedAt}::timestamptz)
               ${s === undefined ? sql`` : sql`, signed_name = ${s.name}, signed_how = ${s.how}, signature = ${s.mark}, signed_at = ${s.at}::timestamptz, signed_place = ${s.place}`}
               ${c === undefined ? sql`` : sql`, countersigned_by = ${c.by}::uuid, countersigned_name = ${c.name}, countersigned_at = ${c.at}::timestamptz`}
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND state = ${from}
        RETURNING id`);
      return [...rows].length === 1;
    },
  };
}
