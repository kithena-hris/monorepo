import type { PendingEvent } from '@kithena/domain-kit';
import type { TenantId } from '@kithena/contracts';

import type { Template } from '../domain/plan.js';
import type {
  CheckIn,
  HireRecord,
  Member,
  PlanRecord,
  ProbationReview,
  Tx,
  UnitOfWork,
} from '../application/ports.js';

/**
 * Onboarding's stores in memory, for the unit and standalone suites: one
 * tenant's state, copied per transaction so a thrown use case leaves nothing
 * behind. Recruiting's shape.
 */

interface TenantState {
  members: Map<string, { m: Member; lastEventId: string }>;
  admins: Set<string>;
  hires: Map<string, HireRecord>;
  templates: Map<string, Template>;
  plans: Map<string, PlanRecord>;
  checkIns: CheckIn[];
  reviews: ProbationReview[];
  settings: Map<string, unknown>;
  idempotency: Map<string, { requestHash: string; status: number; answer: unknown }>;
  outbox: PendingEvent[];
  slug: string | null;
}

const fresh = (): TenantState => ({
  members: new Map(),
  admins: new Set(),
  hires: new Map(),
  templates: new Map(),
  plans: new Map(),
  checkIns: [],
  reviews: [],
  settings: new Map(),
  idempotency: new Map(),
  outbox: [],
  slug: null,
});

const clone = <T>(v: T): T => structuredClone(v);

function txOf(s: TenantState): Tx {
  return {
    members: {
      get: (id) => Promise.resolve(clone(s.members.get(id)?.m ?? null)),
      byAccount: (account) =>
        Promise.resolve(
          clone([...s.members.values()].find((r) => r.m.accountId === account)?.m ?? null),
        ),
      list: () => Promise.resolve([...s.members.values()].map((r) => clone(r.m))),
      upsert: (m, eventId) => {
        const held = s.members.get(m.personId);
        if (held?.lastEventId === eventId) return Promise.resolve(false);
        s.members.set(m.personId, { m: clone(m), lastEventId: eventId });
        return Promise.resolve(true);
      },
    },
    admins: {
      has: (a) => Promise.resolve(s.admins.has(a)),
      add: (a) => {
        s.admins.add(a);
        return Promise.resolve();
      },
      remove: (a) => {
        s.admins.delete(a);
        return Promise.resolve();
      },
    },
    hires: {
      get: (id) => Promise.resolve(clone(s.hires.get(id) ?? null)),
      bySource: (source, externalId) =>
        Promise.resolve(
          clone(
            [...s.hires.values()].find((h) => h.source === source && h.externalId === externalId) ??
              null,
          ),
        ),
      byEmail: (email) =>
        Promise.resolve(
          clone(
            [...s.hires.values()].find((h) => h.email.toLowerCase() === email.toLowerCase()) ??
              null,
          ),
        ),
      save: (h) => {
        s.hires.set(h.id, clone(h));
        return Promise.resolve();
      },
    },
    templates: {
      get: (id) => Promise.resolve(clone(s.templates.get(id) ?? null)),
      list: () => Promise.resolve([...s.templates.values()].map(clone)),
      save: (t) => {
        s.templates.set(t.id, clone(t));
        return Promise.resolve();
      },
      remove: (id) => {
        s.templates.delete(id);
        return Promise.resolve();
      },
    },
    plans: {
      get: (id) => Promise.resolve(clone(s.plans.get(id) ?? null)),
      byHire: (hireId) =>
        Promise.resolve(clone([...s.plans.values()].find((p) => p.hireId === hireId) ?? null)),
      byWelcomeHash: (hash) =>
        Promise.resolve(clone([...s.plans.values()].find((p) => p.welcomeHash === hash) ?? null)),
      list: () => Promise.resolve([...s.plans.values()].map(clone)),
      save: (p) => {
        s.plans.set(p.id, clone(p));
        return Promise.resolve();
      },
    },
    checkIns: {
      forPlan: (planId) =>
        Promise.resolve(s.checkIns.filter((c) => c.planId === planId).map(clone)),
      save: (c) => {
        s.checkIns.push(clone(c));
        return Promise.resolve();
      },
    },
    reviews: {
      forPlan: (planId) => Promise.resolve(s.reviews.filter((r) => r.planId === planId).map(clone)),
      save: (r) => {
        s.reviews.push(clone(r));
        return Promise.resolve();
      },
    },
    settings: {
      get: (key) => Promise.resolve(clone(s.settings.get(key) ?? null)),
      set: (key, value) => {
        s.settings.set(key, clone(value));
        return Promise.resolve();
      },
    },
    idempotency: {
      get: (key) => Promise.resolve(clone(s.idempotency.get(key) ?? null)),
      put: (key, requestHash, status, answer) => {
        s.idempotency.set(key, { requestHash, status, answer: clone(answer) });
        return Promise.resolve();
      },
    },
    outbox: {
      publish: (events) => {
        s.outbox.push(...events.map(clone));
        return Promise.resolve();
      },
    },
    tenant: {
      register: (slug) => {
        s.slug = slug ?? s.slug;
        return Promise.resolve();
      },
      slug: () => Promise.resolve(s.slug),
    },
  };
}

export interface MemoryUnitOfWork extends UnitOfWork {
  events(tenantId: TenantId): readonly PendingEvent[];
}

export function memoryUnitOfWork(): MemoryUnitOfWork {
  const tenants = new Map<string, TenantState>();
  const stateOf = (tenantId: string): TenantState => {
    let found = tenants.get(tenantId);
    if (found === undefined) {
      found = fresh();
      tenants.set(tenantId, found);
    }
    return found;
  };
  return {
    async run(tenantId, fn) {
      const live = stateOf(tenantId);
      const copy = structuredClone(live);
      const result = await fn(txOf(copy));
      tenants.set(tenantId, copy);
      return result;
    },
    tenants: () =>
      Promise.resolve(
        [...tenants.entries()].map(([tenantId, s]) => ({
          tenantId: tenantId as TenantId,
          slug: s.slug,
        })),
      ),
    tenantBySlug: (slug) =>
      Promise.resolve(
        ([...tenants.entries()].find(([, s]) => s.slug === slug)?.[0] as TenantId | undefined) ??
          null,
      ),
    events: (tenantId) => [...stateOf(tenantId).outbox],
  };
}
