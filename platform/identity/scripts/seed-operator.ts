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

// This operator's sessions, not everybody's. The credential delete below was
// already scoped; this one was not, so resetting one operator signed out every
// other one — harmless with a single back-office account and wrong the moment
// there are two.
await sql`
  DELETE FROM platform.operator_session
   WHERE operator_id IN (SELECT id FROM platform.operator WHERE identity_id = ${identityId}::uuid)
`;
await sql`DELETE FROM platform.credential WHERE identity_id = ${identityId}::uuid`;

// The back-office origin this deployment uses. Same reasoning as the tenant
// seed: a passkey is bound to the hostname it was created on, so a printed link
// that names a different one enrols a credential nothing will ever match.
const origin = process.env['ADMIN_ORIGIN'] ?? 'http://localhost:3001';

const enrol = new URL('/enrol', origin);
enrol.searchParams.set('identity', identityId);

process.stdout.write(
  `\nOperator: ${email}\nEnrol:    ${enrol.toString()}\nSign in:  ${new URL('/sign-in', origin).toString()}\n\n`,
);

await sql.end();
