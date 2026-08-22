import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

/**
 * An operator, named but not yet holding a credential.
 *
 * There is no screen that creates one, deliberately: an account that can see
 * across every tenant should not be creatable by anything reachable over the
 * network. Rows are written here, by somebody with the database.
 *
 * Clears any credential the identity already holds, so the enrolment ceremony
 * can be walked again from the start rather than refusing because it has
 * already been completed.
 */
const port = process.argv[2] ?? '5432';
const email = process.argv[3] ?? 'ops@kithena.com';

const sql = postgres(`postgres://kithena:kithena@localhost:${port}/kithena`);

const existing = await sql<{ identity_id: string }[]>`
  SELECT identity_id FROM platform.operator WHERE lower(email) = lower(${email})
`;

const identityId = existing[0]?.identity_id ?? randomUUID();

if (!existing[0]) {
  await sql`INSERT INTO platform.identity (id) VALUES (${identityId}::uuid)`;
  await sql`
    INSERT INTO platform.operator (identity_id, email, status)
    VALUES (${identityId}::uuid, ${email}, 'invited')
  `;
} else {
  await sql`
    UPDATE platform.operator SET status = 'invited' WHERE identity_id = ${identityId}::uuid
  `;
}

await sql`DELETE FROM platform.operator_session`;
await sql`DELETE FROM platform.credential WHERE identity_id = ${identityId}::uuid`;

const enrol = new URL('http://localhost:3001/enrol');
enrol.searchParams.set('identity', identityId);

process.stdout.write(
  `\nOperator: ${email}\nEnrol:    ${enrol.toString()}\nSign in:  http://localhost:3001/sign-in\n\n`,
);

await sql.end();
