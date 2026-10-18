import postgres from 'postgres';

import { seal, unseal, type TokenKey } from './secrets.js';

/**
 * The Slack service's own table, as `svc_slack`: which workspace is which
 * company, and its bot token. Every
 * read and write runs inside the company's row-level security, except the one
 * question asked before the company is known — which company a workspace is.
 */

export interface Installation {
  readonly tenantId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly botUserId: string;
  readonly botToken: string;
  readonly installedBy: string | null;
  readonly installedAt: string;
}

/** One person's own token, for reading what they can see (Performance §22.3). */
export interface PersonToken {
  readonly tenantId: string;
  readonly personId: string;
  readonly slackUserId: string;
  readonly token: string;
  readonly grantedAt: string;
}

export interface Store {
  companyOf(teamId: string): Promise<string | null>;
  installation(tenantId: string): Promise<Installation | null>;
  install(installation: Installation): Promise<void>;
  uninstall(tenantId: string): Promise<void>;
  personToken(tenantId: string, personId: string): Promise<PersonToken | null>;
  keepPersonToken(token: PersonToken): Promise<void>;
  dropPersonToken(tenantId: string, personId: string): Promise<void>;
  close(): Promise<void>;
}

export function postgresStore(url: string, key: TokenKey): Store {
  const sql = postgres(url, { max: 5, onnotice: () => undefined });
  const inTenant = <T>(tenantId: string, work: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return work(tx);
    }) as Promise<T>;

  return {
    async companyOf(teamId) {
      const [row] = await sql<{ id: string | null }[]>`
        SELECT slack.company_of_workspace(${teamId}) AS id`;
      return row?.id ?? null;
    },
    installation: (tenantId) =>
      inTenant(tenantId, async (tx) => {
        const [row] = await tx<
          {
            team_id: string;
            team_name: string;
            bot_user_id: string;
            bot_token: Buffer;
            installed_by: string | null;
            installed_at: Date;
          }[]
        >`SELECT team_id, team_name, bot_user_id, bot_token, installed_by, installed_at
            FROM slack.installation WHERE tenant_id = ${tenantId}`;
        if (row === undefined) return null;
        return {
          tenantId,
          teamId: row.team_id,
          teamName: row.team_name,
          botUserId: row.bot_user_id,
          botToken: unseal(key, row.bot_token),
          installedBy: row.installed_by,
          installedAt: row.installed_at.toISOString(),
        };
      }),
    install: (i) =>
      inTenant(i.tenantId, async (tx) => {
        await tx`
          INSERT INTO slack.installation
            (tenant_id, team_id, team_name, bot_user_id, bot_token, token_key_id, installed_by, installed_at)
          VALUES (${i.tenantId}, ${i.teamId}, ${i.teamName.slice(0, 200)}, ${i.botUserId},
                  ${seal(key, i.botToken)}, ${key.id}, ${i.installedBy}, ${i.installedAt})
          ON CONFLICT (tenant_id) DO UPDATE SET
            team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name,
            bot_user_id = EXCLUDED.bot_user_id, bot_token = EXCLUDED.bot_token,
            token_key_id = EXCLUDED.token_key_id, installed_by = EXCLUDED.installed_by,
            installed_at = EXCLUDED.installed_at`;
      }),
    uninstall: (tenantId) =>
      inTenant(tenantId, async (tx) => {
        await tx`DELETE FROM slack.installation WHERE tenant_id = ${tenantId}`;
      }),
    personToken: (tenantId, personId) =>
      inTenant(tenantId, async (tx) => {
        const [row] = await tx<{ slack_user_id: string; token: Buffer; granted_at: Date }[]>`
          SELECT slack_user_id, token, granted_at FROM slack.person_token
           WHERE tenant_id = ${tenantId} AND person_id = ${personId}`;
        if (row === undefined) return null;
        return {
          tenantId,
          personId,
          slackUserId: row.slack_user_id,
          token: unseal(key, row.token),
          grantedAt: row.granted_at.toISOString(),
        };
      }),
    keepPersonToken: (t) =>
      inTenant(t.tenantId, async (tx) => {
        await tx`
          INSERT INTO slack.person_token
            (tenant_id, person_id, slack_user_id, token, token_key_id, granted_at)
          VALUES (${t.tenantId}, ${t.personId}, ${t.slackUserId}, ${seal(key, t.token)},
                  ${key.id}, ${t.grantedAt})
          ON CONFLICT (tenant_id, person_id) DO UPDATE SET
            slack_user_id = EXCLUDED.slack_user_id, token = EXCLUDED.token,
            token_key_id = EXCLUDED.token_key_id, granted_at = EXCLUDED.granted_at`;
      }),
    dropPersonToken: (tenantId, personId) =>
      inTenant(tenantId, async (tx) => {
        await tx`DELETE FROM slack.person_token
                  WHERE tenant_id = ${tenantId} AND person_id = ${personId}`;
      }),
    close: () => sql.end({ timeout: 5 }),
  };
}

/** Kept in memory: a developer's machine without the database, and the tests. */
export function memoryStore(): Store {
  const installations = new Map<string, Installation>();
  const people = new Map<string, PersonToken>();
  return {
    companyOf: (teamId) =>
      Promise.resolve(
        [...installations.values()].find((i) => i.teamId === teamId)?.tenantId ?? null,
      ),
    installation: (tenantId) => Promise.resolve(installations.get(tenantId) ?? null),
    install: (i) => {
      installations.set(i.tenantId, i);
      return Promise.resolve();
    },
    uninstall: (tenantId) => {
      installations.delete(tenantId);
      return Promise.resolve();
    },
    personToken: (tenantId, personId) =>
      Promise.resolve(people.get(`${tenantId}/${personId}`) ?? null),
    keepPersonToken: (t) => {
      people.set(`${t.tenantId}/${t.personId}`, t);
      return Promise.resolve();
    },
    dropPersonToken: (tenantId, personId) => {
      people.delete(`${tenantId}/${personId}`);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}
