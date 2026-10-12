import type { Clock, PendingEvent } from '@kithena/domain-kit';
import type {
  CalendarDate,
  DocumentId,
  DocumentTypeKey,
  Instant,
  PersonId,
  TenantId,
} from '@kithena/contracts';

import type { Document, Version } from '../domain/document/document.js';
import type { DocumentType } from '../domain/type/document-type.js';
import type { Audience } from '../domain/acknowledge/campaign.js';
import type { Envelope } from '../domain/signature/envelope.js';

/**
 * What Documents' use cases read and write through, and nothing wider.
 * Time Off's shape: every store is reached through `UnitOfWork.run`, bound
 * to one tenant transaction, so row-level security sees the tenant. Bytes are
 * the one thing outside it (`Blobs`): an object store has no transaction.
 */

export interface Caller {
  readonly tenantId: TenantId;
  readonly accountId: string;
  /** The member the account signs in as; null for an account that is none. */
  readonly personId: PersonId | null;
  readonly correlationId: string;
}

/* ---------------------------------------------------------------- members -- */

export interface Member {
  readonly personId: PersonId;
  readonly accountId: string | null;
  readonly displayName: string;
  readonly workEmail: string | null;
  readonly managerPersonId: PersonId | null;
  readonly teamKey: string | null;
  readonly teamName: string | null;
  readonly locationKey: string | null;
  readonly hireDate: CalendarDate | null;
  readonly terminationDate: CalendarDate | null;
  readonly status: string;
}

export interface MemberStore {
  get(personId: PersonId): Promise<Member | null>;
  byAccount(accountId: string): Promise<Member | null>;
  list(): Promise<readonly Member[]>;
  /**
   * Writes when `(effectiveFrom, eventId)` moves forward, so a redelivered or
   * older event changes nothing; answers whether it wrote.
   */
  upsert(member: Member, eventId: string, effectiveFrom: CalendarDate): Promise<boolean>;
}

/** HR for Documents: who identity names administrator of `module.documents`. */
export interface HrStore {
  has(accountId: string): Promise<boolean>;
  list(): Promise<readonly string[]>;
  add(accountId: string): Promise<void>;
  remove(accountId: string): Promise<void>;
}

/* --------------------------------------------------------------- documents -- */

export interface TypeStore {
  list(): Promise<readonly (DocumentType & { readonly archived: boolean })[]>;
  get(key: DocumentTypeKey): Promise<(DocumentType & { readonly archived: boolean }) | null>;
  save(type: DocumentType, archived: boolean): Promise<void>;
}

export interface DocumentStore {
  get(id: DocumentId): Promise<Document | null>;
  /** Insert or replace, grants included. */
  save(doc: Document): Promise<void>;
  /**
   * Every document a viewer might open: owned, about them, shared with them,
   * their team or everyone, filed for everyone, and every filed one for HR.
   * A superset; the domain's `canOpen` decides.
   */
  candidates(viewer: {
    accountId: string;
    personId: PersonId | null;
    teamKey: string | null;
    hr: boolean;
  }): Promise<readonly Document[]>;
  /** Filed documents, for HR's queues. */
  filed(): Promise<readonly Document[]>;
  about(personId: PersonId): Promise<readonly Document[]>;
}

export interface VersionStore {
  list(id: DocumentId): Promise<readonly Version[]>;
  get(id: DocumentId, n: number): Promise<Version | null>;
  add(id: DocumentId, version: Version): Promise<void>;
}

export interface Section {
  readonly id: string;
  readonly kind: 'company' | 'personal';
  readonly ownerAccount: string | null;
  readonly name: string;
}

export interface SectionStore {
  /** Company sections and this account's own. */
  visibleTo(accountId: string): Promise<readonly Section[]>;
  get(id: string): Promise<Section | null>;
  save(section: Section): Promise<void>;
  remove(id: string): Promise<void>;
  entries(
    sectionIds: readonly string[],
  ): Promise<readonly { sectionId: string; documentId: DocumentId }[]>;
  add(sectionId: string, documentId: DocumentId): Promise<void>;
  removeEntry(sectionId: string, documentId: DocumentId): Promise<void>;
}

export interface ViewEntry {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly accountId: string;
  readonly action: 'view' | 'download';
  readonly device: string | null;
  readonly at: Instant;
}

export interface ViewLog {
  add(entry: ViewEntry): Promise<void>;
  list(id: DocumentId, limit: number): Promise<readonly ViewEntry[]>;
}

export interface AccessRequest {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly requesterAccount: string;
  readonly reason: string;
  readonly status: 'open' | 'granted' | 'refused';
  readonly createdAt: Instant;
  readonly decidedAt: Instant | null;
  readonly decidedBy: string | null;
}

export interface AccessRequestStore {
  get(id: string): Promise<AccessRequest | null>;
  save(request: AccessRequest): Promise<void>;
  /** Open requests for documents this account owns, or every filed one for HR. */
  open(): Promise<readonly AccessRequest[]>;
}

export interface DocRequest {
  readonly id: string;
  readonly personId: PersonId;
  readonly typeKey: DocumentTypeKey;
  readonly dueOn: CalendarDate | null;
  readonly message: string;
  readonly status: 'open' | 'fulfilled' | 'cancelled';
  readonly createdBy: string;
  readonly createdAt: Instant;
  readonly remindedAt: Instant | null;
  readonly documentId: DocumentId | null;
}

export interface DocRequestStore {
  get(id: string): Promise<DocRequest | null>;
  save(request: DocRequest): Promise<void>;
  forPerson(personId: PersonId): Promise<readonly DocRequest[]>;
  open(): Promise<readonly DocRequest[]>;
}

export interface LegalHold {
  readonly id: string;
  readonly name: string;
  readonly setBy: string;
  readonly setAt: Instant;
  readonly liftedAt: Instant | null;
  readonly documentIds: readonly DocumentId[];
}

export interface HoldStore {
  list(): Promise<readonly LegalHold[]>;
  get(id: string): Promise<LegalHold | null>;
  save(hold: LegalHold): Promise<void>;
  /** Documents an unlifted hold keeps. */
  held(): Promise<ReadonlySet<string>>;
}

export interface Activity {
  readonly id: string;
  readonly documentId: DocumentId | null;
  readonly accountId: string | null;
  readonly action: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly at: Instant;
}

export interface ActivityStore {
  add(entry: Activity): Promise<void>;
  list(filter: { documentId?: DocumentId; limit: number }): Promise<readonly Activity[]>;
}

export interface SettingsStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface EnvelopeEvent {
  readonly id: string;
  readonly envelopeId: string;
  readonly signerId: string | null;
  /** sent, opened, code_sent, verified, signed, declined, reassigned, voided, reminded, completed */
  readonly action: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly at: Instant;
}

export interface EnvelopeStore {
  get(id: string): Promise<Envelope | null>;
  save(envelope: Envelope): Promise<void>;
  forDocument(documentId: DocumentId): Promise<readonly Envelope[]>;
  /** Envelopes with a signer who is this person. */
  forPerson(personId: PersonId): Promise<readonly Envelope[]>;
  /** The envelope and signer a link's token opens. */
  byToken(tokenHash: string): Promise<{ envelope: Envelope; signerId: string } | null>;
  open(): Promise<readonly Envelope[]>;
  trail(envelopeId: string): Promise<readonly EnvelopeEvent[]>;
  record(event: EnvelopeEvent): Promise<void>;
}

export interface Campaign {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly version: number;
  readonly audience: Audience;
  readonly dueOn: CalendarDate | null;
  readonly sentBy: string;
  readonly createdAt: Instant;
  readonly closedAt: Instant | null;
}

export interface CampaignStore {
  get(id: string): Promise<Campaign | null>;
  save(campaign: Campaign): Promise<void>;
  list(): Promise<readonly Campaign[]>;
  acknowledged(campaignId: string): Promise<ReadonlySet<string>>;
  acknowledge(campaignId: string, personId: PersonId, at: Instant): Promise<void>;
  /** Campaigns this person has acknowledged, by id. */
  mine(personId: PersonId): Promise<ReadonlySet<string>>;
}

export interface StoredKey {
  readonly requestHash: string;
  readonly status: number;
  readonly answer: unknown;
}

export interface IdempotencyStore {
  find(key: string): Promise<StoredKey | null>;
  /** False when somebody saved the key first. */
  save(key: string, stored: StoredKey): Promise<boolean>;
}

export interface Tx {
  readonly tenantId: TenantId;
  readonly members: MemberStore;
  readonly hr: HrStore;
  readonly types: TypeStore;
  readonly documents: DocumentStore;
  readonly versions: VersionStore;
  readonly sections: SectionStore;
  readonly views: ViewLog;
  readonly accessRequests: AccessRequestStore;
  readonly docRequests: DocRequestStore;
  readonly holds: HoldStore;
  readonly activity: ActivityStore;
  readonly envelopes: EnvelopeStore;
  readonly campaigns: CampaignStore;
  readonly settings: SettingsStore;
  readonly idempotency: IdempotencyStore;
  readonly outbox: { publish(events: readonly PendingEvent[]): Promise<void> };
}

export interface UnitOfWork {
  run<T>(tenantId: TenantId, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Bytes, sealed at rest, keyed `<tenant>/<document>/<version>`. */
export interface Blobs {
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * Files that skip the shell: the browser PUTs an upload straight to the
 * bucket and GETs a copy from it (PRD §8.1), because a request through the
 * shell's functions stops at 4.5 MB. Absent in memory, where files travel
 * inside the request instead.
 */
export interface Transfers {
  /** Where the browser PUTs `size` bytes, for a few minutes. */
  presignPut(
    key: string,
    size: number,
    seconds: number,
  ): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }>;
  /** What the browser put there, up to `max` bytes; null when nothing is. */
  readIncoming(key: string, max: number): Promise<Uint8Array | null | 'too_large'>;
  remove(key: string): Promise<void>;
  /** A copy to hand out, and the link that opens it for a few minutes. */
  handOut(
    key: string,
    bytes: Uint8Array,
    file: { fileName: string; mediaType: string; download: boolean },
    seconds: number,
  ): Promise<string>;
}

/**
 * A notice by email, through messaging (`platform/messaging`); absent sends
 * nothing. Messaging writes every word; Documents says which notice, to whom,
 * and the link on the company's own host.
 */
export interface Mailer {
  notice(input: {
    readonly tenantId: TenantId;
    readonly email: string;
    readonly url: string;
    readonly companyName: string;
    readonly dedupeKey: string;
    readonly notice:
      | { readonly kind: 'signature_requested' }
      | { readonly kind: 'signing_code'; readonly code: string };
  }): Promise<void>;
}

/**
 * A model reading a document's text (PRD §14, Documents' exception in
 * `docs/tech-stack.md`): one JSON object back, or null when there is no
 * model, it failed, or it answered something that is not an object.
 */
export interface Reader {
  read(input: {
    readonly instruction: string;
    readonly context: Readonly<Record<string, unknown>>;
  }): Promise<Readonly<Record<string, unknown>> | null>;
}

export interface Deps {
  readonly uow: UnitOfWork;
  readonly blobs: Blobs;
  readonly transfers?: Transfers;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly mailer?: Mailer;
  readonly reader?: Reader;
}
