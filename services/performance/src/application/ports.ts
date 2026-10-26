import type { Clock, PendingEvent, Result, Words } from '@kithena/domain-kit';
import type { CalendarDate, PersonId, TenantId } from '@kithena/contracts';

import type { Automation } from '../domain/automation.js';
import type { Cycle } from '../domain/cycle.js';
import type { Feedback, FeedbackRequest, Note } from '../domain/feedback.js';
import type { Goal } from '../domain/goals.js';
import type { Assignment, LearningItem } from '../domain/learning.js';
import type { CalibrationSession, Nomination, Review } from '../domain/review.js';
import type { Template } from '../domain/template.js';
import type { WebhookEndpoint } from '../domain/webhook.js';

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
  /** Their last working day, once they leave: where retention counts from (§30). */
  readonly leftOn?: CalendarDate | null;
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
  readonly sources: Readonly<
    Record<
      string,
      {
        readonly on: boolean;
        readonly at: string;
        /** Who they are in the tool, once linked: a Slack user id, a GitHub login. */
        readonly account?: string | null;
        /** What the tool's adapter keeps to read as them, sealed by it; null when the tool keeps it. */
        readonly secret?: string | null;
      }
    >
  >;
  readonly reads: readonly {
    readonly source: string;
    readonly at: string;
    readonly purpose: string;
  }[];
}

/**
 * A plan Ask Kithena proposed in a chat app (PRF-164), held until the person
 * presses Do it there, then run as them through the same routes. An hour.
 */
export interface ChatPlan {
  readonly id: string;
  readonly accountId: string;
  readonly reply: string;
  readonly steps: readonly {
    readonly route: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly body: unknown;
    readonly summary: string;
  }[];
  readonly until: string;
  readonly ran: string | null;
}

/** An event the outbox holds, as written: what a webhook delivers. */
export interface Written {
  readonly eventId: string;
  readonly eventName: string;
  readonly writtenAt: string;
  readonly envelope: unknown;
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
  readonly webhooks: Store<WebhookEndpoint>;
  readonly chatPlans: Store<ChatPlan>;
  readonly settings: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  readonly idempotency: {
    get(key: string): Promise<{ requestHash: string; status: number; answer: unknown } | null>;
    put(key: string, requestHash: string, status: number, answer: unknown): Promise<void>;
  };
  readonly outbox: {
    publish(events: readonly PendingEvent[]): Promise<void>;
    /** What was written after `after`, oldest first, at most `limit`. */
    since(
      after: { readonly at: string; readonly id: string },
      limit: number,
    ): Promise<readonly Written[]>;
  };
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
    /** A session's `.ics` invitation, at most. */
    readonly attachments?: readonly { readonly filename: string; readonly base64: string }[];
    /** The member's account: their devices hear of it too, if they turned push on. */
    readonly accountId?: string;
    /** Something for them to do, pushed at once, rather than news. */
    readonly urgent?: boolean;
  }): Promise<void>;
  /**
   * The company's language and this module's words in it: every email is
   * written in the company's language, whatever its reader chose for screens.
   */
  words?(tenantId: string): Promise<MailWords>;
}

/** A language and this module's words for its emails in it. */
export interface MailWords {
  readonly language: string;
  readonly t: Words;
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

/** A webhook's POST; anything but an answer is status 0. */
export type WebhookPoster = (
  url: string,
  request: { readonly headers: Record<string, string>; readonly body: string },
) => Promise<{ readonly status: number }>;

/** Signing and sending webhooks (`PERFORMANCE_WEBHOOK_KEY`); absent, no endpoint can be added. */
export interface Webhooks {
  /** An endpoint's secret at one rotation, derived, never stored. */
  secret(tenantId: string, endpointId: string, version: number): string;
  sign(body: string, secrets: readonly string[]): string;
  /** Whether a URL may be sent to at all: https, public, not Kithena's own. */
  vet(url: string): Promise<Result<true>>;
  readonly post: WebhookPoster;
}

/** What a chat app's button does when pressed (PRF-164): a route as the person, or a plan they confirm. */
export type ChatPress =
  | {
      readonly kind: 'route';
      readonly tenantId: string;
      readonly accountId: string;
      readonly route: string;
      readonly params: Readonly<Record<string, unknown>>;
      readonly body: unknown;
      readonly until: string;
    }
  | {
      readonly kind: 'plan';
      readonly tenantId: string;
      readonly accountId: string;
      readonly planId: string;
      readonly until: string;
    };

export interface ChatButton {
  readonly label: string;
  /** Sealed by Performance; the chat app passes it back as it came. */
  readonly value: string;
  readonly style?: 'primary' | 'danger';
}

/** The company's chat app, through `platform/slack` (PRF-164); absent without its pair's secret. */
export interface Chat {
  send(
    tenantId: string,
    message: {
      readonly email: string;
      readonly text: string;
      readonly buttons: readonly ChatButton[];
    },
  ): Promise<void>;
  /** A button's value, signed so that only Performance's own buttons run. */
  seal(press: ChatPress): string;
  /** A pressed value back, or null for one Performance did not sign. */
  open(value: string): ChatPress | null;
}

/** Something a person's tool holds about the subject in the period, for one request only (§23.1). */
export interface EvidenceItem {
  readonly link: string;
  readonly date: string;
  readonly kind: string;
  readonly text: string;
}

/**
 * A work tool a person links for themselves (§22.3, §23.1): one adapter per
 * tool behind this port. The person approves it in the tool; every read is
 * through their own token, about one subject and one period, and nothing
 * read is kept.
 */
export interface ToolConnector {
  /** Where the company installs the tool's app first, when it has one (GitHub's). */
  readonly install?: string;
  /** Where the person approves Kithena reading it, returning to `origin`. */
  authorize(a: {
    readonly tenantId: string;
    readonly personId: string;
    readonly origin: string;
  }): Promise<Result<{ readonly url: string }>>;
  /** They approved: who they are there, and what to keep to read as them. */
  complete(a: {
    readonly tenantId: string;
    readonly personId: string;
    readonly code: string;
    readonly state: string;
  }): Promise<Result<{ readonly account: string; readonly secret: string | null }>>;
  /** What the subject did in the period, as the person can see it; a renewed secret to keep. */
  search(a: {
    readonly tenantId: string;
    readonly personId: string;
    readonly secret: string | null;
    readonly subject: { readonly email: string | null; readonly account: string | null };
    readonly from: string;
    readonly to: string;
  }): Promise<Result<{ readonly items: readonly EvidenceItem[]; readonly secret?: string | null }>>;
  /** Turned off: the token given back to the tool. */
  revoke(a: {
    readonly tenantId: string;
    readonly personId: string;
    readonly secret: string | null;
  }): Promise<void>;
}

export interface Deps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly live: Live;
  readonly mailer?: Mailer;
  readonly model?: Model;
  readonly webhooks?: Webhooks;
  readonly chat?: Chat;
  /** The tools a person may link, by source (`slack`, `github`); a tool without one is not offered. */
  readonly tools?: Readonly<Partial<Record<string, ToolConnector>>>;
}
