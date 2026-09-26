import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { startPostgres } from '@kithena/testing';

/**
 * A `text[]` literal, built rather than parameterised.
 *
 * postgres.js binds a JS array as an array, and an explicit `::text[]` cast on
 * top of that is what produces `malformed array literal`. The values here are
 * enum members and slugs the column's own CHECK constrains, so composing the
 * literal is safe and is what keeps the empty case — a field visible to
 * nobody — expressible.
 */
const textArray = (values: readonly string[]): string =>
  `{${values.map((v) => `"${v}"`).join(',')}}`;

/**
 * The registry tables, against a real database.
 *
 * Two claims are under test and neither survives a fake. **A definition
 * cannot be inserted without a policy** — there is no unclassified state, no
 * default meaning "decide later", and the column is the one check a form, an
 * import, a REST call and a country pack all pass through. And **a second
 * tenant sees none of it**, which is a property of the policy and the role
 * rather than of any query anybody writes.
 *
 * The constraints duplicate refinements the Zod contract already makes, and
 * that is deliberate rather than redundant: only one of those four writers
 * goes through the form path, and the constraint is what the other three
 * cannot route around.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let asPeople: PostgresJsDatabase;

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    // `platform.touch_updated_at`, which the registry's triggers call. Named
    // because this suite lists the migrations it needs: leaving it out fails
    // on the trigger, which reads like a bug in the table rather than a
    // missing function.
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260926160000_people_pending_change.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }

  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  asPeople = drizzle(serviceClient);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await admin.execute(sql`DELETE FROM people.attribute_definition`);
  await admin.execute(sql`DELETE FROM people.section`);
  await admin.execute(sql`TRUNCATE people.schema_version`);
});

function inTenant<T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  return asPeople.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

async function seedSection(tenantId: string, key = 'hr_information'): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${tenantId}::uuid, ${key},
            ${JSON.stringify({ default: 'HR information' })}::jsonb,
            0, ${textArray(['self', 'hr'])}::text[], 'core')
  `);
}

const POLICY = {
  classification: 'internal',
  piiKind: 'none',
  exportable: true,
  aiEligible: true,
};

/** Insert a definition as the service would, with one field overridden. */
function insertAttribute(
  tx: PostgresJsDatabase,
  tenantId: string,
  over: {
    key?: string;
    classification?: unknown;
    encrypted?: boolean;
    indexed?: boolean;
    includeInEvents?: boolean;
    dataType?: string;
    typeConfig?: unknown;
    ownership?: string[];
  } = {},
): Promise<unknown> {
  const classification = over.classification === undefined ? POLICY : over.classification;
  return tx.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at,
      classification, classification_source,
      encrypted, indexed, include_in_events, origin
    ) VALUES (
      ${tenantId}::uuid, ${over.key ?? 'employee_number'}, 'hr_information',
      ${JSON.stringify({ default: 'Employee number' })}::jsonb, 0,
      ${over.dataType ?? 'text'},
      ${JSON.stringify(over.typeConfig ?? { kind: over.dataType ?? 'text' })}::jsonb,
      'single',
      ${JSON.stringify({ mode: 'never' })}::jsonb,
      ${textArray(over.ownership ?? ['hr'])}::text[], ${textArray(['self', 'hr'])}::text[], 'hr_only',
      ${classification === null ? null : JSON.stringify(classification)}::jsonb,
      'human',
      ${over.encrypted ?? false}, ${over.indexed ?? false}, ${over.includeInEvents ?? false},
      'tenant'
    )
  `);
}

describe('a definition without a policy', () => {
  beforeEach(async () => {
    await seedSection(ACME);
  });

  it('cannot be inserted at all', async () => {
    // There is no unclassified state and no default meaning "decide later".
    await expect(
      inTenant(ACME, (tx) => insertAttribute(tx, ACME, { classification: null })),
    ).rejects.toThrow();
  });

  it('cannot be inserted with an empty object standing in for one', async () => {
    // NOT NULL alone would accept `{}`, which satisfies the column and answers
    // nothing.
    await expect(
      inTenant(ACME, (tx) => insertAttribute(tx, ACME, { classification: {} })),
    ).rejects.toThrow();
  });

  it('cannot be inserted with a classification nobody defined', async () => {
    await expect(
      inTenant(ACME, (tx) =>
        insertAttribute(tx, ACME, { classification: { ...POLICY, classification: 'secret' } }),
      ),
    ).rejects.toThrow();
  });

  it('is accepted once it carries a complete one', async () => {
    await inTenant(ACME, (tx) => insertAttribute(tx, ACME));
    const rows = await admin.execute(sql`SELECT key FROM people.attribute_definition`);
    expect([...rows]).toHaveLength(1);
  });
});

describe('the refinements a form is not the only way past', () => {
  beforeEach(async () => {
    await seedSection(ACME);
  });

  it('refuses special-category data that travels on an event', async () => {
    await expect(
      inTenant(ACME, (tx) =>
        insertAttribute(tx, ACME, {
          classification: { ...POLICY, classification: 'special-category', aiEligible: false },
          includeInEvents: true,
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses special-category data that claims to be AI-eligible', async () => {
    await expect(
      inTenant(ACME, (tx) =>
        insertAttribute(tx, ACME, {
          classification: { ...POLICY, classification: 'special-category', aiEligible: true },
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses financial data that is not encrypted', async () => {
    await expect(
      inTenant(ACME, (tx) =>
        insertAttribute(tx, ACME, {
          classification: { ...POLICY, piiKind: 'financial', aiEligible: false },
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses an encrypted attribute that is also indexed', async () => {
    await expect(
      inTenant(ACME, (tx) => insertAttribute(tx, ACME, { encrypted: true, indexed: true })),
    ).rejects.toThrow();
  });

  it('refuses a config describing a different data type', async () => {
    await expect(
      inTenant(ACME, (tx) =>
        insertAttribute(tx, ACME, { dataType: 'text', typeConfig: { kind: 'long_text' } }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a field nobody may write', async () => {
    await expect(
      inTenant(ACME, (tx) => insertAttribute(tx, ACME, { ownership: [] })),
    ).rejects.toThrow();
  });

  it('refuses a key that could not be a key', async () => {
    await expect(
      inTenant(ACME, (tx) => insertAttribute(tx, ACME, { key: 'Employee-Number' })),
    ).rejects.toThrow();
  });
});

describe('one tenant and another', () => {
  beforeEach(async () => {
    await seedSection(ACME);
    await seedSection(GLOBEX);
    await inTenant(ACME, (tx) => insertAttribute(tx, ACME, { key: 'acme_field' }));
    await inTenant(GLOBEX, (tx) => insertAttribute(tx, GLOBEX, { key: 'globex_field' }));
  });

  it('sees none of each other\'s registry', async () => {
    const acme = await inTenant(ACME, async (tx) => [
      ...(await tx.execute(sql`SELECT key FROM people.attribute_definition`)),
    ]);
    const globex = await inTenant(GLOBEX, async (tx) => [
      ...(await tx.execute(sql`SELECT key FROM people.attribute_definition`)),
    ]);

    expect(acme.map((r) => r['key'])).toEqual(['acme_field']);
    expect(globex.map((r) => r['key'])).toEqual(['globex_field']);
  });

  it('sees none of each other\'s sections either', async () => {
    const seen = await inTenant(ACME, async (tx) => [
      ...(await tx.execute(sql`SELECT tenant_id FROM people.section`)),
    ]);
    expect(seen).toHaveLength(1);
  });

  it('cannot write a definition into the other one', async () => {
    await expect(
      inTenant(ACME, (tx) => insertAttribute(tx, GLOBEX, { key: 'smuggled' })),
    ).rejects.toThrow();
  });

  it('cannot point an attribute at a section belonging to somebody else', async () => {
    // The foreign key is composite for exactly this: a reference that crossed
    // a tenant boundary would be a field rendered from another customer's
    // section.
    await admin.execute(sql`
      INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
      VALUES (${GLOBEX}::uuid, 'globex_only',
              ${JSON.stringify({ default: 'Globex only' })}::jsonb, 0,
              ${textArray([])}::text[], 'tenant')
    `);

    await expect(
      admin.execute(sql`
        INSERT INTO people.attribute_definition (
          tenant_id, key, section_key, labels, data_type, type_config,
          requiredness, ownership, collect_at, classification, classification_source, origin
        ) VALUES (
          ${ACME}::uuid, 'borrowed', 'globex_only',
          ${JSON.stringify({ default: 'Borrowed' })}::jsonb, 'text',
          ${JSON.stringify({ kind: 'text' })}::jsonb,
          ${JSON.stringify({ mode: 'never' })}::jsonb,
          ${textArray(['hr'])}::text[], 'hr_only',
          ${JSON.stringify(POLICY)}::jsonb, 'human', 'tenant'
        )
      `),
    ).rejects.toThrow();
  });
});

describe('a published version', () => {
  const document = {
    sections: [{ key: 'hr_information' }],
    attributes: [{ key: 'employee_number' }],
  };

  async function publish(version: number, checksum = 'a'.repeat(64)): Promise<void> {
    await admin.execute(sql`
      INSERT INTO people.schema_version (tenant_id, version, checksum, document)
      VALUES (${ACME}::uuid, ${version}, ${checksum}, ${JSON.stringify(document)}::jsonb)
    `);
  }

  it('cannot be edited after the fact', async () => {
    // An integrator pinned to version 3 keeps getting version 3, and a DSAR
    // export is generated from the version the record was written under. The
    // domain freezes the object; this is what stops an UPDATE from a support
    // session or a repository written in a hurry.
    await publish(1);
    await expect(
      admin.execute(sql`UPDATE people.schema_version SET checksum = ${'b'.repeat(64)}`),
    ).rejects.toThrow();

    // And the row is what it was. The refusal is the point, but a refusal that
    // left the row edited would be worse than no trigger at all.
    const rows = await admin.execute(sql`SELECT checksum FROM people.schema_version`);
    expect(String([...rows][0]?.['checksum'])).toBe('a'.repeat(64));
  });

  it('cannot be deleted', async () => {
    await publish(1);
    await expect(admin.execute(sql`DELETE FROM people.schema_version`)).rejects.toThrow();

    const rows = await admin.execute(sql`SELECT version FROM people.schema_version`);
    expect([...rows]).toHaveLength(1);
  });

  it('cannot be published twice under one number', async () => {
    await publish(1);
    await expect(publish(1)).rejects.toThrow();
  });

  it('cannot be empty', async () => {
    // A version with no fields validates every record as complete.
    await expect(
      admin.execute(sql`
        INSERT INTO people.schema_version (tenant_id, version, checksum, document)
        VALUES (${ACME}::uuid, 9, ${'c'.repeat(64)},
                ${JSON.stringify({ sections: [], attributes: [] })}::jsonb)
      `),
    ).rejects.toThrow();
  });

  it('cannot claim to roll back to a version that comes after it', async () => {
    await expect(
      admin.execute(sql`
        INSERT INTO people.schema_version (tenant_id, version, checksum, document, rolled_back_from)
        VALUES (${ACME}::uuid, 2, ${'d'.repeat(64)}, ${JSON.stringify(document)}::jsonb, 5)
      `),
    ).rejects.toThrow();
  });

  it('is invisible to another tenant', async () => {
    await publish(1);
    const seen = await inTenant(GLOBEX, async (tx) => [
      ...(await tx.execute(sql`SELECT version FROM people.schema_version`)),
    ]);
    expect(seen).toEqual([]);
  });
});

describe('what the service role may do', () => {
  it('appends a version and cannot revise one', async () => {
    // The trigger refuses everyone; the grant refuses the service before it
    // gets that far. Two answers to the same question, and the one that
    // survives somebody dropping the trigger is the grant.
    const grants = await admin.execute(sql`
      SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'svc_people' AND table_name = 'schema_version'
       ORDER BY privilege_type
    `);
    expect([...grants].map((r) => r['privilege_type'])).toEqual(['INSERT', 'SELECT']);
  });

  it('never deletes a definition or a section', async () => {
    // Archived, not deleted. A section that disappeared would take its
    // attributes' history with it as far as any reader is concerned.
    const grants = await admin.execute(sql`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'svc_people' AND privilege_type = 'DELETE'
    `);
    expect([...grants]).toEqual([]);
  });
});
