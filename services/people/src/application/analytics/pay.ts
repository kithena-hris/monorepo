import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import { CalendarDate, TenantId, type AttributeDefinition } from '@kithena/contracts';

import {
  Decimal,
  mayEditPayBands,
  maySeePay,
  payBand,
  payGroups,
  type PayBand,
  type PayBandInput,
  type PayFact,
  type PayMeasure,
} from '../../domain/pay/pay.js';
import { exponentOf } from '../import/cells.js';
import type { Asking } from '../person/person-access.js';
import { cohortMinimum } from './access.js';
import { dayOf, rows, tenureBand, type SnapshotRun, type TenantScope } from './snapshot.js';

/**
 * Pay bands, and pay in aggregate for finance (PEO-078; PRD §16.2).
 *
 * Three product decisions, recorded in the PRD:
 *
 * 1. **Bands live in People**, per grade and currency, effective-dated,
 *    maintained by HR or finance, each change a `people.pay_band.*` event so
 *    a Compensation module can take them over.
 * 2. **The nightly snapshot may decrypt a sealed salary in memory to count
 *    aggregates**, and stores only the aggregates — quartiles per group —
 *    with an audit row per run saying how many values it read.
 * 3. **Finance sees quartiles only**, per group, and a group under the cohort
 *    minimum shows nothing but "insufficient data". Never a minimum or a
 *    maximum, never a point per person, never two currencies in one figure.
 *
 * Money crosses every edge here in minor units, as digit strings; Postgres
 * holds `numeric(19,4)`; arithmetic is `decimal.js`.
 */

type Tx = PostgresJsDatabase;

/** The salary the charts are about, and the grade a band is for (PRD Appendix A). */
export const SALARY_KEY = 'base_salary';
export const GRADE_KEY = 'grade';

const scale = (currency: string): Decimal => new Decimal(10).pow(exponentOf(currency) ?? 2);

/** `"55000.0000"` EUR → `"5500000"`. */
const toMinor = (major: string, currency: string): string =>
  new Decimal(major).times(scale(currency)).toFixed(0);

/** `"5500000"` EUR → `"55000"`, for `numeric(19,4)`. */
const toMajor = (minor: Decimal, currency: string): string => minor.div(scale(currency)).toFixed();

// ----------------------------------------------------------------- bands --

export interface PayBandView {
  readonly id: string;
  readonly grade: string;
  readonly currency: string;
  readonly minimumMinor: string;
  readonly midpointMinor: string;
  readonly maximumMinor: string;
  readonly effectiveFrom: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly supersedes: string | null;
}

interface BandRow {
  id: string;
  grade: string;
  currency: string;
  minimum: string;
  midpoint: string;
  maximum: string;
  effective_from: string;
  recorded_at: string;
  recorded_by: string;
  supersedes: string | null;
}

const viewOf = (r: BandRow): PayBandView => ({
  id: r.id,
  grade: r.grade,
  currency: r.currency,
  minimumMinor: toMinor(r.minimum, r.currency),
  midpointMinor: toMinor(r.midpoint, r.currency),
  maximumMinor: toMinor(r.maximum, r.currency),
  effectiveFrom: r.effective_from,
  recordedAt: r.recorded_at,
  recordedBy: r.recorded_by,
  supersedes: r.supersedes,
});

const BAND_COLUMNS = sql`id::text, grade, currency, minimum::text, midpoint::text, maximum::text,
  effective_from::text, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
  recorded_by::text, supersedes::text`;

/**
 * Not superseded: the recording of its grade, currency and day that stands.
 * Asked of the chain rather than of `recorded_at`, which two writes in one
 * millisecond share.
 */
const standing = sql`NOT EXISTS (SELECT 1 FROM people.pay_band s
                                  WHERE s.tenant_id = b.tenant_id AND s.supersedes = b.id)`;

/** Every (grade, currency, day) as it now stands. */
async function currentBands(tx: Tx, tenantId: string): Promise<BandRow[]> {
  return rows<BandRow>(
    tx,
    sql`SELECT ${BAND_COLUMNS} FROM people.pay_band b
         WHERE b.tenant_id = ${tenantId}::uuid AND ${standing}
         ORDER BY grade, currency, effective_from DESC`,
  );
}

/** The band in force on `day` for each grade and currency, in minor units. */
export async function bandsInForce(tx: Tx, tenantId: string, day: string): Promise<PayBandView[]> {
  const found = await rows<BandRow>(
    tx,
    sql`SELECT DISTINCT ON (grade, currency) ${BAND_COLUMNS}
          FROM people.pay_band b
         WHERE b.tenant_id = ${tenantId}::uuid AND effective_from <= ${day}::date AND ${standing}
         ORDER BY grade, currency, effective_from DESC`,
  );
  return found.map(viewOf);
}

const bandOf = (v: PayBandView): PayBand => ({
  grade: v.grade,
  currency: v.currency,
  minimum: new Decimal(v.minimumMinor),
  midpoint: new Decimal(v.midpointMinor),
  maximum: new Decimal(v.maximumMinor),
  effectiveFrom: v.effectiveFrom,
});

const Forbidden = failure('FORBIDDEN', 'Pay bands are for HR and finance');

export interface PayBands {
  /** Every band as it now stands, newest day first per grade; HR or finance. */
  list(tx: Tx, asking: Asking): Promise<Result<readonly PayBandView[]>>;
  /**
   * Set a band from a day, or correct the one recorded for that day; HR or
   * finance. A row and a `people.pay_band.set`/`corrected` event, together.
   */
  set(tx: Tx, asking: Asking, input: PayBandInput): Promise<Result<PayBandView>>;
}

export function payBands(deps: {
  readonly clock: Clock;
  readonly newId: () => string;
  readonly publish: (tx: Tx, events: readonly PendingEvent[]) => Promise<void>;
}): PayBands {
  return {
    async list(tx, asking) {
      if (!mayEditPayBands(asking.viewer.roles)) return err(Forbidden);
      return ok((await currentBands(tx, asking.tenantId)).map(viewOf));
    },

    async set(tx, asking, input) {
      if (!mayEditPayBands(asking.viewer.roles)) return err(Forbidden);
      const band = payBand(input);
      if (!band.ok) return band;
      const { grade, currency, effectiveFrom } = band.value;
      const exponent = exponentOf(currency);
      if (exponent === null || exponent > 4) {
        return err(
          failure('VALUE_INVALID', `${currency} is not a currency People knows`, ['currency']),
        );
      }

      // One writer per tenant at a time, so two corrections of one day both
      // name the row the other did not replace.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`people.pay_band:${asking.tenantId}`}, 0))`,
      );
      const [previous] = await rows<{ id: string }>(
        tx,
        sql`SELECT id::text FROM people.pay_band b
             WHERE b.tenant_id = ${asking.tenantId}::uuid AND grade = ${grade}
               AND currency = ${currency} AND effective_from = ${effectiveFrom}::date
               AND ${standing}`,
      );
      const supersedes = previous?.id ?? null;
      const id = deps.newId();
      const at = deps.clock.instant();
      const major = (d: Decimal) => toMajor(d, currency);

      await tx.execute(sql`
        INSERT INTO people.pay_band
          (tenant_id, id, grade, currency, minimum, midpoint, maximum, effective_from,
           supersedes, recorded_at, recorded_by)
        VALUES (${asking.tenantId}::uuid, ${id}::uuid, ${grade}, ${currency},
                ${major(band.value.minimum)}::numeric, ${major(band.value.midpoint)}::numeric,
                ${major(band.value.maximum)}::numeric, ${effectiveFrom}::date,
                ${supersedes}::uuid, ${at}::timestamptz, ${asking.viewer.accountId}::uuid)`);

      const money = (d: Decimal) => ({ amountMinor: d.toNumber(), currency });
      await deps.publish(tx, [
        {
          eventId: deps.newId(),
          eventName: supersedes === null ? 'people.pay_band.set' : 'people.pay_band.corrected',
          eventVersion: 1,
          tenantId: TenantId.parse(asking.tenantId),
          occurredAt: at,
          effectiveFrom: CalendarDate.parse(effectiveFrom),
          // One grade and currency's bands reach a consumer in order.
          aggregate: { type: 'PayBand', id: `${grade}:${currency}`, version: 1 },
          actor: { kind: 'user', userId: asking.viewer.accountId },
          correlationId: asking.correlationId,
          causationId: null,
          payload: {
            bandId: id,
            grade,
            minimum: money(band.value.minimum),
            midpoint: money(band.value.midpoint),
            maximum: money(band.value.maximum),
            effectiveFrom,
            ...(supersedes === null ? {} : { supersedes }),
          },
        },
      ]);

      return ok({
        id,
        grade,
        currency,
        minimumMinor: band.value.minimum.toFixed(0),
        midpointMinor: band.value.midpoint.toFixed(0),
        maximumMinor: band.value.maximum.toFixed(0),
        effectiveFrom,
        recordedAt: at,
        recordedBy: asking.viewer.accountId,
        supersedes,
      });
    },
  };
}

// -------------------------------------------------------------- snapshot --

/**
 * Every holder's plaintext for one sealed attribute, by person id
 * (`SecretStore.revealAll`). Only the pay snapshot calls it.
 */
export type SealedValues = (
  tx: Tx,
  where: { tenantId: string; attributeKey: string },
) => Promise<ReadonlyMap<string, string>>;

export interface PaySnapshotDeps {
  readonly clock: Clock;
  readonly newId: () => string;
  /** Needed only when the salary field is sealed; without it such a run is refused. */
  readonly sealed?: SealedValues;
}

export interface PaySnapshotAudit {
  readonly valuesRead: number;
  readonly valuesSealed: number;
  readonly groups: number;
  readonly withheld: number;
}

/** A stored or sealed money value: `{ amountMinor, currency }`, or nothing usable. */
function salaryOf(value: unknown): PayFact['salary'] | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeof v !== 'object' || v === null) return null;
  const { amountMinor, currency } = v as Record<string, unknown>;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/u.test(currency)) return null;
  const digits =
    typeof amountMinor === 'number' && Number.isSafeInteger(amountMinor)
      ? String(amountMinor)
      : typeof amountMinor === 'string' && /^\d{1,17}$/u.test(amountMinor)
        ? amountMinor
        : null;
  if (digits === null || digits === '0') return null;
  return { amount: new Decimal(digits), currency };
}

/**
 * Pay in aggregate for the run's day, in the caller's transaction, after
 * `takeSnapshot` (PEO-078).
 *
 * Reads each present person's grade, tenure band and salary — decrypting a
 * sealed salary in memory — computes quartiles per group, and writes the
 * groups and an audit row. The facts live in this function's memory and
 * nowhere else: no person id, salary or grade reaches a row, a log or the
 * result. Idempotent per day: a re-run replaces the day's groups and adds
 * an audit row of its own.
 */
export async function takePaySnapshot(
  deps: PaySnapshotDeps,
  { tx, tenantId }: TenantScope,
  request: {
    readonly run: Pick<SnapshotRun, 'day' | 'days'>;
    readonly definitions: readonly AttributeDefinition[];
    readonly cohortMinimum?: number;
    /** `system:<process>`, or the account that asked. */
    readonly takenBy: string;
  },
): Promise<Result<PaySnapshotAudit>> {
  const salary = request.definitions.find((d) => d.key === SALARY_KEY && d.deprecatedAt === null);
  if (salary === undefined) {
    return err(failure('NOT_CONFIGURED', `No ${SALARY_KEY} field is published`));
  }
  if (salary.encrypted && deps.sealed === undefined) {
    return err(failure('UNAVAILABLE', 'The salary is sealed and no key ring is configured'));
  }
  const { day, days } = request.run;

  const people = await rows<{
    person_id: string;
    grade: string | null;
    salary: unknown;
    tenure_band: string;
  }>(
    tx,
    sql`
SELECT p.id::text AS person_id, p.custom ->> ${GRADE_KEY} AS grade,
       p.custom -> ${SALARY_KEY} AS salary,
       ${tenureBand(sql`t.months`)} AS tenure_band
  FROM people.person p
 CROSS JOIN LATERAL (SELECT ${dayOf(days)} AS day) AS d
 CROSS JOIN LATERAL (SELECT extract(year FROM a) * 12 + extract(month FROM a) AS months
                       FROM age(d.day, p.hire_date) AS a) AS t
 WHERE p.tenant_id = ${tenantId}::uuid
   AND p.status NOT IN ('provisional', 'discarded', 'merged')
   AND p.hire_date IS NOT NULL AND p.hire_date <= d.day
   AND (p.last_working_day IS NULL OR p.last_working_day >= d.day)`,
  );

  const sealed = salary.encrypted
    ? await (deps.sealed as SealedValues)(tx, { tenantId, attributeKey: SALARY_KEY })
    : null;

  const facts: PayFact[] = [];
  let valuesSealed = 0;
  for (const person of people) {
    const raw = sealed === null ? person.salary : sealed.get(person.person_id);
    const amount = salaryOf(raw);
    if (amount === null) continue;
    if (sealed !== null) valuesSealed += 1;
    facts.push({ grade: person.grade, tenureBand: person.tenure_band, salary: amount });
  }

  const bands = (await bandsInForce(tx, tenantId, day)).map(bandOf);
  const groups = payGroups(facts, bands, cohortMinimum(request.cohortMinimum));

  await tx.execute(
    sql`DELETE FROM people.pay_snapshot WHERE tenant_id = ${tenantId}::uuid AND day = ${day}::date`,
  );
  if (groups.length > 0) {
    const figure = (measure: PayMeasure, currency: string, d: Decimal | undefined) =>
      d === undefined ? null : measure === 'compa' ? d.toFixed() : toMajor(d, currency);
    await tx.execute(sql`
      INSERT INTO people.pay_snapshot (tenant_id, day, measure, bucket, currency, people, p25, median, p75)
      VALUES ${sql.join(
        groups.map(
          (g) => sql`(${tenantId}::uuid, ${day}::date, ${g.measure}, ${g.bucket}, ${g.currency},
                      ${g.people}::int,
                      ${figure(g.measure, g.currency, g.quartiles?.p25)}::numeric,
                      ${figure(g.measure, g.currency, g.quartiles?.median)}::numeric,
                      ${figure(g.measure, g.currency, g.quartiles?.p75)}::numeric)`,
        ),
        sql`, `,
      )}`);
  }

  const audit: PaySnapshotAudit = {
    valuesRead: facts.length,
    valuesSealed,
    groups: groups.length,
    withheld: groups.filter((g) => g.people === null).length,
  };
  await tx.execute(sql`
    INSERT INTO people.pay_snapshot_audit
      (tenant_id, id, day, taken_at, taken_by, values_read, values_sealed, groups, withheld)
    VALUES (${tenantId}::uuid, ${deps.newId()}::uuid, ${day}::date, ${deps.clock.instant()}::timestamptz,
            ${request.takenBy}, ${audit.valuesRead}, ${audit.valuesSealed}, ${audit.groups},
            ${audit.withheld})`);
  return ok(audit);
}

// ---------------------------------------------------------------- charts --

export interface PayCell {
  readonly bucket: string;
  readonly currency: string;
  readonly status: 'ok' | 'insufficient_data';
  /** Null whenever withheld: no count, no figure. */
  readonly people: number | null;
  /** Minor units for salary, a ratio to four places for compa-ratio. */
  readonly p25: string | null;
  readonly median: string | null;
  readonly p75: string | null;
}

export interface PayCharts {
  /** The snapshot day the figures are from; null before the first. */
  readonly asOf: string | null;
  readonly minimum: number;
  readonly grade: readonly PayCell[];
  readonly tenure: readonly PayCell[];
  readonly compa: readonly PayCell[];
  /** The bands in force on `asOf`, which the grade chart draws the figures inside. */
  readonly bands: readonly PayBandView[];
}

/**
 * Pay in aggregate, finance's only (§16.2's finance relation). Served from
 * the latest pay snapshot and never a range — this month minus last month is
 * whoever changed pay in between — with the cohort minimum applied again at
 * read time, so a tenant that raised it since the run has it hold now.
 */
export async function payCharts(
  { tx, tenantId }: TenantScope,
  asking: Pick<Asking, 'viewer'>,
  settings: { readonly cohortMinimum?: number } = {},
): Promise<Result<PayCharts>> {
  if (!maySeePay(asking.viewer.roles)) {
    return err(failure('FORBIDDEN', 'Pay in aggregate is for finance'));
  }
  const minimum = cohortMinimum(settings.cohortMinimum);
  const [latest] = await rows<{ day: string | null }>(
    tx,
    sql`SELECT max(day)::text AS day FROM people.pay_snapshot WHERE tenant_id = ${tenantId}::uuid`,
  );
  const asOf = latest?.day ?? null;
  if (asOf === null) return ok({ asOf, minimum, grade: [], tenure: [], compa: [], bands: [] });

  const found = await rows<{
    measure: PayMeasure;
    bucket: string;
    currency: string;
    people: number | null;
    p25: string | null;
    median: string | null;
    p75: string | null;
  }>(
    tx,
    sql`SELECT measure, bucket, currency, people, p25::text, median::text, p75::text
          FROM people.pay_snapshot WHERE tenant_id = ${tenantId}::uuid AND day = ${asOf}::date
         ORDER BY measure, bucket, currency`,
  );

  const cell = (r: (typeof found)[number]): PayCell => {
    if (r.people === null || r.people < minimum) {
      return {
        bucket: r.bucket,
        currency: r.currency,
        status: 'insufficient_data',
        people: null,
        p25: null,
        median: null,
        p75: null,
      };
    }
    const as = (v: string | null) =>
      v === null
        ? null
        : r.measure === 'compa'
          ? new Decimal(v).toFixed(4)
          : toMinor(v, r.currency);
    return {
      bucket: r.bucket,
      currency: r.currency,
      status: 'ok',
      people: r.people,
      p25: as(r.p25),
      median: as(r.median),
      p75: as(r.p75),
    };
  };
  const of = (measure: PayMeasure) => found.filter((r) => r.measure === measure).map(cell);

  return ok({
    asOf,
    minimum,
    grade: of('grade'),
    tenure: of('tenure'),
    compa: of('compa'),
    bands: await bandsInForce(tx, tenantId, asOf),
  });
}
