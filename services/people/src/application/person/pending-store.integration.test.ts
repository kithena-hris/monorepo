import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { open, seal, staticKeyRing } from '../../infrastructure/envelope.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { drizzlePendingChangeStore } from './pending-store.js';
import type { PendingChange } from './pending-changes.js';

/**
 * `people.pending_change` against a real database (PEO-077): a sealed value
 * is never stored as it came, its ciphertext goes when the change closes, a
 * change closes once, nobody decides their own, and one tenant sees none of
 * another's.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const ASKER = '00000000-0000-4000-8000-0000000000b1';
const HR = '00000000-0000-4000-8000-0000000000b2';
const IBAN = 'DE89370400440532013000';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);
const store = drizzlePendingChangeStore({
  seal: (plaintext) => seal(plaintext, ring),
  open: (sealed) => open(sealed, ring),
});

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await admin.execute(sql`DELETE FROM people.pending_change`);
});

function change(id: string, over: Partial<PendingChange> = {}): PendingChange {
  return {
    tenantId: ACME,
    personId: ADA,
    attributeKey: 'iban',
    kind: 'value',
    approval: {
      id,
      requestedBy: ASKER,
      requestedAt: '2026-09-22T09:00:00.000Z',
      reason: '',
      expiresAt: '2026-09-29T09:00:00.000Z',
      state: 'pending',
      decidedBy: null,
      decidedAt: null,
      note: null,
    },
    effectiveFrom: '2026-09-22',
    supersedes: null,
    sealed: true,
    value: null,
    last4: '3000',
    ...over,
  };
}

const ID = '01890000-0000-7000-8000-000000000001';
const OTHER = '01890000-0000-7000-8000-000000000002';

describe('a held change, stored', () => {
  it('keeps a sealed value sealed, opens it while pending, and drops it on close', async () => {
    const held = change(ID);
    await inTenant(ACME, ({ tx }) => store.insert(tx, held, JSON.stringify(IBAN)));

    const raw = await admin.execute(sql`SELECT * FROM people.pending_change`);
    expect(JSON.stringify([...raw])).not.toContain(IBAN.slice(0, 12));
    expect([...raw][0]).toMatchObject({ value: null, last4: '3000', key_id: 'k1' });

    const plain = await inTenant(ACME, ({ tx }) => store.unseal(tx, ACME, ID));
    expect(JSON.parse(plain ?? 'null')).toBe(IBAN);

    const closed = await inTenant(ACME, ({ tx }) =>
      store.close(tx, held, {
        ...held,
        approval: {
          ...held.approval,
          state: 'approved',
          decidedBy: HR,
          decidedAt: '2026-09-23T09:00:00.000Z',
        },
      }),
    );
    expect(closed).toBe(true);
    const after = await admin.execute(
      sql`SELECT ciphertext, key_id, state FROM people.pending_change`,
    );
    expect([...after][0]).toMatchObject({ ciphertext: null, key_id: null, state: 'approved' });
    expect(await inTenant(ACME, ({ tx }) => store.unseal(tx, ACME, ID))).toBeNull();
  });

  it('keeps a clear value as the write took it, and lists what is open', async () => {
    const salary = change(ID, {
      attributeKey: 'base_salary',
      sealed: false,
      value: { amountMinor: 5_500_000, currency: 'EUR' },
      last4: null,
    });
    await inTenant(ACME, async ({ tx }) => {
      await store.insert(tx, salary, null);
      await store.insert(tx, change(OTHER, { personId: ASKER }), JSON.stringify(IBAN));
    });
    const found = await inTenant(ACME, ({ tx }) => store.find(tx, ACME, ID));
    expect(found).toEqual(salary);
    const ada = await inTenant(ACME, ({ tx }) =>
      store.open(tx, ACME, { personId: ADA, limit: 10 }),
    );
    expect(ada.map((c) => c.approval.id)).toEqual([ID]);
    const all = await inTenant(ACME, ({ tx }) => store.open(tx, ACME, { limit: 10 }));
    expect(all).toHaveLength(2);
  });

  it('closes once: a second close, or a decision racing an expiry, loses', async () => {
    const held = change(ID);
    await inTenant(ACME, ({ tx }) => store.insert(tx, held, JSON.stringify(IBAN)));
    const expired = { ...held, approval: { ...held.approval, state: 'expired' as const } };
    const rejected = {
      ...held,
      approval: {
        ...held.approval,
        state: 'rejected' as const,
        decidedBy: HR,
        decidedAt: '2026-09-23T09:00:00.000Z',
      },
    };
    expect(await inTenant(ACME, ({ tx }) => store.close(tx, held, expired))).toBe(true);
    expect(await inTenant(ACME, ({ tx }) => store.close(tx, held, rejected))).toBe(false);
  });

  it('refuses a decision by the requester in the database too', async () => {
    const held = change(ID);
    await inTenant(ACME, ({ tx }) => store.insert(tx, held, JSON.stringify(IBAN)));
    await expect(
      inTenant(ACME, ({ tx }) =>
        store.close(tx, held, {
          ...held,
          approval: {
            ...held.approval,
            state: 'approved',
            decidedBy: ASKER,
            decidedAt: '2026-09-23T09:00:00.000Z',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('is invisible to another tenant', async () => {
    await inTenant(ACME, ({ tx }) => store.insert(tx, change(ID), JSON.stringify(IBAN)));
    const seen = await inTenant(GLOBEX, ({ tx }) => store.open(tx, ACME, { limit: 10 }));
    expect(seen).toEqual([]);
  });
});
