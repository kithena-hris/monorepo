import type { Clock, PendingEvent } from '@kithena/domain-kit';
import type { CalendarDate, PersonId, TenantId } from '@kithena/contracts';

import type { Automation } from '../domain/automation.js';
import type { Cycle } from '../domain/cycle.js';
import type { Feedback, FeedbackRequest, Note } from '../domain/feedback.js';
import type { Goal } from '../domain/goals.js';
import type { Assignment, LearningItem } from '../domain/learning.js';
import type { CalibrationSession, Nomination, Review } from '../domain/review.js';
import type { Template } from '../domain/template.js';

/**
 * What Performance's use cases need from the world (PRF-004): one tenant's
 * stores inside one transaction, and the clock, ids, mail and the model
 * beside them. Onboarding's shape, with one store per aggregate over a
 * single table of records (`migrations/*_performance_core.sql`).
 */

export interface Caller {
  readonly tenantId: TenantId;
  readonly accountId: string;
  readonly personId: string | null;
  readonly correlationId: string;
  /** "Web", "Phone", "Slack", "Ask Kithena": where the activity log says it came from. */
  readonly via?: string;
}

export interface Member {
  readonly personId: PersonId;
  readonly accountId: string | null;
  readonly displayName: string;
  readonly workEmail: string | null;
  readonly managerPersonId: PersonId | null;
  readonly status: string;
  readonly title: string | null;
  readonly orgUnitId: string | null;
  readonly locationId: string | null;
  readonly legalEntityId: string | null;
  readonly hiredOn: CalendarDate | null;
  readonly probationEnd: CalendarDate | null;
}

/** The columns a record is found by; the rest is its JSON. */
export interface Where {
  readonly cycleId?: string;
  readonly subjectId?: string;
  readonly ownerId?: string;
  readonly state?: string;
  readonly key?: string;
}

export interface Store<T extends { readonly id: string }> {
  get(id: string): Promise<T | null>;
  find(where?: Where): Promise<T[]>;
  /**
   * Insert or replace. With `expectRevision`, only over that revision: false
   * when another save got there first (§10.2), and nothing is written.
   */
  save(value: T, expectRevision?: number): Promise<boolean>;
  remove(id: string): Promise<void>;
}

export interface OrgUnit {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
}

/** One AI output kept for review (§22.4): never the input itself, only its hash. */
export interface AiOutput {
  readonly id: string;
  readonly feature: string;
  readonly forPerson: string | null;
  readonly on: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly output: unknown;
  outcome: string;
  readonly at: string;
}

/** A person's grants to read their own work in connected tools (§22.3). */
export interface Grant {
  readonly id: string;
  readonly sources: Readonly<Record<string, { readonly on: boolean; readonly at: string }>>;
  readonly reads: readonly {
    readonly source: string;
    readonly at: string;
    readonly purpose: string;
  }[];
}

export interface SavedChart {
  readonly id: string;
  readonly owner: string;
  readonly title: string;
  readonly plan: unknown;
  readonly at: string;
}

export interface Tx {
  readonly members: {
    get(personId: string): Promise<Member | null>;
    byAccount(accountId: string): Promise<Member | null>;
    list(): Promise<readonly Member[]>;
    upsert(member: Member, eventId: string): Promise<boolean>;
  };
  readonly admins: {
    has(accountId: string): Promise<boolean>;
    add(accountId: string): Promise<void>;
    remove(accountId: string): Promise<void>;
  };
  readonly templates: Store<Template>;
  readonly cycles: Store<Cycle>;
  readonly reviews: Store<Review>;
  readonly nominations: Store<Nomination>;
  readonly feedback: Store<Feedback>;
  readonly requests: Store<FeedbackRequest>;
  readonly notes: Store<Note>;
  readonly goals: Store<Goal>;
  readonly items: Store<LearningItem>;
  readonly assignments: Store<Assignment>;
  readonly automations: Store<Automation>;
  readonly calibrations: Store<CalibrationSession>;
  readonly aiLog: Store<AiOutput>;
  readonly grants: Store<Grant>;
  readonly orgUnits: Store<OrgUnit>;
  readonly charts: Store<SavedChart>;
  readonly settings: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  readonly idempotency: {
    get(key: string): Promise<{ requestHash: string; status: number; answer: unknown } | null>;
    put(key: string, requestHash: string, status: number, answer: unknown): Promise<void>;
  };
  readonly outbox: { publish(events: readonly PendingEvent[]): Promise<void> };
}

export interface UnitOfWork {
  run<T>(tenantId: TenantId, fn: (tx: Tx) => Promise<T>): Promise<T>;
  tenants(): Promise<readonly TenantId[]>;
}

export interface Mailer {
  send(message: {
    readonly tenantId: string;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly dedupeKey: string;
  }): Promise<void>;
}

/** Any OpenAI-compatible chat model, behind the AI gateway (`infrastructure/model.ts`). */
export interface Model {
  readonly name: string;
  complete(
    tenantId: string,
    prompt: { readonly instruction: string; readonly context: Readonly<Record<string, unknown>> },
  ): Promise<string | null>;
}

/** What changed in a cycle, for the live stream (§8.7). */
export interface LiveChange {
  readonly cycleId: string;
  readonly state: string;
  readonly version: number;
  readonly counts: Readonly<Record<string, number>>;
}

export interface Live {
  publish(tenantId: string, change: LiveChange): void;
  subscribe(tenantId: string, listener: (change: LiveChange) => void): () => void;
}

export interface Deps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly live: Live;
  readonly mailer?: Mailer;
  readonly model?: Model;
}
