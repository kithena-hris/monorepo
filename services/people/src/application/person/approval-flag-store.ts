import { sql } from 'drizzle-orm';

import { Decimal } from '../../domain/pay/pay.js';
import type { Question } from '../../domain/approval/question.js';
import type { CheckCode, Mark, Money } from '../../domain/approval/unusual.js';
import type { ApprovalFlagStore } from './approval-flags.js';

/**
 * The approval checks' tables, hand-written against
 * `migrations/20261001170000_people_approval_flags.sql`, beside the use case
 * as the pending-change store is: nothing else reads them.
 *
 * What the checks read from elsewhere is read here too, and nothing more: a
 * team's recorded pay changes this year, the band in force for a grade, and
 * when a person's address or email was recorded. History is read as the
 * chain stands (a corrected row is replaced by its correction), and a value
 * redacted for encryption or retention is not there to read.
 */

const iso = (v: Date | string) => new Date(v).toISOString();

/** `"62000.0000"` EUR → `"6200000"`. */
const toMinor = (major: string, currency: string): string =>
  new Decimal(major)
    .times(
      new Decimal(10).pow(
        new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
          .maximumFractionDigits ?? 2,
      ),
    )
    .toFixed(0);

const moneyOf = (v: unknown): Money | null =>
  v !== null && typeof v === 'object' && 'amountMinor' in v && 'currency' in v
    ? { amountMinor: String(v.amountMinor), currency: String(v.currency) }
    : null;

type QuestionRow = {
  id: string;
  change_id: string;
  asked_by: string;
  asked_at: Date | string;
  question: string;
  answer: string | null;
  answered_at: Date | string | null;
};

const questionOf = (r: QuestionRow): Question => ({
  id: r.id,
  changeId: r.change_id,
  askedBy: r.asked_by,
  askedAt: iso(r.asked_at),
  question: r.question,
  answer: r.answer,
  answeredAt: r.answered_at === null ? null : iso(r.answered_at),
});

const QUESTION = sql`id::text, change_id::text, asked_by::text, asked_at, question, answer, answered_at`;

export function drizzleApprovalFlagStore(): ApprovalFlagStore {
  return {
    async switches(tx, tenantId) {
      const rows = await tx.execute<{ code: string; enabled: boolean }>(sql`
        SELECT code, enabled FROM people.approval_check WHERE tenant_id = ${tenantId}::uuid`);
      return new Map([...rows].map((r) => [r.code, r.enabled]));
    },

    async setSwitch(tx, tenantId, to) {
      await tx.execute(sql`
        INSERT INTO people.approval_check (tenant_id, code, enabled, set_by, set_at)
        VALUES (${tenantId}::uuid, ${to.code}, ${to.on}, ${to.by}::uuid, ${to.at}::timestamptz)
        ON CONFLICT (tenant_id, code)
        DO UPDATE SET enabled = EXCLUDED.enabled, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at`);
    },

    async marks(tx, tenantId, since) {
      const rows = await tx.execute<{
        code: string;
        requested_by: string;
        magnitude: string | null;
        marked_at: Date | string;
      }>(sql`
        SELECT code, requested_by::text, magnitude::text, marked_at
          FROM people.approval_flag_mark
         WHERE tenant_id = ${tenantId}::uuid AND marked_at >= ${since}::timestamptz`);
      return [...rows].map((r) => ({
        code: r.code as CheckCode,
        requestedBy: r.requested_by,
        magnitude: r.magnitude,
        at: iso(r.marked_at),
      }));
    },

    async mark(tx, tenantId, changeId, marks, by) {
      for (const m of marks) {
        await tx.execute(sql`
          INSERT INTO people.approval_flag_mark
                 (tenant_id, change_id, code, requested_by, magnitude, marked_by, marked_at)
          VALUES (${tenantId}::uuid, ${changeId}::uuid, ${m.code}, ${m.requestedBy}::uuid,
                  ${m.magnitude}::numeric, ${by}::uuid, ${m.at}::timestamptz)
          ON CONFLICT DO NOTHING`);
      }
    },

    async recordDecided(tx, tenantId, changeId, codes) {
      await tx.execute(sql`
        UPDATE people.pending_change SET flags = ${`{${codes.join(',')}}`}::text[]
         WHERE tenant_id = ${tenantId}::uuid AND id = ${changeId}::uuid`);
    },

    async stats(tx, tenantId, since) {
      const rows = await tx.execute<{ flagged: number; rejected: number; marked: number }>(sql`
        WITH asked AS (
          SELECT c.id, c.state,
                 cardinality(coalesce(c.flags, '{}')) > 0 AS flagged,
                 EXISTS (SELECT 1 FROM people.approval_flag_mark m
                          WHERE m.tenant_id = c.tenant_id AND m.change_id = c.id) AS marked
            FROM people.pending_change c
           WHERE c.tenant_id = ${tenantId}::uuid AND c.requested_at >= ${since}::timestamptz
        )
        SELECT count(*) FILTER (WHERE flagged OR marked)::int AS flagged,
               count(*) FILTER (WHERE (flagged OR marked) AND state = 'rejected')::int AS rejected,
               count(*) FILTER (WHERE marked)::int AS marked
          FROM asked`);
      const row = [...rows][0];
      return { flagged: row?.flagged ?? 0, rejected: row?.rejected ?? 0, marked: row?.marked ?? 0 };
    },

    async questions(tx, tenantId, changeIds) {
      if (changeIds.length === 0) return [];
      const rows = await tx.execute<QuestionRow>(sql`
        SELECT ${QUESTION} FROM people.approval_question
         WHERE tenant_id = ${tenantId}::uuid
           AND change_id = ANY(${`{${changeIds.join(',')}}`}::uuid[])
         ORDER BY asked_at, id`);
      return [...rows].map(questionOf);
    },

    async question(tx, tenantId, id) {
      const rows = await tx.execute<QuestionRow>(sql`
        SELECT ${QUESTION} FROM people.approval_question
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const row = [...rows][0];
      return row ? questionOf(row) : null;
    },

    async ask(tx, tenantId, q) {
      await tx.execute(sql`
        INSERT INTO people.approval_question (tenant_id, id, change_id, asked_by, asked_at, question)
        VALUES (${tenantId}::uuid, ${q.id}::uuid, ${q.changeId}::uuid, ${q.askedBy}::uuid,
                ${q.askedAt}::timestamptz, ${q.question})`);
    },

    async answer(tx, tenantId, q) {
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.approval_question SET answer = ${q.answer}, answered_at = ${q.answeredAt}::timestamptz
         WHERE tenant_id = ${tenantId}::uuid AND id = ${q.id}::uuid AND answer IS NULL
        RETURNING id`);
      return [...rows].length > 0;
    },

    async teamRaises(tx, tenantId, t) {
      const rows = await tx.execute<{ before: unknown; after: unknown }>(sql`
        WITH chain AS (
          SELECT h.person_id, h.effective_from, h.value AS after,
                 lag(h.value) OVER (PARTITION BY h.person_id
                                    ORDER BY h.effective_from, h.recorded_at, h.id) AS before
            FROM people.person_attribute_history h
            JOIN people.person p ON p.tenant_id = h.tenant_id AND p.id = h.person_id
           WHERE h.tenant_id = ${tenantId}::uuid AND h.attribute_key = ${t.payKey}
             AND h.person_id <> ${t.except}::uuid
             AND p.custom ->> ${t.teamKey} = ${t.team}
             AND p.status NOT IN ('provisional', 'discarded', 'merged')
             AND h.value IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM people.person_attribute_history s
                              WHERE s.tenant_id = h.tenant_id AND s.supersedes = h.id)
        )
        SELECT before, after FROM chain
         WHERE before IS NOT NULL
           AND effective_from BETWEEN ${t.from}::date AND ${t.until}::date`);
      return [...rows].flatMap((r) => {
        const before = moneyOf(r.before);
        const after = moneyOf(r.after);
        return before === null || after === null ? [] : [{ before, after }];
      });
    },

    async band(tx, tenantId, of) {
      const rows = await tx.execute<{ minimum: string; maximum: string }>(sql`
        SELECT minimum::text, maximum::text FROM people.pay_band b
         WHERE b.tenant_id = ${tenantId}::uuid AND b.grade = ${of.grade}
           AND b.currency = ${of.currency} AND b.effective_from <= ${of.day}::date
           AND NOT EXISTS (SELECT 1 FROM people.pay_band s
                            WHERE s.tenant_id = b.tenant_id AND s.supersedes = b.id)
         ORDER BY b.effective_from DESC
         LIMIT 1`);
      const row = [...rows][0];
      return row === undefined
        ? null
        : {
            minimumMinor: toMinor(row.minimum, of.currency),
            maximumMinor: toMinor(row.maximum, of.currency),
          };
    },

    async changedAt(tx, tenantId, of) {
      if (of.keys.length === 0) return [];
      const rows = await tx.execute<{ key: string; at: Date | string }>(sql`
        SELECT attribute_key AS key, recorded_at AS at FROM people.person_attribute_history
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${of.personId}::uuid
           AND attribute_key = ANY(${`{${of.keys.join(',')}}`}::text[])
           AND recorded_at >= ${of.since}::timestamptz`);
      return [...rows].map((r) => ({ key: r.key, at: iso(r.at) }));
    },
  };
}

/** For tests: the same reads over arrays, and the facts handed in. */
export function inMemoryApprovalFlagStore(
  facts: {
    readonly raises?: readonly { readonly before: Money; readonly after: Money }[];
    readonly band?: { readonly minimumMinor: string; readonly maximumMinor: string } | null;
    readonly changed?: readonly { readonly key: string; readonly at: string }[];
  } = {},
): ApprovalFlagStore & {
  readonly marked: { changeId: string; mark: Mark }[];
  readonly decided: Map<string, readonly string[]>;
  readonly asked: Question[];
} {
  const switches = new Map<string, boolean>();
  const marked: { changeId: string; mark: Mark }[] = [];
  const decided = new Map<string, readonly string[]>();
  const asked: Question[] = [];
  return {
    marked,
    decided,
    asked,
    switches: () => Promise.resolve(switches),
    setSwitch(_tx, _tenant, to) {
      switches.set(to.code, to.on);
      return Promise.resolve();
    },
    marks: (_tx, _tenant, since) =>
      Promise.resolve(marked.filter((m) => m.mark.at >= since).map((m) => m.mark)),
    mark(_tx, _tenant, changeId, marks) {
      for (const mark of marks) {
        if (!marked.some((m) => m.changeId === changeId && m.mark.code === mark.code)) {
          marked.push({ changeId, mark });
        }
      }
      return Promise.resolve();
    },
    recordDecided(_tx, _tenant, changeId, codes) {
      decided.set(changeId, codes);
      return Promise.resolve();
    },
    stats: () =>
      Promise.resolve({
        flagged: new Set([...decided.keys(), ...marked.map((m) => m.changeId)]).size,
        rejected: 0,
        marked: new Set(marked.map((m) => m.changeId)).size,
      }),
    questions: (_tx, _tenant, ids) => Promise.resolve(asked.filter((q) => ids.includes(q.changeId))),
    question: (_tx, _tenant, id) => Promise.resolve(asked.find((q) => q.id === id) ?? null),
    ask(_tx, _tenant, q) {
      asked.push(q);
      return Promise.resolve();
    },
    answer(_tx, _tenant, q) {
      const i = asked.findIndex((a) => a.id === q.id && a.answer === null);
      if (i < 0) return Promise.resolve(false);
      asked[i] = q;
      return Promise.resolve(true);
    },
    teamRaises: () => Promise.resolve(facts.raises ?? []),
    band: () => Promise.resolve(facts.band ?? null),
    changedAt: () => Promise.resolve(facts.changed ?? []),
  };
}
