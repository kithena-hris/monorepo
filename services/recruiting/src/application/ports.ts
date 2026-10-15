import type { Clock, PendingEvent } from '@kithena/domain-kit';
import type {
  CalendarDate,
  Instant,
  LaunchCountry,
  PersonId,
  TenantId,
  ApplicationSource,
  PublicJob,
} from '@kithena/contracts';

import type { Application, StageMove } from '../domain/application/application.js';
import type { Stage } from '../domain/application/pipeline.js';
import type { AdCheck } from '../domain/ad/checks.js';
import type { TeamRole } from '../domain/access/access.js';
import type { Benefit } from '../domain/benefits/benefits.js';
import type { Contract } from '../domain/contract/contract.js';
import type { FormField } from '../domain/form/form.js';
import type { Interview, Scorecard } from '../domain/interview/interview.js';
import type { Job, Target } from '../domain/job/job.js';
import type { Offer } from '../domain/offer/offer.js';
import type { Prehire } from '../domain/prehire/prehire.js';
import type { AgencyFee } from '../domain/referral/referral.js';
import type {
  ApprovalChain,
  Requisition,
  StepDecision,
} from '../domain/requisition/requisition.js';
import type { Answer, Questionnaire } from '../domain/screening/questionnaire.js';

/**
 * What Recruiting's use cases read and write through, and nothing wider.
 * Documents' shape: every store is reached through `UnitOfWork.run`, bound to
 * one tenant transaction, so row-level security sees the tenant. Bytes are
 * the one thing outside it (`Blobs`).
 */

export interface Caller {
  readonly tenantId: TenantId;
  readonly accountId: string;
  /** The member the account signs in as; null for an account that is none. */
  readonly personId: PersonId | null;
  readonly correlationId: string;
}

/* ------------------------------------------------------------ the company -- */

export interface Member {
  readonly personId: PersonId;
  readonly accountId: string | null;
  readonly displayName: string;
  readonly workEmail: string | null;
  readonly managerPersonId: PersonId | null;
  readonly teamKey: string | null;
  readonly teamName: string | null;
  readonly locationKey: string | null;
  readonly legalEntityId: string | null;
  readonly status: string;
}

export interface MemberStore {
  get(personId: PersonId): Promise<Member | null>;
  byAccount(accountId: string): Promise<Member | null>;
  list(): Promise<readonly Member[]>;
  /** Writes when `(effectiveFrom, eventId)` moves forward; answers whether it wrote. */
  upsert(member: Member, eventId: string, effectiveFrom: CalendarDate): Promise<boolean>;
}

/** Who identity names administrator of `module.recruiting`. */
export interface AdminStore {
  has(accountId: string): Promise<boolean>;
  list(): Promise<readonly string[]>;
  add(accountId: string): Promise<void>;
  remove(accountId: string): Promise<void>;
}

export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly country: LaunchCountry;
  readonly currency: string;
  readonly fullTimeWeeklyMinutes: number;
  readonly headcount: number;
  readonly foundedOn: CalendarDate | null;
  readonly worksCouncil: boolean;
  readonly worksCouncilIds: readonly string[];
}

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly entityId: string | null;
  readonly country: LaunchCountry;
  readonly region: string | null;
  readonly city: string | null;
  readonly timeZone: string;
}

/** A plain keyed store, for the aggregates nothing queries across. */
export interface Records<T extends { readonly id: string }> {
  get(id: string): Promise<T | null>;
  list(): Promise<readonly T[]>;
  save(value: T): Promise<void>;
  remove(id: string): Promise<void>;
}

/* ---------------------------------------------------------- requisitions -- */

export interface Approval {
  readonly id: string;
  readonly subject: {
    readonly kind: 'requisition' | 'offer';
    readonly id: string;
    readonly version: number;
  };
  readonly chainId: string | null;
  readonly steps: readonly (readonly string[])[];
  readonly decisions: readonly StepDecision[];
  readonly outcome: 'pending' | 'approved' | 'rejected' | 'superseded';
  readonly changes: readonly {
    readonly field: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly createdAt: Instant;
}

export interface ApprovalStore {
  get(id: string): Promise<Approval | null>;
  open(subject: Approval['subject']['kind'], subjectId: string): Promise<Approval | null>;
  /** Every pending approval a person is on, for the Inbox. */
  waitingOn(personId: string): Promise<readonly Approval[]>;
  save(approval: Approval): Promise<void>;
}

/* ------------------------------------------------------------------ jobs -- */

export interface JobAd {
  readonly jobId: string;
  readonly language: string;
  readonly title: string;
  /** The editor's document (Tiptap JSON). */
  readonly doc: unknown;
  readonly html: string;
  readonly plain: string;
  readonly checks: readonly AdCheck[];
}

export interface Criterion {
  readonly id: string;
  readonly text: string;
  readonly must: boolean;
  readonly weight: number;
}

export interface PlannedInterview {
  readonly key: string;
  readonly title: string;
  readonly minutes: number;
  readonly interviewerIds: readonly string[];
  readonly competencies: readonly string[];
  readonly scorecardTemplateId: string | null;
}

export interface JobRecord extends Job {
  readonly entityId: string | null;
  readonly locationIds: readonly string[];
  readonly slug: string;
  readonly openedAt: Instant | null;
  readonly createdAt: Instant;
  /** The pack's outline of the terms (PRD §19.2): shown in the ad. */
  readonly outline: {
    readonly contractType: string | null;
    readonly hours: 'full_time' | 'part_time';
    readonly seniority: 'entry' | 'mid' | 'senior' | 'lead' | 'executive' | null;
  };
  readonly salary: {
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
    readonly period: 'year' | 'month' | 'hour';
  } | null;
  readonly searchable: boolean;
  readonly benefitIds: readonly string[];
  readonly scorecardTemplateId: string | null;
}

export interface JobStore {
  get(id: string): Promise<JobRecord | null>;
  bySlug(slug: string): Promise<JobRecord | null>;
  list(): Promise<readonly JobRecord[]>;
  save(job: JobRecord): Promise<void>;
  team(jobId: string): Promise<readonly { readonly personId: string; readonly role: TeamRole }[]>;
  setTeam(
    jobId: string,
    team: readonly { readonly personId: string; readonly role: TeamRole }[],
  ): Promise<void>;
  /** Every job a person is on the team of. */
  onTeam(personId: string): Promise<readonly string[]>;
  stages(jobId: string): Promise<readonly Stage[]>;
  setStages(jobId: string, stages: readonly Stage[]): Promise<void>;
  form(jobId: string): Promise<{
    readonly fields: readonly FormField[];
    readonly questionnaireId: string | null;
  } | null>;
  setForm(
    jobId: string,
    fields: readonly FormField[],
    questionnaireId: string | null,
  ): Promise<void>;
  ads(jobId: string): Promise<readonly JobAd[]>;
  saveAd(ad: JobAd): Promise<void>;
  targets(jobId: string): Promise<readonly Target[]>;
  saveTarget(jobId: string, target: Target): Promise<void>;
  criteria(jobId: string): Promise<readonly Criterion[]>;
  setCriteria(jobId: string, criteria: readonly Criterion[]): Promise<void>;
  plan(jobId: string): Promise<readonly PlannedInterview[]>;
  setPlan(jobId: string, plan: readonly PlannedInterview[]): Promise<void>;
}

export interface PipelineTemplate {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly stages: readonly Stage[];
}

/* ------------------------------------------------------------ candidates -- */

export interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly cvHash: string | null;
  readonly personId: string | null;
  readonly location: string | null;
  readonly links: readonly string[];
  readonly timeZone: string | null;
  readonly language: string;
  readonly tags: readonly string[];
  readonly mergedInto: string | null;
  readonly anonymisedAt: Instant | null;
  readonly createdAt: Instant;
}

export interface CandidateStore {
  get(id: string): Promise<Candidate | null>;
  byEmail(email: string): Promise<Candidate | null>;
  /** Candidates sharing a phone's last digits or a CV hash: duplicate suspects. */
  suspects(phoneTail: string | null, cvHash: string | null): Promise<readonly Candidate[]>;
  search(query: {
    readonly text?: string;
    readonly tag?: string;
    readonly limit: number;
  }): Promise<readonly Candidate[]>;
  save(candidate: Candidate): Promise<void>;
}

export interface CandidateFile {
  readonly id: string;
  readonly candidateId: string;
  readonly applicationId: string | null;
  readonly kind:
    'cv' | 'cover_letter' | 'portfolio' | 'work_sample' | 'reference' | 'contract' | 'other';
  readonly blobKey: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly uploadedAt: Instant;
}

export interface FileStore {
  get(id: string): Promise<CandidateFile | null>;
  of(candidateId: string): Promise<readonly CandidateFile[]>;
  add(file: CandidateFile): Promise<void>;
  setText(fileId: string, text: string | null): Promise<void>;
  text(fileId: string): Promise<{ readonly text: string; readonly noText: boolean } | null>;
  removeOf(candidateId: string): Promise<readonly CandidateFile[]>;
}

export interface ApplicationRecord extends Application {
  readonly source: ApplicationSource;
  readonly language: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly adjustments: string | null;
  readonly score: number | null;
  readonly createdAt: Instant;
}

export interface ApplicationStore {
  get(id: string): Promise<ApplicationRecord | null>;
  forJob(jobId: string): Promise<readonly ApplicationRecord[]>;
  forCandidate(candidateId: string): Promise<readonly ApplicationRecord[]>;
  find(candidateId: string, jobId: string): Promise<ApplicationRecord | null>;
  /** Insert or replace, with the history's new moves appended (never rewritten). */
  save(
    app: ApplicationRecord,
    category: string,
    newMoves: readonly StageMove[],
    effectiveFrom: CalendarDate,
  ): Promise<void>;
  /** Everything, for analytics: the period decides by the moves' times. */
  all(): Promise<readonly ApplicationRecord[]>;
}

export interface Consent {
  readonly id: string;
  readonly candidateId: string;
  readonly purpose: 'application' | 'talent_pool' | 'nyc_aedt_notice';
  readonly givenAt: Instant;
  readonly expiresOn: CalendarDate | null;
  readonly withdrawnAt: Instant | null;
  readonly notice: string;
}

export interface Pool {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface PoolMember {
  readonly poolId: string;
  readonly candidateId: string;
  readonly reason: string;
  readonly addedBy: string | null;
  readonly addedAt: Instant;
}

export interface PoolStore {
  list(): Promise<readonly Pool[]>;
  get(id: string): Promise<Pool | null>;
  save(pool: Pool): Promise<void>;
  members(poolId: string): Promise<readonly PoolMember[]>;
  of(candidateId: string): Promise<readonly PoolMember[]>;
  add(member: PoolMember): Promise<void>;
  remove(poolId: string, candidateId: string): Promise<void>;
}

export interface Note {
  readonly id: string;
  readonly candidateId: string;
  readonly applicationId: string | null;
  readonly authorId: string;
  readonly body: string;
  readonly mentions: readonly string[];
  readonly createdAt: Instant;
}

export interface Message {
  readonly id: string;
  readonly candidateId: string;
  readonly applicationId: string | null;
  readonly direction: 'out' | 'in';
  readonly subject: string;
  readonly body: string;
  readonly fromPerson: string | null;
  readonly templateId: string | null;
  readonly sendAt: Instant;
  readonly sentAt: Instant | null;
  readonly readAt: Instant | null;
  readonly createdAt: Instant;
}

export interface MessageStore {
  thread(candidateId: string): Promise<readonly Message[]>;
  add(message: Message): Promise<void>;
  markSent(id: string, at: Instant): Promise<void>;
  markRead(candidateId: string, at: Instant): Promise<void>;
  /** Outgoing messages due to send; across tenants for the sender job. */
  due(at: Instant): Promise<readonly Message[]>;
}

export interface Template {
  readonly id: string;
  readonly kind: 'email' | 'offer_letter' | 'contract';
  readonly purpose: string;
  readonly language: string;
  readonly name: string;
  readonly subject: string | null;
  readonly body: string;
}

/* ------------------------------------------------------------ interviews -- */

export interface InterviewRecord extends Interview {
  readonly title: string;
  readonly place: string | null;
  readonly videoUrl: string | null;
}

export interface InterviewStore {
  get(id: string): Promise<InterviewRecord | null>;
  forApplication(applicationId: string): Promise<readonly InterviewRecord[]>;
  forInterviewer(personId: string, from: Instant, to: Instant): Promise<readonly InterviewRecord[]>;
  save(interview: InterviewRecord): Promise<void>;
  scorecards(interviewId: string): Promise<readonly Scorecard[]>;
  forApplicationScorecards(applicationId: string): Promise<readonly Scorecard[]>;
  saveScorecard(card: Scorecard & { readonly notes: string | null }): Promise<void>;
  /** Scorecards owed by a person: interviews completed and not submitted. */
  owedBy(personId: string): Promise<readonly InterviewRecord[]>;
}

export interface ScorecardTemplate {
  readonly id: string;
  readonly name: string;
  readonly competencies: readonly {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly questions: readonly string[];
  }[];
}

export interface WorkingHours {
  readonly personId: string;
  readonly timeZone: string;
  /** Per weekday (1 Monday … 7 Sunday), minutes from midnight: [from, to] pairs. */
  readonly week: Readonly<Record<string, readonly (readonly [number, number])[]>>;
}

export interface ReferenceRequest {
  readonly id: string;
  readonly applicationId: string;
  readonly refereeName: string;
  readonly refereeEmail: string;
  readonly relationship: string | null;
  readonly tokenHash: string;
  readonly state: 'named' | 'requested' | 'completed' | 'declined';
  readonly answers: Readonly<Record<string, string>> | null;
  readonly requestedAt: Instant | null;
  readonly completedAt: Instant | null;
}

/* ---------------------------------------------------------------- offers -- */

export interface OfferStore {
  get(id: string): Promise<Offer | null>;
  forApplication(applicationId: string): Promise<readonly Offer[]>;
  list(): Promise<readonly Offer[]>;
  save(offer: Offer): Promise<void>;
}

export interface ContractStore {
  get(id: string): Promise<(Contract & { readonly fileId: string | null }) | null>;
  forOffer(offerId: string): Promise<(Contract & { readonly fileId: string | null }) | null>;
  bySubjectRef(subjectRef: string): Promise<(Contract & { readonly fileId: string | null }) | null>;
  save(contract: Contract & { readonly fileId: string | null }): Promise<void>;
}

export interface PrehireStore {
  get(applicationId: string): Promise<Prehire | null>;
  list(): Promise<readonly Prehire[]>;
  save(prehire: Prehire): Promise<void>;
}

export interface PayBand {
  readonly id: string;
  readonly entityId: string | null;
  readonly grade: string;
  readonly minMinor: number;
  readonly maxMinor: number;
  readonly currency: string;
  readonly source: 'recruiting' | 'people';
}

/* ----------------------------------------------------- referrals, agencies -- */

export interface Referral {
  readonly id: string;
  readonly jobId: string;
  readonly referrerId: string;
  readonly candidateName: string;
  readonly candidateEmail: string;
  readonly note: string | null;
  readonly applicationId: string | null;
  readonly createdAt: Instant;
}

export interface Agency {
  readonly id: string;
  readonly name: string;
  readonly contactEmail: string;
  readonly fee: AgencyFee;
  readonly guaranteeDays: number;
  readonly ownershipMonths: number;
  readonly active: boolean;
  readonly jobIds: readonly string[];
}

export interface AgencySubmission {
  readonly id: string;
  readonly agencyId: string;
  readonly jobId: string;
  readonly emailNorm: string;
  readonly applicationId: string | null;
  readonly submittedOn: CalendarDate;
}

/* --------------------------------------------------------- public access -- */

export interface CodeStore {
  put(emailNorm: string, jobId: string, codeHash: string, expiresAt: Instant): Promise<void>;
  get(
    emailNorm: string,
    jobId: string,
  ): Promise<{
    readonly codeHash: string;
    readonly attempts: number;
    readonly expiresAt: Instant;
  } | null>;
  attempt(emailNorm: string, jobId: string): Promise<void>;
  remove(emailNorm: string, jobId: string): Promise<void>;
}

export interface TokenStore {
  put(tokenHash: string, candidateId: string, expiresAt: Instant): Promise<void>;
  candidate(tokenHash: string, now: Instant): Promise<string | null>;
}

export interface QuestionnaireStore {
  get(id: string): Promise<Questionnaire | null>;
  list(): Promise<readonly Questionnaire[]>;
  save(q: Questionnaire): Promise<void>;
  answers(applicationId: string): Promise<
    readonly {
      readonly questionnaireId: string;
      readonly answers: Readonly<Record<string, Answer>>;
      readonly score: number | null;
    }[]
  >;
  saveAnswers(
    applicationId: string,
    questionnaireId: string,
    version: number,
    answers: Readonly<Record<string, Answer>>,
    score: number | null,
    knockedOut: readonly string[],
  ): Promise<void>;
}

export interface SettingsStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface IdempotencyStore {
  get(key: string): Promise<{
    readonly requestHash: string;
    readonly status: number;
    readonly answer: unknown;
  } | null>;
  put(key: string, requestHash: string, status: number, answer: unknown): Promise<void>;
}

/** The cross-company projection Kithena Jobs reads (PRD §31.2). */
export interface PublicStore {
  putCompany(company: {
    readonly slug: string;
    readonly name: string;
    readonly themeId: string;
    readonly logoUrl: string | null;
    readonly about: string | null;
    readonly searchable: boolean;
  }): Promise<void>;
  putListing(listing: PublicJob, tsvText: string): Promise<void>;
  removeListing(jobId: string): Promise<void>;
}

export interface Tx {
  readonly members: MemberStore;
  readonly admins: AdminStore;
  readonly entities: Records<Entity>;
  readonly locations: Records<Location>;
  readonly orgUnits: Records<{
    readonly id: string;
    readonly name: string;
    readonly parentId: string | null;
  }>;
  readonly requisitions: Records<Requisition>;
  readonly chains: Records<ApprovalChain>;
  readonly approvals: ApprovalStore;
  readonly jobs: JobStore;
  readonly pipelines: Records<PipelineTemplate>;
  readonly questionnaires: QuestionnaireStore;
  readonly candidates: CandidateStore;
  readonly files: FileStore;
  readonly applications: ApplicationStore;
  readonly consents: {
    of(candidateId: string): Promise<readonly Consent[]>;
    save(consent: Consent): Promise<void>;
  };
  readonly pools: PoolStore;
  readonly notes: {
    of(candidateId: string): Promise<readonly Note[]>;
    add(note: Note): Promise<void>;
  };
  readonly messages: MessageStore;
  readonly templates: Records<Template>;
  readonly interviews: InterviewStore;
  readonly scorecardTemplates: Records<ScorecardTemplate>;
  readonly workingHours: {
    get(personId: string): Promise<WorkingHours | null>;
    save(hours: WorkingHours): Promise<void>;
  };
  readonly references: {
    forApplication(applicationId: string): Promise<readonly ReferenceRequest[]>;
    byToken(tokenHash: string): Promise<ReferenceRequest | null>;
    save(r: ReferenceRequest): Promise<void>;
  };
  readonly offers: OfferStore;
  readonly contracts: ContractStore;
  readonly prehires: PrehireStore;
  readonly benefits: Records<Benefit>;
  readonly payBands: Records<PayBand>;
  readonly referrals: {
    list(): Promise<readonly Referral[]>;
    byReferrer(personId: string): Promise<readonly Referral[]>;
    save(r: Referral): Promise<void>;
  };
  readonly agencies: Records<Agency>;
  readonly submissions: {
    forEmail(emailNorm: string): Promise<readonly AgencySubmission[]>;
    forAgency(agencyId: string): Promise<readonly AgencySubmission[]>;
    add(s: AgencySubmission): Promise<void>;
  };
  readonly codes: CodeStore;
  readonly tokens: TokenStore;
  readonly legalHolds: {
    has(candidateId: string): Promise<boolean>;
    place(candidateId: string, reason: string, by: string): Promise<void>;
    lift(candidateId: string): Promise<void>;
  };
  readonly settings: SettingsStore;
  readonly idempotency: IdempotencyStore;
  readonly outbox: { publish(events: readonly PendingEvent[]): Promise<void> };
  readonly tenant: { register(slug: string | null): Promise<void>; slug(): Promise<string | null> };
  /**
   * The public projection, written in the same transaction as the job it
   * shows (PRD §31.2): the schemas share a database, so there is no dual write.
   */
  readonly public: PublicStore;
}

export interface UnitOfWork {
  run<T>(tenantId: TenantId, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Across tenants, for the sweeps: ids and slugs only. */
  tenants(): Promise<readonly { readonly tenantId: TenantId; readonly slug: string | null }[]>;
  tenantBySlug(slug: string): Promise<TenantId | null>;
}

/** Bytes, sealed at rest, keyed `<tenant>/<candidate>/<file>`. */
export interface Blobs {
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * Email through `platform/messaging` (PRD §12.7); absent sends nothing.
 * Recruiting writes the candidate's thread itself, so it sends text.
 */
export interface Mailer {
  send(input: {
    readonly tenantId: TenantId;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly replyTo: string | null;
    readonly dedupeKey: string;
  }): Promise<void>;
}

export interface Deps {
  readonly uow: UnitOfWork;
  readonly blobs: Blobs;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly mailer?: Mailer;
  /** The public site's origin, for links in emails: `https://jobs.kithena.com`. */
  readonly jobsOrigin: string;
  /** Text from a PDF, DOCX or ODT (PRD §14.1); null when it has none. */
  readonly extractText: (bytes: Uint8Array, mediaType: string) => Promise<string | null>;
}
