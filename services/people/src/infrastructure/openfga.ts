import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { OpenFgaClient, type TupleKey } from '@openfga/sdk';
import { logger } from '@kithena/telemetry';

import type { RelationsResolver } from '../application/person/ports.js';

/**
 * Authorization as a graph, in OpenFGA (PEO-092, PRD §6.6).
 *
 * The model, in OpenFGA's DSL:
 *
 *     type user
 *     type tenant
 *       relations
 *         define hr: [user]
 *         define finance: [user]
 *         define people_admin: [user]
 *     type person
 *       relations
 *         define account: [user]
 *         define reports_to: [person]
 *         define manager: account from reports_to
 *         define manager_chain: manager or manager_chain from reports_to
 *
 * `account` is §6.6's `self`, renamed because OpenFGA reserves `self`.
 *
 * Two tuples per person, at most — who they sign in as, and who they report
 * to — and everything else is derived. A manager is whoever signs in as the
 * person this one reports to, so a manager who changes account, or leaves,
 * changes nothing on their reports. The chain is transitive over the
 * reporting line, so moving somebody is one tuple replaced, and the old chain
 * loses them in the same write the new one gains them.
 *
 * `hr`, `finance` and `people_admin` sit on the tenant, and the tenant asked
 * about is the one the request is in. HR at one company is nobody at another.
 *
 * The standalone implementation, `drizzleRelations`, answers the same
 * questions from `people.person` and the forwarded roles, and is what runs
 * when `OPENFGA_URL` is unset — `just standalone people` has no OpenFGA.
 */
export const PEOPLE_AUTHORIZATION_MODEL = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'tenant',
      relations: { hr: { this: {} }, finance: { this: {} }, people_admin: { this: {} } },
      metadata: {
        relations: {
          hr: { directly_related_user_types: [{ type: 'user' }] },
          finance: { directly_related_user_types: [{ type: 'user' }] },
          people_admin: { directly_related_user_types: [{ type: 'user' }] },
        },
      },
    },
    {
      type: 'person',
      relations: {
        account: { this: {} },
        reports_to: { this: {} },
        manager: {
          tupleToUserset: {
            tupleset: { relation: 'reports_to' },
            computedUserset: { relation: 'account' },
          },
        },
        manager_chain: {
          union: {
            child: [
              { computedUserset: { relation: 'manager' } },
              {
                tupleToUserset: {
                  tupleset: { relation: 'reports_to' },
                  computedUserset: { relation: 'manager_chain' },
                },
              },
            ],
          },
        },
      },
      metadata: {
        relations: {
          account: { directly_related_user_types: [{ type: 'user' }] },
          reports_to: { directly_related_user_types: [{ type: 'person' }] },
        },
      },
    },
  ],
} as const;

/** The roles the tenant object carries. */
const TENANT_ROLES = ['hr', 'finance', 'people_admin'] as const;

/** A person in these states signs in as nobody: their account is ended or never was. */
const GONE = new Set(['terminated', 'discarded']);

export interface OpenFga {
  readonly relations: RelationsResolver;
  /**
   * Bring one person's tuples in line with their row.
   *
   * The event that triggered it is only the reason to look: the row is the
   * truth, so a redelivered event, a replay from the beginning, or two events
   * arriving out of order all converge on the same tuples. Kafka keys the
   * outbox by `tenant:aggregate`, so one person's events reach one consumer
   * in order anyway; this does not depend on it.
   */
  sync(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<'applied' | 'unchanged'>;
  /** Grant or revoke a tenant role. Idempotent. */
  role(tenantId: string, accountId: string, role: (typeof TENANT_ROLES)[number], held: boolean): Promise<void>;
}

/** Null when `OPENFGA_URL` is unset: the caller uses `drizzleRelations`. */
export function openFgaFrom(env: NodeJS.ProcessEnv): OpenFga | null {
  const apiUrl = env['OPENFGA_URL'];
  if (apiUrl === undefined || apiUrl === '') return null;
  // One per process: the transports and the consumer share it, so a first
  // boot creates People's store once rather than racing itself to two.
  const key = `${apiUrl} ${env['OPENFGA_STORE_ID'] ?? ''}`;
  let found = shared.get(key);
  if (found === undefined) {
    found = openFga(apiUrl, env['OPENFGA_STORE_ID']);
    shared.set(key, found);
  }
  return found;
}

const shared = new Map<string, OpenFga>();

/**
 * The client, with People's store and model in place.
 *
 * The store is found by name, or created, when no id is given; the model is
 * written when the latest one in the store differs from this file's. Both are
 * idempotent, so every replica can do it on boot. Lazily, on first use, so a
 * process whose OpenFGA is briefly down still boots and answers what it can.
 */
export function openFga(apiUrl: string, storeId?: string): OpenFga {
  let ready: Promise<OpenFgaClient> | undefined;
  const client = (): Promise<OpenFgaClient> => {
    ready ??= prepare(apiUrl, storeId).catch((cause: unknown) => {
      ready = undefined;
      throw cause;
    });
    return ready;
  };

  const exists = async (fga: OpenFgaClient, tuple: TupleKey): Promise<boolean> =>
    (await fga.read(tuple)).tuples.length > 0;

  return {
    relations: {
      async relations(_tx, tenantId, viewer, personId) {
        const fga = await client();
        const user = `user:${viewer.accountId}`;
        const person = `person:${personId}`;
        const tenant = `tenant:${tenantId}`;
        const checks = [
          { user, relation: 'account', object: person, correlationId: 'self' },
          { user, relation: 'manager', object: person, correlationId: 'manager' },
          { user, relation: 'manager_chain', object: person, correlationId: 'chain' },
          { user, relation: 'hr', object: tenant, correlationId: 'hr' },
          { user, relation: 'finance', object: tenant, correlationId: 'finance' },
          { user, relation: 'people_admin', object: tenant, correlationId: 'admin' },
        ];
        // One round trip for the person, as §6.6 asks; the per-field work is
        // the local intersection in `field-access.ts`.
        const { result } = await fga.batchCheck({ checks });
        const allowed = (id: string): boolean => {
          const answer = result.find((r) => r.correlationId === id);
          // A check that errored is a no, never a yes.
          if (answer?.error !== undefined) {
            logger.warn({ check: id, error: answer.error.message }, 'openfga check failed');
          }
          return answer?.allowed === true && answer.error === undefined;
        };
        return {
          isSelf: allowed('self'),
          isManager: allowed('manager'),
          isInManagerChain: allowed('chain'),
          isHr: allowed('hr'),
          isFinance: allowed('finance'),
          isAdmin: allowed('admin'),
        };
      },
    },

    async sync(tx, tenantId, personId) {
      const fga = await client();
      const rows = await tx.execute<{
        identity_account_id: string | null;
        manager_id: string | null;
        status: string;
        first: boolean;
      }>(sql`
        SELECT identity_account_id, manager_id, status,
               id = (SELECT id FROM people.person
                      WHERE tenant_id = ${tenantId}::uuid
                      ORDER BY created_at, id LIMIT 1) AS first
          FROM people.person
         WHERE tenant_id = ${tenantId}::uuid AND id = ${personId}::uuid
      `);
      const row = [...rows][0];
      const object = `person:${personId}`;

      const wanted: TupleKey[] = [];
      if (row?.identity_account_id != null && !GONE.has(row.status)) {
        wanted.push({ user: `user:${row.identity_account_id}`, relation: 'account', object });
      }
      if (row?.manager_id != null) {
        wanted.push({ user: `person:${row.manager_id}`, relation: 'reports_to', object });
      }

      const held: TupleKey[] = [];
      let token: string | undefined;
      do {
        const page = await fga.read(
          { object },
          token === undefined ? {} : { continuationToken: token },
        );
        held.push(...page.tuples.map((t) => t.key));
        token = page.continuation_token === '' ? undefined : page.continuation_token;
      } while (token !== undefined);

      const same = (a: TupleKey, b: TupleKey) =>
        a.user === b.user && a.relation === b.relation && a.object === b.object;
      const writes = wanted.filter((w) => !held.some((h) => same(h, w)));
      const deletes = held
        .filter((h) => !wanted.some((w) => same(h, w)))
        .map(({ user, relation, object: o }) => ({ user, relation, object: o }));

      /*
       * The first person in a tenant administers it (PRD §8.2, step 2: the
       * operator invites the first administrator, and it is their account
       * People provisions first). Deterministic whichever event arrives
       * first, because it is read from the rows, and never revoked here.
       *
       * ponytail: every later grant needs a role-management transport, which
       * does not exist yet; until it does, `role()` is the only other way in.
       */
      if (row?.first === true && row.identity_account_id !== null && !GONE.has(row.status)) {
        for (const relation of ['people_admin', 'hr'] as const) {
          const tuple = {
            user: `user:${row.identity_account_id}`,
            relation,
            object: `tenant:${tenantId}`,
          };
          if (!(await exists(fga, tuple))) writes.push(tuple);
        }
      }

      if (writes.length === 0 && deletes.length === 0) return 'unchanged';
      await fga.write({
        ...(writes.length > 0 ? { writes } : {}),
        ...(deletes.length > 0 ? { deletes } : {}),
      });
      return 'applied';
    },

    async role(tenantId, accountId, role, held) {
      const fga = await client();
      const tuple = { user: `user:${accountId}`, relation: role, object: `tenant:${tenantId}` };
      const has = await exists(fga, tuple);
      if (held && !has) await fga.write({ writes: [tuple] });
      if (!held && has) await fga.write({ deletes: [tuple] });
    },
  };
}

const STORE_NAME = 'people';

async function prepare(apiUrl: string, storeId?: string): Promise<OpenFgaClient> {
  const bare = new OpenFgaClient({ apiUrl });
  let id = storeId;
  if (id === undefined || id === '') {
    let token: string | undefined;
    do {
      const page = await bare.listStores(token === undefined ? {} : { continuationToken: token });
      id = page.stores.find((s) => s.name === STORE_NAME)?.id;
      token = page.continuation_token === '' ? undefined : page.continuation_token;
    } while (id === undefined && token !== undefined);
    id ??= (await bare.createStore({ name: STORE_NAME })).id;
  }

  const inStore = new OpenFgaClient({ apiUrl, storeId: id });
  const latest = await inStore.readLatestAuthorizationModel().catch(() => undefined);
  const current = latest?.authorization_model;
  let modelId = current?.id;
  if (
    current === undefined ||
    JSON.stringify(current.type_definitions) !==
      JSON.stringify(PEOPLE_AUTHORIZATION_MODEL.type_definitions)
  ) {
    modelId = (
      await inStore.writeAuthorizationModel(
        structuredClone(PEOPLE_AUTHORIZATION_MODEL) as never,
      )
    ).authorization_model_id;
  }
  return new OpenFgaClient({
    apiUrl,
    storeId: id,
    ...(modelId === undefined ? {} : { authorizationModelId: modelId }),
  });
}
