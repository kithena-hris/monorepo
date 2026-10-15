import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { outboxTable, publish, withTenant } from '@kithena/db-kit';
import type { PersonId, TenantId } from '@kithena/contracts';
import { logger, onShutdown } from '@kithena/telemetry';

import type { Template } from '../domain/plan.js';
import type { HireRecord, Member, PlanRecord, Tx, UnitOfWork } from '../application/ports.js';

/**
 * One tenant, one transaction, every store (ONB-006), over
 * `migrations/20261015130010_onboarding_core.sql`, in raw SQL as Recruiting's
 * is. A plan's tasks are rows of their own, rewritten with the plan.
 */

const outbox = outboxTable('onboarding');

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

function memberOf(r: Row): Member {
  return {
    personId: r['person_id'] as PersonId,
    accountId: str(r['account_id']),
    displayName: String(r['display_name']),
    workEmail: str(r['work_email']),
    managerPersonId: str(r['manager_person_id']) as PersonId | null,
    status: String(r['status']),
  };
}

const planOf = (r: Row | null): PlanRecord | null =>
  r === null ? null : (r['body'] as PlanRecord);

function storesIn(tx: PostgresJsDatabase, T: string): Tx {
  return {
    members: {
      get: async (id) => {
        const r = await one(tx, sql`SELECT * FROM onboarding.member WHERE person_id = ${id}`);
        return r === null ? null : memberOf(r);
      },
      byAccount: async (account) => {
        const found = await rows(
          tx,
          sql`SELECT * FROM onboarding.member WHERE account_id = ${account} LIMIT 2`,
        );
        return found.length === 1 && found[0] !== undefined ? memberOf(found[0]) : null;
      },
      list: async () =>
        (await rows(tx, sql`SELECT * FROM onboarding.member ORDER BY display_name`)).map(memberOf),
      upsert: async (m, eventId) => {
        const written = await rows(
          tx,
          sql`INSERT INTO onboarding.member (tenant_id, person_id, account_id, display_name, work_email, manager_person_id, status, last_event_id)
            VALUES (${T}, ${m.personId}, ${m.accountId}, ${m.displayName}, ${m.workEmail}, ${m.managerPersonId}, ${m.status}, ${eventId})
            ON CONFLICT (tenant_id, person_id) DO UPDATE SET account_id = EXCLUDED.account_id, display_name = EXCLUDED.display_name,
              work_email = EXCLUDED.work_email, manager_person_id = EXCLUDED.manager_person_id, status = EXCLUDED.status,
              last_event_id = EXCLUDED.last_event_id, updated_at = now()
            WHERE onboarding.member.last_event_id <> EXCLUDED.last_event_id
            RETURNING person_id`,
        );
        return written.length > 0;
      },
    },
    admins: {
      has: async (a) =>
        (await one(tx, sql`SELECT 1 AS ok FROM onboarding.admin WHERE account_id = ${a}`)) !== null,
      add: async (a) => {
        await tx.execute(
          sql`INSERT INTO onboarding.admin (tenant_id, account_id) VALUES (${T}, ${a}) ON CONFLICT DO NOTHING`,
        );
      },
      remove: async (a) => {
        await tx.execute(sql`DELETE FROM onboarding.admin WHERE account_id = ${a}`);
      },
    },
    hires: {
      get: async (id) =>
        ((await one(tx, sql`SELECT body FROM onboarding.hire WHERE id = ${id}`))?.[
          'body'
        ] as HireRecord | null) ?? null,
      bySource: async (source, externalId) =>
        ((
          await one(
            tx,
            sql`SELECT body FROM onboarding.hire WHERE source = ${source} AND external_id = ${externalId}`,
          )
        )?.['body'] as HireRecord | undefined) ?? null,
      byEmail: async (email) =>
        ((
          await one(
            tx,
            sql`SELECT body FROM onboarding.hire WHERE lower(body->>'email') = lower(${email}) ORDER BY created_at LIMIT 1`,
          )
        )?.['body'] as HireRecord | undefined) ?? null,
      save: async (h) => {
        await tx.execute(sql`INSERT INTO onboarding.hire (tenant_id, id, source, external_id, person_id, body)
          VALUES (${T}, ${h.id}, ${h.source}, ${h.externalId}, ${h.personId}, ${J(h)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET person_id = EXCLUDED.person_id, body = EXCLUDED.body`);
      },
    },
    templates: {
      get: async (id) =>
        ((await one(tx, sql`SELECT body FROM onboarding.template WHERE id = ${id}`))?.['body'] as
          Template | undefined) ?? null,
      list: async () =>
        (await rows(tx, sql`SELECT body FROM onboarding.template ORDER BY name`)).map(
          (r) => r['body'] as Template,
        ),
      save: async (t) => {
        await tx.execute(sql`INSERT INTO onboarding.template (tenant_id, id, name, active, body) VALUES (${T}, ${t.id}, ${t.name}, ${t.active}, ${J(t)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active, body = EXCLUDED.body`);
      },
      remove: async (id) => {
        await tx.execute(sql`DELETE FROM onboarding.template WHERE id = ${id}`);
      },
    },
    plans: {
      get: async (id) =>
        planOf(await one(tx, sql`SELECT body FROM onboarding.plan WHERE id = ${id}`)),
      byHire: async (hireId) =>
        planOf(await one(tx, sql`SELECT body FROM onboarding.plan WHERE hire_id = ${hireId}`)),
      byWelcomeHash: async (hash) =>
        planOf(await one(tx, sql`SELECT body FROM onboarding.plan WHERE welcome_hash = ${hash}`)),
      list: async () =>
        (await rows(tx, sql`SELECT body FROM onboarding.plan ORDER BY start_date`)).map(
          (r) => r['body'] as PlanRecord,
        ),
      save: async (p) => {
        await tx.execute(sql`INSERT INTO onboarding.plan (tenant_id, id, hire_id, state, start_date, probation_end, manager_id, buddy_id, person_id, welcome_hash, body)
          VALUES (${T}, ${p.id}, ${p.hireId}, ${p.state}, ${p.startDate}, ${p.probationEnd}, ${p.managerId}, ${p.buddyId}, ${p.personId}, ${p.welcomeHash}, ${J(p)})
          ON CONFLICT (tenant_id, id) DO UPDATE SET state = EXCLUDED.state, start_date = EXCLUDED.start_date, probation_end = EXCLUDED.probation_end,
            manager_id = EXCLUDED.manager_id, buddy_id = EXCLUDED.buddy_id, person_id = EXCLUDED.person_id, body = EXCLUDED.body`);
        await tx.execute(sql`DELETE FROM onboarding.task WHERE plan_id = ${p.id}`);
        for (const t of p.tasks)
          await tx.execute(sql`INSERT INTO onboarding.task (tenant_id, id, plan_id, key, owner_role, owner_person_id, due_on, state, body)
            VALUES (${T}, ${t.id}, ${p.id}, ${t.key}, ${t.ownerRole}, ${t.ownerPersonId}, ${t.dueOn}, ${t.state}, ${J(t)})`);
      },
    },
    checkIns: {
      forPlan: async (planId) =>
        (
          await rows(
            tx,
            sql`SELECT id, plan_id, day, by_person, body, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
            FROM onboarding.check_in WHERE plan_id = ${planId} ORDER BY created_at`,
          )
        ).map((r) => ({
          id: String(r['id']),
          planId: String(r['plan_id']),
          day: Number(r['day']) as 30 | 60 | 90,
          by: String(r['by_person']),
          notes: (r['body'] as { notes?: string }).notes ?? '',
          at: String(r['at']),
        })),
      save: async (c) => {
        await tx.execute(sql`INSERT INTO onboarding.check_in (tenant_id, id, plan_id, day, by_person, body)
          VALUES (${T}, ${c.id}, ${c.planId}, ${c.day}, ${c.by}, ${J({ notes: c.notes })})
          ON CONFLICT (tenant_id, plan_id, day, by_person) DO NOTHING`);
      },
    },
    reviews: {
      forPlan: async (planId) =>
        (
          await rows(
            tx,
            sql`SELECT plan_id, outcome, probation_end::text AS probation_end, decided_by,
            to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
            FROM onboarding.probation_review WHERE plan_id = ${planId} ORDER BY decided_at`,
          )
        ).map((r) => ({
          planId: String(r['plan_id']),
          outcome: r['outcome'] as 'passed' | 'extended' | 'failed',
          probationEnd: str(r['probation_end']) as never,
          by: String(r['decided_by']),
          at: String(r['at']),
        })),
      save: async (r) => {
        await tx.execute(sql`INSERT INTO onboarding.probation_review (tenant_id, plan_id, outcome, probation_end, decided_by, decided_at)
          VALUES (${T}, ${r.planId}, ${r.outcome}, ${r.probationEnd}, ${r.by}, ${r.at})`);
      },
    },
    settings: {
      get: async (key) =>
        (await one(tx, sql`SELECT value FROM onboarding.settings WHERE key = ${key}`))?.['value'] ??
        null,
      set: async (key, value) => {
        await tx.execute(sql`INSERT INTO onboarding.settings (tenant_id, key, value) VALUES (${T}, ${key}, ${J(value)})
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
      },
    },
    idempotency: {
      get: async (key) => {
        const r = await one(
          tx,
          sql`SELECT request_hash, status, answer FROM onboarding.idempotency_key WHERE key = ${key}`,
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
        await tx.execute(sql`INSERT INTO onboarding.idempotency_key (tenant_id, key, request_hash, status, answer)
          VALUES (${T}, ${key}, ${requestHash}, ${status}, ${J(answer)})`);
      },
    },
    outbox: {
      publish: async (events) => {
        if (events.length > 0) await publish(tx, outbox, events);
      },
    },
    tenant: {
      register: async (slug) => {
        await tx.execute(sql`INSERT INTO onboarding.tenant (tenant_id, slug) VALUES (${T}, ${slug})
          ON CONFLICT (tenant_id) DO UPDATE SET slug = coalesce(EXCLUDED.slug, onboarding.tenant.slug)`);
      },
      slug: async () =>
        str(
          (await one(tx, sql`SELECT slug FROM onboarding.tenant WHERE tenant_id = ${T}`))?.['slug'],
        ),
    },
  };
}

export function drizzleUnitOfWork(db: PostgresJsDatabase): UnitOfWork {
  return {
    run: (tenantId, fn) =>
      withTenant(db, tenantId, async (tx) => {
        await tx.execute(
          sql`INSERT INTO onboarding.tenant (tenant_id) VALUES (${tenantId}) ON CONFLICT DO NOTHING`,
        );
        return fn(storesIn(tx, tenantId));
      }),
    tenants: async () =>
      (await rows(db, sql`SELECT tenant_id, slug FROM onboarding.tenant ORDER BY tenant_id`)).map(
        (r) => ({
          tenantId: r['tenant_id'] as TenantId,
          slug: str(r['slug']),
        }),
      ),
    tenantBySlug: async (slug) =>
      (str(
        (await one(db, sql`SELECT tenant_id FROM onboarding.tenant WHERE slug = ${slug}`))?.[
          'tenant_id'
        ],
      ) as TenantId | null) ?? null,
  };
}

/** Onboarding's pool, as `svc_onboarding`, closed on SIGTERM; null without a URL. */
export function onboardingDatabase(
  env: NodeJS.ProcessEnv = process.env,
): PostgresJsDatabase | null {
  const url = env['ONBOARDING_DATABASE_URL'];
  if (!url) {
    logger.info({ module: 'onboarding' }, 'ONBOARDING_DATABASE_URL unset; no storage');
    return null;
  }
  const client = postgres(url, { max: 5 });
  onShutdown('onboarding database', () => client.end({ timeout: 5 }));
  return drizzle(client);
}
