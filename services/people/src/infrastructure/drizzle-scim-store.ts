import { sql } from 'drizzle-orm';
import { publish } from '@kithena/db-kit';

import type { ExternalSource } from '../domain/access/field-access.js';
import type { ScimConnection, ScimGroup, ScimLink, ScimStore } from '../application/scim/ports.js';
import { outbox } from './tables.js';

/**
 * `people.scim_*` (20260926160000_people_scim.sql), in the caller's tenant
 * transaction like every People store.
 */

type Row = Record<string, unknown>;

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const connectionOf = (r: Row): ScimConnection => ({
  id: String(r['id']),
  system: String(r['system']),
  tokenHash: String(r['token_hash']),
  previousTokenHash: textOrNull(r['previous_token_hash']),
  previousValidUntil: isoOrNull(r['previous_valid_until']),
  createdAt: iso(r['created_at']),
  tokenRotatedAt: isoOrNull(r['token_rotated_at']),
  revokedAt: isoOrNull(r['revoked_at']),
});

const linkOf = (r: Row): ScimLink => ({
  personId: String(r['person_id']),
  userName: String(r['user_name']),
  externalId: textOrNull(r['external_id']),
  active: r['active'] === true,
  createdAt: iso(r['created_at']),
  updatedAt: iso(r['updated_at']),
});

export function drizzleScimStore(): ScimStore {
  return {
    async connection(tx, tenantId, id) {
      const [row] = await tx.execute(sql`
        SELECT * FROM people.scim_connection WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      return row === undefined ? null : connectionOf(row);
    },

    async connections(tx, tenantId) {
      const rows = await tx.execute(sql`
        SELECT c.*, (SELECT count(*) FROM people.scim_link l
                      WHERE l.tenant_id = c.tenant_id AND l.connection_id = c.id)::int AS linked
          FROM people.scim_connection c
         WHERE c.tenant_id = ${tenantId}::uuid
         ORDER BY c.created_at, c.id`);
      return rows.map((r) => ({ ...connectionOf(r), linked: Number(r['linked']) }));
    },

    async createConnection(tx, tenantId, row) {
      await tx.execute(sql`
        INSERT INTO people.scim_connection (tenant_id, id, system, token_hash, created_at, created_by)
        VALUES (${tenantId}::uuid, ${row.id}::uuid, ${row.system}, ${row.tokenHash},
                ${row.createdAt}::timestamptz, ${row.createdBy}::uuid)`);
    },

    async rotate(tx, tenantId, id, token) {
      await tx.execute(sql`
        UPDATE people.scim_connection
           SET token_hash = ${token.hash}, previous_token_hash = ${token.previousHash},
               previous_valid_until = ${token.previousValidUntil}::timestamptz,
               token_rotated_at = ${token.rotatedAt}::timestamptz
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
    },

    async revoke(tx, tenantId, id, at) {
      await tx.execute(sql`
        DELETE FROM people.scim_mapping WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${id}::uuid`);
      await tx.execute(sql`
        UPDATE people.scim_connection
           SET revoked_at = ${at}::timestamptz, previous_token_hash = NULL, previous_valid_until = NULL
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
    },

    async lockMappings(tx, tenantId) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`people.scim_mapping:${tenantId}`}, 0))`,
      );
    },

    async mappings(tx, tenantId) {
      const rows = await tx.execute(sql`
        SELECT connection_id, scim_path, attribute_key FROM people.scim_mapping
         WHERE tenant_id = ${tenantId}::uuid ORDER BY connection_id, attribute_key`);
      return rows.map((r) => ({
        connectionId: String(r['connection_id']),
        path: String(r['scim_path']),
        key: String(r['attribute_key']),
      }));
    },

    async setMapping(tx, tenantId, connectionId, entries) {
      await tx.execute(sql`
        DELETE FROM people.scim_mapping
         WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${connectionId}::uuid`);
      for (const { path, key } of entries) {
        // eslint-disable-next-line no-await-in-loop -- a mapping is a few dozen rows at most
        await tx.execute(sql`
          INSERT INTO people.scim_mapping (tenant_id, connection_id, scim_path, attribute_key)
          VALUES (${tenantId}::uuid, ${connectionId}::uuid, ${path}, ${key})`);
      }
    },

    async sources(tx, tenantId, personId) {
      const rows = await tx.execute(sql`
        SELECT m.attribute_key, c.id, c.system
          FROM people.scim_link l
          JOIN people.scim_connection c ON c.tenant_id = l.tenant_id AND c.id = l.connection_id
          JOIN people.scim_mapping m ON m.tenant_id = l.tenant_id AND m.connection_id = l.connection_id
         WHERE l.tenant_id = ${tenantId}::uuid AND l.person_id = ${personId}::uuid
           AND c.revoked_at IS NULL`);
      return new Map<string, ExternalSource>(
        rows.map((r) => [String(r['attribute_key']), { connectionId: String(r['id']), system: String(r['system']) }]),
      );
    },

    async links(tx, tenantId, connectionId) {
      const rows = await tx.execute(sql`
        SELECT * FROM people.scim_link
         WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${connectionId}::uuid
         ORDER BY person_id`);
      return rows.map(linkOf);
    },

    async link(tx, tenantId, connectionId, personId) {
      const [row] = await tx.execute(sql`
        SELECT * FROM people.scim_link
         WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${connectionId}::uuid
           AND person_id = ${personId}::uuid`);
      return row === undefined ? null : linkOf(row);
    },

    async clash(tx, tenantId, connectionId, claim) {
      const rows = await tx.execute(sql`
        SELECT lower(user_name) = lower(${claim.userName}) AS user_name,
               external_id IS NOT DISTINCT FROM ${claim.externalId} AS external_id
          FROM people.scim_link
         WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${connectionId}::uuid
           AND (lower(user_name) = lower(${claim.userName})
                OR (${claim.externalId}::text IS NOT NULL AND external_id = ${claim.externalId}))
           AND person_id IS DISTINCT FROM ${claim.except}::uuid
         LIMIT 1`);
      const row = rows[0];
      if (row === undefined) return null;
      return row['user_name'] === true ? 'userName' : 'externalId';
    },

    async putLink(tx, tenantId, connectionId, link) {
      await tx.execute(sql`
        INSERT INTO people.scim_link
          (tenant_id, connection_id, person_id, user_name, external_id, active, created_at, updated_at)
        VALUES (${tenantId}::uuid, ${connectionId}::uuid, ${link.personId}::uuid, ${link.userName},
                ${link.externalId}, ${link.active}, ${link.createdAt}::timestamptz, ${link.updatedAt}::timestamptz)
        ON CONFLICT (tenant_id, connection_id, person_id) DO UPDATE
           SET user_name = EXCLUDED.user_name, external_id = EXCLUDED.external_id,
               active = EXCLUDED.active, updated_at = EXCLUDED.updated_at`);
    },

    async unlink(tx, tenantId, connectionId, personId) {
      await tx.execute(sql`
        DELETE FROM people.scim_group_member m
         USING people.scim_group g
         WHERE m.tenant_id = ${tenantId}::uuid AND m.person_id = ${personId}::uuid
           AND g.tenant_id = m.tenant_id AND g.id = m.group_id AND g.connection_id = ${connectionId}::uuid`);
      await tx.execute(sql`
        DELETE FROM people.scim_link
         WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${connectionId}::uuid
           AND person_id = ${personId}::uuid`);
    },

    async groups(tx, tenantId, connectionId) {
      const rows = await tx.execute(sql`
        SELECT g.*, coalesce(array_agg(m.person_id ORDER BY m.person_id)
                             FILTER (WHERE m.person_id IS NOT NULL), '{}') AS members
          FROM people.scim_group g
          LEFT JOIN people.scim_group_member m ON m.tenant_id = g.tenant_id AND m.group_id = g.id
         WHERE g.tenant_id = ${tenantId}::uuid AND g.connection_id = ${connectionId}::uuid
         GROUP BY g.tenant_id, g.id
         ORDER BY g.created_at, g.id`);
      return rows.map(
        (r): ScimGroup => ({
          id: String(r['id']),
          displayName: String(r['display_name']),
          externalId: textOrNull(r['external_id']),
          members: (r['members'] as unknown[]).map(String),
          createdAt: iso(r['created_at']),
          updatedAt: iso(r['updated_at']),
        }),
      );
    },

    async putGroup(tx, tenantId, connectionId, group) {
      await tx.execute(sql`
        INSERT INTO people.scim_group
          (tenant_id, id, connection_id, display_name, external_id, created_at, updated_at)
        VALUES (${tenantId}::uuid, ${group.id}::uuid, ${connectionId}::uuid, ${group.displayName},
                ${group.externalId}, ${group.createdAt}::timestamptz, ${group.updatedAt}::timestamptz)
        ON CONFLICT (tenant_id, id) DO UPDATE
           SET display_name = EXCLUDED.display_name, external_id = EXCLUDED.external_id,
               updated_at = EXCLUDED.updated_at`);
      await tx.execute(sql`
        DELETE FROM people.scim_group_member WHERE tenant_id = ${tenantId}::uuid AND group_id = ${group.id}::uuid`);
      for (const personId of group.members) {
        // eslint-disable-next-line no-await-in-loop -- one row per member
        await tx.execute(sql`
          INSERT INTO people.scim_group_member (tenant_id, group_id, person_id)
          VALUES (${tenantId}::uuid, ${group.id}::uuid, ${personId}::uuid)`);
      }
    },

    async deleteGroup(tx, tenantId, connectionId, id) {
      if (!/^[0-9a-f-]{36}$/u.test(id)) return false;
      const rows = await tx.execute(sql`
        DELETE FROM people.scim_group
         WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${connectionId}::uuid AND id = ${id}::uuid
        RETURNING id`);
      return rows.length > 0;
    },

    async publish(tx, events) {
      await publish(tx, outbox, events);
    },
  };
}
