import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { TenantAdministratorNamed, TenantProvisioned } from '@kithena/contracts';
import { outboxTable, publish } from '@kithena/db-kit';
import { systemClock, type PendingEvent } from '@kithena/domain-kit';

import { Account } from '../src/account/domain/account.js';
import { drizzleAccountRepository } from '../src/account/infrastructure/drizzle-account-repository.js';
import { uuidv7 } from '../src/shared/uuid.js';

/**
 * A tenant, an invited account, and one enrolment link.
 *
 * Enrolment links are single-use by design, so walking the flow a second time
 * needs a second link. Doing that by hand means remembering to hash the token
 * before storing it, which is the one step that must not be skipped and the one
 * easiest to skip.
 *
 * Resets the account to `invited` and clears credentials, so the whole path can
 * be walked from the start rather than from wherever the last attempt stopped.
 *
 * Lives here rather than in `tools/scripts` because that directory belongs to
 * the root package, which has no database driver — pnpm's strict layout means
 * `postgres` is only resolvable from the packages that declare it, and this is
 * one of them.
 *
 * Connects as the owner, not `svc_identity`. Seeding writes rows for a tenant
 * before any tenant scope exists, which is precisely what row-level security is
 * there to prevent.
 */
/*
 * No logo is seeded, and that is deliberate.
 *
 * There used to be one: a PNG drawn here and stored as a `data:` URI, because
 * seeding cannot upload to object storage and a fetched URL would have made
 * this script depend on somebody else's uptime. It was a good stand-in and the
 * wrong value. `imageIsOurs` refuses anything off the configured image host —
 * a domain rule that exists so a tenant's sign-in page cannot render an image
 * somebody else controls — so the seeded company could not be *saved* from the
 * back office at all: every amendment re-sent the `data:` URI and came back
 * `IMAGE_NOT_OURS`, including one that only changed the theme.
 *
 * A seed that writes a value the product refuses to accept is a seed that
 * makes the product look broken. Null is honest: this deployment has no image
 * store configured, so this company has no logo. Configure one — see
 * `imageStore()` in `apps/admin` — and upload a real mark through the screen
 * that is meant to.
 */

const port = process.argv[2] ?? process.env['POSTGRES_PORT'] ?? '5432';
const sql = postgres(`postgres://kithena:kithena@localhost:${port}/kithena`);

/*
 * The local companies, each with the administrator the back office would
 * name. Acme is the small one; Dunder Mifflin is The Office's paper company,
 * whose employees People's seed adds (`services/people/src/seed-companies.ts`
 * holds the rest; a module does not import another, so the slugs and the
 * administrator's email are repeated here). `SEED_TENANTS=dunder-mifflin`
 * seeds only that one, so a second company can be added without resetting
 * the first one's administrator.
 */
const COMPANIES = [
  {
    slug: 'acme',
    displayName: 'Acme Corp',
    accent: 'oklch(0.55 0.18 264)',
    country: 'ES',
    line1: 'Calle Mayor 1',
    city: 'Madrid',
    zone: 'Europe/Madrid',
    identity: '00000000-0000-4000-8000-00000000000d',
    account: '00000000-0000-4000-8000-0000000000a1',
    email: 'ada@acme.example',
  },
  {
    slug: 'dunder-mifflin',
    displayName: 'Dunder Mifflin',
    accent: 'oklch(0.5 0.15 250)',
    country: 'US',
    line1: '1725 Slough Avenue',
    city: 'Scranton',
    zone: 'America/New_York',
    identity: '00000000-0000-4000-8000-0000000000de',
    account: '00000000-0000-4000-8000-0000000000d1',
    email: 'toby.flenderson@dunder-mifflin.example',
  },
] as const;

const only = (process.env['SEED_TENANTS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '');

/*
 * Acme's Platform team as Time Off's seed has it (`services/timeoff/src/seed/
 * acme.ts` repeats these account ids, as this file repeats People's slugs): an
 * invited account each, so `just dev` can sign in as Adam and Time Off finds
 * the member that account signs in as. Plain rows and no
 * `account.provisioned`, because People's consumer would make each a
 * provisional person in People's Acme, and the team is Time Off's own
 * (`docs/demo-company.md`). The `n`th has account `…a<n>` and identity `…d<n>`.
 */
const TIMEOFF_TEAM = [
  ['Marco', 'Ruiz'],
  ['Adam', 'Novak'],
  ['Omar', 'Haddad'],
  ['Yuki', 'Sato'],
  ['Leo', 'Rossi'],
  ['Hana', 'Kim'],
  ['Ravi', 'Patel'],
] as const;

for (const company of COMPANIES) {
  if (only.length > 0 && !only.includes(company.slug)) continue;
  // eslint-disable-next-line no-await-in-loop -- one company at a time
  await seedCompany(company);
  // eslint-disable-next-line no-await-in-loop -- one company at a time
  if (company.slug === 'acme') await seedTimeOffTeam(company);
}

async function seedCompany(company: (typeof COMPANIES)[number]): Promise<void> {
  const IDENTITY = company.identity;
  const ACCOUNT = company.account;
  const EMAIL = company.email;
  const ZONE = company.zone;
  // An address, because a company the back office creates has one and People
  // makes the first legal entity in its country (PEO-099).
  const [created] = await sql<{ id: string }[]>`
    INSERT INTO platform.tenant (slug, display_name, status, accent_color, logo_url,
                                 address_country, address_line1, address_city)
    VALUES (${company.slug}, ${company.displayName}, 'active', ${company.accent}, NULL,
            ${company.country}, ${company.line1}, ${company.city})
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
  `;
  const [tenant] = await sql<
    { id: string }[]
  >`SELECT id FROM platform.tenant WHERE slug = ${company.slug}`;
  if (!tenant) throw new Error(`the ${company.slug} tenant did not get created`);

  /*
   * Only this demo account's rows. Every one of these used to be unscoped.
   *
   * `DELETE FROM platform.credential` with no WHERE clause deletes every passkey
   * in the database — the operator's back-office credential included — so asking
   * for a second enrolment link signed the whole machine out and destroyed
   * credentials that cannot be recreated without walking each person's enrolment
   * again. It did exactly that, which is why the scoping is here now.
   *
   * A seed script is run casually and repeatedly, by definition. That is the
   * argument for it being narrow, not for trusting whoever runs it to know what
   * it touches.
   *
   * `just local-reset` is the one that clears everything, and it says so.
   */
  await sql`DELETE FROM platform.session       WHERE account_id = ${ACCOUNT}::uuid`;
  await sql`DELETE FROM platform.enrolment_token WHERE account_id = ${ACCOUNT}::uuid`;
  await sql`DELETE FROM platform.credential    WHERE identity_id = ${IDENTITY}::uuid`;
  /*
   * What the back office's "create a company" leaves behind, the first time:
   * the account commissioned by the `Account` aggregate itself, so
   * `identity.account.provisioned` is raised as it always is, and the company
   * announced and Ada named People's administrator, as `provisionTenant` does.
   * All of it into `platform.outbox` in one transaction, which is how every
   * module hears about a company (PEO-099, PEO-112): People learns of Ada, the
   * company and her role from these events, never from this script.
   *
   * Nothing carries them to People locally (Debezium is not run), so
   * `pnpm db:seed` pipes them, as `pnpm --filter @kithena/identity events`
   * prints them, into People's seed, which hands them to People's consumer.
   */
  if (created !== undefined) {
    const db = drizzle(sql);
    await db.transaction(async (tx) => {
      const context = (process: string) => ({
        clock: systemClock,
        newEventId: () => uuidv7(),
        actor: { kind: 'system' as const, process },
        correlationId: randomUUID(),
        causationId: null,
      });
      const account = Account.commission(
        {
          id: ACCOUNT,
          identityId: IDENTITY,
          tenantId: created.id,
          workEmail: EMAIL,
          timeZone: ZONE,
          employmentStart: '2026-01-01',
          via: 'admin_api',
        },
        context('seed'),
      );
      await drizzleAccountRepository().create(tx, account);

      await tx.execute(dsql`
        INSERT INTO platform.tenant_administrator (tenant_id, entitlement, account_id)
        VALUES (${created.id}::uuid, 'module.people', ${ACCOUNT}::uuid)
      `);
      // The envelope `provisionTenant`'s scope writes, each payload checked
      // against the contract People parses it with.
      const tenantEvent = (name: string, payload: Record<string, unknown>): PendingEvent => {
        const ctx = context('seed');
        return {
          eventId: ctx.newEventId(),
          eventName: name,
          eventVersion: 1,
          tenantId: created.id as PendingEvent['tenantId'],
          occurredAt: systemClock.instant(),
          effectiveFrom: null,
          aggregate: { type: 'Tenant', id: created.id, version: 1 },
          actor: ctx.actor,
          correlationId: ctx.correlationId,
          causationId: null,
          payload,
        };
      };
      await publish(tx, outboxTable('platform'), [
        tenantEvent(
          TenantProvisioned.name,
          TenantProvisioned.payload.parse({
            slug: company.slug,
            displayName: company.displayName,
            country: company.country,
            timeZone: ZONE,
          }),
        ),
        tenantEvent(
          TenantAdministratorNamed.name,
          TenantAdministratorNamed.payload.parse({
            entitlement: 'module.people',
            accountId: ACCOUNT,
            namedBy: null,
          }),
        ),
      ]);
    });
  }

  await sql`INSERT INTO platform.identity (id) VALUES (${IDENTITY}::uuid) ON CONFLICT DO NOTHING`;

  await sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start)
    VALUES (${ACCOUNT}::uuid, ${tenant.id}::uuid, ${IDENTITY}::uuid, 'invited',
            ${EMAIL}, ${ZONE}, '2026-01-01')
    ON CONFLICT (id) DO UPDATE SET status = 'invited'
  `;

  // The row holds the hash. The token itself exists only in this output.
  const token = randomBytes(32).toString('base64url');
  await sql`
    INSERT INTO platform.enrolment_token
      (tenant_id, account_id, token_hash, second_channel, expires_at)
    VALUES (${tenant.id}::uuid, ${ACCOUNT}::uuid,
            ${createHash('sha256').update(token).digest()}, 'in_person',
            now() + interval '72 hours')
  `;

  /*
   * The auth origin this deployment actually uses, not a guess.
   *
   * It was `http://localhost:3100`, and a passkey created there is refused when
   * `WEBAUTHN_RP_ID` is `app.localhost` — a relying party id has to be a suffix
   * of the hostname the ceremony runs on, and `app.localhost` is not a suffix of
   * `localhost`. The browser rejects it before the service sees it, so the
   * symptom is a sign-in that quietly never recognises anybody.
   */
  const origin = process.env['AUTH_ORIGIN'] ?? 'http://localhost:3100';

  const enrol = new URL('/enrol', origin);
  enrol.searchParams.set('identity', IDENTITY);
  enrol.searchParams.set('tenant', company.slug);
  enrol.searchParams.set('token', token);
  enrol.searchParams.set('name', EMAIL);

  const login = new URL('/login', origin);
  // The slug, which is what the hostname will carry in production. A uuid in a
  // link is a uuid somebody has to copy correctly.
  login.searchParams.set('tenant', company.slug);

  process.stdout.write(
    `\n${company.displayName} (${EMAIL})\nEnrol:  ${enrol.toString()}\nSign in: ${login.toString()}\n`,
  );
}

/**
 * Time Off's half of Acme: Ada named its administrator too, as the back
 * office names one per module, and the Platform team's accounts. Both
 * idempotent on their own, so a database seeded before Time Off existed gets
 * them without a reset: the naming is published only when its row is new, and
 * an account keeps its passkeys — only one still invited gets a fresh link.
 */
async function seedTimeOffTeam(company: (typeof COMPANIES)[number]): Promise<void> {
  const [tenant] = await sql<
    { id: string }[]
  >`SELECT id FROM platform.tenant WHERE slug = ${company.slug}`;
  if (!tenant) throw new Error(`the ${company.slug} tenant did not get created`);

  await drizzle(sql).transaction(async (tx) => {
    const named = await tx.execute(dsql`
      INSERT INTO platform.tenant_administrator (tenant_id, entitlement, account_id)
      VALUES (${tenant.id}::uuid, 'module.timeoff', ${company.account}::uuid)
      ON CONFLICT DO NOTHING
      RETURNING account_id
    `);
    if (named.length === 0) return;
    await publish(tx, outboxTable('platform'), [
      {
        eventId: uuidv7(),
        eventName: TenantAdministratorNamed.name,
        eventVersion: 1,
        tenantId: tenant.id as PendingEvent['tenantId'],
        occurredAt: systemClock.instant(),
        effectiveFrom: null,
        aggregate: { type: 'Tenant', id: tenant.id, version: 1 },
        actor: { kind: 'system', process: 'seed' },
        correlationId: randomUUID(),
        causationId: null,
        payload: TenantAdministratorNamed.payload.parse({
          entitlement: 'module.timeoff',
          accountId: company.account,
          namedBy: null,
        }),
      },
    ]);
  });

  const origin = process.env['AUTH_ORIGIN'] ?? 'http://localhost:3100';
  const lines: string[] = [];
  for (const [n, [given, family]] of TIMEOFF_TEAM.entries()) {
    const account = `7ac0e000-0000-4000-8000-0000000000a${String(n + 1)}`;
    const identity = `7ac0e000-0000-4000-8000-0000000000d${String(n + 1)}`;
    const email = `${given}.${family}@${company.slug}.example`.toLowerCase();
    // eslint-disable-next-line no-await-in-loop -- seven accounts, in order
    await sql`INSERT INTO platform.identity (id) VALUES (${identity}::uuid) ON CONFLICT DO NOTHING`;
    // eslint-disable-next-line no-await-in-loop -- seven accounts, in order
    const [row] = await sql<{ status: string }[]>`
      INSERT INTO platform.account
        (id, tenant_id, identity_id, status, work_email, time_zone, employment_start,
         given_name, family_name)
      VALUES (${account}::uuid, ${tenant.id}::uuid, ${identity}::uuid, 'invited',
              ${email}, ${company.zone}, '2026-01-01', ${given}, ${family})
      ON CONFLICT (id) DO UPDATE SET work_email = EXCLUDED.work_email
      RETURNING status
    `;
    if (row?.status !== 'invited') continue;
    const token = randomBytes(32).toString('base64url');
    // eslint-disable-next-line no-await-in-loop -- seven accounts, in order
    await sql`DELETE FROM platform.enrolment_token WHERE account_id = ${account}::uuid`;
    // eslint-disable-next-line no-await-in-loop -- seven accounts, in order
    await sql`
      INSERT INTO platform.enrolment_token
        (tenant_id, account_id, token_hash, second_channel, expires_at)
      VALUES (${tenant.id}::uuid, ${account}::uuid,
              ${createHash('sha256').update(token).digest()}, 'in_person',
              now() + interval '72 hours')
    `;
    const enrol = new URL('/enrol', origin);
    enrol.searchParams.set('identity', identity);
    enrol.searchParams.set('tenant', company.slug);
    enrol.searchParams.set('token', token);
    enrol.searchParams.set('name', email);
    lines.push(`  ${given} ${family} (${email})\n  Enrol:  ${enrol.toString()}`);
  }
  if (lines.length > 0) {
    process.stdout.write(`\nAcme's Platform team, in Time Off\n${lines.join('\n')}\n`);
  }
}

await sql.end();
