import { sql } from 'drizzle-orm';

import type {
  AskMessage,
  DetailAsk,
  DetailAskStore,
  SendBackReason,
} from '../application/inbox/asks.js';

/**
 * Asks for details and their threads, over `people.detail_ask` and
 * `people.detail_ask_message` (`migrations/20261010100000_people_detail_ask.sql`),
 * in the caller's tenant transaction.
 */

type Row = {
  id: string;
  person_id: string;
  keys: string[];
  message: string | null;
  due_on: string | Date | null;
  requested_by: string;
  requested_at: string | Date;
  batch_id: string;
  state: DetailAsk['state'];
  reason: SendBackReason | null;
  note: string | null;
  closed_by: string | null;
  closed_at: string | Date | null;
};

const iso = (v: string | Date): string => new Date(v).toISOString();
const day = (v: string | Date | null): string | null =>
  v === null ? null : typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);

const askOf = (r: Row): DetailAsk => ({
  id: r.id,
  personId: r.person_id,
  keys: r.keys,
  message: r.message,
  dueOn: day(r.due_on),
  requestedBy: r.requested_by,
  requestedAt: iso(r.requested_at),
  batchId: r.batch_id,
  state: r.state,
  reason: r.reason,
  note: r.note,
  closedBy: r.closed_by,
  closedAt: r.closed_at === null ? null : iso(r.closed_at),
});

const COLUMNS = sql.raw(
  'id, person_id, keys, message, due_on::text AS due_on, requested_by, requested_at, batch_id, state, reason, note, closed_by, closed_at',
);

export function drizzleDetailAsks(): DetailAskStore {
  return {
    async insert(tx, tenantId, asks) {
      for (const a of asks) {
        await tx.execute(sql`
          INSERT INTO people.detail_ask
            (tenant_id, id, person_id, keys, message, due_on, requested_by, requested_at, batch_id, state)
          VALUES (${tenantId}::uuid, ${a.id}::uuid, ${a.personId}::uuid,
                  ${`{${a.keys.join(',')}}`}::text[], ${a.message}, ${a.dueOn}::date,
                  ${a.requestedBy}::uuid, ${a.requestedAt}::timestamptz, ${a.batchId}::uuid, 'open')`);
      }
    },

    async find(tx, tenantId, id) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.detail_ask
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const [row] = [...rows];
      return row === undefined ? null : askOf(row);
    },

    async forPerson(tx, tenantId, personId, since) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.detail_ask
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
           AND requested_at >= ${since}::timestamptz
         ORDER BY requested_at DESC`);
      return [...rows].map(askOf);
    },

    async sentBy(tx, tenantId, accountId, since) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.detail_ask
         WHERE tenant_id = ${tenantId}::uuid AND requested_by = ${accountId}::uuid
           AND requested_at >= ${since}::timestamptz
         ORDER BY requested_at DESC`);
      return [...rows].map(askOf);
    },

    async inBatch(tx, tenantId, batchId) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.detail_ask
         WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid
         ORDER BY requested_at`);
      return [...rows].map(askOf);
    },

    async close(tx, tenantId, id, to) {
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.detail_ask
           SET state = ${to.state}, reason = ${to.reason}, note = ${to.note},
               closed_by = ${to.by}::uuid, closed_at = ${to.at}::timestamptz
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND state = 'open'
        RETURNING id`);
      return [...rows].length === 1;
    },

    async reopen(tx, tenantId, id) {
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.detail_ask
           SET state = 'open', reason = NULL, note = NULL, closed_by = NULL, closed_at = NULL
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND state = 'done'
        RETURNING id`);
      return [...rows].length === 1;
    },

    async setDue(tx, tenantId, batchId, dueOn) {
      await tx.execute(sql`
        UPDATE people.detail_ask SET due_on = ${dueOn}::date
         WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid AND state = 'open'`);
    },

    async addMessage(tx, tenantId, m) {
      await tx.execute(sql`
        INSERT INTO people.detail_ask_message (tenant_id, id, ask_id, author, body, at)
        VALUES (${tenantId}::uuid, ${m.id}::uuid, ${m.askId}::uuid, ${m.author}::uuid, ${m.body},
                ${m.at}::timestamptz)`);
    },

    async messages(tx, tenantId, askIds) {
      if (askIds.length === 0) return [];
      const rows = await tx.execute<{
        id: string;
        ask_id: string;
        author: string;
        body: string;
        at: string | Date;
      }>(sql`
        SELECT id, ask_id, author, body, at FROM people.detail_ask_message
         WHERE tenant_id = ${tenantId}::uuid AND ask_id = ANY(${`{${askIds.join(',')}}`}::uuid[])
         ORDER BY at`);
      return [...rows].map((r): AskMessage => ({
        id: r.id,
        askId: r.ask_id,
        author: r.author,
        body: r.body,
        at: iso(r.at),
      }));
    },

    async nudge(tx, tenantId, changeId, by, at) {
      const rows = await tx.execute<{ change_id: string }>(sql`
        INSERT INTO people.change_nudge (tenant_id, change_id, nudged_by, at)
        VALUES (${tenantId}::uuid, ${changeId}::uuid, ${by}::uuid, ${at}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING change_id`);
      return [...rows].length === 1;
    },

    async nudges(tx, tenantId, changeIds) {
      if (changeIds.length === 0) return new Map();
      const rows = await tx.execute<{ change_id: string; at: string | Date }>(sql`
        SELECT change_id, at FROM people.change_nudge
         WHERE tenant_id = ${tenantId}::uuid
           AND change_id = ANY(${`{${changeIds.join(',')}}`}::uuid[])`);
      return new Map([...rows].map((r) => [r.change_id, iso(r.at)]));
    },
  };
}
