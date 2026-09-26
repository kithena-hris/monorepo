import postgres from 'postgres';

/**
 * `pnpm --silent --filter @kithena/identity events`: every event in identity's
 * outbox, oldest first, one JSON envelope a line on stdout.
 *
 * What Debezium would publish to `kithena.identity.v1`, for a laptop that runs
 * no Debezium: `pnpm db:seed` pipes it into People's seed, which hands each
 * line to People's consumer. Identity reads only its own table to do it, and
 * People never reads it at all; the pipe stands where the topic would.
 *
 * Connects as the owner, as the seed does: the outbox isolates by tenant, and
 * this reads every tenant's.
 */

const port = process.argv[2] ?? process.env['POSTGRES_PORT'] ?? '5432';
const sql = postgres(`postgres://kithena:kithena@localhost:${port}/kithena`, { max: 1 });

const rows = await sql<{ envelope: unknown }[]>`
  SELECT envelope FROM platform.outbox ORDER BY created_at, event_id`;
for (const row of rows) process.stdout.write(`${JSON.stringify(row.envelope)}\n`);

await sql.end();
