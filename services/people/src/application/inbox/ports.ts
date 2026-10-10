import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { FileMediaType } from '../../domain/person/file.js';
import type { UploadDeps } from '../import/upload.js';

/**
 * The Inbox's ports in People: what the use cases in this folder need from
 * the world, apart from the screens' deps. Their own file so `ScreenDeps`
 * (`screens/record.ts`) can name them without importing the use cases that
 * import it.
 */

type Tx = PostgresJsDatabase;

export type AskState = 'open' | 'done' | 'sent_back' | 'cancelled';
export type SendBackReason = 'no_information' | 'not_applicable' | 'other';

export interface DetailAsk {
  readonly id: string;
  readonly personId: string;
  readonly keys: readonly string[];
  readonly message: string | null;
  readonly dueOn: string | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly batchId: string;
  readonly state: AskState;
  readonly reason: SendBackReason | null;
  readonly note: string | null;
  readonly closedBy: string | null;
  readonly closedAt: string | null;
}

export interface AskMessage {
  readonly id: string;
  readonly askId: string;
  /** The account that wrote it. */
  readonly author: string;
  readonly body: string;
  readonly at: string;
}

export interface DetailAskStore {
  insert(tx: Tx, tenantId: string, asks: readonly DetailAsk[]): Promise<void>;
  find(tx: Tx, tenantId: string, id: string): Promise<DetailAsk | null>;
  /** One person's asks, newest first, since an instant. */
  forPerson(
    tx: Tx,
    tenantId: string,
    personId: string,
    since: string,
  ): Promise<readonly DetailAsk[]>;
  /** The asks an account sent, newest first, since an instant. */
  sentBy(tx: Tx, tenantId: string, accountId: string, since: string): Promise<readonly DetailAsk[]>;
  inBatch(tx: Tx, tenantId: string, batchId: string): Promise<readonly DetailAsk[]>;
  /** Asks still open for these people, due on or before a day: overdue ones (P2). */
  openDueBy(
    tx: Tx,
    tenantId: string,
    personIds: readonly string[],
    day: string,
  ): Promise<readonly DetailAsk[]>;
  /** Close an open ask; false when it was already closed. */
  close(
    tx: Tx,
    tenantId: string,
    id: string,
    to: {
      readonly state: Exclude<AskState, 'open'>;
      readonly reason: SendBackReason | null;
      readonly note: string | null;
      readonly by: string;
      readonly at: string;
    },
  ): Promise<boolean>;
  /** Open again what the person finished a moment ago (C5's Undo); false otherwise. */
  reopen(tx: Tx, tenantId: string, id: string): Promise<boolean>;
  setDue(tx: Tx, tenantId: string, batchId: string, dueOn: string | null): Promise<void>;
  addMessage(tx: Tx, tenantId: string, message: AskMessage): Promise<void>;
  messages(tx: Tx, tenantId: string, askIds: readonly string[]): Promise<readonly AskMessage[]>;
  /** Record the one nudge on a change waiting for HR; false when it was nudged already. */
  nudge(tx: Tx, tenantId: string, changeId: string, by: string, at: string): Promise<boolean>;
  /** When each of these changes was nudged, where it was. */
  nudges(
    tx: Tx,
    tenantId: string,
    changeIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export interface AskDeps {
  readonly store: DetailAskStore;
  readonly newId: () => string;
}

export type DocumentMode = 'keep' | 'acknowledge' | 'sign';
export type DocumentState =
  'open' | 'kept' | 'acknowledged' | 'signed' | 'countersigned' | 'declined' | 'cancelled';

export interface Signature {
  readonly name: string;
  readonly how: 'typed' | 'drawn';
  /** The typed name, or the drawn strokes as an SVG path. */
  readonly mark: string;
  readonly at: string;
  readonly place: string | null;
}

export interface SentDocument {
  readonly id: string;
  readonly personId: string;
  readonly name: string;
  readonly mediaType: FileMediaType;
  readonly size: number;
  readonly mode: DocumentMode;
  readonly message: string | null;
  readonly dueOn: string | null;
  readonly sentBy: string;
  readonly sentAt: string;
  readonly countersigner: string | null;
  readonly state: DocumentState;
  readonly signature: Signature | null;
  readonly countersignedBy: string | null;
  readonly countersignedName: string | null;
  readonly countersignedAt: string | null;
  readonly note: string | null;
  readonly closedAt: string | null;
}

export interface DocumentStore {
  insert(
    tx: Tx,
    tenantId: string,
    document: SentDocument,
    file: { readonly bytes: Uint8Array; readonly checksum: string },
  ): Promise<void>;
  find(tx: Tx, tenantId: string, id: string): Promise<SentDocument | null>;
  bytes(tx: Tx, tenantId: string, id: string): Promise<Uint8Array | null>;
  /** One person's documents, newest first. */
  forPerson(tx: Tx, tenantId: string, personId: string): Promise<readonly SentDocument[]>;
  /** What an account sent, or has to countersign, since an instant, newest first. */
  involving(
    tx: Tx,
    tenantId: string,
    accountId: string,
    since: string,
  ): Promise<readonly SentDocument[]>;
  /** Documents still with these people, due on or before a day: overdue ones (P2). */
  openDueBy(
    tx: Tx,
    tenantId: string,
    personIds: readonly string[],
    day: string,
  ): Promise<readonly SentDocument[]>;
  /** Move it on from `from`; false when somebody moved it first. */
  move(
    tx: Tx,
    tenantId: string,
    id: string,
    from: DocumentState,
    to: Pick<SentDocument, 'state' | 'note' | 'closedAt'> & {
      readonly signature?: Signature;
      readonly countersigned?: { readonly by: string; readonly name: string; readonly at: string };
    },
  ): Promise<boolean>;
}

export interface DocumentDeps {
  readonly store: DocumentStore;
  readonly uploads: Pick<UploadDeps, 'store' | 'intents'>;
  readonly newId: () => string;
}

export interface FailingIntegration {
  readonly endpointId: string;
  readonly url: string;
  /** When it started failing: the oldest delivery still failing, or when it was disabled. */
  readonly since: string;
  readonly attempts: number;
  readonly lastResponse: number | null;
  readonly disabled: boolean;
  /** Why it was disabled, in People's words. */
  readonly problem: string | null;
  /** Deliveries waiting on it. */
  readonly waiting: number;
}

export interface Claim {
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export interface TeamTaskStore {
  failing(tx: Tx, tenantId: string, failures: number): Promise<readonly FailingIntegration[]>;
  claims(tx: Tx, tenantId: string, itemIds: readonly string[]): Promise<ReadonlyMap<string, Claim>>;
  /** Take it, or take it over: the newest one taking it holds it. */
  claim(tx: Tx, tenantId: string, itemId: string, claim: Claim): Promise<void>;
}

export type InboxNotice =
  | {
      readonly kind: 'inbox_task';
      readonly topic: 'document_sign' | 'document_acknowledge' | 'document_countersign';
    }
  | {
      readonly kind: 'inbox_update';
      readonly topic: 'answered' | 'document_shared' | 'document_returned';
    };

/** Whom: a person on file, or the account somebody signs in as. */
export type Recipient = { readonly personId: string } | { readonly accountId: string };

export interface InboxNotifier {
  notify(
    tenantId: string,
    to: Recipient,
    notice: InboxNotice,
    /** The item, as the Inbox addresses it: `/inbox/todo?item=…`. */
    itemPath: string,
    /** What makes a retry the same message. */
    dedupeKey: string,
  ): Promise<void>;
}
