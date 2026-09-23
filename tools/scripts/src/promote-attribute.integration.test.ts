import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { PromotionRefused, migrationsDirectory, promotionFor } from './promote-attribute.js';

/**
 * What this tool emits, applied to a real database.
 *
 * "Valid Atlas migration" is not a claim a unit test can make. Comparing the
 * output to a string typed twice asserts that the template has not changed,
 * which is a different thing from Postgres accepting it — and the interesting
 * parts of this SQL are exactly the parts a template comparison cannot check:
 * whether a generated column may be added this way, whether the cast holds,
 * and what happens to rows whose JSONB does not fit the type.
 *
 * So the suite applies the real People migrations, then applies what the tool
 * wrote, then uses the column.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const AT = new Date('2026-09-23T11:22:33.000Z');

let stopPg: (() => Promise<void>) | undefined;
let client: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase;

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  client = postgres(pg.url, { max: 1 });
  db = drizzle(client);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
  ]) {
    await db.execute(sql.raw(await migration(file)));
  }
});

afterAll(async () => {
  await client?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM people.person`);
  /*
   * A migration runs once; this suite applies one per test.
   *
   * Dropping the promoted columns between tests is the harness catching up
   * with reality rather than a property of the tool — `ADD COLUMN` on a column
   * that already exists is the right failure everywhere except here.
   */
  for (const column of ['custom_employee_grade', 'custom_headcount_budget']) {
    // eslint-disable-next-line no-await-in-loop -- two statements, in a test
    await db.execute(sql.raw(`ALTER TABLE people.person DROP COLUMN IF EXISTS ${column}`));
  }
});

async function seed(custom: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    INSERT INTO people.person (tenant_id, status, given_name, custom)
    VALUES (${ACME}::uuid, 'active', 'Ada', ${JSON.stringify(custom)}::jsonb)
  `);
}

describe('the migration it writes', () => {
  it('applies to a real database', async () => {
    await seed({ employee_grade: 'P4' });

    const { sql: text } = promotionFor({
      attributeKey: 'employee_grade',
      dataType: 'text',
      at: AT,
    });
    await expect(db.execute(sql.raw(text))).resolves.toBeDefined();
  });

  it('produces a column that holds what custom held', async () => {
    await seed({ employee_grade: 'P4' });
    await db.execute(
      sql.raw(promotionFor({ attributeKey: 'employee_grade', dataType: 'text', at: AT }).sql),
    );

    const rows = await db.execute(sql`SELECT custom_employee_grade FROM people.person`);
    expect(String([...rows][0]?.['custom_employee_grade'])).toBe('P4');
  });

  it('keeps the generated column in step with custom, because it is generated', async () => {
    // The point of a generated column over a copied one: there is no second
    // write to forget, and no window where the two disagree.
    await seed({ employee_grade: 'P4' });
    await db.execute(
      sql.raw(promotionFor({ attributeKey: 'employee_grade', dataType: 'text', at: AT }).sql),
    );

    await db.execute(sql`
      UPDATE people.person SET custom = ${JSON.stringify({ employee_grade: 'P5' })}::jsonb
    `);

    const rows = await db.execute(sql`SELECT custom_employee_grade FROM people.person`);
    expect(String([...rows][0]?.['custom_employee_grade'])).toBe('P5');
  });

  it('refuses to be written into, because it is derived', async () => {
    await seed({ employee_grade: 'P4' });
    await db.execute(
      sql.raw(promotionFor({ attributeKey: 'employee_grade', dataType: 'text', at: AT }).sql),
    );

    await expect(
      db.execute(sql`UPDATE people.person SET custom_employee_grade = 'P9'`),
    ).rejects.toThrow();
  });

  it('creates the index the promotion exists for', async () => {
    await seed({ employee_grade: 'P4' });
    await db.execute(
      sql.raw(promotionFor({ attributeKey: 'employee_grade', dataType: 'text', at: AT }).sql),
    );

    const rows = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'people' AND indexname = 'person_custom_employee_grade_idx'
    `);
    // Tenant first: every directory query is scoped to one already.
    expect(String([...rows][0]?.['indexdef'])).toContain('(tenant_id, custom_employee_grade)');
  });

  it('casts a numeric attribute so a range filter is a range filter', async () => {
    await seed({ headcount_budget: '42' });
    await db.execute(
      sql.raw(promotionFor({ attributeKey: 'headcount_budget', dataType: 'number', at: AT }).sql),
    );

    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM people.person WHERE custom_headcount_budget > 40
    `);
    expect(Number([...rows][0]?.['n'])).toBe(1);
  });

  it('fails loudly when a row cannot be cast, rather than reading null', async () => {
    // The failure worth having. A column that silently read null for the bad
    // rows would make the directory stop finding exactly the people whose data
    // was wrong — and nobody would notice until one of them asked.
    await seed({ headcount_budget: 'not a number' });
    await expect(
      db.execute(
        sql.raw(promotionFor({ attributeKey: 'headcount_budget', dataType: 'number', at: AT }).sql),
      ),
    ).rejects.toThrow();
  });

  it('handles a row that has no value for the attribute at all', async () => {
    // Most rows, on the day an attribute is promoted.
    await seed({ something_else: 'x' });
    await db.execute(
      sql.raw(promotionFor({ attributeKey: 'employee_grade', dataType: 'text', at: AT }).sql),
    );

    const rows = await db.execute(sql`SELECT custom_employee_grade FROM people.person`);
    expect([...rows][0]?.['custom_employee_grade']).toBeNull();
  });
});

describe('what it refuses', () => {
  it('refuses a key that is not an attribute key', async () => {
    expect(() => promotionFor({ attributeKey: 'Employee Grade', dataType: 'text' })).toThrow(
      PromotionRefused,
    );
    await Promise.resolve();
  });

  it('refuses a type nothing filters a directory on', () => {
    // An address is a JSONB object, a document reference is a pointer, and a
    // repeating group has no single value to index.
    expect(() =>
      promotionFor({ attributeKey: 'home_address', dataType: 'address' as never }),
    ).toThrow(/not worth promoting/u);
  });

  it('refuses a name Postgres would truncate', () => {
    expect(() => promotionFor({ attributeKey: 'a'.repeat(60), dataType: 'text' })).toThrow(
      /truncates/u,
    );
  });
});

describe('the file it would write', () => {
  it('is named for the moment and the attribute, beside the other migrations', () => {
    const { fileName } = promotionFor({ attributeKey: 'employee_grade', dataType: 'text', at: AT });
    expect(fileName).toBe('20260923112233_promote_employee_grade.sql');
    expect(migrationsDirectory()).toMatch(/migrations\/$/u);
  });
});
