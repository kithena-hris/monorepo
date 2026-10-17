import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { outboxTable, publish, withTenant } from '@kithena/db-kit';
import type { PersonId, TenantId } from '@kithena/contracts';
import { logger, onShutdown } from '@kithena/telemetry';

import type { AuditEntry, Member, Store, Tx, UnitOfWork, Where } from '../application/ports.js';
import { COLUMNS, STORES, type Kind } from './records.js';

/**
 * One tenant, one transaction, every store (PRF-036), over
 * `migrations/*_performance_core.sql`: the member projection, the audit log
 * and settings in tables of their own, every aggregate a row of
 * `performance.record`. Onboarding's raw-SQL shape.
 */

const outbox = outboxTable('performance');

type Row = Record<string, unknown>;
const rows = async (tx: PostgresJsDatabase, query: SQL): Promise<Row[]> => [
  ...(await tx.execute<Row>(query)),
];
const one = async (tx: PostgresJsDatabase, query: SQL): Promise<Row | null> =>
  (await rows(tx, query))[0] ?? null;
const J = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
const str = (v: unknown): string | null =>
  typeof v === 'string'
    ? v
    : v instanceof Date
      ? v.toISOString()
      : typeof v === 'number'
        ? String(v)
        : null;
const day = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : str(v);

function memberOf(r: Row): Member {
  return {
    personId: r['person_id'] as PersonId,
    accountId: str(r['account_id']),
    displayName: String(r['display_name']),
    workEmail: str(r['work_email']),
    managerPersonId: str(r['manager_person_id']) as PersonId | null,
    status: String(r['status']),
    title: str(r['title']),
    orgUnitId: str(r['org_unit_id']),
    locationId: str(r['location_id']),
    legalEntityId: str(r['legal_entity_id']),
    hiredOn: day(r['hired_on']) as Member['hiredOn'],
    probationEnd: day(r['probation_end']) as Member['probationEnd'],
  };
}

function store<T extends { readonly id: string }>(
  tx: PostgresJsDatabase,
  T: string,
  kind: Kind,
): Store<T> {
  const cols = COLUMNS[kind];
  const where = (w: Where | undefined): SQL => {
    const parts: SQL[] = [sql`kind = ${kind}`];
    if (w?.cycleId !== undefined) parts.push(sql`cycle_id = ${w.cycleId}`);
    if (w?.subjectId !== undefined) parts.push(sql`subject_id = ${w.subjectId}`);
    if (w?.ownerId !== undefined) parts.push(sql`owner_id = ${w.ownerId}`);
    if (w?.state !== undefined) parts.push(sql`state = ${w.state}`);
    if (w?.key !== undefined) parts.push(sql`key = ${w.key}`);
    return sql.join(parts, sql` AND `);
  };
  return {
    get: async (id) =>
      ((
        await one(tx, sql`SELECT body FROM performance.record WHERE kind = ${kind} AND id = ${id}`)
      )?.['body'] as T | undefined) ?? null,
    find: async (w) =>
      (
        await rows(
          tx,
          sql`SELECT body FROM performance.record WHERE ${where(w)} ORDER BY created_at, id`,
        )
      ).map((r) => r['body'] as T),
    save: async (value, expect) => {
      const c = cols(value);
      const written = await rows(
        tx,
        sql`INSERT INTO performance.record (tenant_id, kind, id, cycle_id, subject_id, owner_id, state, key, revision, body)
          VALUES (${T}, ${kind}, ${value.id}, ${c.cycleId}, ${c.subjectId}, ${c.ownerId}, ${c.state}, ${c.key}, ${c.revision}, ${J(value)})
          ON CONFLICT (tenant_id, kind, id) DO UPDATE SET cycle_id = EXCLUDED.cycle_id, subject_id = EXCLUDED.subject_id,
            owner_id = EXCLUDED.owner_id, state = EXCLUDED.state, key = EXCLUDED.key, revision = EXCLUDED.revision,
            body = EXCLUDED.body, updated_at = now()
          ${expect === undefined ? sql`` : sql`WHERE performance.record.revision = ${expect}`}
          RETURNING id`,
      );
      return written.length > 0;
    },
    remove: async (id) => {
      await tx.execute(sql`DELETE FROM performance.record WHERE kind = ${kind} AND id = ${id}`);
    },
  };
}

function auditOf(r: Row): AuditEntry {
  return {
    id: String(r['id']),
    at: str(r['at']) ?? '',
    actorPersonId: str(r['actor_person_id']),
    actorAccountId: String(r['actor_account_id']),
    as: String(r['acting_as']),
    action: String(r['action']),
    target: String(r['target']),
    targetId: str(r['target_id']),
    where: String(r['via']),
    outcome: r['outcome'] === 'refused' ? 'refused' : 'done',
    fields: (r['fields'] as string[] | null) ?? [],
    ai: r['ai'] === true,
  };
}

function storesIn(tx: PostgresJsDatabase, T: string): Tx {
  const stores = Object.fromEntries(
    Object.entries(STORES).map(([name, kind]) => [name, store(tx, T, kind)]),
  ) as unknown as Pick<Tx, keyof typeof STORES>;
  return {
    ...stores,
    members: {
      get: async (id) => {
        const r = await one(tx, sql`SELECT * FROM performance.member WHERE person_id = ${id}`);
        return r === null ? null : memberOf(r);
      },
      byAccount: async (account) => {
        const found = await rows(
          tx,
          sql`SELECT * FROM performance.member WHERE account_id = ${account} LIMIT 2`,
        );
        return found.length === 1 && found[0] !== undefined ? memberOf(found[0]) : null;
      },
      list: async () =>
        (await rows(tx, sql`SELECT * FROM performance.member ORDER BY display_name`)).map(memberOf),
      upsert: async (m, eventId) => {
        const written = await rows(
          tx,
          sql`INSERT INTO performance.member (tenant_id, person_id, account_id, display_name, work_email, manager_person_id, status, title, org_unit_id, location_id, legal_entity_id, hired_on, probation_end, last_event_id)
            VALUES (${T}, ${m.personId}, ${m.accountId}, ${m.displayName}, ${m.workEmail}, ${m.managerPersonId}, ${m.status}, ${m.title}, ${m.orgUnitId}, ${m.locationId}, ${m.legalEntityId}, ${m.hiredOn}, ${m.probationEnd}, ${eventId})
            ON CONFLICT (tenant_id, person_id) DO UPDATE SET account_id = EXCLUDED.account_id, display_name = EXCLUDED.display_name,
              work_email = EXCLUDED.work_email, manager_person_id = EXCLUDED.manager_person_id, status = EXCLUDED.status,
              title = EXCLUDED.title, org_unit_id = EXCLUDED.org_unit_id, location_id = EXCLUDED.location_id,
              legal_entity_id = EXCLUDED.legal_entity_id, hired_on = EXCLUDED.hired_on, probation_end = EXCLUDED.probation_end,
              last_event_id = EXCLUDED.last_event_id, updated_at = now()
            WHERE performance.member.last_event_id <> EXCLUDED.last_event_id
            RETURNING person_id`,
        );
        return written.length > 0;
      },
    },
    admins: {
      has: async (a) =>
        (await one(tx, sql`SELECT 1 AS ok FROM performance.admin WHERE account_id = ${a}`)) !==
        null,
      add: async (a) => {
        await tx.execute(
          sql`INSERT INTO performance.admin (tenant_id, account_id) VALUES (${T}, ${a}) ON CONFLICT DO NOTHING`,
        );
      },
      remove: async (a) => {
        await tx.execute(sql`DELETE FROM performance.admin WHERE account_id = ${a}`);
      },
    },
    audit: {
      record: async (e) => {
        await tx.execute(sql`INSERT INTO performance.audit (tenant_id, id, at, actor_person_id, actor_account_id, acting_as, action, target, target_id, via, outcome, fields, ai)
          VALUES (${T}, ${e.id}, ${e.at}, ${e.actorPersonId}, ${e.actorAccountId}, ${e.as}, ${e.action}, ${e.target}, ${e.targetId}, ${e.where}, ${e.outcome}, ${J(e.fields)}, ${e.ai})`);
      },
      list: async (f) => {
        const parts: SQL[] = [sql`true`];
        if (f.q !== undefined && f.q !== '')
          parts.push(
            sql`(action ILIKE ${`%${f.q}%`} OR target ILIKE ${`%${f.q}%`} OR acting_as ILIKE ${`%${f.q}%`})`,
          );
        if (f.refused === true) parts.push(sql`outcome = 'refused'`);
        if (f.ai === true) parts.push(sql`ai`);
        return (
          await rows(
            tx,
            sql`SELECT * FROM performance.audit WHERE ${sql.join(parts, sql` AND `)} ORDER BY at DESC LIMIT ${f.limit}`,
          )
        ).map(auditOf);
      },
    },
    settings: {
      get: async (key) =>
        (await one(tx, sql`SELECT value FROM performance.settings WHERE key = ${key}`))?.[
          'value'
        ] ?? null,
      set: async (key, value) => {
        await tx.execute(sql`INSERT INTO performance.settings (tenant_id, key, value) VALUES (${T}, ${key}, ${J(value)})
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
      },
    },
    idempotency: {
      get: async (key) => {
        const r = await one(
          tx,
          sql`SELECT request_hash, status, answer FROM performance.idempotency_key WHERE key = ${key}`,
        );
        return r === null
          ? null
          : {
              requestHash: String(r['request_hash']),
              status: Number(r['status']),
              answer: r['answer'],
            };
      },
      put: async (key, requestHash, status, answer) => {
        await tx.execute(sql`INSERT INTO performance.idempotency_key (tenant_id, key, request_hash, status, answer)
          VALUES (${T}, ${key}, ${requestHash}, ${status}, ${J(answer)})`);
      },
    },
    outbox: {
      publish: async (events) => {
        if (events.length > 0) await publish(tx, outbox, events);
      },
    },
  };
}

export function drizzleUnitOfWork(db: PostgresJsDatabase): UnitOfWork {
  return {
    run: (tenantId, fn) =>
      withTenant(db, tenantId, async (tx) => {
        await tx.execute(
          sql`INSERT INTO performance.tenant (tenant_id) VALUES (${tenantId}) ON CONFLICT DO NOTHING`,
        );
        return fn(storesIn(tx, tenantId));
      }),
    tenants: async () =>
      (await rows(db, sql`SELECT tenant_id FROM performance.tenant ORDER BY tenant_id`)).map(
        (r) => r['tenant_id'] as TenantId,
      ),
  };
}

/** Performance's pool, as `svc_performance`, closed on SIGTERM; null without a URL. */
export function performanceDatabase(
  env: NodeJS.ProcessEnv = process.env,
): PostgresJsDatabase | null {
  const url = env['PERFORMANCE_DATABASE_URL'];
  if (!url) {
    logger.info({ module: 'performance' }, 'PERFORMANCE_DATABASE_URL unset; no storage');
    return null;
  }
  const client = postgres(url, { max: 5 });
  onShutdown('performance database', () => client.end({ timeout: 5 }));
  return drizzle(client);
}
