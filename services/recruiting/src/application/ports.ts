import type { Clock, PendingEvent, Result, Words } from '@kithena/domain-kit';
import type {
  CalendarDate,
  Instant,
  LaunchCountry,
  PersonId,
  TenantId,
  ApplicationSource,
  JobSearch,
  PublicCompany,
  PublicJob,
  PublicListing,
  PublicationTarget,
  StageCategory,
} from '@kithena/contracts';

import type { Application, StageMove } from '../domain/pipeline/application.js';
import type { Stage } from '../domain/pipeline/pipeline.js';
import type { AdCheck } from '../domain/ad/checks.js';
import type { TeamRole } from '../domain/access/access.js';
import type { Benefit } from '../domain/benefits/benefits.js';
import type { DnsRecord } from '../domain/careers/domain.js';
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

/**
 * Where a legal entity, a location or a department came from: People's
 * events, where People is present, or Recruiting's own settings. One of
 * People's is renamed, moved or archived in People; Recruiting adds what
 * only it knows (an entity's currency, its works council) and nothing else.
 */
export type OrgSource = 'recruiting' | 'people';

export interface OrgUnit {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly source?: OrgSource;
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
  readonly source?: OrgSource;
}

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly entityId: string | null;
  readonly country: LaunchCountry;
  readonly region: string | null;
  readonly city: string | null;
  readonly timeZone: string;
  readonly source?: OrgSource;
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
  /** The step of the job's pipeline it belongs to: entering that step asks for it. One per step. */
  readonly stageId?: string | null;
  /** `slots`: the candidate chooses from times that fit the panel; `fixed`: one time for all. */
  readonly mode?: 'slots' | 'fixed';
  /** With `fixed`: when it is. */
  readonly fixedAt?: Instant | null;
  /** Where it happens; neither this nor a link makes a video call on the organiser's calendar. */
  readonly place?: string | null;
  readonly videoUrl?: string | null;
  /** What it is about, in the invitation and on the calendar. */
  readonly agenda?: string | null;
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
  /** The job and everything that is only its own: team, stages, form, ads, targets, criteria, plan. */
  remove(jobId: string): Promise<void>;
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
  /** Every scheduled interview starting in the window: the reminders' read. */
  startingBetween(from: Instant, to: Instant): Promise<readonly InterviewRecord[]>;
  save(interview: InterviewRecord): Promise<void>;
  scorecards(interviewId: string): Promise<readonly Scorecard[]>;
  forApplicationScorecards(applicationId: string): Promise<readonly Scorecard[]>;
  /** The submitted scorecards' notes, read only by the debrief summary. */
  scorecardNotes(applicationId: string): Promise<
    readonly {
      readonly interviewId: string;
      readonly interviewerId: string;
      readonly notes: string;
    }[]
  >;
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

/* -------------------------------------------------------------------- AI -- */

export type AiFeature = 'parser' | 'matrix' | 'writer' | 'assistant' | 'charts';

/**
 * One time a model read something for a person (PRD §22.2 point 7, AI Act
 * art. 12): the model, the prompt's version, the masked text it read and its
 * hash, and what it answered. The human decision that followed is the
 * pipeline's own history.
 */
export interface Assessment {
  readonly id: string;
  readonly applicationId: string;
  readonly feature: AiFeature;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly maskedInput: string;
  readonly output: unknown;
  readonly scoreBp: number | null;
  readonly band: string | null;
  readonly requestedBy: string;
  readonly createdAt: Instant;
}

/**
 * A job board (PRD §26.1): one adapter per board behind one port. Publishing
 * twice updates; closing takes the job down. Google for Jobs and the XML feed
 * are the first two, and read the job from Kithena Jobs' own page and feed;
 * Indeed sends the job by API, takes applications in its own apply and hears
 * back where each went.
 */
export interface JobBoard {
  readonly target: PublicationTarget;
  /** `ref` is the board's own id for the posting, kept to close it. */
  publish(job: BoardJob): Promise<Result<{ readonly url: string | null; readonly ref?: string }>>;
  close(job: BoardJob): Promise<void>;
  /** Applications the board's own apply posts to Recruiting, signed. */
  readonly inbound?: {
    verify(raw: string, signature: string): boolean;
    parse(raw: string): Result<BoardApplication>;
  };
  /** The job's questionnaire in the board's own format, for its apply to ask (Indeed's screener questions). */
  questions?(questionnaire: Questionnaire): unknown;
  /** Tells the board where an application it sent has got to. */
  disposition?(input: {
    readonly ref: string;
    readonly status: StageCategory | 'rejected' | 'withdrawn';
    readonly at: string;
  }): Promise<Result<void>>;
}

/** An application as a board's apply sent it, mapped at the adapter (PRD §11.1). */
export interface BoardApplication {
  readonly jobId: string;
  /** The board's id for it, for dispositions. */
  readonly ref: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  /** Questionnaire answers as the public form sends them: `q_<question id>`. */
  readonly answers: Readonly<Record<string, Answer>>;
  readonly files: readonly {
    readonly field: string;
    readonly fileName: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }[];
}

/** A third-party assessment (PRD §15.3): the result is a score and a report on the application. */
export interface AssessmentProvider {
  readonly name: string;
  invite(input: {
    readonly applicationId: string;
    readonly email: string;
    readonly packageKey: string;
  }): Promise<Result<{ readonly externalId: string; readonly url: string }>>;
  /** Null until the candidate has finished. */
  result(
    externalId: string,
  ): Promise<{ readonly scoreBp: number; readonly reportUrl: string } | null>;
}

/** A background check (PRD §17.2), started only when the domain allows it. */
export interface BackgroundCheckProvider {
  readonly name: string;
  start(input: {
    readonly applicationId: string;
    readonly email: string;
    readonly country: LaunchCountry;
  }): Promise<Result<{ readonly externalId: string }>>;
  status(externalId: string): Promise<'pending' | 'clear' | 'consider'>;
}

/** What a board is told about a job: where Kithena Jobs shows it. */
export interface BoardJob {
  readonly jobId: string;
  readonly company: string;
  readonly slug: string;
  /** Kithena Jobs' page for the job, which a board must link to (Indeed checks it). */
  readonly url: string;
  /** What that page shows, for a board that takes the ad itself; null for one that reads the page. */
  readonly page: PublicJob | null;
  /** The address a board may show for the company: its reply address. */
  readonly contactEmail: string | null;
  /** The board's id from publishing, when it gave one. */
  readonly ref: string | null;
  /** Whether the job's form has a questionnaire for the board's apply to ask. */
  readonly asks: boolean;
}

/** A message in the company's chat app: to a person by address, or into a job's channel. */
export interface ChatMessage {
  readonly to: { readonly email: string } | { readonly channel: string };
  readonly text: string;
  /** An Approve button's value, sealed by Recruiting; the press comes back through the relay. */
  readonly approve?: string;
  readonly links?: readonly { readonly label: string; readonly url: string }[];
}

/** Kithena's chat app (PRD §26.3, REC-137): Slack first, through `platform/slack`. */
export interface Chat {
  /** What `platform/slack` presents when it relays a press. */
  readonly token: string;
  /** The tenant app's address, with `{slug}` where the company goes. */
  readonly appBase: string;
  /** Never throws: a chat message that does not go is not a failed use case. */
  send(tenantId: string, message: ChatMessage): Promise<void>;
}

export interface Sealer {
  seal(plain: Uint8Array, boundTo: string): Uint8Array;
  /** Null when it does not open: the wrong key, or a row moved to another id. */
  open(sealed: Uint8Array, boundTo: string): Uint8Array | null;
}

export interface VerdictRow {
  readonly criterionId: string;
  readonly verdict: 'met' | 'partly_met' | 'not_met' | 'not_evidenced';
  readonly passages: readonly string[];
  readonly agreed: boolean | null;
  readonly agreedBy: string | null;
}

/** A model, reached only through the AI gateway; null on a refusal, a failure or a timeout. */
export interface Model {
  readonly name: string;
  complete(
    tenantId: string,
    prompt: { readonly instruction: string; readonly context: Readonly<Record<string, unknown>> },
  ): Promise<string | null>;
  /**
   * The same, with the provider's web search open to the model, where the
   * provider has one; its answer is JSON in its text. Absent: no web search.
   */
  research?(
    tenantId: string,
    prompt: { readonly instruction: string; readonly context: Readonly<Record<string, unknown>> },
  ): Promise<string | null>;
}

/** The public web, read: a host's home page as its words (S1, a company's "about"). */
export interface Web {
  read(host: string): Promise<{ readonly url: string; readonly text: string } | null>;
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
  /** Out of the list; the answers given to it stay with their applications. */
  remove(id: string): Promise<void>;
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
  /** The company's own careers domain, if it has one (REC-136). */
  careersDomain(): Promise<CareersDomain | null>;
  putCareersDomain(domain: CareersDomain & { readonly companySlug: string }): Promise<void>;
  removeCareersDomain(): Promise<void>;
  /** Every company's, for the ceiling Kithena Jobs' project allows. */
  careersDomainCount(): Promise<number>;
}

/** A company's own domain for its careers page, and what its DNS needs (REC-136). */
export interface CareersDomain {
  readonly host: string;
  readonly status: 'pending' | 'verified';
  readonly records: readonly DnsRecord[];
  readonly verifiedAt: string | null;
}

export type CalendarKind = 'google' | 'microsoft';
export type VideoKind = 'zoom';
export type ConnectionKind = CalendarKind | VideoKind;

export interface CalendarEvent {
  readonly title: string;
  readonly startsAt: string;
  readonly minutes: number;
  readonly description: string;
  readonly location: string | null;
  /** Work emails of the interviewers; never the candidate's. */
  readonly attendees: readonly string[];
  /** Ask the calendar for a Meet or Teams link. */
  readonly video: boolean;
}

/** A member's calendar for one session: a grant refreshed once, busy times, events. */
export interface CalendarSession {
  /** The grant to keep: a provider may rotate it on refresh. */
  readonly grant: string;
  busy(from: string, to: string): Promise<Result<readonly (readonly [string, string])[]>>;
  create(event: CalendarEvent): Promise<Result<{ eventId: string; videoUrl: string | null }>>;
  cancel(eventId: string): Promise<Result<void>>;
  /** Google: hear when the Meet call behind this link ends, on Kithena's Pub/Sub topic. */
  watchMeeting?(
    videoUrl: string,
    topic: string,
    ttlSeconds: number,
  ): Promise<Result<{ space: string }>>;
}

/** A member's video account for one session: a meeting made and ended. */
export interface VideoSession {
  readonly grant: string;
  meeting(input: {
    readonly title: string;
    readonly startsAt: string;
    readonly minutes: number;
  }): Promise<Result<{ meetingId: string; url: string }>>;
  end(meetingId: string): Promise<Result<void>>;
}

/** What a member connects by OAuth: consent, a code redeemed for a grant, a session. */
interface Connectable<K extends ConnectionKind, S> {
  readonly kind: K;
  /** Where the member grants access; `state` comes back with the code. */
  consentUrl(state: string): string;
  /** The long-lived grant (a refresh token) for the code the provider sent back. */
  redeem(code: string): Promise<Result<string>>;
  open(grant: string): Promise<Result<S>>;
}

/** Google Workspace or Microsoft 365 (PRD §26.2, REC-135). */
export type CalendarProvider = Connectable<CalendarKind, CalendarSession>;
/** Zoom: a meeting link of the member's own in place of Meet or Teams. */
export type VideoProvider = Connectable<VideoKind, VideoSession>;
export type Connection = CalendarProvider | VideoProvider;

/** Where Kithena Jobs is served (Vercel): a host added to its project, its state, and taken off. */
export interface DomainHost {
  add(host: string): Promise<Result<HostedDomain>>;
  check(host: string): Promise<Result<HostedDomain>>;
  remove(host: string): Promise<Result<void>>;
}

export interface HostedDomain {
  /** Serving: verified by the host and its DNS pointing at it. */
  readonly verified: boolean;
  readonly records: readonly DnsRecord[];
}

export interface Tx {
  readonly members: MemberStore;
  readonly admins: AdminStore;
  readonly entities: Records<Entity>;
  readonly locations: Records<Location>;
  readonly orgUnits: Records<OrgUnit>;
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
  /** A member's connected calendar and video (PRD §26.2): each grant sealed. */
  readonly connections: {
    list(personId: string): Promise<readonly { kind: ConnectionKind; sealed: Uint8Array }[]>;
    save(personId: string, kind: ConnectionKind, sealed: Uint8Array): Promise<void>;
    remove(personId: string, kind: ConnectionKind): Promise<void>;
  };
  readonly assessments: {
    save(a: Assessment): Promise<void>;
    forApplication(applicationId: string): Promise<readonly Assessment[]>;
  };
  /** Voluntary self-ID, sealed (§24.4): written by the candidate, read only to count. */
  readonly selfIds: {
    save(applicationId: string, sealed: Uint8Array): Promise<void>;
    all(): Promise<readonly { readonly applicationId: string; readonly sealed: Uint8Array }[]>;
    remove(applicationId: string): Promise<void>;
  };
  /** The matrix's findings, one per criterion, and a person's agreement with each (§22.4). */
  readonly verdicts: {
    save(assessmentId: string, rows: readonly VerdictRow[]): Promise<void>;
    agree(assessmentId: string, criterionId: string, agreed: boolean, by: string): Promise<void>;
    of(assessmentId: string): Promise<readonly VerdictRow[]>;
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
/**
 * Structure beside an email's words, drawn by messaging in the company's
 * colours (its `correspondence.ts`): times by day, facts, a button. Never markup.
 */
export interface MailParts {
  readonly heading?: string | null;
  readonly times?: {
    readonly title: string;
    readonly days: readonly { readonly day: string; readonly times: readonly string[] }[];
    readonly note?: string | null;
  } | null;
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
  readonly action?: { readonly label: string; readonly href: string } | null;
  readonly secondary?: { readonly label: string; readonly href: string } | null;
  readonly themeId?: string | null;
  readonly logoUrl?: string | null;
}

export interface MailAttachment {
  readonly filename: string;
  readonly base64: string;
}

export interface Mailer {
  send(input: {
    readonly tenantId: TenantId;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly replyTo: string | null;
    readonly dedupeKey: string;
    /** Who the email is from, as the candidate knows them; messaging's footer and wordmark. */
    readonly companyName?: string;
    readonly parts?: MailParts;
    /** A calendar invitation (`invite.ics`): Gmail and Outlook draw it as one, with Add to calendar. */
    readonly attachments?: readonly MailAttachment[];
  }): Promise<void>;
  /**
   * The company's language and Recruiting's words in it: every email is
   * written in the company's language, whatever the candidate reads screens in.
   */
  words?(tenantId: TenantId): Promise<MailWords>;
}

/** A language and Recruiting's words for its emails in it. */
export interface MailWords {
  readonly language: string;
  readonly t: Words;
}

/**
 * Kithena Jobs' reads (REC-090, PRD §31.2): the public projection across
 * companies, through a role that may read nothing else. No tenant, no caller.
 */
export interface Listings {
  /**
   * The search. When words were given and nothing matches them whole, `nearby`
   * carries the closest listings instead (any of the words, the country kept,
   * every other filter dropped), so a search never ends on nothing.
   */
  search(query: JobSearch): Promise<{
    rows: readonly PublicListing[];
    total: number;
    nearby?: readonly PublicListing[];
  }>;
  job(company: string, slug: string, language: string | null): Promise<PublicJob | null>;
  company(slug: string): Promise<{ company: PublicCompany; jobs: readonly PublicListing[] } | null>;
  /** The company a verified careers domain shows, or null (REC-136). */
  companyForHost(host: string): Promise<string | null>;
}

/* ------------------------------------------------- candidate accounts -- */

/**
 * A candidate's account on Kithena Jobs (PRD §10.5, extended): one across
 * every company, holding only what is the candidate's own. No tenant.
 */
export interface CandidateAccount {
  readonly id: string;
  readonly email: string;
  readonly emailNorm: string;
  readonly name: string;
  readonly googleSub: string | null;
  /** The picture Google vouched for, when they signed in with it. */
  readonly pictureUrl: string | null;
  readonly consentedAt: Instant | null;
  readonly consentNotice: string | null;
  readonly codeHash: string | null;
  readonly codeExpiresAt: Instant | null;
  readonly codeAttempts: number;
  readonly createdAt: Instant;
  readonly lastSeenAt: Instant;
}

export interface CandidateCv {
  readonly id: string;
  readonly accountId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly blobKey: string;
  readonly size: number;
  readonly isDefault: boolean;
  readonly uploadedAt: Instant;
}

export interface Accounts {
  byEmail(emailNorm: string): Promise<CandidateAccount | null>;
  byGoogleSub(sub: string): Promise<CandidateAccount | null>;
  save(account: CandidateAccount): Promise<void>;
  putSession(tokenHash: string, accountId: string, expiresAt: Instant): Promise<void>;
  bySession(tokenHash: string, now: Instant): Promise<CandidateAccount | null>;
  endSession(tokenHash: string): Promise<void>;
  cvs(accountId: string): Promise<readonly CandidateCv[]>;
  saveCv(cv: CandidateCv): Promise<void>;
  setDefaultCv(accountId: string, cvId: string): Promise<void>;
  removeCv(cvId: string): Promise<void>;
}

/** What Google vouched for, checked against this site's client id. */
export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly picture: string | null;
}

export interface IncomingUpload {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/**
 * A timer at each interview's end (Valkey, BullMQ): the moment it ends, the
 * interview is completed and each interviewer is asked for their scorecard.
 * Set again when it is booked or moved, dropped when it is cancelled.
 */
export interface InterviewEnds {
  at(tenantId: string, interviewId: string, endsAt: string): Promise<void>;
  /** A timer at `at` to start hearing the Meet call (`MeetEvents`); dropped with the rest. */
  watch(tenantId: string, interviewId: string, at: string): Promise<void>;
  drop(tenantId: string, interviewId: string): Promise<void>;
}

/**
 * Meet calls heard as they end (Google Workspace Events through Pub/Sub):
 * the topic a subscription publishes to, and which interview each watched
 * space is, kept beside the timers in Valkey for as long as it is watched.
 */
export interface MeetEvents {
  readonly topic: string;
  remember(
    space: string,
    interview: { tenantId: string; interviewId: string },
    ttlSeconds: number,
  ): Promise<void>;
  recall(space: string): Promise<{ tenantId: string; interviewId: string } | null>;
}

export interface Deps {
  readonly uow: UnitOfWork;
  readonly blobs: Blobs;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly mailer?: Mailer;
  /** Candidate accounts on Kithena Jobs; absent, the site has no sign-in and applying needs a code every time. */
  readonly accounts?: Accounts;
  /** Google's answer to an ID token from the site's own client; absent, there is no Google sign-in. */
  readonly verifyGoogle?: (idToken: string) => Promise<GoogleIdentity | null>;
  /**
   * Where candidates' replies arrive (PRD §12.7): Resend receives mail for
   * `domain`, and messaging hands each reply back presenting `token`. Absent,
   * replies go to the company's own reply address.
   */
  readonly inbound?: { readonly domain: string; readonly token: string };
  /** Absent without an AI key: every AI feature is then off, and Recruiting works without it. */
  readonly model?: Model;
  /** A company's own website, read for its "about"; absent, the model writes from its search alone. */
  readonly web?: Web;
  /**
   * Seals what only aggregates may read (§24.4, self-ID), bound to its row's
   * id. Absent without `RECRUITING_ENCRYPTION_KEY`: self-ID is then off.
   */
  readonly sealer?: Sealer;
  readonly chat?: Chat;
  /** Absent without Valkey: an interview is then completed by hand, or at the next start. */
  readonly interviewEnds?: InterviewEnds;
  /** Absent without a topic: a Meet interview completes at its booked end, as any other. */
  readonly meetEvents?: MeetEvents;
  /** The boards a job may be published to beyond Kithena's own pages; Google and the feed by default. */
  readonly boards?: readonly JobBoard[];
  /** No provider is chosen yet: absent, the screens say so. A fake adapter each for tests and local runs. */
  readonly assessmentProvider?: AssessmentProvider;
  readonly backgroundChecks?: BackgroundCheckProvider;
  /** Where a company's own careers domain is added; absent, the setting says it is not set up. */
  readonly domains?: DomainHost;
  /** The calendars and video members may connect; none, scheduling uses working hours and an `.ics`. */
  readonly connections?: readonly Connection[];
  /**
   * A member's Google Workspace calendar by delegation, without connecting it:
   * null when their company's Workspace has not allowed Kithena.
   */
  readonly workspaceCalendar?: (email: string) => Promise<CalendarSession | null>;
  /** The public site's origin, for links in emails: `https://jobs.kithena.com`. */
  readonly jobsOrigin: string;
  /** Text from a PDF, DOCX or ODT (PRD §14.1); null when it has none. */
  readonly extractText: (bytes: Uint8Array, mediaType: string) => Promise<string | null>;
}
