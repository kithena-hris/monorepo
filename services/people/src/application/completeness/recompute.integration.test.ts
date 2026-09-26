import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { PersonProfileCompleted, PersonProfileIncomplete } from '@kithena/contracts';
import { fixedClock, type Clock } from '@kithena/domain-kit';
import { UTC_CALENDAR, type TenantCalendar } from '../../domain/org/calendar.js';
import { fixedCalendars } from '../org/org.js';
import { startPostgres } from '@kithena/testing';

import { drizzleCompletenessStore } from '../../infrastructure/drizzle-completeness-store.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { publishSchema } from '../schema/publish-schema.js';
import { recomputeCompleteness } from './recompute.js';
import { sweepReminders, type ReminderMailer } from './reminders.js';
import type { Reminder } from './store.js';

/**
 * PEO-026: a tightening publish over 400 people, the events it raises, and the
 * one-email-per-week cap.
 *
 * The event count is asserted against the preview's own number, because that
 * is the promise the settings screen makes: "this makes 300 of 400 people
 * incomplete" has to be the number of people who then hear about it.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const T0 = '2026-09-23T09:00:00.000Z';
const HOUR = 3_600_000;
const at = (offsetMs: number): Clock =>
  fixedClock(new Date(Date.parse(T0) + offsetMs).toISOString());

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const newEventId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
};

const store = drizzleCompletenessStore();
const deps = (clock: Clock, calendar: TenantCalendar = UTC_CALENDAR) => ({
  schema: drizzleSchemaRepository(),
  people: drizzlePeopleFacts(),
  store,
  clock,
  newEventId,
  // Small, so 400 people cross several batch boundaries.
  batchSize: 64,
  calendars: fixedCalendars(calendar),
});

const actor = { kind: 'system', process: 'integration-test' } as const;
const correlationId = '00000000-0000-4000-8000-0000000000c1';

const publishRequest = {
  tenantId: ACME,
  actor,
  publishedBy: null,
  correlationId,
  artifactUrl: 'https://api.kithena.test/v1/people/schema',
};

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
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924320000_people_effective_through.sql',
    '20260924330000_people_identifier_review.sql',
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
  await admin.execute(sql`TRUNCATE people.schema_version`);
  await admin.execute(sql`DELETE FROM people.outbox`);
  await admin.execute(sql`DELETE FROM people.completeness_gap`);
  await admin.execute(sql`DELETE FROM people.person`);
  await admin.execute(sql`DELETE FROM people.attribute_definition`);
  await admin.execute(sql`DELETE FROM people.section`);
  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'hr_information', ${JSON.stringify({ default: 'HR' })}::jsonb, 0,
            ${'{"self","hr"}'}::text[], 'core')
  `);
});

async function defineAttribute(
  key: string,
  owner: 'hr' | 'employee',
  required: boolean,
  requiredFrom: string | null = null,
): Promise<void> {
  const requiredness = required
    ? { mode: 'always', requiredFrom, appliesTo: 'all_records' }
    : { mode: 'never' };
  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, 'hr_information', ${JSON.stringify({ default: key })}::jsonb, 0, 'text',
      ${JSON.stringify({ kind: 'text' })}::jsonb, 'single', ${JSON.stringify(requiredness)}::jsonb,
      ${`{"${owner}"}`}::text[], ${'{"self","hr"}'}::text[], 'anytime',
      ${JSON.stringify({ classification: 'internal', piiKind: 'none', exportable: true, aiEligible: true })}::jsonb,
      'human', 'tenant'
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET requiredness = EXCLUDED.requiredness
  `);
}

/** `n` active people; the first `answered` have every field in `bag` filled in. */
async function seed(
  n: number,
  answered: number,
  bag: Record<string, string>,
  status = 'active',
): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.person (tenant_id, status, given_name, work_email, custom)
    SELECT ${ACME}::uuid, ${status}, 'Ada', 'p' || i || '@acme.test',
           CASE WHEN i <= ${answered} THEN ${JSON.stringify(bag)}::jsonb ELSE '{}'::jsonb END
    FROM generate_series(1, ${n}) AS i
  `);
}

async function publishAndRecompute(
  clock: Clock,
  calendar?: TenantCalendar,
  /** When the `schema.published` event is consumed, if not at once. */
  consumedBy: Clock = clock,
) {
  const published = await inTenant(ACME, ({ tx }) =>
    publishSchema(deps(clock, calendar)).publish(tx, publishRequest),
  );
  if (!published.ok) throw new Error(published.error.message);

  const recomputed = await inTenant(ACME, ({ tx }) =>
    recomputeCompleteness(deps(consumedBy, calendar))(tx, {
      tenantId: ACME,
      schemaVersion: published.value.version.version,
      actor,
      correlationId,
      causationId: null,
    }),
  );
  if (!recomputed.ok) throw new Error(recomputed.error.message);
  return {
    preview: published.value.preview,
    summary: recomputed.value,
    version: published.value.version.version,
  };
}

async function outbox(eventName: string): Promise<unknown[]> {
  const rows = await admin.execute(
    sql`SELECT envelope FROM people.outbox WHERE event_name = ${eventName}`,
  );
  return [...rows].map((r) => r['envelope']);
}

function recordingMailer(): ReminderMailer & { sent: Reminder[] } {
  const sent: Reminder[] = [];
  return {
    sent,
    send(_tenantId, _company, reminder) {
      sent.push(reminder);
      return Promise.resolve();
    },
  };
}

async function seededIds(): Promise<string[]> {
  const rows = await admin.execute(
    sql`SELECT person_id FROM people.completeness_gap WHERE cardinality(employee_keys) > 0 ORDER BY person_id`,
  );
  return [...rows].map((r) => String(r['person_id']));
}

const ACME_CO = { name: 'Acme Corp', origin: 'https://acme.app.kithena.test' };

const sweep = (clock: Clock, mailer: ReminderMailer, calendar: TenantCalendar = UTC_CALENDAR) =>
  sweepReminders({
    inTenant,
    store,
    mailer,
    clock,
    calendars: fixedCalendars(calendar),
    company: () => Promise.resolve(ACME_CO),
  })(ACME);

describe('a tightening publish over 400 people', () => {
  beforeEach(async () => {
    // Version 1: two optional fields. 400 people, 100 of whom have both.
    await defineAttribute('cost_centre', 'hr', false);
    await defineAttribute('emergency_contact', 'employee', false);
    await seed(400, 100, { cost_centre: 'CC-1', emergency_contact: 'Grace' });
    await publishAndRecompute(at(0));
    await admin.execute(sql`DELETE FROM people.outbox`);
  });

  it('raises one profile_incomplete per person the preview said would become incomplete', async () => {
    await defineAttribute('cost_centre', 'hr', true);
    await defineAttribute('emergency_contact', 'employee', true);

    const { preview, summary } = await publishAndRecompute(at(0));

    expect(preview.impact.becomingIncomplete).toBe(300);
    expect(summary).toMatchObject({ evaluated: 400, becameIncomplete: 300, superseded: false });

    const events = await outbox('people.person.profile_incomplete');
    expect(events).toHaveLength(preview.impact.becomingIncomplete);

    // Each one is a valid contract event naming both keys and who owns each.
    for (const envelope of events) {
      const parsed = PersonProfileIncomplete.parse(envelope) as {
        payload: { missing: { key: string; owners: string[] }[]; schemaVersion: number };
      };
      expect(parsed.payload.schemaVersion).toBe(2);
      expect(parsed.payload.missing).toEqual([
        expect.objectContaining({ key: 'cost_centre', owners: ['hr'] }),
        expect.objectContaining({ key: 'emergency_contact', owners: ['employee'] }),
      ]);
    }

    const states = await admin.execute(sql`
      SELECT completeness, count(*)::int AS n FROM people.person GROUP BY completeness ORDER BY completeness
    `);
    expect([...states].map((r) => [r['completeness'], r['n']])).toEqual([
      ['complete', 100],
      ['incomplete', 300],
    ]);
  });

  it('raises nothing twice when the same publish is delivered again', async () => {
    await defineAttribute('cost_centre', 'hr', true);
    const { version } = await publishAndRecompute(at(0));

    const again = await inTenant(ACME, ({ tx }) =>
      recomputeCompleteness(deps(at(0)))(tx, {
        tenantId: ACME,
        schemaVersion: version,
        actor,
        correlationId,
        causationId: null,
      }),
    );
    expect(again.ok && again.value.becameIncomplete).toBe(0);
    expect(await outbox('people.person.profile_incomplete')).toHaveLength(300);
  });

  it('does nothing for a version a later one has replaced', async () => {
    await defineAttribute('cost_centre', 'hr', true);
    await publishAndRecompute(at(0));
    await defineAttribute('emergency_contact', 'employee', true);
    await publishAndRecompute(at(0));

    const late = await inTenant(ACME, ({ tx }) =>
      recomputeCompleteness(deps(at(0)))(tx, {
        tenantId: ACME,
        schemaVersion: 2,
        actor,
        correlationId,
        causationId: null,
      }),
    );
    expect(late.ok && late.value.superseded).toBe(true);
  });

  it('raises profile_completed when a loosening publish closes the gap', async () => {
    await defineAttribute('cost_centre', 'hr', true);
    await publishAndRecompute(at(0));
    await defineAttribute('cost_centre', 'hr', false);

    const { preview, summary } = await publishAndRecompute(at(0));

    expect(summary.becameComplete).toBe(preview.impact.becomingComplete);
    const completed = await outbox('people.person.profile_completed');
    expect(completed).toHaveLength(300);
    expect(() => PersonProfileCompleted.parse(completed[0])).not.toThrow();
  });

  it('gives HR one grid row per missing field, not a task per person', async () => {
    await defineAttribute('cost_centre', 'hr', true);
    await defineAttribute('emergency_contact', 'employee', true);
    await publishAndRecompute(at(0));

    const grid = await inTenant(ACME, ({ tx }) => store.staffGrid(tx, ACME, '2026-09-22'));
    expect(grid).toHaveLength(1);
    expect(grid[0]).toMatchObject({ task: 'missing', key: 'cost_centre' });
    expect(grid[0]?.personIds).toHaveLength(300);
  });

  it('never evaluates a provisional record', async () => {
    await seed(5, 0, {}, 'provisional');
    await defineAttribute('emergency_contact', 'employee', true);
    const { summary } = await publishAndRecompute(at(0));

    expect(summary.becameIncomplete).toBe(300);
    const provisional = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.person p
        JOIN people.completeness_gap g ON g.person_id = p.id
       WHERE p.status = 'provisional' AND cardinality(g.employee_keys) > 0
    `);
    expect([...provisional][0]?.['n']).toBe(0);
  });
});

describe('a required core field', () => {
  it('is missing for nobody who has it, in the preview and in the recompute', async () => {
    // PEO-079: `hire_date` and `work_email` are columns, not `custom` keys.
    await defineAttribute('hire_date', 'hr', true);
    await defineAttribute('work_email', 'hr', true);
    await seed(40, 0, {});
    await admin.execute(sql`UPDATE people.person SET hire_date = '2024-01-01'`);

    const { preview, summary } = await publishAndRecompute(at(0));

    expect(preview.impact).toMatchObject({ evaluated: 40, becomingIncomplete: 0 });
    expect(summary).toMatchObject({ evaluated: 40, becameIncomplete: 0 });
    expect(await outbox('people.person.profile_incomplete')).toHaveLength(0);
  });
});

describe('a tenant whose calendar is not UTC', () => {
  it('counts a requiredFrom on the local date the preview used, not the UTC one', async () => {
    // 13:00 UTC on the 23rd is 01:00 on the 24th in Auckland (NZST, UTC+12).
    // A field required from the 24th is required locally and not yet in UTC,
    // so a recompute that assumed UTC would raise nothing at all. The
    // recompute below is called the way the consumer calls it: with no time
    // zone, because `schema.published` does not carry one.
    const nearMidnight = fixedClock('2026-09-23T13:00:00.000Z');
    await defineAttribute('cost_centre', 'hr', true, '2026-09-24');
    await seed(40, 10, { cost_centre: 'CC-1' });

    const { preview, summary } = await publishAndRecompute(
      nearMidnight,
      { ...UTC_CALENDAR, defaultZone: 'Pacific/Auckland' },
      // Consumed a day later: the recompute replays the preview's instant.
      fixedClock('2026-09-24T13:00:00.000Z'),
    );

    expect(preview.impact.becomingIncomplete).toBe(30);
    expect(summary.becameIncomplete).toBe(preview.impact.becomingIncomplete);
    expect(await outbox('people.person.profile_incomplete')).toHaveLength(30);
  });

  it('counts entities in Madrid and Bangalore each on their own day', async () => {
    const MADRID = '00000000-0000-4000-8000-0000000000e1';
    const BANGALORE = '00000000-0000-4000-8000-0000000000e2';
    const calendar: TenantCalendar = {
      defaultZone: 'Europe/Madrid',
      entities: new Map([
        [MADRID, { id: MADRID, name: 'Acme SL', country: 'ES', timeZone: 'Europe/Madrid' }],
        [BANGALORE, { id: BANGALORE, name: 'Acme India', country: 'IN', timeZone: 'Asia/Kolkata' }],
      ]),
      locations: new Map(),
    };
    await defineAttribute('cost_centre', 'hr', true, '2026-09-24');
    for (const [entity, n] of [
      [MADRID, 20],
      [BANGALORE, 12],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- two inserts
      await admin.execute(sql`
        INSERT INTO people.person (tenant_id, status, given_name, work_email, legal_entity_id)
        SELECT ${ACME}::uuid, 'active', 'Ada', ${entity} || '-' || i || '@acme.test', ${entity}::uuid
        FROM generate_series(1, ${n}) AS i`);
    }

    // 20:00 UTC on the 23rd: 01:30 on the 24th in Bangalore, 22:00 on the 23rd in Madrid.
    const { preview, summary } = await publishAndRecompute(
      fixedClock('2026-09-23T20:00:00.000Z'),
      calendar,
    );
    expect(preview.impact.becomingIncomplete).toBe(12);
    expect(summary.becameIncomplete).toBe(12);
  });
});

describe('the reminder cap: one email per person per week', () => {
  beforeEach(async () => {
    await defineAttribute('emergency_contact', 'employee', true);
    await defineAttribute('bank_holiday_region', 'employee', false);
    await defineAttribute('cost_centre', 'hr', true);
    await seed(400, 100, { emergency_contact: 'Grace', cost_centre: 'CC-1' });
    await publishAndRecompute(at(0));
  });

  it("waits for working hours on the person's own clock", async () => {
    const mailer = recordingMailer();
    const auckland = { ...UTC_CALENDAR, defaultZone: 'Pacific/Auckland' };
    // T0 is 09:00 UTC: 21:00 in Auckland. Nobody there is emailed at night.
    expect((await sweep(at(0), mailer, auckland)).sent).toBe(0);
    // Twelve hours on it is 09:00 in Auckland, and the week has not begun.
    expect((await sweep(at(12 * HOUR), mailer, auckland)).sent).toBe(300);
  });

  it('sends one email per person however many fields are missing, then none for 168 hours', async () => {
    const mailer = recordingMailer();

    expect(await sweep(at(0), mailer)).toEqual({ sent: 300, failed: 0, waiting: false });
    // One per person, not one per field.
    expect(new Set(mailer.sent.map((r) => r.personId)).size).toBe(300);

    expect((await sweep(at(1 * HOUR), mailer)).sent).toBe(0);
    expect((await sweep(at(167 * HOUR), mailer)).sent).toBe(0);
    expect((await sweep(at(168 * HOUR), mailer)).sent).toBe(300);
    expect(mailer.sent).toHaveLength(600);
  });

  it('does not reset the week when a second publish adds another missing field', async () => {
    const mailer = recordingMailer();
    await sweep(at(0), mailer);

    // Two days later HR marks a second employee field required.
    await defineAttribute('bank_holiday_region', 'employee', true);
    await publishAndRecompute(at(48 * HOUR));

    // The 300 already emailed hear nothing more. The 100 who were complete
    // until now have never been emailed, so they get their first.
    const first = new Set(mailer.sent.map((r) => r.personId));
    expect((await sweep(at(48 * HOUR), mailer)).sent).toBe(100);
    expect(mailer.sent.slice(300).some((r) => first.has(r.personId))).toBe(false);

    // When the first 300's week is up, one email each names both fields.
    expect((await sweep(at(168 * HOUR), mailer)).sent).toBe(300);
    expect(mailer.sent.at(-1)?.keys.toSorted()).toEqual([
      'bank_holiday_region',
      'emergency_contact',
    ]);
  });

  it('holds when two sweeps race', async () => {
    const mailer = recordingMailer();
    const [a, b] = await Promise.all([sweep(at(0), mailer), sweep(at(0), mailer)]);
    expect(a.sent + b.sent).toBe(300);
    expect(new Set(mailer.sent.map((r) => r.personId)).size).toBe(300);
  });

  it('holds across a person closing the gap and reopening it within the week', async () => {
    const mailer = recordingMailer();
    await sweep(at(0), mailer);

    // Everybody fills it in, the gap closes, then a new required field opens it.
    await admin.execute(
      sql`UPDATE people.person SET custom = custom || '{"emergency_contact":"x"}'`,
    );
    await defineAttribute('emergency_contact', 'employee', false);
    await publishAndRecompute(at(24 * HOUR));
    await defineAttribute('bank_holiday_region', 'employee', true);
    await publishAndRecompute(at(48 * HOUR));

    // Only the hundred who were never emailed hear about it.
    const first = new Set(mailer.sent.map((r) => r.personId));
    expect((await sweep(at(48 * HOUR), mailer)).sent).toBe(100);
    expect(mailer.sent.slice(300).some((r) => first.has(r.personId))).toBe(false);
  });

  it('sends on day 1, then weekly: nothing on day 3, one on day 7, one on day 14', async () => {
    const mailer = recordingMailer();
    const DAY = 24 * HOUR;
    const one = (await seededIds())[0] ?? '';
    const heard = () => mailer.sent.filter((r) => r.personId === one).length;

    await sweep(at(0), mailer);
    expect(heard()).toBe(1);
    await sweep(at(3 * DAY), mailer);
    expect(heard()).toBe(1);
    await sweep(at(7 * DAY), mailer);
    expect(heard()).toBe(2);
    await sweep(at(10 * DAY), mailer);
    await sweep(at(14 * DAY), mailer);
    expect(heard()).toBe(3);
  });

  it('stops emailing a person once their profile is complete', async () => {
    const mailer = recordingMailer();
    await sweep(at(0), mailer);

    // Fifty of the three hundred fill everything in; their gap rows empty.
    const done = mailer.sent.slice(0, 50).map((r) => r.personId);
    await inTenant(ACME, ({ tx }) =>
      store.saveGaps(
        tx,
        ACME,
        1,
        done.map((personId) => ({ personId, employeeKeys: [], staffKeys: [] })),
      ),
    );

    expect((await sweep(at(168 * HOUR), mailer)).sent).toBe(250);
    expect(mailer.sent.slice(300).some((r) => done.includes(r.personId))).toBe(false);
  });

  it('reads and claims in bounded pages and still reaches everyone once', async () => {
    const page = await inTenant(ACME, ({ tx }) =>
      store.dueReminders(tx, ACME, at(0).now(), { after: null, limit: 25 }),
    );
    expect(page).toHaveLength(25);

    const mailer = recordingMailer();
    const result = await sweepReminders({
      inTenant,
      store,
      mailer,
      clock: at(0),
      calendars: fixedCalendars(UTC_CALENDAR),
      company: () => Promise.resolve(ACME_CO),
      batchSize: 7,
    })(ACME);
    expect(result).toEqual({ sent: 300, failed: 0, waiting: false });
    expect(new Set(mailer.sent.map((r) => r.personId)).size).toBe(300);
  });

  it('waits, claiming nothing, until the company is known — then sends', async () => {
    const mailer = recordingMailer();
    let company: typeof ACME_CO | null = null;
    const run = () =>
      sweepReminders({
        inTenant,
        store,
        mailer,
        clock: at(0),
        calendars: fixedCalendars(UTC_CALENDAR),
        company: () => Promise.resolve(company),
      })(ACME);

    expect(await run()).toEqual({ sent: 0, failed: 0, waiting: true });
    const claimed = await admin.execute(
      sql`SELECT count(*)::int AS n FROM people.completeness_gap WHERE reminded_at IS NOT NULL`,
    );
    expect([...claimed][0]?.['n']).toBe(0);

    company = ACME_CO;
    expect((await run()).sent).toBe(300);
  });

  it('never emails about a field HR owns', async () => {
    await defineAttribute('emergency_contact', 'employee', false);
    await publishAndRecompute(at(0));

    const mailer = recordingMailer();
    expect((await sweep(at(0), mailer)).sent).toBe(0);
  });
});
