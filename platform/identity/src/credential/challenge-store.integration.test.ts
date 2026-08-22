import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { startPostgres } from '@kithena/testing';

import {
  postgresChallengeStore,
  sweepExpiredChallenges,
} from './infrastructure/postgres-challenge-store.js';

/**
 * The one property that matters: a challenge is spendable exactly once.
 *
 * A WebAuthn challenge is all that stands between an assertion and a replay of
 * it. If two requests carrying the same captured assertion can both read the
 * challenge, both signatures verify — perfectly, twice. Valkey got this right
 * with `GETDEL`; this has to get it right with `DELETE ... RETURNING`, and a
 * unit test against a fake cannot tell the two apart because a fake has no
 * concurrency.
 *
 * So this runs against a real Postgres, and the important test fires the
 * requests together rather than in sequence.
 */
let stop: (() => Promise<void>) | undefined;
let client: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase;

const SUBJECT = '00000000-0000-4000-8000-0000000000c1';

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;
  client = postgres(started.url, { max: 8 });
  db = drizzle(client);

  // The real migrations, not a hand-rolled approximation. A schema retyped for
  // a test is a schema that can disagree with production.
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260822180000_webauthn_challenge.sql',
  ]) {
    const path = new URL(`../../../../migrations/${file}`, import.meta.url);
    const text = await readFile(path, 'utf8');
    // The GRANT names a role this throwaway database does not have.
    await db.execute(sql.raw(text.replace(/^GRANT .*$/gm, '')));
  }
}, 120_000);

afterAll(async () => {
  await client?.end();
  await stop?.();
});

describe('challenges in Postgres', () => {
  it('returns what was issued', async () => {
    const store = postgresChallengeStore(db);
    await store.issue('c-basic', { purpose: 'registration', subject: SUBJECT }, 60);
    expect(await store.consume('c-basic')).toEqual({
      purpose: 'registration',
      subject: SUBJECT,
    });
  });

  it('carries a null subject through, for a discoverable sign-in', async () => {
    // Nobody has said who they are yet, which is the whole point of the flow.
    const store = postgresChallengeStore(db);
    await store.issue('c-anon', { purpose: 'authentication', subject: null }, 60);
    expect(await store.consume('c-anon')).toEqual({ purpose: 'authentication', subject: null });
  });

  it('refuses a second read', async () => {
    const store = postgresChallengeStore(db);
    await store.issue('c-once', { purpose: 'authentication', subject: null }, 60);
    expect(await store.consume('c-once')).not.toBeNull();
    expect(await store.consume('c-once')).toBeNull();
  });

  it('refuses a challenge nobody issued', async () => {
    expect(await postgresChallengeStore(db).consume('c-never')).toBeNull();
  });

  it('gives exactly one winner when spent concurrently', async () => {
    // The replay, as it would actually arrive: the same captured assertion
    // presented twice at once. Sequentially this passes even with a
    // read-then-delete, which is why it is fired together.
    const store = postgresChallengeStore(db);
    await store.issue('c-race', { purpose: 'authentication', subject: SUBJECT }, 60);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => store.consume('c-race')),
    );

    expect(attempts.filter((a) => a !== null)).toHaveLength(1);
    expect(attempts.filter((a) => a === null)).toHaveLength(7);
  });

  it('refuses an expired challenge without waiting for a sweep', async () => {
    // Expiry is a predicate, not a job. A sweep that has not run must not make
    // a stale challenge usable.
    const store = postgresChallengeStore(db);
    await db.execute(sql`
      INSERT INTO platform.webauthn_challenge (challenge, purpose, subject, expires_at)
      VALUES ('c-stale', 'authentication', NULL, now() - interval '1 second')
    `);
    expect(await store.consume('c-stale')).toBeNull();
  });

  it('sweeps only what has expired', async () => {
    const store = postgresChallengeStore(db);
    await store.issue('c-fresh', { purpose: 'authentication', subject: null }, 600);
    await db.execute(sql`
      INSERT INTO platform.webauthn_challenge (challenge, purpose, subject, expires_at)
      VALUES ('c-old', 'authentication', NULL, now() - interval '1 hour')
    `);

    expect(await sweepExpiredChallenges(db)).toBeGreaterThanOrEqual(1);
    expect(await store.consume('c-fresh')).not.toBeNull();
  });

  it('does not let a re-issued challenge overwrite a live one', async () => {
    // `ON CONFLICT DO NOTHING`: a collision means the random source repeated
    // itself, and silently re-pointing the existing challenge at a new subject
    // would be worse than refusing the second issue.
    const store = postgresChallengeStore(db);
    await store.issue('c-dup', { purpose: 'registration', subject: SUBJECT }, 60);
    await store.issue('c-dup', { purpose: 'authentication', subject: null }, 60);
    expect(await store.consume('c-dup')).toEqual({ purpose: 'registration', subject: SUBJECT });
  });
});
