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
      members: {
        get: async (id) => s.members.get(id)?.member ?? null,
        byAccount: async (account) => {
          const found = [...s.members.values()].filter((m) => m.member.accountId === account);
          return found.length === 1 ? (found[0]?.member ?? null) : null;
        },
        list: async () => [...s.members.values()].map((m) => m.member),
        upsert: async (member, eventId, effectiveFrom) => {
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
      },
      hr: {
        has: async (a) => s.hr.has(a),
        list: async () => [...s.hr],
        add: async (a) => void s.hr.add(a),
        remove: async (a) => void s.hr.delete(a),
      },
      types: {
        list: async () => [...s.types.values()].map((t) => ({ ...t.type, archived: t.archived })),
        get: async (key) => {
          const t = s.types.get(key);
          return t === undefined ? null : { ...t.type, archived: t.archived };
        },
        save: async (type, archived) => void s.types.set(type.key, { type, archived }),
      },
      documents: {
        get: async (id) => s.documents.get(id) ?? null,
        save: async (doc) => void s.documents.set(doc.id, doc),
        candidates: async () => [...s.documents.values()],
        filed: async () => [...s.documents.values()].filter((d) => d.typeKey !== null),
        about: async (personId) =>
          [...s.documents.values()].filter((d) => d.subjectPersonId === personId),
      },
      versions: {
        list: async (id) => s.versions.get(id) ?? [],
        get: async (id, n) => (s.versions.get(id) ?? []).find((v) => v.n === n) ?? null,
        add: async (id, version) =>
          void s.versions.set(id, [...(s.versions.get(id) ?? []), version]),
      },
      sections: {
        visibleTo: async (account) =>
          [...s.sections.values()].filter(
            (x) => x.kind === 'company' || x.ownerAccount === account,
          ),
        get: async (id) => s.sections.get(id) ?? null,
        save: async (section) => void s.sections.set(section.id, section),
        remove: async (id) => {
          s.sections.delete(id);
          s.entries = s.entries.filter((e) => e.sectionId !== id);
        },
        entries: async (ids) =>
          s.entries
            .filter((e) => ids.includes(e.sectionId))
            .map((e) => ({ sectionId: e.sectionId, documentId: e.documentId as Document['id'] })),
        add: async (sectionId, documentId) => {
          if (!s.entries.some((e) => e.sectionId === sectionId && e.documentId === documentId)) {
            s.entries.push({ sectionId, documentId });
          }
        },
        removeEntry: async (sectionId, documentId) => {
          s.entries = s.entries.filter(
            (e) => !(e.sectionId === sectionId && e.documentId === documentId),
          );
        },
      },
      views: {
        add: async (entry) => void s.views.push(entry),
        list: async (id, limit) =>
          s.views
            .filter((v) => v.documentId === id)
            .toSorted((a, b) => b.at.localeCompare(a.at))
            .slice(0, limit),
      },
      accessRequests: {
        get: async (id) => s.accessRequests.get(id) ?? null,
        save: async (r) => void s.accessRequests.set(r.id, r),
        open: async () => [...s.accessRequests.values()].filter((r) => r.status === 'open'),
      },
      docRequests: {
        get: async (id) => s.docRequests.get(id) ?? null,
        save: async (r) => void s.docRequests.set(r.id, r),
        forPerson: async (p) => [...s.docRequests.values()].filter((r) => r.personId === p),
        open: async () => [...s.docRequests.values()].filter((r) => r.status === 'open'),
      },
      holds: {
        list: async () => [...s.holds.values()],
        get: async (id) => s.holds.get(id) ?? null,
        save: async (h) => void s.holds.set(h.id, h),
        held: async () =>
          new Set(
            [...s.holds.values()].filter((h) => h.liftedAt === null).flatMap((h) => h.documentIds),
          ),
      },
      activity: {
        add: async (entry) => void s.activity.push(entry),
        list: async ({ documentId, limit }) =>
          s.activity
            .filter((a) => documentId === undefined || a.documentId === documentId)
            .toSorted((a, b) => b.at.localeCompare(a.at))
            .slice(0, limit),
      },
      envelopes: {
        get: async (id) => s.envelopes.get(id) ?? null,
        save: async (e) => void s.envelopes.set(e.id, e),
        forDocument: async (id) => [...s.envelopes.values()].filter((e) => e.documentId === id),
        forPerson: async (p) =>
          [...s.envelopes.values()].filter((e) => e.signers.some((x) => x.personId === p)),
        byToken: async (hash) => {
          for (const e of s.envelopes.values()) {
            const signer = e.signers.find((x) => x.tokenHash === hash);
            if (signer !== undefined) return { envelope: e, signerId: signer.id };
          }
          return null;
        },
        open: async () => [...s.envelopes.values()].filter((e) => e.status === 'sent'),
        trail: async (id) => s.trail.filter((t) => t.envelopeId === id),
        record: async (event) => void s.trail.push(event),
      },
      campaigns: {
        get: async (id) => s.campaigns.get(id) ?? null,
        save: async (c) => void s.campaigns.set(c.id, c),
        list: async () => [...s.campaigns.values()],
        acknowledged: async (id) => s.acks.get(id) ?? new Set(),
        acknowledge: async (id, personId) => {
          const set = s.acks.get(id) ?? new Set<string>();
          set.add(personId);
          s.acks.set(id, set);
        },
        mine: async (personId) =>
          new Set([...s.acks.entries()].filter(([, set]) => set.has(personId)).map(([id]) => id)),
      },
      settings: {
        get: async (key) => s.settings.get(key) ?? null,
        set: async (key, value) => void s.settings.set(key, value),
      },
      idempotency: {
        find: async (key) => s.keys.get(key) ?? null,
        save: async (key, stored) => {
          if (s.keys.has(key)) return false;
          s.keys.set(key, stored);
          return true;
        },
      },
      outbox: { publish: async (list) => void events.push(...list) },
    };
  };

  const bytes = new Map<string, Uint8Array>();
  return {
    uow: { run: (tenantId, fn) => fn(txFor(tenantId)) },
    blobs: {
      put: async (key, b) => void bytes.set(key, b),
      get: async (key) => bytes.get(key) ?? null,
      delete: async (key) => void bytes.delete(key),
      size: () => bytes.size,
    },
    events,
  };
}
