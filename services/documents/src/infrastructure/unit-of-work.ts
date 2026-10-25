import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { outboxTable, publish, withTenant } from '@kithena/db-kit';
import type {
  CalendarDate,
  DocumentId,
  DocumentKind,
  DocumentTypeKey,
  Instant,
  PersonId,
  TenantId,
} from '@kithena/contracts';
import { logger, onShutdown } from '@kithena/telemetry';

import type { Grant } from '../domain/access/access.js';
import type { Document, Version } from '../domain/document/document.js';
import type { DocumentType } from '../domain/type/document-type.js';
import type { Envelope } from '../domain/signature/envelope.js';
import type {
  AccessRequest,
  Activity,
  Campaign,
  DocRequest,
  LegalHold,
  Member,
  Section,
  Tx,
  UnitOfWork,
  ViewEntry,
} from '../application/ports.js';

/**
 * One tenant, one transaction, every store (DOC-016), over the tables of
 * `migrations/20261012120010_documents_core.sql`, in raw SQL as People's
 * file store is. Bound to the transaction whose `app.tenant_id` row-level
 * security reads; events go to `documents.outbox` on the same one.
 */

const outbox = outboxTable('documents');

/** An instant as the contracts spell it, whatever the session's zone. */
const iso = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const uuids = (ids: readonly string[]) => `{${ids.join(',')}}`;

type Row = Record<string, unknown>;
const rows = async (tx: PostgresJsDatabase, query: SQL): Promise<Row[]> => [
  ...(await tx.execute<Row>(query)),
];
const str = (v: unknown): string | null =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'bigint'
      ? String(v)
      : v instanceof Date
        ? v.toISOString()
        : null;

function memberOf(r: Row): Member {
  return {
    personId: r['person_id'] as PersonId,
    accountId: str(r['account_id']),
    displayName: String(r['display_name']),
    workEmail: str(r['work_email']),
    managerPersonId: str(r['manager_person_id']) as PersonId | null,
    teamKey: str(r['team_key']),
    teamName: str(r['team_name']),
    locationKey: str(r['location_key']),
    hireDate: str(r['hire_date']) as CalendarDate | null,
    terminationDate: str(r['termination_date']) as CalendarDate | null,
    status: String(r['status']),
  };
}

const MEMBER = sql`person_id, account_id, display_name, work_email, manager_person_id, team_key,
  team_name, location_key, hire_date::text AS hire_date, termination_date::text AS termination_date, status`;

const DOCUMENT = sql`d.id, d.title, d.type_key, d.owner_account, d.subject_person_id, d.level,
  d.confidential, d.confidential_by, d.current_version, d.expires_on::text AS expires_on,
  ${iso(sql`d.deleted_at`)} AS deleted_at, ${iso(sql`d.created_at`)} AS created_at,
  coalesce(t.kind, 'Personal') AS kind,
  (SELECT ${iso(sql`v.uploaded_at`)} FROM documents.version v
    WHERE v.tenant_id = d.tenant_id AND v.document_id = d.id AND v.n = d.current_version) AS version_at,
  coalesce((SELECT json_agg(json_build_object('kind', g.principal_kind, 'id', g.principal_id,
      'permission', g.permission, 'endsOn', g.ends_on))
    FROM documents.grant g WHERE g.tenant_id = d.tenant_id AND g.document_id = d.id), '[]') AS grants`;

const FROM_DOCUMENT = sql`FROM documents.document d
  LEFT JOIN documents.document_type t ON t.tenant_id = d.tenant_id AND t.key = d.type_key`;

function documentOf(r: Row): Document {
  const grants = (
    r['grants'] as { kind: string; id: string; permission: string; endsOn: string | null }[]
  ).map((g): Grant => ({
    grantee:
      g.kind === 'member'
        ? { kind: 'member', personId: g.id }
        : g.kind === 'team'
          ? { kind: 'team', teamKey: g.id }
          : { kind: 'everyone' },
    permission: g.permission as Grant['permission'],
    endsOn: g.endsOn as CalendarDate | null,
  }));
  return {
    id: r['id'] as DocumentId,
    title: String(r['title']),
    typeKey: str(r['type_key']) as DocumentTypeKey | null,
    kind: String(r['kind']) as DocumentKind,
    ownerAccount: String(r['owner_account']),
    subjectPersonId: str(r['subject_person_id']) as PersonId | null,
    level: r['level'] as Document['level'],
    confidential: Boolean(r['confidential']),
    confidentialBy: str(r['confidential_by']) as Document['confidentialBy'],
    grants,
    currentVersion: Number(r['current_version']),
    versionAt: (str(r['version_at']) ?? str(r['created_at'])) as Instant,
    expiresOn: str(r['expires_on']) as CalendarDate | null,
    deletedAt: str(r['deleted_at']) as Instant | null,
    createdAt: String(r['created_at']) as Instant,
  };
}

function versionOf(r: Row): Version {
  return {
    n: Number(r['n']),
    blobKey: String(r['blob_key']),
    fileName: String(r['file_name']),
    mediaType: String(r['media_type']),
    size: Number(r['size']),
    pages: r['pages'] === null ? null : Number(r['pages']),
    checksum: String(r['checksum']).trim(),
    note: str(r['note']),
    uploadedAt: String(r['uploaded_at']) as Instant,
    uploadedBy: String(r['uploaded_by']),
  };
}

const CAMPAIGN = sql`id, document_id, version, audience, due_on::text AS due_on, sent_by,
  ${iso(sql`created_at`)} AS created_at, ${iso(sql`closed_at`)} AS closed_at`;

function campaignOf(r: Row): Campaign {
  return {
    id: String(r['id']),
    documentId: r['document_id'] as DocumentId,
    version: Number(r['version']),
    audience: r['audience'] as Campaign['audience'],
    dueOn: str(r['due_on']) as CalendarDate | null,
    sentBy: String(r['sent_by']),
    createdAt: String(r['created_at']) as Instant,
    closedAt: str(r['closed_at']) as Instant | null,
  };
}

const VERSION = sql`n, blob_key, file_name, media_type, size, pages, checksum, note,
  ${iso(sql`uploaded_at`)} AS uploaded_at, uploaded_by`;

function storesIn(tx: PostgresJsDatabase, tenantId: TenantId): Tx {
  const T = sql`${tenantId}::uuid`;
  const docs = (where: SQL) =>
    rows(tx, sql`SELECT ${DOCUMENT} ${FROM_DOCUMENT} WHERE d.tenant_id = ${T} AND ${where}`).then(
      (list) => list.map(documentOf),
    );
  const section = (r: Row): Section => ({
    id: String(r['id']),
    kind: r['kind'] as Section['kind'],
    ownerAccount: str(r['owner_account']),
    name: String(r['name']),
  });
  const docRequest = (r: Row): DocRequest => ({
    id: String(r['id']),
    personId: r['person_id'] as PersonId,
    typeKey: r['type_key'] as DocumentTypeKey,
    dueOn: str(r['due_on']) as CalendarDate | null,
    message: String(r['message']),
    status: r['status'] as DocRequest['status'],
    createdBy: String(r['created_by']),
    createdAt: String(r['created_at']) as Instant,
    remindedAt: str(r['reminded_at']) as Instant | null,
    documentId: str(r['document_id']) as DocumentId | null,
  });
  const DOC_REQUEST = sql`id, person_id, type_key, due_on::text AS due_on, message, status, created_by,
    ${iso(sql`created_at`)} AS created_at, ${iso(sql`reminded_at`)} AS reminded_at, document_id`;
  const accessRequest = (r: Row): AccessRequest => ({
    id: String(r['id']),
    documentId: r['document_id'] as DocumentId,
    requesterAccount: String(r['requester_account']),
    reason: String(r['reason']),
    status: r['status'] as AccessRequest['status'],
    createdAt: String(r['created_at']) as Instant,
    decidedAt: str(r['decided_at']) as Instant | null,
    decidedBy: str(r['decided_by']),
  });
  const ACCESS_REQUEST = sql`id, document_id, requester_account, reason, status,
    ${iso(sql`created_at`)} AS created_at, ${iso(sql`decided_at`)} AS decided_at, decided_by`;
  const HOLD = sql`h.id, h.name, h.set_by, ${iso(sql`h.set_at`)} AS set_at, ${iso(sql`h.lifted_at`)} AS lifted_at,
    coalesce((SELECT array_agg(e.document_id::text) FROM documents.hold_entry e
      WHERE e.tenant_id = h.tenant_id AND e.hold_id = h.id), '{}') AS document_ids`;
  const hold = (r: Row): LegalHold => ({
    id: String(r['id']),
    name: String(r['name']),
    setBy: String(r['set_by']),
    setAt: String(r['set_at']) as Instant,
    liftedAt: str(r['lifted_at']) as Instant | null,
    documentIds: r['document_ids'] as DocumentId[],
  });

  return {
    tenantId,
    members: {
      async get(personId) {
        const [r] = await rows(
          tx,
          sql`SELECT ${MEMBER} FROM documents.member WHERE tenant_id = ${T} AND person_id = ${personId}::uuid`,
        );
        return r === undefined ? null : memberOf(r);
      },
      async byAccount(accountId) {
        const list = await rows(
          tx,
          sql`SELECT ${MEMBER} FROM documents.member WHERE tenant_id = ${T} AND account_id = ${accountId}::uuid LIMIT 2`,
        );
        return list.length === 1 && list[0] !== undefined ? memberOf(list[0]) : null;
      },
      list: async () =>
        (
          await rows(
            tx,
            sql`SELECT ${MEMBER} FROM documents.member WHERE tenant_id = ${T} ORDER BY display_name`,
          )
        ).map(memberOf),
      async upsert(m, eventId, effectiveFrom) {
        const written = await rows(
          tx,
          sql`INSERT INTO documents.member (tenant_id, person_id, account_id, display_name, work_email,
                manager_person_id, team_key, team_name, location_key, hire_date, termination_date, status,
                last_event_id, last_effective_from)
              VALUES (${T}, ${m.personId}::uuid, ${m.accountId}::uuid, ${m.displayName}, ${m.workEmail},
                ${m.managerPersonId}::uuid, ${m.teamKey}, ${m.teamName}, ${m.locationKey}, ${m.hireDate}::date,
                ${m.terminationDate}::date, ${m.status}, ${eventId}::uuid, ${effectiveFrom}::date)
              ON CONFLICT (tenant_id, person_id) DO UPDATE SET
                account_id = EXCLUDED.account_id, display_name = EXCLUDED.display_name,
                work_email = EXCLUDED.work_email, manager_person_id = EXCLUDED.manager_person_id,
                team_key = EXCLUDED.team_key, team_name = EXCLUDED.team_name,
                location_key = EXCLUDED.location_key, hire_date = EXCLUDED.hire_date,
                termination_date = EXCLUDED.termination_date, status = EXCLUDED.status,
                last_event_id = EXCLUDED.last_event_id, last_effective_from = EXCLUDED.last_effective_from
              WHERE (documents.member.last_effective_from, documents.member.last_event_id)
                  < (EXCLUDED.last_effective_from, EXCLUDED.last_event_id)
              RETURNING person_id`,
        );
        return written.length === 1;
      },
    },
    hr: {
      has: async (a) =>
        (
          await rows(
            tx,
            sql`SELECT 1 FROM documents.hr WHERE tenant_id = ${T} AND account_id::text = ${a}`,
          )
        ).length > 0,
      list: async () =>
        (await rows(tx, sql`SELECT account_id FROM documents.hr WHERE tenant_id = ${T}`)).map((r) =>
          String(r['account_id']),
        ),
      add: async (a) => {
        await tx.execute(
          sql`INSERT INTO documents.hr (tenant_id, account_id) VALUES (${T}, ${a}::uuid) ON CONFLICT DO NOTHING`,
        );
      },
      remove: async (a) => {
        await tx.execute(
          sql`DELETE FROM documents.hr WHERE tenant_id = ${T} AND account_id = ${a}::uuid`,
        );
      },
    },
    types: {
      list: async () =>
        (
          await rows(
            tx,
            sql`SELECT definition, archived FROM documents.document_type WHERE tenant_id = ${T} ORDER BY name`,
          )
        ).map((r) => ({ ...(r['definition'] as DocumentType), archived: Boolean(r['archived']) })),
      async get(key) {
        const [r] = await rows(
          tx,
          sql`SELECT definition, archived FROM documents.document_type WHERE tenant_id = ${T} AND key = ${key}`,
        );
        return r === undefined
          ? null
          : { ...(r['definition'] as DocumentType), archived: Boolean(r['archived']) };
      },
      async save(type, archived) {
        await tx.execute(sql`INSERT INTO documents.document_type (tenant_id, key, name, kind, definition, archived)
          VALUES (${T}, ${type.key}, ${type.name}, ${type.kind}, ${JSON.stringify(type)}::jsonb, ${archived})
          ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind,
            definition = EXCLUDED.definition, archived = EXCLUDED.archived`);
      },
    },
    documents: {
      async get(id) {
        if (!/^[0-9a-f-]{36}$/iu.test(id)) return null;
        return (await docs(sql`d.id = ${id}::uuid`))[0] ?? null;
      },
      async save(d) {
        await tx.execute(sql`INSERT INTO documents.document (tenant_id, id, title, type_key, owner_account,
            subject_person_id, level, confidential, confidential_by, current_version, expires_on, deleted_at,
            deleted_by, created_at)
          VALUES (${T}, ${d.id}::uuid, ${d.title}, ${d.typeKey}, ${d.ownerAccount}::uuid, ${d.subjectPersonId}::uuid,
            ${d.level}, ${d.confidential}, ${d.confidentialBy}, ${d.currentVersion}, ${d.expiresOn}::date,
            ${d.deletedAt}::timestamptz, NULL, ${d.createdAt}::timestamptz)
          ON CONFLICT (tenant_id, id) DO UPDATE SET title = EXCLUDED.title, level = EXCLUDED.level,
            confidential = EXCLUDED.confidential, confidential_by = EXCLUDED.confidential_by,
            current_version = EXCLUDED.current_version, expires_on = EXCLUDED.expires_on,
            deleted_at = EXCLUDED.deleted_at`);
        await tx.execute(
          sql`INSERT INTO documents.tenant (tenant_id) VALUES (${T}) ON CONFLICT DO NOTHING`,
        );
        await tx.execute(
          sql`DELETE FROM documents.grant WHERE tenant_id = ${T} AND document_id = ${d.id}::uuid`,
        );
        for (const g of d.grants) {
          const id =
            g.grantee.kind === 'member'
              ? g.grantee.personId
              : g.grantee.kind === 'team'
                ? g.grantee.teamKey
                : '*';
          // oxlint-disable-next-line no-await-in-loop -- one transaction, a document's grants
          await tx.execute(sql`INSERT INTO documents.grant (tenant_id, document_id, principal_kind, principal_id, permission, ends_on)
            VALUES (${T}, ${d.id}::uuid, ${g.grantee.kind}, ${id}, ${g.permission}, ${g.endsOn}::date)`);
        }
      },
      candidates: (v) =>
        docs(sql`(d.owner_account::text = ${v.accountId}
          OR (${v.personId}::uuid IS NOT NULL AND d.subject_person_id = ${v.personId}::uuid)
          OR (${v.hr} AND d.type_key IS NOT NULL)
          OR (t.definition->>'audience' = 'everyone' AND d.type_key IS NOT NULL)
          OR EXISTS (SELECT 1 FROM documents.grant g WHERE g.tenant_id = d.tenant_id AND g.document_id = d.id
            AND (g.principal_kind = 'everyone'
              OR (g.principal_kind = 'member' AND g.principal_id = ${v.personId ?? ''})
              OR (g.principal_kind = 'team' AND g.principal_id = ${v.teamKey ?? ''}))))`),
      filed: () => docs(sql`d.type_key IS NOT NULL`),
      about: (personId) => docs(sql`d.subject_person_id = ${personId}::uuid`),
    },
    versions: {
      list: async (id) =>
        (
          await rows(
            tx,
            sql`SELECT ${VERSION} FROM documents.version WHERE tenant_id = ${T} AND document_id = ${id}::uuid ORDER BY n`,
          )
        ).map(versionOf),
      async get(id, n) {
        const [r] = await rows(
          tx,
          sql`SELECT ${VERSION} FROM documents.version WHERE tenant_id = ${T} AND document_id = ${id}::uuid AND n = ${n}`,
        );
        return r === undefined ? null : versionOf(r);
      },
      async add(id, v) {
        await tx.execute(sql`INSERT INTO documents.version (tenant_id, document_id, n, blob_key, file_name, media_type,
            size, pages, checksum, note, uploaded_at, uploaded_by)
          VALUES (${T}, ${id}::uuid, ${v.n}, ${v.blobKey}, ${v.fileName}, ${v.mediaType}, ${v.size}, ${v.pages},
            ${v.checksum}, ${v.note}, ${v.uploadedAt}::timestamptz, ${v.uploadedBy}::uuid)`);
      },
    },
    sections: {
      visibleTo: async (account) =>
        (
          await rows(
            tx,
            sql`SELECT id, kind, owner_account, name FROM documents.section
          WHERE tenant_id = ${T} AND (kind = 'company' OR owner_account::text = ${account}) ORDER BY name`,
          )
        ).map(section),
      async get(id) {
        const [r] = await rows(
          tx,
          sql`SELECT id, kind, owner_account, name FROM documents.section WHERE tenant_id = ${T} AND id = ${id}::uuid`,
        );
        return r === undefined ? null : section(r);
      },
      async save(s) {
        await tx.execute(sql`INSERT INTO documents.section (tenant_id, id, kind, owner_account, name)
          VALUES (${T}, ${s.id}::uuid, ${s.kind}, ${s.ownerAccount}::uuid, ${s.name})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name`);
      },
      async remove(id) {
        await tx.execute(
          sql`DELETE FROM documents.section_entry WHERE tenant_id = ${T} AND section_id = ${id}::uuid`,
        );
        await tx.execute(
          sql`DELETE FROM documents.section WHERE tenant_id = ${T} AND id = ${id}::uuid`,
        );
      },
      entries: async (ids) =>
        ids.length === 0
          ? []
          : (
              await rows(
                tx,
                sql`SELECT section_id, document_id FROM documents.section_entry
              WHERE tenant_id = ${T} AND section_id = ANY(${uuids(ids)}::uuid[])`,
              )
            ).map((r) => ({
              sectionId: String(r['section_id']),
              documentId: r['document_id'] as DocumentId,
            })),
      add: async (sectionId, documentId) => {
        await tx.execute(sql`INSERT INTO documents.section_entry (tenant_id, section_id, document_id)
          VALUES (${T}, ${sectionId}::uuid, ${documentId}::uuid) ON CONFLICT DO NOTHING`);
      },
      removeEntry: async (sectionId, documentId) => {
        await tx.execute(sql`DELETE FROM documents.section_entry WHERE tenant_id = ${T}
          AND section_id = ${sectionId}::uuid AND document_id = ${documentId}::uuid`);
      },
    },
    views: {
      add: async (e: ViewEntry) => {
        await tx.execute(sql`INSERT INTO documents.view_log (tenant_id, id, document_id, account_id, action, device, at)
          VALUES (${T}, ${e.id}::uuid, ${e.documentId}::uuid, ${e.accountId}::uuid, ${e.action}, ${e.device}, ${e.at}::timestamptz)`);
      },
      list: async (id, limit) =>
        (
          await rows(
            tx,
            sql`SELECT id, document_id, account_id, action, device, ${iso(sql`at`)} AS at
          FROM documents.view_log WHERE tenant_id = ${T} AND document_id = ${id}::uuid ORDER BY at DESC LIMIT ${limit}`,
          )
        ).map((r) => ({
          id: String(r['id']),
          documentId: r['document_id'] as DocumentId,
          accountId: String(r['account_id']),
          action: r['action'] as ViewEntry['action'],
          device: str(r['device']),
          at: String(r['at']) as Instant,
        })),
    },
    accessRequests: {
      async get(id) {
        const [r] = await rows(
          tx,
          sql`SELECT ${ACCESS_REQUEST} FROM documents.access_request WHERE tenant_id = ${T} AND id = ${id}::uuid`,
        );
        return r === undefined ? null : accessRequest(r);
      },
      async save(a) {
        await tx.execute(sql`INSERT INTO documents.access_request (tenant_id, id, document_id, requester_account, reason,
            status, created_at, decided_at, decided_by)
          VALUES (${T}, ${a.id}::uuid, ${a.documentId}::uuid, ${a.requesterAccount}::uuid, ${a.reason}, ${a.status},
            ${a.createdAt}::timestamptz, ${a.decidedAt}::timestamptz, ${a.decidedBy}::uuid)
          ON CONFLICT (tenant_id, id) DO UPDATE SET status = EXCLUDED.status, decided_at = EXCLUDED.decided_at,
            decided_by = EXCLUDED.decided_by`);
      },
      open: async () =>
        (
          await rows(
            tx,
            sql`SELECT ${ACCESS_REQUEST} FROM documents.access_request WHERE tenant_id = ${T} AND status = 'open' ORDER BY created_at`,
          )
        ).map(accessRequest),
    },
    docRequests: {
      async get(id) {
        const [r] = await rows(
          tx,
          sql`SELECT ${DOC_REQUEST} FROM documents.doc_request WHERE tenant_id = ${T} AND id = ${id}::uuid`,
        );
        return r === undefined ? null : docRequest(r);
      },
      async save(d) {
        await tx.execute(sql`INSERT INTO documents.doc_request (tenant_id, id, person_id, type_key, due_on, message,
            status, created_by, created_at, reminded_at, document_id)
          VALUES (${T}, ${d.id}::uuid, ${d.personId}::uuid, ${d.typeKey}, ${d.dueOn}::date, ${d.message}, ${d.status},
            ${d.createdBy}::uuid, ${d.createdAt}::timestamptz, ${d.remindedAt}::timestamptz, ${d.documentId}::uuid)
          ON CONFLICT (tenant_id, id) DO UPDATE SET status = EXCLUDED.status, reminded_at = EXCLUDED.reminded_at,
            document_id = EXCLUDED.document_id`);
      },
      forPerson: async (p) =>
        (
          await rows(
            tx,
            sql`SELECT ${DOC_REQUEST} FROM documents.doc_request WHERE tenant_id = ${T} AND person_id = ${p}::uuid ORDER BY created_at`,
          )
        ).map(docRequest),
      open: async () =>
        (
          await rows(
            tx,
            sql`SELECT ${DOC_REQUEST} FROM documents.doc_request WHERE tenant_id = ${T} AND status = 'open' ORDER BY created_at`,
          )
        ).map(docRequest),
    },
    holds: {
      list: async () =>
        (
          await rows(
            tx,
            sql`SELECT ${HOLD} FROM documents.legal_hold h WHERE h.tenant_id = ${T} ORDER BY h.set_at`,
          )
        ).map(hold),
      async get(id) {
        const [r] = await rows(
          tx,
          sql`SELECT ${HOLD} FROM documents.legal_hold h WHERE h.tenant_id = ${T} AND h.id = ${id}::uuid`,
        );
        return r === undefined ? null : hold(r);
      },
      async save(h) {
        await tx.execute(sql`INSERT INTO documents.legal_hold (tenant_id, id, name, set_by, set_at, lifted_at)
          VALUES (${T}, ${h.id}::uuid, ${h.name}, ${h.setBy}::uuid, ${h.setAt}::timestamptz, ${h.liftedAt}::timestamptz)
          ON CONFLICT (tenant_id, id) DO UPDATE SET lifted_at = EXCLUDED.lifted_at`);
        await tx.execute(sql`INSERT INTO documents.hold_entry (tenant_id, hold_id, document_id)
          SELECT ${T}, ${h.id}::uuid, unnest(${uuids(h.documentIds)}::uuid[]) ON CONFLICT DO NOTHING`);
      },
      held: async () =>
        new Set(
          (
            await rows(
              tx,
              sql`SELECT DISTINCT e.document_id FROM documents.hold_entry e
            JOIN documents.legal_hold h ON h.tenant_id = e.tenant_id AND h.id = e.hold_id
            WHERE e.tenant_id = ${T} AND h.lifted_at IS NULL`,
            )
          ).map((r) => String(r['document_id'])),
        ),
    },
    activity: {
      add: async (a: Activity) => {
        await tx.execute(sql`INSERT INTO documents.activity (tenant_id, id, document_id, account_id, action, detail, at)
          VALUES (${T}, ${a.id}::uuid, ${a.documentId}::uuid,
            ${a.accountId !== null && /^[0-9a-f-]{36}$/iu.test(a.accountId) ? a.accountId : null}::uuid,
            ${a.action}, ${JSON.stringify(a.detail)}::jsonb, ${a.at}::timestamptz)`);
      },
      list: async ({ documentId, limit }) =>
        (
          await rows(
            tx,
            sql`SELECT id, document_id, account_id, action, detail, ${iso(sql`at`)} AS at
          FROM documents.activity WHERE tenant_id = ${T}
          ${documentId === undefined ? sql`` : sql`AND document_id = ${documentId}::uuid`}
          ORDER BY at DESC LIMIT ${limit}`,
          )
        ).map((r) => ({
          id: String(r['id']),
          documentId: str(r['document_id']) as DocumentId | null,
          accountId: str(r['account_id']),
          action: String(r['action']),
          detail: r['detail'] as Record<string, unknown>,
          at: String(r['at']) as Instant,
        })),
    },
    envelopes: {
      async get(id) {
        if (!/^[0-9a-f-]{36}$/iu.test(id)) return null;
        const [r] = await rows(
          tx,
          sql`SELECT body FROM documents.envelope WHERE tenant_id = ${T} AND id = ${id}::uuid`,
        );
        return r === undefined ? null : (r['body'] as Envelope);
      },
      async save(e) {
        await tx.execute(sql`INSERT INTO documents.envelope (tenant_id, id, document_id, version, sender_account, status,
            body, due_on, created_at, completed_at)
          VALUES (${T}, ${e.id}::uuid, ${e.documentId}::uuid, ${e.version}, ${e.senderAccount}::uuid, ${e.status},
            ${JSON.stringify(e)}::jsonb, ${e.dueOn}::date, ${e.createdAt}::timestamptz, ${e.completedAt}::timestamptz)
          ON CONFLICT (tenant_id, id) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body,
            completed_at = EXCLUDED.completed_at`);
        await tx.execute(
          sql`DELETE FROM documents.envelope_signer WHERE tenant_id = ${T} AND envelope_id = ${e.id}::uuid`,
        );
        for (const sg of e.signers) {
          // oxlint-disable-next-line no-await-in-loop -- one transaction, an envelope's signers
          await tx.execute(sql`INSERT INTO documents.envelope_signer (tenant_id, envelope_id, signer_id, person_id, token_hash, status)
            VALUES (${T}, ${e.id}::uuid, ${sg.id}, ${sg.personId}::uuid, ${sg.tokenHash}, ${sg.status})`);
        }
      },
      forDocument: async (id) =>
        (
          await rows(
            tx,
            sql`SELECT body FROM documents.envelope WHERE tenant_id = ${T} AND document_id = ${id}::uuid ORDER BY created_at DESC`,
          )
        ).map((r) => r['body'] as Envelope),
      async latestFor(ids) {
        if (ids.length === 0) return new Map();
        const found = await rows(
          tx,
          sql`SELECT DISTINCT ON (document_id) document_id::text AS d, body FROM documents.envelope
            WHERE tenant_id = ${T} AND document_id = ANY(${`{${ids.join(',')}}`}::uuid[])
            ORDER BY document_id, created_at DESC`,
        );
        return new Map(found.map((r) => [String(r['d']), r['body'] as Envelope]));
      },
      forPerson: async (p) =>
        (
          await rows(
            tx,
            sql`SELECT e.body FROM documents.envelope e WHERE e.tenant_id = ${T} AND EXISTS (
            SELECT 1 FROM documents.envelope_signer s WHERE s.tenant_id = e.tenant_id AND s.envelope_id = e.id
              AND s.person_id = ${p}::uuid) ORDER BY e.created_at DESC`,
          )
        ).map((r) => r['body'] as Envelope),
      signedByEmail: async (email) =>
        (
          await rows(
            tx,
            sql`SELECT body FROM documents.envelope WHERE tenant_id = ${T} AND status = 'completed'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(body->'signers') s
                WHERE lower(s->>'email') = lower(${email}))
              ORDER BY created_at DESC`,
          )
        ).map((r) => r['body'] as Envelope),
      async byToken(hash) {
        const [r] = await rows(
          tx,
          sql`SELECT e.body, s.signer_id FROM documents.envelope_signer s
          JOIN documents.envelope e ON e.tenant_id = s.tenant_id AND e.id = s.envelope_id
          WHERE s.tenant_id = ${T} AND s.token_hash = ${hash}`,
        );
        return r === undefined
          ? null
          : { envelope: r['body'] as Envelope, signerId: String(r['signer_id']) };
      },
      open: async () =>
        (
          await rows(
            tx,
            sql`SELECT body FROM documents.envelope WHERE tenant_id = ${T} AND status = 'sent' ORDER BY created_at`,
          )
        ).map((r) => r['body'] as Envelope),
      trail: async (id) =>
        (
          await rows(
            tx,
            sql`SELECT id, envelope_id, signer_id, action, detail, ${iso(sql`at`)} AS at
          FROM documents.envelope_event WHERE tenant_id = ${T} AND envelope_id = ${id}::uuid ORDER BY at, id`,
          )
        ).map((r) => ({
          id: String(r['id']),
          envelopeId: String(r['envelope_id']),
          signerId: str(r['signer_id']),
          action: String(r['action']),
          detail: r['detail'] as Record<string, unknown>,
          at: String(r['at']) as Instant,
        })),
      record: async (ev) => {
        await tx.execute(sql`INSERT INTO documents.envelope_event (tenant_id, id, envelope_id, signer_id, action, detail, at)
          VALUES (${T}, ${ev.id}::uuid, ${ev.envelopeId}::uuid, ${ev.signerId}, ${ev.action}, ${JSON.stringify(ev.detail)}::jsonb, ${ev.at}::timestamptz)`);
      },
    },
    campaigns: {
      async get(id) {
        if (!/^[0-9a-f-]{36}$/iu.test(id)) return null;
        const [r] = await rows(
          tx,
          sql`SELECT ${CAMPAIGN} FROM documents.campaign WHERE tenant_id = ${T} AND id = ${id}::uuid`,
        );
        return r === undefined ? null : campaignOf(r);
      },
      async save(c) {
        await tx.execute(sql`INSERT INTO documents.campaign (tenant_id, id, document_id, version, audience, due_on, sent_by, created_at, closed_at)
          VALUES (${T}, ${c.id}::uuid, ${c.documentId}::uuid, ${c.version}, ${JSON.stringify(c.audience)}::jsonb, ${c.dueOn}::date,
            ${c.sentBy}::uuid, ${c.createdAt}::timestamptz, ${c.closedAt}::timestamptz)
          ON CONFLICT (tenant_id, id) DO UPDATE SET closed_at = EXCLUDED.closed_at, due_on = EXCLUDED.due_on`);
      },
      list: async () =>
        (
          await rows(
            tx,
            sql`SELECT ${CAMPAIGN} FROM documents.campaign WHERE tenant_id = ${T} ORDER BY created_at DESC`,
          )
        ).map(campaignOf),
      acknowledged: async (id) =>
        new Set(
          (
            await rows(
              tx,
              sql`SELECT person_id FROM documents.acknowledgement WHERE tenant_id = ${T} AND campaign_id = ${id}::uuid`,
            )
          ).map((r) => String(r['person_id'])),
        ),
      acknowledge: async (id, personId, at) => {
        await tx.execute(sql`INSERT INTO documents.acknowledgement (tenant_id, campaign_id, person_id, at)
          VALUES (${T}, ${id}::uuid, ${personId}::uuid, ${at}::timestamptz) ON CONFLICT DO NOTHING`);
      },
      mine: async (personId) =>
        new Set(
          (
            await rows(
              tx,
              sql`SELECT campaign_id FROM documents.acknowledgement WHERE tenant_id = ${T} AND person_id = ${personId}::uuid`,
            )
          ).map((r) => String(r['campaign_id'])),
        ),
    },
    settings: {
      async get(key) {
        const [r] = await rows(
          tx,
          sql`SELECT value FROM documents.settings WHERE tenant_id = ${T} AND key = ${key}`,
        );
        return r === undefined ? null : r['value'];
      },
      set: async (key, value) => {
        await tx.execute(sql`INSERT INTO documents.settings (tenant_id, key, value)
          VALUES (${T}, ${key}, ${JSON.stringify(value)}::jsonb)
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`);
      },
    },
    idempotency: {
      async find(key) {
        const [r] = await rows(
          tx,
          sql`SELECT request_hash, status, answer FROM documents.idempotency_key
          WHERE tenant_id = ${T} AND key = ${key}`,
        );
        return r === undefined
          ? null
          : {
              requestHash: String(r['request_hash']),
              status: Number(r['status']),
              answer: r['answer'],
            };
      },
      save: async (key, stored) =>
        (
          await rows(
            tx,
            sql`INSERT INTO documents.idempotency_key (tenant_id, key, request_hash, status, answer)
            VALUES (${T}, ${key}, ${stored.requestHash}, ${stored.status}, ${JSON.stringify(stored.answer)}::jsonb)
            ON CONFLICT DO NOTHING RETURNING key`,
          )
        ).length === 1,
    },
    outbox: { publish: (events) => publish(tx, outbox, events) },
  };
}

export function drizzleUnitOfWork(db: PostgresJsDatabase): UnitOfWork {
  return { run: (tenantId, fn) => withTenant(db, tenantId, (tx) => fn(storesIn(tx, tenantId))) };
}

/** Documents' pool, as `svc_documents`, closed on SIGTERM; null without a URL. */
export function documentsDatabase(env: NodeJS.ProcessEnv = process.env): PostgresJsDatabase | null {
  const url = env['DOCUMENTS_DATABASE_URL'];
  if (!url) {
    logger.info({ module: 'documents' }, 'DOCUMENTS_DATABASE_URL unset; no storage');
    return null;
  }
  const client = postgres(url, { max: 10 });
  onShutdown('documents database', () => client.end({ timeout: 5 }));
  return drizzle(client);
}

/** Every tenant with a document, for the nightly sweep. */
export async function tenantsWithDocuments(db: PostgresJsDatabase): Promise<TenantId[]> {
  const list = await db.execute<{ tenant_id: string }>(
    sql`SELECT tenant_id FROM documents.tenant ORDER BY tenant_id`,
  );
  return [...list].map((r) => r.tenant_id as TenantId);
}
