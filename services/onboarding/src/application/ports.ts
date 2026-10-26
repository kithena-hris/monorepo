import type { Clock, PendingEvent, Words } from '@kithena/domain-kit';
import type {
  CalendarDate,
  HireIntake,
  PersonId,
  ProbationOutcome,
  TenantId,
} from '@kithena/contracts';

import type { Plan, Template } from '../domain/plan.js';

/**
 * What Onboarding's use cases need from the world (ONB-006): one tenant's
 * stores inside one transaction, and the clock, ids and mail beside them.
 * Recruiting's shape, smaller.
 */

export interface Caller {
  readonly tenantId: TenantId;
  readonly accountId: string;
  readonly personId: string | null;
  readonly correlationId: string;
}

export interface Member {
  readonly personId: PersonId;
  readonly accountId: string | null;
  readonly displayName: string;
  readonly workEmail: string | null;
  readonly managerPersonId: PersonId | null;
  readonly status: string;
}

export interface HireRecord extends HireIntake {
  readonly id: string;
  readonly createdAt: string;
}

/** A plan, with the hire it is for as the plan's screens need it. */
export interface PlanRecord extends Plan {
  readonly name: string;
  readonly email: string;
  readonly personId: string | null;
  readonly managerId: string | null;
  readonly country: HireIntake['country'];
  readonly department: string | null;
  readonly location: string | null;
  readonly workMode: HireIntake['workMode'];
  readonly allowedExtensionMonths: number | null;
  readonly welcomeHash: string | null;
}

export interface CheckIn {
  readonly id: string;
  readonly planId: string;
  readonly day: 30 | 60 | 90;
  readonly by: string;
  readonly notes: string;
  readonly at: string;
}

export interface ProbationReview {
  readonly planId: string;
  readonly outcome: ProbationOutcome;
  readonly probationEnd: CalendarDate | null;
  readonly by: string;
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
  readonly hires: {
    get(id: string): Promise<HireRecord | null>;
    bySource(source: HireIntake['source'], externalId: string): Promise<HireRecord | null>;
    byEmail(email: string): Promise<HireRecord | null>;
    save(hire: HireRecord): Promise<void>;
  };
  readonly templates: {
    get(id: string): Promise<Template | null>;
    list(): Promise<readonly Template[]>;
    save(template: Template): Promise<void>;
    remove(id: string): Promise<void>;
  };
  readonly plans: {
    get(id: string): Promise<PlanRecord | null>;
    byHire(hireId: string): Promise<PlanRecord | null>;
    byWelcomeHash(hash: string): Promise<PlanRecord | null>;
    list(): Promise<readonly PlanRecord[]>;
    save(plan: PlanRecord): Promise<void>;
  };
  readonly checkIns: {
    forPlan(planId: string): Promise<readonly CheckIn[]>;
    save(checkIn: CheckIn): Promise<void>;
  };
  readonly reviews: {
    forPlan(planId: string): Promise<readonly ProbationReview[]>;
    save(review: ProbationReview): Promise<void>;
  };
  readonly settings: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  readonly idempotency: {
    get(key: string): Promise<{ requestHash: string; status: number; answer: unknown } | null>;
    put(key: string, requestHash: string, status: number, answer: unknown): Promise<void>;
  };
  readonly outbox: { publish(events: readonly PendingEvent[]): Promise<void> };
  readonly tenant: {
    register(slug: string | null): Promise<void>;
    slug(): Promise<string | null>;
  };
}

export interface UnitOfWork {
  run<T>(tenantId: TenantId, fn: (tx: Tx) => Promise<T>): Promise<T>;
  tenants(): Promise<readonly { tenantId: TenantId; slug: string | null }[]>;
  tenantBySlug(slug: string): Promise<TenantId | null>;
}

export interface Mailer {
  send(message: {
    readonly tenantId: string;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly dedupeKey: string;
    readonly parts?: MailParts;
  }): Promise<void>;
  /**
   * The company's language and this module's words in it: every email is
   * written in the company's language, whatever its reader chose for screens.
   */
  words?(tenantId: string): Promise<MailWords>;
}

/** What messaging lays out beside the words: a heading, facts, one button, what happens next. */
export interface MailParts {
  readonly heading?: string;
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
  readonly action?: { readonly label: string; readonly href: string };
  readonly steps?: readonly string[];
  readonly note?: string;
}

/** A language and this module's words for its emails in it. */
export interface MailWords {
  readonly language: string;
  readonly t: Words;
}

export interface Deps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly mailer?: Mailer;
  /** The public site the welcome page lives on: `https://jobs.kithena.com`. */
  readonly jobsOrigin: string;
}
