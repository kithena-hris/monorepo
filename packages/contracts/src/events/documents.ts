import * as z from 'zod';

import {
  asContact,
  asFreeText,
  asIdentity,
  asInternal,
  asPublic,
  policy,
} from '../classification.js';
import { defineEvent } from '../event.js';
import { activityRecorded } from './activity.js';
import { CalendarDate, PersonId } from '../primitives.js';
import {
  AccessLevel,
  ConfidentialBy,
  DocumentId,
  DocumentKind,
  DocumentTypeKey,
  Grantee,
  Permission,
} from '../documents/primitives.js';

/**
 * Documents' events (Documents PRD §13).
 *
 * No payload carries a document's title, its text, its bytes or a value read
 * from it: `documents.test.ts` walks every one to prove there is no field that
 * could. A consumer learns that something happened to which document, about
 * whom, and goes to Documents for the rest, as the person it acts for.
 */

const id = () => z.uuid().register(policy, asPublic());
const accountId = () => z.uuid().register(policy, asPublic());
const subject = () => PersonId.nullable();
const typeKey = () => DocumentTypeKey.nullable();

export const DocumentFiled = defineEvent(
  'documents.document.filed',
  1,
  z.object({
    documentId: DocumentId,
    typeKey: typeKey(),
    kind: DocumentKind,
    ownerAccountId: accountId(),
    subjectPersonId: subject(),
    level: AccessLevel,
    confidential: z.boolean().register(policy, asInternal()),
    pages: z.int().nonnegative().nullable().register(policy, asInternal()),
    expiresOn: CalendarDate.nullable(),
  }),
);

export const DocumentVersioned = defineEvent(
  'documents.document.versioned',
  1,
  z.object({
    documentId: DocumentId,
    version: z.int().positive().register(policy, asInternal()),
    subjectPersonId: subject(),
  }),
);

export const DocumentShared = defineEvent(
  'documents.document.shared',
  1,
  z.object({
    documentId: DocumentId,
    grantee: Grantee,
    permission: Permission,
    endsOn: CalendarDate.nullable(),
  }),
);

export const DocumentAccessChanged = defineEvent(
  'documents.document.access_changed',
  1,
  z.object({
    documentId: DocumentId,
    level: AccessLevel,
    confidential: z.boolean().register(policy, asInternal()),
    confidentialBy: ConfidentialBy.nullable(),
  }),
);

export const DocumentViewedConfidential = defineEvent(
  'documents.document.viewed_confidential',
  1,
  z.object({
    documentId: DocumentId,
    viewerAccountId: accountId(),
    action: z.enum(['view', 'download']).register(policy, asInternal()),
  }),
);

export const DocumentDeleted = defineEvent(
  'documents.document.deleted',
  1,
  z.object({ documentId: DocumentId, subjectPersonId: subject() }),
);

export const DocumentRestored = defineEvent(
  'documents.document.restored',
  1,
  z.object({ documentId: DocumentId }),
);

/** Its bytes are gone: the trash ran out, or retention ended and HR confirmed. */
export const DocumentDestroyed = defineEvent(
  'documents.document.destroyed',
  1,
  z.object({
    documentId: DocumentId,
    reason: z.enum(['trash', 'retention']).register(policy, asInternal()),
  }),
);

export const DocumentRequested = defineEvent(
  'documents.request.created',
  1,
  z.object({
    requestId: id(),
    personId: PersonId,
    typeKey: DocumentTypeKey,
    dueOn: CalendarDate.nullable(),
  }),
);

export const DocumentRequestFulfilled = defineEvent(
  'documents.request.fulfilled',
  1,
  z.object({ requestId: id(), personId: PersonId, documentId: DocumentId }),
);

export const DocumentRequestCancelled = defineEvent(
  'documents.request.cancelled',
  1,
  z.object({ requestId: id(), personId: PersonId }),
);

export const AccessRequested = defineEvent(
  'documents.access.requested',
  1,
  z.object({ requestId: id(), documentId: DocumentId, requesterAccountId: accountId() }),
);

export const AccessDecided = defineEvent(
  'documents.access.decided',
  1,
  z.object({
    requestId: id(),
    documentId: DocumentId,
    granted: z.boolean().register(policy, asInternal()),
  }),
);

export const DocumentTypeChanged = defineEvent(
  'documents.type.changed',
  1,
  z.object({ typeKey: DocumentTypeKey, archived: z.boolean().register(policy, asInternal()) }),
);

export const LegalHoldPlaced = defineEvent(
  'documents.hold.placed',
  1,
  z.object({
    holdId: id(),
    documentIds: z.array(DocumentId).register(policy, asPublic()),
  }),
);

export const LegalHoldLifted = defineEvent('documents.hold.lifted', 1, z.object({ holdId: id() }));

/** A signer outside the company, by address: the one personal value an event here holds. */
const signerEmail = () => z.email().nullable().register(policy, asContact());

export const EnvelopeSent = defineEvent(
  'documents.envelope.sent',
  1,
  z.object({
    envelopeId: id(),
    documentId: DocumentId,
    version: z.int().positive().register(policy, asInternal()),
    signers: z
      .array(
        z.object({
          personId: PersonId.nullable(),
          email: signerEmail(),
          order: z.int().positive().register(policy, asInternal()),
        }),
      )
      // The walk stops at an array, so the list carries its most sensitive member's policy.
      .register(policy, asContact()),
    dueOn: CalendarDate.nullable(),
  }),
);

export const EnvelopeSigned = defineEvent(
  'documents.envelope.signed',
  1,
  z.object({
    envelopeId: id(),
    signerId: id(),
    personId: PersonId.nullable(),
    /** What another module sent it for, as `envelope.completed` carries it. */
    subjectRef: z.string().max(160).nullable().default(null).register(policy, asInternal()),
    /** The members whose turn to sign came with this signature. */
    turn: z.array(PersonId).max(10).default([]).register(policy, asIdentity()),
  }),
);

export const EnvelopeDeclined = defineEvent(
  'documents.envelope.declined',
  1,
  z.object({
    envelopeId: id(),
    signerId: id(),
    reason: z.string().max(1000).register(policy, asFreeText()),
  }),
);

export const EnvelopeCompleted = defineEvent(
  'documents.envelope.completed',
  1,
  z.object({
    envelopeId: id(),
    documentId: DocumentId,
    signedVersion: z.int().positive().register(policy, asInternal()),
    subjectPersonId: subject(),
    /** What another module sent it for (`recruiting:offer:<id>:<version>`), so it can match without asking. */
    subjectRef: z.string().max(160).nullable().register(policy, asInternal()),
    /**
     * For an envelope another module sent (a `subjectRef`): each signer's
     * signature, so the module that asked can keep the one its person signed
     * with. A hire's contract signature becomes the signature on their record.
     */
    signatures: z
      .array(
        z.object({
          email: z.string().max(254).nullable().register(policy, asContact()),
          personId: PersonId.nullable(),
          /** The mark as its JSON text (`SignatureMark`), as People keeps a signature. */
          mark: z.string().max(50_000).register(policy, asIdentity()),
        }),
      )
      .max(10)
      .default([])
      .register(policy, asIdentity()),
  }),
);

export const EnvelopeVoided = defineEvent(
  'documents.envelope.voided',
  1,
  z.object({
    envelopeId: id(),
    reason: z.string().max(1000).register(policy, asFreeText()),
  }),
);

export const AcknowledgementSent = defineEvent(
  'documents.acknowledgement.sent',
  1,
  z.object({
    campaignId: id(),
    documentId: DocumentId,
    version: z.int().positive().register(policy, asInternal()),
    audience: z.int().nonnegative().register(policy, asInternal()),
    dueOn: CalendarDate.nullable(),
  }),
);

export const DocumentAcknowledged = defineEvent(
  'documents.acknowledgement.acknowledged',
  1,
  z.object({ campaignId: id(), documentId: DocumentId, personId: PersonId }),
);

/** Every act in Documents, in words, for the company's activity log (`docs/audit.md`). */
export const DocumentsActivityRecorded = activityRecorded('documents');

export const documentsEvents = [
  DocumentsActivityRecorded,
  DocumentFiled,
  DocumentVersioned,
  DocumentShared,
  DocumentAccessChanged,
  DocumentViewedConfidential,
  DocumentDeleted,
  DocumentRestored,
  DocumentDestroyed,
  DocumentRequested,
  DocumentRequestFulfilled,
  DocumentRequestCancelled,
  AccessRequested,
  AccessDecided,
  DocumentTypeChanged,
  LegalHoldPlaced,
  LegalHoldLifted,
  EnvelopeSent,
  EnvelopeSigned,
  EnvelopeDeclined,
  EnvelopeCompleted,
  EnvelopeVoided,
  AcknowledgementSent,
  DocumentAcknowledged,
] as const;
