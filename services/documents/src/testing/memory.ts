import type { PendingEvent } from '@kithena/domain-kit';
import type { TenantId } from '@kithena/contracts';

import type { Document, Version } from '../domain/document/document.js';
import type { DocumentType } from '../domain/type/document-type.js';
import type { Envelope } from '../domain/signature/envelope.js';
import type {
  AccessRequest,
  Activity,
  Campaign,
  EnvelopeEvent,
  Blobs,
  DocRequest,
  LegalHold,
  Member,
  Section,
  StoredKey,
  Tx,
  UnitOfWork,
  ViewEntry,
} from '../application/ports.js';

/**
 * Every store in memory, per tenant: the standalone suite's and the unit
 * tests' unit of work. One tenant's maps are never handed to another, which
 * is the in-memory form of row-level security.
 *
 * ponytail: no rollback. A use case that fails after a write leaves it, which
 * the Drizzle unit of work does not; tests assert on refusals, which return
 * before writing.
 */

interface TenantState {
  members: Map<string, { member: Member; eventId: string; effectiveFrom: string }>;
  hr: Set<string>;
  types: Map<string, { type: DocumentType; archived: boolean }>;
  documents: Map<string, Document>;
  versions: Map<string, Version[]>;
  sections: Map<string, Section>;
  entries: { sectionId: string; documentId: string }[];
  views: ViewEntry[];
  accessRequests: Map<string, AccessRequest>;
  docRequests: Map<string, DocRequest>;
  holds: Map<string, LegalHold>;
  activity: Activity[];
  settings: Map<string, unknown>;
  keys: Map<string, StoredKey>;
  envelopes: Map<string, Envelope>;
  trail: EnvelopeEvent[];
  campaigns: Map<string, Campaign>;
  acks: Map<string, Set<string>>;
}

const fresh = (): TenantState => ({
  members: new Map(),
  hr: new Set(),
  types: new Map(),
  documents: new Map(),
  versions: new Map(),
  sections: new Map(),
  entries: [],
  views: [],
  accessRequests: new Map(),
  docRequests: new Map(),
  holds: new Map(),
  activity: [],
  settings: new Map(),
  keys: new Map(),
  envelopes: new Map(),
  trail: [],
  campaigns: new Map(),
  acks: new Map(),
});

export interface MemoryWorld {
  readonly uow: UnitOfWork;
  readonly blobs: Blobs & { readonly size: () => number };
  readonly events: PendingEvent[];
}

type Sync<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => R : never;
};

/** A store written synchronously, answering through promises as the port does (Time Off's). */
function promised<T extends object>(sync: Sync<T>): T {
  return Object.fromEntries(
    Object.entries(sync).map(([k, fn]) => [
      k,
      (...args: unknown[]) => Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)),
    ]),
  ) as T;
}

export function memoryWorld(): MemoryWorld {
  const tenants = new Map<string, TenantState>();
  const events: PendingEvent[] = [];
  const stateOf = (tenantId: string) => {
    let s = tenants.get(tenantId);
    if (s === undefined) {
      s = fresh();
      tenants.set(tenantId, s);
    }
    return s;
  };

  const txFor = (tenantId: TenantId): Tx => {
    const s = stateOf(tenantId);
    return {
      tenantId,
      members: promised<Tx['members']>({
        get: (id) => s.members.get(id)?.member ?? null,
        byAccount: (account) => {
          const found = [...s.members.values()].filter((m) => m.member.accountId === account);
          return found.length === 1 ? (found[0]?.member ?? null) : null;
        },
        list: () => [...s.members.values()].map((m) => m.member),
        upsert: (member, eventId, effectiveFrom) => {
          const prior = s.members.get(member.personId);
          if (
            prior !== undefined &&
            (prior.effectiveFrom > effectiveFrom ||
              (prior.effectiveFrom === effectiveFrom && prior.eventId >= eventId))
          ) {
            return false;
          }
          s.members.set(member.personId, { member, eventId, effectiveFrom });
          return true;
        },
      }),
      hr: promised<Tx['hr']>({
        has: (a) => s.hr.has(a),
        list: () => [...s.hr],
        add: (a) => void s.hr.add(a),
        remove: (a) => void s.hr.delete(a),
      }),
      types: promised<Tx['types']>({
        list: () => [...s.types.values()].map((t) => ({ ...t.type, archived: t.archived })),
        get: (key) => {
          const t = s.types.get(key);
          return t === undefined ? null : { ...t.type, archived: t.archived };
        },
        save: (type, archived) => void s.types.set(type.key, { type, archived }),
      }),
      documents: promised<Tx['documents']>({
        get: (id) => s.documents.get(id) ?? null,
        save: (doc) => void s.documents.set(doc.id, doc),
        candidates: () => [...s.documents.values()],
        filed: () => [...s.documents.values()].filter((d) => d.typeKey !== null),
        about: (personId) =>
          [...s.documents.values()].filter((d) => d.subjectPersonId === personId),
      }),
      versions: promised<Tx['versions']>({
        list: (id) => s.versions.get(id) ?? [],
        get: (id, n) => (s.versions.get(id) ?? []).find((v) => v.n === n) ?? null,
        add: (id, version) => void s.versions.set(id, [...(s.versions.get(id) ?? []), version]),
      }),
      sections: promised<Tx['sections']>({
        visibleTo: (account) =>
          [...s.sections.values()].filter(
            (x) => x.kind === 'company' || x.ownerAccount === account,
          ),
        get: (id) => s.sections.get(id) ?? null,
        save: (section) => void s.sections.set(section.id, section),
        remove: (id) => {
          s.sections.delete(id);
          s.entries = s.entries.filter((e) => e.sectionId !== id);
        },
        entries: (ids) =>
          s.entries
            .filter((e) => ids.includes(e.sectionId))
            .map((e) => ({ sectionId: e.sectionId, documentId: e.documentId as Document['id'] })),
        add: (sectionId, documentId) => {
          if (!s.entries.some((e) => e.sectionId === sectionId && e.documentId === documentId)) {
            s.entries.push({ sectionId, documentId });
          }
        },
        removeEntry: (sectionId, documentId) => {
          s.entries = s.entries.filter(
            (e) => !(e.sectionId === sectionId && e.documentId === documentId),
          );
        },
      }),
      views: promised<Tx['views']>({
        add: (entry) => void s.views.push(entry),
        list: (id, limit) =>
          s.views
            .filter((v) => v.documentId === id)
            .toSorted((a, b) => b.at.localeCompare(a.at))
            .slice(0, limit),
      }),
      accessRequests: promised<Tx['accessRequests']>({
        get: (id) => s.accessRequests.get(id) ?? null,
        save: (r) => void s.accessRequests.set(r.id, r),
        open: () => [...s.accessRequests.values()].filter((r) => r.status === 'open'),
      }),
      docRequests: promised<Tx['docRequests']>({
        get: (id) => s.docRequests.get(id) ?? null,
        save: (r) => void s.docRequests.set(r.id, r),
        forPerson: (p) => [...s.docRequests.values()].filter((r) => r.personId === p),
        open: () => [...s.docRequests.values()].filter((r) => r.status === 'open'),
      }),
      holds: promised<Tx['holds']>({
        list: () => [...s.holds.values()],
        get: (id) => s.holds.get(id) ?? null,
        save: (h) => void s.holds.set(h.id, h),
        held: () =>
          new Set(
            [...s.holds.values()].filter((h) => h.liftedAt === null).flatMap((h) => h.documentIds),
          ),
      }),
      activity: promised<Tx['activity']>({
        add: (entry) => void s.activity.push(entry),
        list: ({ documentId, limit }) =>
          s.activity
            .filter((a) => documentId === undefined || a.documentId === documentId)
            .toSorted((a, b) => b.at.localeCompare(a.at))
            .slice(0, limit),
      }),
      envelopes: promised<Tx['envelopes']>({
        get: (id) => s.envelopes.get(id) ?? null,
        save: (e) => void s.envelopes.set(e.id, e),
        forDocument: (id) => [...s.envelopes.values()].filter((e) => e.documentId === id),
        latestFor: (ids) => {
          const out = new Map<string, Envelope>();
          for (const e of s.envelopes.values()) {
            if (!ids.includes(e.documentId)) continue;
            const had = out.get(e.documentId);
            if (had === undefined || had.createdAt < e.createdAt) out.set(e.documentId, e);
          }
          return out;
        },
        forPerson: (p) =>
          [...s.envelopes.values()].filter((e) => e.signers.some((x) => x.personId === p)),
        byToken: (hash) => {
          for (const e of s.envelopes.values()) {
            const signer = e.signers.find((x) => x.tokenHash === hash);
            if (signer !== undefined) return { envelope: e, signerId: signer.id };
          }
          return null;
        },
        open: () => [...s.envelopes.values()].filter((e) => e.status === 'sent'),
        trail: (id) => s.trail.filter((t) => t.envelopeId === id),
        record: (event) => void s.trail.push(event),
      }),
      campaigns: promised<Tx['campaigns']>({
        get: (id) => s.campaigns.get(id) ?? null,
        save: (c) => void s.campaigns.set(c.id, c),
        list: () => [...s.campaigns.values()],
        acknowledged: (id) => s.acks.get(id) ?? new Set(),
        acknowledge: (id, personId) => {
          const set = s.acks.get(id) ?? new Set<string>();
          set.add(personId);
          s.acks.set(id, set);
        },
        mine: (personId) =>
          new Set([...s.acks.entries()].filter(([, set]) => set.has(personId)).map(([id]) => id)),
      }),
      settings: promised<Tx['settings']>({
        get: (key) => s.settings.get(key) ?? null,
        set: (key, value) => void s.settings.set(key, value),
      }),
      idempotency: promised<Tx['idempotency']>({
        find: (key) => s.keys.get(key) ?? null,
        save: (key, stored) => {
          if (s.keys.has(key)) return false;
          s.keys.set(key, stored);
          return true;
        },
      }),
      outbox: promised<Tx['outbox']>({ publish: (list) => void events.push(...list) }),
    };
  };

  const bytes = new Map<string, Uint8Array>();
  return {
    uow: { run: (tenantId, fn) => fn(txFor(tenantId)) },
    blobs: {
      put: (key, b) => Promise.resolve(void bytes.set(key, b)),
      get: (key) => Promise.resolve(bytes.get(key) ?? null),
      delete: (key) => Promise.resolve(void bytes.delete(key)),
      size: () => bytes.size,
    },
    events,
  };
}
