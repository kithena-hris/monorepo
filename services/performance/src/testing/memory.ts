import type { PendingEvent } from '@kithena/domain-kit';
import type { TenantId } from '@kithena/contracts';

import type { AuditEntry, Member, Store, Tx, UnitOfWork } from '../application/ports.js';
import { COLUMNS, fits, STORES, type Kind } from '../infrastructure/records.js';

/**
 * Performance in memory: the same stores and the same columns as Postgres,
 * for the unit, standalone and contract suites. Transactions are copies
 * swapped in on success, so a failed use case leaves nothing behind, as
 * Postgres would.
 */

interface Tenant {
  members: Map<string, Member & { lastEventId: string }>;
  admins: Set<string>;
  records: Map<string, { kind: Kind; value: Record<string, unknown>; at: number }>;
  audit: AuditEntry[];
  settings: Map<string, unknown>;
  idempotency: Map<string, { requestHash: string; status: number; answer: unknown }>;
  outbox: PendingEvent[];
}

const fresh = (): Tenant => ({
  members: new Map(),
  admins: new Set(),
  records: new Map(),
  audit: [],
  settings: new Map(),
  idempotency: new Map(),
  outbox: [],
});

const copy = (t: Tenant): Tenant => ({
  members: new Map(t.members),
  admins: new Set(t.admins),
  records: new Map(t.records),
  audit: [...t.audit],
  settings: new Map(t.settings),
  idempotency: new Map(t.idempotency),
  outbox: [...t.outbox],
});

const clone = <T>(v: T): T => structuredClone(v);
const done = (): Promise<void> => Promise.resolve();
const strip = ({ lastEventId: _l, ...rest }: Member & { lastEventId: string }): Member => rest;

export interface MemoryWorld {
  readonly uow: UnitOfWork;
  readonly outbox: (tenantId: string) => readonly PendingEvent[];
  readonly audit: (tenantId: string) => readonly AuditEntry[];
}

export function memoryUnitOfWork(): MemoryWorld {
  const tenants = new Map<string, Tenant>();
  let seq = 0;
  const txOf = (t: Tenant): Tx => {
    const store = <T extends { readonly id: string }>(kind: Kind): Store<T> => ({
      get: (id) => {
        const r = t.records.get(`${kind}:${id}`);
        return Promise.resolve(r === undefined ? null : (clone(r.value) as unknown as T));
      },
      find: (where) =>
        Promise.resolve(
          [...t.records.values()]
            .filter((r) => r.kind === kind && fits(COLUMNS[kind](r.value), where))
            .toSorted((a, b) => a.at - b.at)
            .map((r) => clone(r.value) as unknown as T),
        ),
      save: (value, expect) => {
        const k = `${kind}:${value.id}`;
        const old = t.records.get(k);
        const row = clone(value) as unknown as Record<string, unknown>;
        const cols = COLUMNS[kind](row);
        if (
          expect !== undefined &&
          old !== undefined &&
          COLUMNS[kind](old.value).revision !== expect
        )
          return Promise.resolve(false);
        if (cols.key !== null)
          for (const [other, r] of t.records)
            if (other !== k && r.kind === kind && COLUMNS[kind](r.value).key === cols.key)
              return Promise.reject(new Error(`duplicate key ${cols.key}`));
        t.records.set(k, { kind, value: row, at: old?.at ?? (seq += 1) });
        return Promise.resolve(true);
      },
      remove: (id) => {
        t.records.delete(`${kind}:${id}`);
        return done();
      },
    });
    const stores = Object.fromEntries(
      Object.entries(STORES).map(([name, kind]) => [name, store(kind)]),
    ) as unknown as Pick<Tx, keyof typeof STORES>;
    return {
      ...stores,
      members: {
        get: (id) => {
          const m = t.members.get(id);
          return Promise.resolve(m === undefined ? null : strip(m));
        },
        byAccount: (a) => {
          const found = [...t.members.values()].filter((m) => m.accountId === a);
          const m = found.length === 1 ? found[0] : undefined;
          return Promise.resolve(m === undefined ? null : strip(m));
        },
        list: () =>
          Promise.resolve(
            [...t.members.values()]
              .map(strip)
              .toSorted((a, b) => a.displayName.localeCompare(b.displayName)),
          ),
        upsert: (m, eventId) => {
          if (t.members.get(m.personId)?.lastEventId === eventId) return Promise.resolve(false);
          t.members.set(m.personId, { ...m, lastEventId: eventId });
          return Promise.resolve(true);
        },
      },
      admins: {
        has: (a) => Promise.resolve(t.admins.has(a)),
        add: (a) => {
          t.admins.add(a);
          return done();
        },
        remove: (a) => {
          t.admins.delete(a);
          return done();
        },
      },
      audit: {
        record: (e) => {
          t.audit.push(e);
          return done();
        },
        list: (f) =>
          Promise.resolve(
            t.audit
              .filter(
                (e) =>
                  f.q === undefined ||
                  f.q === '' ||
                  `${e.action} ${e.target} ${e.as}`.toLowerCase().includes(f.q.toLowerCase()),
              )
              .filter((e) => f.refused !== true || e.outcome === 'refused')
              .filter((e) => f.ai !== true || e.ai)
              .toReversed()
              .slice(0, f.limit),
          ),
      },
      settings: {
        get: (k) => Promise.resolve(t.settings.has(k) ? clone(t.settings.get(k)) : null),
        set: (k, v) => {
          t.settings.set(k, clone(v));
          return done();
        },
      },
      idempotency: {
        get: (k) => Promise.resolve(t.idempotency.get(k) ?? null),
        put: (k, requestHash, status, answer) => {
          t.idempotency.set(k, { requestHash, status, answer });
          return done();
        },
      },
      outbox: {
        publish: (events) => {
          t.outbox.push(...events);
          return done();
        },
      },
    };
  };
  let chain: Promise<unknown> = Promise.resolve();
  const uow: UnitOfWork = {
    run: <T>(tenantId: TenantId, fn: (tx: Tx) => Promise<T>): Promise<T> => {
      // One at a time, as a serialisable database would make them.
      const next = chain.then(async () => {
        const held = tenants.get(tenantId) ?? fresh();
        const working = copy(held);
        const answer = await fn(txOf(working));
        tenants.set(tenantId, working);
        return answer;
      });
      chain = next.catch(() => undefined);
      return next;
    },
    tenants: () => Promise.resolve([...tenants.keys()] as TenantId[]),
  };
  return {
    uow,
    outbox: (id) => tenants.get(id)?.outbox ?? [],
    audit: (id) => tenants.get(id)?.audit ?? [],
  };
}
