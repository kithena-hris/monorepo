import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
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
/**
 * A stand-in mark, drawn rather than fetched, and a PNG rather than an SVG.
 *
 * Fetched would make seeding depend on somebody else's uptime and hotlink
 * policy — the first attempt used a Wikipedia URL and rendered a broken image.
 * SVG would be worse than inconvenient: it carries script, and this value ends
 * up in an `<img src>` on the least authenticated page in the product. Real
 * uploads are rasterised for exactly that reason, and the seed should not model
 * something the product refuses to do.
 */
function placeholderLogo(): string {
  const width = 120;
  const height = 40;

  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0); // PNG filter byte: none
    for (let x = 0; x < width; x += 1) {
      const inside = y >= 8 && y < 32 && x >= 8 && x < 112;
      const on = inside && (Math.floor((x - 8) / 12) + Math.floor((y - 8) / 12)) % 2 === 0;
      rows.push(...(on ? [0x4f, 0x46, 0xe5] : [0xef, 0xf0, 0xfb]));
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString('base64')}`;
}

/** PNG chunks are CRC-32 checked, and `node:zlib` does not expose one. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const port = process.argv[2] ?? '5432';
const sql = postgres(`postgres://kithena:kithena@localhost:${port}/kithena`);

const IDENTITY = '00000000-0000-4000-8000-00000000000d';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const EMAIL = 'ada@acme.example';

await sql`
  INSERT INTO platform.tenant (slug, display_name, status, accent_color, logo_url)
  VALUES ('acme', 'Acme Corp', 'active', 'oklch(0.55 0.18 264)', ${placeholderLogo()})
  ON CONFLICT (slug) DO UPDATE
    SET display_name = excluded.display_name,
        accent_color = excluded.accent_color,
        logo_url     = excluded.logo_url
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
