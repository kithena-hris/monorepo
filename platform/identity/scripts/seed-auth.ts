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

const port = process.argv[2] ?? '5432';
const sql = postgres(`postgres://kithena:kithena@localhost:${port}/kithena`);

const IDENTITY = '00000000-0000-4000-8000-00000000000d';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const EMAIL = 'ada@acme.example';

await sql`
  INSERT INTO platform.tenant (slug, display_name, status, accent_color, logo_url)
  VALUES ('acme', 'Acme Corp', 'active', 'oklch(0.55 0.18 264)', NULL)
  ON CONFLICT (slug) DO UPDATE
    SET display_name = excluded.display_name,
        accent_color = excluded.accent_color,
        logo_url     = excluded.logo_url
`;
const [tenant] = await sql<{ id: string }[]>`SELECT id FROM platform.tenant WHERE slug = 'acme'`;
if (!tenant) throw new Error('the acme tenant did not get created');

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
enrol.searchParams.set('tenant', 'acme');
enrol.searchParams.set('token', token);
enrol.searchParams.set('name', EMAIL);

const login = new URL('/login', origin);
// The slug, which is what the hostname will carry in production. A uuid in a
// link is a uuid somebody has to copy correctly.
login.searchParams.set('tenant', 'acme');

process.stdout.write(`\nEnrol:  ${enrol.toString()}\n\nSign in: ${login.toString()}\n\n`);

await sql.end();
