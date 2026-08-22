import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

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
const port = process.argv[2] ?? '5432';
const sql = postgres(`postgres://kithena:kithena@localhost:${port}/kithena`);

const IDENTITY = '00000000-0000-4000-8000-00000000000d';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const EMAIL = 'ada@acme.example';

/*
 * A logo drawn here rather than fetched, and a PNG rather than an SVG.
 *
 * Fetched would make seeding depend on somebody else's uptime and hotlink
 * policy; the first attempt at this used a Wikipedia URL and rendered a broken
 * image. SVG would be worse than inconvenient — it carries script, and this
 * value ends up in an `<img src>` on the least authenticated page in the
 * product. Real uploads are rasterised for the same reason.
 */
const LOGO = 'data:image/png;base64,iVBORw0KGgo=' as string;

await sql`
  INSERT INTO platform.tenant (slug, display_name, status, accent_color)
  VALUES ('acme', 'Acme Corp', 'active', 'oklch(0.55 0.18 264)')
  ON CONFLICT (slug) DO UPDATE SET display_name = excluded.display_name
`;
const [tenant] = await sql<{ id: string }[]>`SELECT id FROM platform.tenant WHERE slug = 'acme'`;
if (!tenant) throw new Error('the acme tenant did not get created');

await sql`DELETE FROM platform.session`;
await sql`DELETE FROM platform.enrolment_token`;
await sql`DELETE FROM platform.credential`;
await sql`INSERT INTO platform.identity (id) VALUES (${IDENTITY}::uuid) ON CONFLICT DO NOTHING`;

await sql`
  INSERT INTO platform.account
    (id, tenant_id, identity_id, status, work_email, time_zone, employment_start)
  VALUES (${ACCOUNT}::uuid, ${tenant.id}::uuid, ${IDENTITY}::uuid, 'invited',
          ${EMAIL}, 'Europe/Madrid', '2026-01-01')
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

const enrol = new URL('http://localhost:3100/enrol');
enrol.searchParams.set('identity', IDENTITY);
enrol.searchParams.set('tenant', 'acme');
enrol.searchParams.set('token', token);
enrol.searchParams.set('name', EMAIL);

const login = new URL('http://localhost:3100/login');
// The slug, which is what the hostname will carry in production. A uuid in a
// link is a uuid somebody has to copy correctly.
login.searchParams.set('tenant', 'acme');

process.stdout.write(`\nEnrol:  ${enrol.toString()}\n\nSign in: ${login.toString()}\n\n`);

await sql.end();
