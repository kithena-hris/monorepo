import type { Answer, Questionnaire } from '../domain/screening/questionnaire.js';
import type { Prehire } from '../domain/prehire/prehire.js';
import type { Contract } from '../domain/contract/contract.js';
import type { Offer } from '../domain/offer/offer.js';
import type { Scorecard } from '../domain/interview/interview.js';
import type { Target } from '../domain/job/job.js';
import type { FormField } from '../domain/form/form.js';
import type { TeamRole } from '../domain/access/access.js';
import { createHash } from 'node:crypto';
import type { PendingEvent } from '@kithena/domain-kit';
import { PublicCompany, PublicListing, type PublicJob, type TenantId } from '@kithena/contracts';

import type { StageMove } from '../domain/pipeline/application.js';
import type { Stage } from '../domain/pipeline/pipeline.js';
import { normalEmail, normalPhone } from '../domain/candidate/duplicates.js';
import type {
  Assessment,
  VerdictRow,
  Agency,
  Listings,
  AgencySubmission,
  Approval,
  ApplicationRecord,
  Blobs,
  Candidate,
  CandidateFile,
  Consent,
  Message,
  Note,
  PoolMember,
  Pool,
  Records,
  ReferenceRequest,
  Referral,
  Tx,
  UnitOfWork,
  WorkingHours,
  Criterion,
  InterviewRecord,
  JobAd,
  JobRecord,
  Member,
  PlannedInterview,
  CareersDomain,
  ConnectionKind,
} from '../application/ports.js';

/**
 * Recruiting in memory: every store, per tenant, for the domain-adjacent
 * tests and the standalone suite. Documents' `testing/memory.ts` shape. A
 * failed transaction's writes are discarded: each run works on a copy.
 */

/** Every method answers through a promise, as the ports do; the bodies stay synchronous. */
type Sync<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => R | Promise<R>
    : T[K] extends (...args: infer A) => infer R
      ? (...args: A) => R
      : Sync<T[K]>;
};

function promisify<T>(target: Sync<T>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
    out[key] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            const result: unknown = (value as (...a: unknown[]) => unknown)(...args);
            return key === 'keys' || key === 'events' ? result : Promise.resolve(result);
          }
        : value !== null && typeof value === 'object'
          ? promisify(value as never)
          : value;
  }
  return out as T;
}

type Bag = Map<string, unknown>;

interface TenantState {
  readonly id: string;
  readonly bags: Map<string, Bag>;
  readonly outbox: PendingEvent[];
  slug: string | null;
}

const clone = <T>(value: T): T => structuredClone(value);

function bag(state: TenantState, name: string): Bag {
  let found = state.bags.get(name);
  if (found === undefined) {
    found = new Map();
    state.bags.set(name, found);
  }
  return found;
}

function records<T extends { readonly id: string }>(state: TenantState, name: string): Records<T> {
  const b = () => bag(state, name);
  return promisify<Records<T>>({
    get: (id) => clone((b().get(id) as T | undefined) ?? null),
    list: () => clone([...b().values()] as T[]),
    save: (value) => {
      b().set(value.id, clone(value));
    },
    remove: (id) => {
      b().delete(id);
    },
  });
}

function keyed<T>(state: TenantState, name: string) {
  const b = () => bag(state, name);
  return {
    get: (key: string) => clone((b().get(key) as T | undefined) ?? null),
    set: (key: string, value: T) => b().set(key, clone(value)),
    del: (key: string) => b().delete(key),
    values: () => clone([...b().values()] as T[]),
  };
}

const tail = (phone: string | null) =>
  phone === null ? null : normalPhone(phone).replace(/^\+/u, '').slice(-9);

function txOf(state: TenantState, publicState: PublicState): Tx {
  const members = keyed<{ m: Member; at: string }>(state, 'members');
  const admins = keyed<true>(state, 'admins');
  const approvals = keyed<Approval>(state, 'approvals');
  const jobs = keyed<JobRecord>(state, 'jobs');
  const teams = keyed<{ personId: string; role: TeamRole }[]>(state, 'teams');
  const stages = keyed<Stage[]>(state, 'stages');
  const forms = keyed<{
    fields: FormField[];
    questionnaireId: string | null;
  }>(state, 'forms');
  const ads = keyed<JobAd>(state, 'ads');
  const targets = keyed<Target>(state, 'targets');
  const criteria = keyed<Criterion[]>(state, 'criteria');
  const plans = keyed<PlannedInterview[]>(state, 'plans');
  const candidates = keyed<Candidate>(state, 'candidates');
  const files = keyed<CandidateFile>(state, 'files');
  const texts = keyed<{ text: string; noText: boolean }>(state, 'texts');
  const apps = keyed<ApplicationRecord>(state, 'applications');
  const moves = keyed<StageMove & { category: string }>(state, 'moves');
  const consents = keyed<Consent>(state, 'consents');
  const pools = keyed<Pool>(state, 'pools');
  const poolMembers = keyed<PoolMember>(state, 'poolMembers');
  const notes = keyed<Note>(state, 'notes');
  const messages = keyed<Message>(state, 'messages');
  const interviews = keyed<InterviewRecord>(state, 'interviews');
  const cards = keyed<Scorecard & { notes: string | null }>(state, 'scorecards');
  const hours = keyed<WorkingHours>(state, 'hours');
  const connections = keyed<{ kind: ConnectionKind; sealed: Uint8Array }[]>(state, 'connections');
  const othersThan = (person: string, kind: ConnectionKind) =>
    (connections.get(person) ?? []).filter((c) => c.kind !== kind);
  const assessed = keyed<Assessment>(state, 'assessments');
  const selfIds = keyed<{ applicationId: string; sealed: number[] }>(state, 'selfIds');
  const verdicts = keyed<VerdictRow & { assessmentId: string }>(state, 'verdicts');
  const refs = keyed<ReferenceRequest>(state, 'references');
  const offers = keyed<Offer>(state, 'offers');
  const contracts = keyed<Contract & { fileId: string | null }>(state, 'contracts');
  const prehires = keyed<Prehire>(state, 'prehires');
  const referrals = keyed<Referral>(state, 'referrals');
  const submissions = keyed<AgencySubmission>(state, 'submissions');
  const codes = keyed<{ codeHash: string; attempts: number; expiresAt: string }>(state, 'codes');
  const tokens = keyed<{ candidateId: string; expiresAt: string }>(state, 'tokens');
  const holds = keyed<{ reason: string; by: string }>(state, 'holds');
  const settings = keyed<unknown>(state, 'settings');
  const idem = keyed<{ requestHash: string; status: number; answer: unknown }>(
    state,
    'idempotency',
  );
  const questionnaires = keyed<Questionnaire>(state, 'questionnaires');
  const answers = keyed<{
    questionnaireId: string;
    answers: Record<string, Answer>;
    score: number | null;
    applicationId: string;
  }>(state, 'answers');

  return promisify<Tx>({
    members: {
      get: (id) => members.get(id)?.m ?? null,
      byAccount: (account) => members.values().find((r) => r.m.accountId === account)?.m ?? null,
      list: () => members.values().map((r) => r.m),
      upsert: (member, eventId, effectiveFrom) => {
        const at = `${effectiveFrom}|${eventId}`;
        const held = members.get(member.personId);
        if (held !== null && held.at >= at) return false;
        members.set(member.personId, { m: member, at });
        return true;
      },
    },
    admins: {
      has: (a) => admins.get(a) !== null,
      list: () => [...bag(state, 'admins').keys()],
      add: (a) => {
        admins.set(a, true);
      },
      remove: (a) => {
        admins.del(a);
      },
    },
    entities: records(state, 'entities'),
    locations: records(state, 'locations'),
    orgUnits: records(state, 'orgUnits'),
    requisitions: records(state, 'requisitions'),
    chains: records(state, 'chains'),
    approvals: {
      get: (id) => approvals.get(id),
      open: (kind, id) =>
        approvals
          .values()
          .find((a) => a.subject.kind === kind && a.subject.id === id && a.outcome === 'pending') ??
        null,
      waitingOn: (person) =>
        approvals.values().filter((a) => {
          if (a.outcome !== 'pending') return false;
          const step = a.steps.findIndex((_, i) => !a.decisions.some((d) => d.step === i));
          return step !== -1 && (a.steps[step] ?? []).includes(person);
        }),
      save: (a) => {
        approvals.set(a.id, a);
      },
    },
    jobs: {
      get: (id) => jobs.get(id),
      bySlug: (slug) => jobs.values().find((j) => j.slug === slug) ?? null,
      list: () => jobs.values(),
      save: (job) => {
        jobs.set(job.id, job);
      },
      team: (id) => teams.get(id) ?? [],
      setTeam: (id, team) => {
        teams.set(id, [...team]);
      },
      onTeam: (person) =>
        [...bag(state, 'teams').entries()]
          .filter(([, t]) => (t as { personId: string }[]).some((m) => m.personId === person))
          .map(([id]) => id),
      stages: (id) => stages.get(id) ?? [],
      setStages: (id, s) => {
        stages.set(id, [...s]);
      },
      form: (id) => forms.get(id),
      setForm: (id, fields, questionnaireId) => {
        forms.set(id, { fields: [...fields], questionnaireId });
      },
      ads: (id) => ads.values().filter((a) => a.jobId === id),
      saveAd: (ad) => {
        ads.set(`${ad.jobId}:${ad.language}`, ad);
      },
      targets: (id) =>
        [...bag(state, 'targets').entries()]
          .filter(([k]) => k.startsWith(`${id}:`))
          .map(([, t]) => clone(t as Target)),
      saveTarget: (id, t) => {
        targets.set(`${id}:${t.target}`, t);
      },
      criteria: (id) => criteria.get(id) ?? [],
      setCriteria: (id, c) => {
        criteria.set(id, [...c]);
      },
      plan: (id) => plans.get(id) ?? [],
      setPlan: (id, p) => {
        plans.set(id, [...p]);
      },
    },
    pipelines: records(state, 'pipelines'),
    questionnaires: {
      get: (id) => questionnaires.get(id),
      list: () => questionnaires.values(),
      save: (q) => {
        questionnaires.set(q.id, q);
      },
      remove: (id) => {
        questionnaires.del(id);
      },
      answers: (applicationId) => answers.values().filter((a) => a.applicationId === applicationId),
      saveAnswers: (applicationId, questionnaireId, _version, given, score) => {
        answers.set(`${applicationId}:${questionnaireId}`, {
          applicationId,
          questionnaireId,
          answers: { ...given },
          score,
        });
      },
    },
    candidates: {
      get: (id) => candidates.get(id),
      byEmail: (email) =>
        candidates
          .values()
          .find(
            (c) =>
              normalEmail(c.email) === normalEmail(email) &&
              c.mergedInto === null &&
              c.anonymisedAt === null,
          ) ?? null,
      suspects: (phoneTail, cvHash) =>
        candidates
          .values()
          .filter(
            (c) =>
              c.mergedInto === null &&
              c.anonymisedAt === null &&
              ((phoneTail !== null && tail(c.phone) === phoneTail) ||
                (cvHash !== null && c.cvHash === cvHash)),
          ),
      search: ({ text, tag, limit }) =>
        candidates
          .values()
          .filter((c) => c.mergedInto === null && c.anonymisedAt === null)
          .filter((c) => tag === undefined || c.tags.includes(tag))
          .filter((c) => {
            if (text === undefined || text.trim() === '') return true;
            const needle = text.toLowerCase();
            if (c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle))
              return true;
            return files
              .values()
              .some(
                (f) =>
                  f.candidateId === c.id &&
                  (texts.get(f.id)?.text.toLowerCase().includes(needle) ?? false),
              );
          })
          .slice(0, limit),
      save: (c) => {
        candidates.set(c.id, c);
      },
    },
    files: {
      get: (id) => files.get(id),
      of: (candidateId) => files.values().filter((f) => f.candidateId === candidateId),
      add: (f) => {
        files.set(f.id, f);
      },
      setText: (id, text) => {
        texts.set(id, { text: text ?? '', noText: text === null });
      },
      text: (id) => texts.get(id),
      removeOf: (candidateId) => {
        const gone = files.values().filter((f) => f.candidateId === candidateId);
        for (const f of gone) {
          files.del(f.id);
          texts.del(f.id);
        }
        return gone;
      },
    },
    applications: {
      get: (id) => apps.get(id),
      forJob: (jobId) => apps.values().filter((a) => a.jobId === jobId),
      forCandidate: (candidateId) => apps.values().filter((a) => a.candidateId === candidateId),
      find: (candidateId, jobId) =>
        apps.values().find((a) => a.candidateId === candidateId && a.jobId === jobId) ?? null,
      save: (app, category, newMoves) => {
        apps.set(app.id, app);
        for (const move of newMoves) moves.set(move.id, { ...move, category });
      },
      all: () => apps.values(),
    },
    consents: {
      of: (candidateId) => consents.values().filter((c) => c.candidateId === candidateId),
      save: (c) => {
        consents.set(c.id, c);
      },
    },
    pools: {
      list: () => pools.values(),
      get: (id) => pools.get(id),
      save: (p) => {
        pools.set(p.id, p);
      },
      members: (poolId) => poolMembers.values().filter((m) => m.poolId === poolId),
      of: (candidateId) => poolMembers.values().filter((m) => m.candidateId === candidateId),
      add: (m) => {
        poolMembers.set(`${m.poolId}:${m.candidateId}`, m);
      },
      remove: (poolId, candidateId) => {
        poolMembers.del(`${poolId}:${candidateId}`);
      },
    },
    notes: {
      of: (candidateId) => notes.values().filter((n) => n.candidateId === candidateId),
      add: (n) => {
        notes.set(n.id, n);
      },
    },
    messages: {
      thread: (candidateId) =>
        messages
          .values()
          .filter((m) => m.candidateId === candidateId)
          .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
      add: (m) => {
        messages.set(m.id, m);
      },
      markSent: (id, at) => {
        const m = messages.get(id);
        if (m !== null) messages.set(id, { ...m, sentAt: at });
      },
      markRead: (candidateId, at) => {
        for (const m of messages.values())
          if (m.candidateId === candidateId && m.direction === 'in' && m.readAt === null)
            messages.set(m.id, { ...m, readAt: at });
      },
      due: (at) =>
        messages
          .values()
          .filter((m) => m.direction === 'out' && m.sentAt === null && m.sendAt <= at),
    },
    templates: records(state, 'templates'),
    interviews: {
      get: (id) => interviews.get(id),
      forApplication: (applicationId) =>
        interviews.values().filter((i) => i.applicationId === applicationId),
      forInterviewer: (person, from, to) =>
        interviews
          .values()
          .filter(
            (i) => i.interviewerIds.includes(person) && i.startsAt >= from && i.startsAt < to,
          ),
      startingBetween: (from, to) =>
        interviews
          .values()
          .filter((i) => i.state === 'scheduled' && i.startsAt >= from && i.startsAt < to),
      save: (i) => {
        interviews.set(i.id, i);
      },
      scorecards: (interviewId) => cards.values().filter((c) => c.interviewId === interviewId),
      forApplicationScorecards: (applicationId) => {
        const ids = new Set(
          interviews
            .values()
            .filter((i) => i.applicationId === applicationId)
            .map((i) => i.id),
        );
        return cards.values().filter((c) => ids.has(c.interviewId));
      },
      saveScorecard: (c) => {
        cards.set(`${c.interviewId}:${c.interviewerId}`, c);
      },
      scorecardNotes: (applicationId) => {
        const ids = new Set(
          interviews
            .values()
            .filter((i) => i.applicationId === applicationId)
            .map((i) => i.id),
        );
        return cards
          .values()
          .filter((c) => ids.has(c.interviewId) && c.submittedAt !== null)
          .flatMap((c) => {
            const notes = (c as { notes?: string | null }).notes ?? null;
            return notes === null || notes === ''
              ? []
              : [{ interviewId: c.interviewId, interviewerId: c.interviewerId, notes }];
          });
      },
      owedBy: (person) =>
        interviews
          .values()
          .filter(
            (i) =>
              i.state === 'completed' &&
              i.interviewerIds.includes(person) &&
              (cards.get(`${i.id}:${person}`)?.submittedAt ?? null) === null,
          ),
    },
    scorecardTemplates: records(state, 'scorecardTemplates'),
    workingHours: {
      get: (person) => hours.get(person),
      save: (h) => {
        hours.set(h.personId, h);
      },
    },
    connections: {
      list: (person) => connections.get(person) ?? [],
      save: (person, kind, sealed) => {
        connections.set(person, [...othersThan(person, kind), { kind, sealed }]);
      },
      remove: (person, kind) => {
        connections.set(person, othersThan(person, kind));
      },
    },
    assessments: {
      save: (a) => {
        assessed.set(a.id, a);
      },
      forApplication: (applicationId) =>
        assessed.values().filter((a) => a.applicationId === applicationId),
    },
    selfIds: {
      save: (applicationId, sealed) => {
        selfIds.set(applicationId, { applicationId, sealed: [...sealed] });
      },
      remove: (applicationId) => {
        selfIds.del(applicationId);
      },
      all: () =>
        selfIds
          .values()
          .map((r) => ({ applicationId: r.applicationId, sealed: Uint8Array.from(r.sealed) })),
    },
    verdicts: {
      save: (assessmentId, rows) => {
        for (const r of rows)
          verdicts.set(`${assessmentId}:${r.criterionId}`, { ...r, assessmentId });
      },
      agree: (assessmentId, criterionId, agreed, by) => {
        const held = verdicts.get(`${assessmentId}:${criterionId}`);
        if (held !== null)
          verdicts.set(`${assessmentId}:${criterionId}`, { ...held, agreed, agreedBy: by });
      },
      of: (assessmentId) =>
        verdicts
          .values()
          .filter((v) => v.assessmentId === assessmentId)
          .map(({ assessmentId: _a, ...v }) => v),
    },
    references: {
      forApplication: (applicationId) =>
        refs.values().filter((r) => r.applicationId === applicationId),
      byToken: (hash) => refs.values().find((r) => r.tokenHash === hash) ?? null,
      save: (r) => {
        refs.set(r.id, r);
      },
    },
    offers: {
      get: (id) => offers.get(id),
      forApplication: (applicationId) =>
        offers.values().filter((o) => o.applicationId === applicationId),
      list: () => offers.values(),
      save: (o) => {
        offers.set(o.id, o);
      },
    },
    contracts: {
      get: (id) => contracts.get(id),
      forOffer: (offerId) =>
        contracts.values().find((c) => c.offerId === offerId && c.state !== 'voided') ?? null,
      bySubjectRef: (ref) => contracts.values().find((c) => c.subjectRef === ref) ?? null,
      save: (c) => {
        contracts.set(c.id, c);
      },
    },
    prehires: {
      get: (id) => prehires.get(id),
      list: () => prehires.values(),
      save: (p) => {
        prehires.set(p.applicationId, p);
      },
    },
    benefits: records(state, 'benefits'),
    payBands: records(state, 'payBands'),
    referrals: {
      list: () => referrals.values(),
      byReferrer: (person) => referrals.values().filter((r) => r.referrerId === person),
      save: (r) => {
        referrals.set(r.id, r);
      },
    },
    agencies: records<Agency>(state, 'agencies'),
    submissions: {
      forEmail: (email) => submissions.values().filter((s) => s.emailNorm === email),
      forAgency: (agencyId) => submissions.values().filter((s) => s.agencyId === agencyId),
      add: (s) => {
        submissions.set(s.id, s);
      },
    },
    codes: {
      put: (email, jobId, codeHash, expiresAt) => {
        codes.set(`${email}:${jobId}`, { codeHash, attempts: 0, expiresAt });
      },
      get: (email, jobId) => codes.get(`${email}:${jobId}`) as never,
      attempt: (email, jobId) => {
        const c = codes.get(`${email}:${jobId}`);
        if (c !== null) codes.set(`${email}:${jobId}`, { ...c, attempts: c.attempts + 1 });
      },
      remove: (email, jobId) => {
        codes.del(`${email}:${jobId}`);
      },
    },
    tokens: {
      put: (hash, candidateId, expiresAt) => {
        tokens.set(hash, { candidateId, expiresAt });
      },
      candidate: (hash, now) => {
        const t = tokens.get(hash);
        return t !== null && t.expiresAt > now ? t.candidateId : null;
      },
    },
    legalHolds: {
      has: (id) => holds.get(id) !== null,
      place: (id, reason, by) => {
        holds.set(id, { reason, by });
      },
      lift: (id) => {
        holds.del(id);
      },
    },
    settings: {
      get: (key) => settings.get(key),
      set: (key, value) => {
        settings.set(key, value);
      },
    },
    idempotency: {
      get: (key) => idem.get(key),
      put: (key, requestHash, status, answer) => {
        idem.set(key, { requestHash, status, answer });
      },
    },
    outbox: {
      publish: (events) => {
        state.outbox.push(...clone(events));
      },
    },
    tenant: {
      register: (slug) => {
        if (slug !== null) state.slug = slug;
        publicState.tenants.add(state);
      },
      slug: () => state.slug,
    },
    // ponytail: written straight through, not rolled back with a failed transaction.
    public: {
      putCompany: (company) => {
        publicState.companies.set(company.slug, clone(company));
      },
      putListing: (job, tsv) => {
        publicState.listings.set(`${job.jobId}:${job.language}`, { job: clone(job), tsv });
      },
      removeListing: (jobId) => {
        for (const key of publicState.listings.keys())
          if (key.startsWith(`${jobId}:`)) publicState.listings.delete(key);
      },
      careersDomain: () => {
        const kept = publicState.domains.get(state.id);
        return kept === undefined ? null : clone(kept.domain);
      },
      putCareersDomain: ({ companySlug, ...domain }) => {
        publicState.domains.set(state.id, { companySlug, domain: clone(domain) });
      },
      removeCareersDomain: () => {
        publicState.domains.delete(state.id);
      },
      careersDomainCount: () => publicState.domains.size,
    },
  });
}

interface PublicState {
  readonly companies: Map<string, unknown>;
  readonly listings: Map<string, { job: PublicJob; tsv: string }>;
  readonly tenants: Set<TenantState>;
  /** A careers domain per tenant, by tenant id. */
  readonly domains: Map<string, { companySlug: string; domain: CareersDomain }>;
}

export interface MemoryUnitOfWork extends UnitOfWork {
  /** Every event published, per tenant, for assertions. */
  events(tenantId: TenantId): readonly PendingEvent[];
  readonly publicListings: Map<string, { job: PublicJob; tsv: string }>;
  /** Kithena Jobs' reads over the same projection. */
  readonly listings: Listings;
}

export function memoryUnitOfWork(): MemoryUnitOfWork {
  const tenants = new Map<string, TenantState>();
  const publicState: PublicState = {
    companies: new Map(),
    listings: new Map(),
    tenants: new Set(),
    domains: new Map(),
  };
  const stateOf = (tenantId: string): TenantState => {
    let found = tenants.get(tenantId);
    if (found === undefined) {
      found = { id: tenantId, bags: new Map(), outbox: [], slug: null };
      tenants.set(tenantId, found);
    }
    return found;
  };
  return {
    async run(tenantId, fn) {
      const live = stateOf(tenantId);
      // A copy per transaction: a thrown use case leaves nothing behind.
      const copy: TenantState = {
        id: live.id,
        bags: structuredClone(live.bags),
        outbox: [...live.outbox],
        slug: live.slug,
      };
      const result = await fn(txOf(copy, publicState));
      live.bags.clear();
      for (const [k, v] of copy.bags) live.bags.set(k, v);
      live.outbox.splice(0, live.outbox.length, ...copy.outbox);
      live.slug = copy.slug;
      if (publicState.tenants.has(copy)) {
        publicState.tenants.delete(copy);
        publicState.tenants.add(live);
      }
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
    publicListings: publicState.listings,
    listings: memoryListings(publicState),
  };
}

/** The public projection searched as Postgres would, near enough: every word of the query in the text. */
function memoryListings(state: PublicState): Listings {
  const listing = (job: PublicJob): PublicListing => PublicListing.parse(job);
  const open = () => [...state.listings.values()].filter((l) => !l.job.closed);
  return {
    companyForHost: (host) =>
      Promise.resolve(
        [...state.domains.values()].find(
          (d) => d.domain.host === host && d.domain.status === 'verified',
        )?.companySlug ?? null,
      ),
    search: (query) => {
      const words = (query.q ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
      const rows = open()
        .filter((l) =>
          query.company === undefined ? l.job.searchable : l.job.company.slug === query.company,
        )
        .filter((l) => words.every((w) => `${l.job.title} ${l.tsv}`.toLowerCase().includes(w)))
        .filter(
          (l) =>
            query.country === undefined || l.job.places.some((p) => p.country === query.country),
        )
        .filter(
          (l) =>
            query.workMode === undefined ||
            query.workMode.length === 0 ||
            query.workMode.includes(l.job.workMode),
        )
        .toSorted((a, b) => b.job.postedAt.localeCompare(a.job.postedAt));
      return Promise.resolve({
        rows: rows.slice((query.page - 1) * 20, query.page * 20).map((l) => listing(l.job)),
        total: rows.length,
      });
    },
    job: (company, slug, language) => {
      const all = [...state.listings.values()].filter(
        (l) => l.job.company.slug === company && l.job.slug === slug,
      );
      const found = all.find((l) => l.job.language === language) ?? all[0];
      return Promise.resolve(found === undefined ? null : clone(found.job));
    },
    company: (slug) => {
      const company = state.companies.get(slug) as PublicCompany | undefined;
      return Promise.resolve(
        company === undefined
          ? null
          : {
              company: PublicCompany.parse(company),
              jobs: open()
                .filter((l) => l.job.company.slug === slug)
                .map((l) => listing(l.job)),
            },
      );
    },
  };
}

export function memoryBlobs(): Blobs & { readonly keys: () => readonly string[] } {
  const held = new Map<string, Uint8Array>();
  return promisify<Blobs & { readonly keys: () => readonly string[] }>({
    put: (key, bytes) => {
      held.set(key, bytes);
    },
    get: (key) => held.get(key) ?? null,
    delete: (key) => {
      held.delete(key);
    },
    keys: () => [...held.keys()],
  });
}

export const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
