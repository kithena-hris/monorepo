import { createHash } from 'node:crypto';
import * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import {
  CalendarDate,
  DocumentId,
  DocumentTypeDefinition,
  DocumentTypeKey,
  Grantee,
  InboxAnswer,
  Permission,
  PersonId,
  SignatureMark,
} from '@kithena/contracts';

import {
  addVersion,
  content,
  deleteDocument,
  rename,
  restoreDocument,
  setConfidential,
  setExpiry,
  share,
  upload,
  type UploadedFile,
} from '../application/documents.js';
import {
  acknowledge,
  campaignScreen,
  sendForAcknowledgement,
} from '../application/acknowledgements.js';
import {
  AnswerView,
  askAbout,
  askAcross,
  compareVersions,
  CompareView,
  describeType,
  readFields,
  setAiSettings,
  suggestFiling,
  summarize,
  SummaryView,
} from '../application/ai.js';
import { documentsInbox } from '../application/inbox.js';
import { fileSplit, proposeSplit } from '../application/split.js';
import {
  DraftSigner,
  DraftTurn,
  DraftView,
  draftDocument,
  fileDraft,
  generateLetters,
  readTemplate,
} from '../application/letters.js';
import {
  askSender,
  declineAsMember,
  declineByLink,
  reassignSigner,
  remindSigners,
  requestCode,
  sealAgain,
  sendForSignature,
  signAsMember,
  signByLink,
  verifyCode,
  voidRequest,
} from '../application/signatures.js';
import {
  envelopeFile,
  envelopeScreen,
  envelopesScreen,
  EnvelopesView,
  EnvelopeView,
  linkScreen,
} from '../application/signing-screens.js';
import { importMembers, MemberRow } from '../application/members.js';
import { checkFile } from '../domain/document/document.js';
import {
  askForDocument,
  cancelRequest,
  changeSection,
  confirmRetention,
  createSection,
  decideAccess,
  liftHold,
  placeHold,
  remindRequest,
  requestAccess,
  saveType,
  setAccessSettings,
  setAskAfterUpload,
} from '../application/organise.js';
import type { Caller, Deps, StoredKey, UnitOfWork } from '../application/ports.js';
import { documentScreen, library, personFile, settingsScreen } from '../application/screens.js';
import { LibraryView, OpenOrClosed, PersonFileView, SettingsView } from '../application/views.js';
import type { CallerFrom } from './caller.js';

/**
 * REST v1 for Documents (PRD §18, DOC-022): `/v1/documents/...`.
 *
 * Time Off's design, copied: one route table serves REST, the OpenAPI
 * document and the subgraph; every write carries `Idempotency-Key`, saved
 * with its answer in the write's own transaction; no route decides who may
 * do anything — the application layer does.
 *
 * **Files skip the router.** The browser PUTs to the bucket with a presigned
 * URL (`startDocumentsUpload`) and the write names the upload; a file read
 * back is a presigned link to a copy. A request through the shell stops at
 * 4.5 MB on Vercel. Without a bucket (tests, a laptop) a file of up to 25 MB
 * travels inside the request as base64 instead.
 */

export interface RestRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export interface RestResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface RestDeps {
  readonly deps: Deps;
  readonly callerFrom: CallerFrom;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly params: z.ZodObject;
  readonly body: z.ZodType | null;
  readonly answer: z.ZodType;
  readonly status: number;
  readonly graphql: boolean;
  /** Reached by a signing link's token, not through the router: no caller, no key. */
  readonly public: boolean;
  /**
   * Whether the answer is kept against its idempotency key. Never for what a
   * model wrote (PRD §14.1): nothing it reads or writes is stored, so a
   * retry asks again rather than replaying a stored answer.
   */
  readonly keep: boolean;
  readonly run: (
    deps: Deps,
    caller: Caller,
    input: { readonly params: unknown; readonly body: unknown },
  ) => Promise<Result<unknown>>;
  readonly shape: (value: unknown) => unknown;
}

const NoParams = z.object({});

function route<P extends z.ZodObject, B extends z.ZodType | null, A extends z.ZodType, V>(def: {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly params?: P;
  readonly body?: B;
  readonly answer: A;
  readonly status?: number;
  readonly public?: true;
  /** A model's answer: never stored (`Route['keep']`). */
  readonly model?: true;
  readonly run: (
    deps: Deps,
    caller: Caller,
    input: {
      readonly params: z.output<P>;
      readonly body: B extends z.ZodType ? z.output<B> : undefined;
    },
  ) => Promise<Result<V>>;
  readonly shape?: (value: V) => z.input<A>;
}): Route {
  return {
    name: def.name,
    method: def.method,
    path: def.path,
    summary: def.summary,
    params: def.params ?? NoParams,
    body: def.body ?? null,
    answer: def.answer,
    status: def.status ?? 200,
    graphql: def.public !== true,
    public: def.public === true,
    keep: def.model !== true,
    run: def.run as Route['run'],
    shape: (def.shape ?? ((v: V) => v)) as Route['shape'],
  };
}

/* ------------------------------------------------------------- contract -- */

export const Done = z.object({ ok: z.literal(true) }).meta({ title: 'DocumentsDone' });
const done = () => ({ ok: true as const });
const Created = z.object({ id: z.string() }).meta({ title: 'DocumentsCreated' });

/** 25 MB of bytes is at most this many base64 characters. */
const MAX_BASE64 = Math.ceil((25 * 1024 * 1024) / 3) * 4;

/** A small file inside the request: tests, and a store with no presigned uploads. */
export const FileBody = z.strictObject({
  name: z.string().trim().min(1).max(255),
  mediaType: z.string().max(200),
  base64: z.base64().max(MAX_BASE64, 'Files sent inside a request are up to 25 MB'),
});

/** A file the browser already PUT to the bucket (`startDocumentsUpload`). */
export const UploadedBody = z.strictObject({
  uploadId: z.uuid(),
  name: z.string().trim().min(1).max(255),
  mediaType: z.string().max(200),
});

const incomingKey = (caller: Caller, uploadId: string) => `incoming/${caller.tenantId}/${uploadId}`;

/**
 * The bytes a write carries, from the request or from the bucket, and what to
 * do once the write is over: an upload is read once and deleted, kept or not.
 */
async function fileOf(
  deps: Deps,
  caller: Caller,
  body: {
    file?: z.output<typeof FileBody> | undefined;
    upload?: z.output<typeof UploadedBody> | undefined;
  },
): Promise<Result<{ file: UploadedFile; done: () => Promise<void> }>> {
  if (body.file !== undefined) {
    const f = body.file;
    return ok({
      file: {
        name: f.name,
        mediaType: f.mediaType,
        bytes: new Uint8Array(Buffer.from(f.base64, 'base64')),
      },
      done: async () => {},
    });
  }
  const u = body.upload;
  if (u === undefined) return err(failure('BAD_REQUEST', 'Send a file or an upload', ['file']));
  if (deps.transfers === undefined)
    return err(failure('UNAVAILABLE', 'Uploads are not set up here'));
  const key = incomingKey(caller, u.uploadId);
  const bytes = await deps.transfers.readIncoming(key, 100 * 1024 * 1024);
  if (bytes === null) return err(failure('NOT_FOUND', 'Nothing was uploaded', ['upload']));
  if (bytes === 'too_large') return err(failure('TOO_LARGE', 'Files are up to 100 MB', ['upload']));
  return ok({
    file: { name: u.name, mediaType: u.mediaType, bytes },
    done: () => deps.transfers?.remove(key) ?? Promise.resolve(),
  });
}

/** Runs a write with a file, then lets the upload go. */
async function withFile<T>(
  deps: Deps,
  caller: Caller,
  body: Parameters<typeof fileOf>[2],
  write: (file: UploadedFile) => Promise<Result<T>>,
): Promise<Result<T>> {
  const got = await fileOf(deps, caller, body);
  if (!got.ok) return got;
  try {
    return await write(got.value.file);
  } finally {
    await got.value.done();
  }
}

const OneFile = { file: FileBody.optional(), upload: UploadedBody.optional() };

const SplitPart = z
  .object({
    from: z.int().min(1),
    to: z.int().min(1),
    title: z.string().trim().min(1).max(200),
    typeKey: z.string().nullable(),
    subjectPersonId: z.string().nullable(),
  })
  .meta({ title: 'DocumentsSplitPart' });

export const UploadBody = z.strictObject({
  title: z.string().trim().min(1).max(200),
  typeKey: DocumentTypeKey.nullable().default(null),
  subjectPersonId: PersonId.nullable().default(null),
  sectionId: z.uuid().nullable().default(null),
  expiresOn: CalendarDate.nullable().default(null),
  requestId: z.uuid().nullable().default(null),
  ...OneFile,
});

export const VersionBody = z.strictObject({
  note: z.string().max(500).nullable().default(null),
  ...OneFile,
});

export const GrantsBody = z.strictObject({
  grants: z
    .array(
      z.strictObject({ grantee: Grantee, permission: Permission, endsOn: CalendarDate.nullable() }),
    )
    .max(200),
});

const DocParams = z.object({ documentId: DocumentId });

/** A link to the copy, for a few minutes; or, with no bucket, the bytes themselves. */
const FileAnswer = z
  .object({
    fileName: z.string(),
    mediaType: z.string(),
    url: z.string().nullable(),
    base64: z.string().nullable(),
    original: z.boolean(),
  })
  .meta({ title: 'DocumentsFile' });

const AccessSettingsBody = z.strictObject({
  askAfterUpload: z.boolean().optional(),
  peopleMayTurnOffQuestion: z.boolean().optional(),
  everyoneShare: z.enum(['hr', 'anyone']).optional(),
  companyLinks: z.boolean().optional(),
  outsideSharing: z.boolean().optional(),
  watermark: z.boolean().optional(),
  blockDownload: z.boolean().optional(),
  personalSections: z.boolean().optional(),
});

const OriginBody = {
  origin: z.url().max(300),
  companyName: z.string().trim().min(1).max(120),
};

/** The contract's signature: typed in a face, or drawn. */
const Mark = SignatureMark;

const SignBody = z.strictObject({
  signature: Mark,
  values: z.record(z.string().max(80), z.string().max(200)).default({}),
  // The signer's own calendar day, for the date box: within a day of the server's, or ignored.
  day: z.iso.date().optional(),
  /**
   * The Signature ID the signer was shown under each box as they filled it
   * (K7): kept as their `signed` event's id, so the print on the screen and
   * in the sealed file are one. Absent, Kithena makes one.
   */
  traceId: z.uuid().optional(),
  ...OriginBody,
});

const FieldBody = z.strictObject({
  id: z.string().max(80),
  signerId: z.string().max(20),
  kind: z.enum(['signature', 'initials', 'date', 'name', 'title', 'checkbox', 'text']),
  page: z.int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  required: z.boolean().default(true),
  label: z.string().max(120).nullable().default(null),
});

const EnvelopeParams = z.object({ envelopeId: z.uuid() });
const TokenParams = z.object({ token: z.string().min(40).max(120) });
const Completed = z
  .object({
    completed: z.boolean(),
    /** Who signs next, by name, for "Sent to … for their signature". */
    next: z.array(z.string()),
  })
  .meta({ title: 'DocumentsSigned' });

/** A file as a link to a copy that lasts minutes, or the bytes without a bucket. */
async function handOut(
  deps: Deps,
  tenantId: string,
  f: { bytes: Uint8Array; fileName: string; mediaType: string },
  download: boolean,
) {
  const url =
    deps.transfers === undefined
      ? null
      : await deps.transfers.handOut(
          `outgoing/${tenantId}/${deps.newId()}`,
          f.bytes,
          { fileName: f.fileName, mediaType: f.mediaType, download },
          600,
        );
  return {
    fileName: f.fileName,
    mediaType: f.mediaType,
    url,
    base64: url === null ? Buffer.from(f.bytes).toString('base64') : null,
    original: true,
  };
}

const V1 = '/v1/documents';

const created = (v: { id: string }) => ({ id: v.id });

export const ROUTES: readonly Route[] = [
  /* -------------------------------------------------------------- reads -- */
  route({
    name: 'documentsLibrary',
    method: 'GET',
    path: `${V1}/library`,
    summary: 'The Documents screen: what needs you, the queues, and every document you can open',
    params: z.object({
      show: z.string().max(80).default('all'),
      q: z.string().max(200).default(''),
      queue: z.enum(['to_sign', 'expiring', 'missing', 'to_delete']).nullable().default(null),
      deleted: z.boolean().default(false),
    }),
    answer: LibraryView,
    run: (deps, caller, { params }) => library(deps, caller, params),
  }),
  route({
    name: 'documentsDocument',
    method: 'GET',
    path: `${V1}/d/{documentId}`,
    summary: 'A document, or who owns it when you cannot open it',
    params: DocParams,
    answer: OpenOrClosed,
    run: (deps, caller, { params }) => documentScreen(deps, caller, params.documentId),
  }),
  route({
    name: 'documentsFile',
    method: 'GET',
    path: `${V1}/d/{documentId}/file`,
    summary: 'A version’s bytes: watermarked for a Confidential view, logged when Confidential',
    params: DocParams.extend({
      version: z.int().positive().nullable().default(null),
      mode: z.enum(['view', 'download']).default('view'),
      device: z.string().max(200).nullable().default(null),
    }),
    answer: FileAnswer,
    run: async (deps, caller, { params }) => {
      const got = await content(deps, caller, params.documentId, {
        version: params.version,
        mode: params.mode,
        device: params.device,
      });
      if (!got.ok) return got;
      const f = got.value;
      const url =
        deps.transfers === undefined
          ? null
          : await deps.transfers.handOut(
              `outgoing/${caller.tenantId}/${deps.newId()}`,
              f.bytes,
              {
                fileName: f.fileName,
                mediaType: f.mediaType,
                download: params.mode === 'download',
              },
              600,
            );
      return ok({
        fileName: f.fileName,
        mediaType: f.mediaType,
        url,
        base64: url === null ? Buffer.from(f.bytes).toString('base64') : null,
        original: f.original,
      });
    },
  }),
  route({
    name: 'documentsPersonFile',
    method: 'GET',
    path: `${V1}/people/{personId}`,
    summary: 'A person’s file: what their types require, and what they have',
    params: z.object({ personId: PersonId }),
    answer: PersonFileView,
    run: (deps, caller, { params }) => personFile(deps, caller, params.personId),
  }),
  route({
    name: 'documentsInbox',
    method: 'GET',
    path: `${V1}/inbox`,
    summary:
      'What Documents has in this person’s Inbox: documents asked of them, and access to decide',
    answer: InboxAnswer,
    run: (deps, caller) => documentsInbox(deps, caller),
  }),
  route({
    name: 'documentsSettings',
    method: 'GET',
    path: `${V1}/settings`,
    summary: 'Settings › Documents: types, sections, access and legal holds',
    answer: SettingsView,
    run: (deps, caller) => settingsScreen(deps, caller),
  }),

  /* ------------------------------------------------------------- writes -- */
  route({
    name: 'startDocumentsUpload',
    method: 'POST',
    path: `${V1}/uploads`,
    summary: 'Where the browser puts a file before filing it: a presigned PUT, for ten minutes',
    body: z.strictObject({
      name: z.string().trim().min(1).max(255),
      mediaType: z.string().max(200),
      size: z.int().positive(),
    }),
    answer: z
      .object({
        uploadId: z.string(),
        url: z.string(),
        method: z.literal('PUT'),
        headers: z.record(z.string(), z.string()),
      })
      .meta({ title: 'DocumentsUpload' }),
    status: 201,
    run: async (deps, caller, { body }) => {
      const fit = checkFile({ mediaType: body.mediaType, size: body.size });
      if (!fit.ok) return fit;
      if (deps.transfers === undefined) {
        return err(failure('UNAVAILABLE', 'Uploads are not set up here'));
      }
      const uploadId = deps.newId();
      const put = await deps.transfers.presignPut(incomingKey(caller, uploadId), body.size, 600);
      return ok({ uploadId, ...put });
    },
  }),
  route({
    name: 'uploadDocument',
    method: 'POST',
    path: `${V1}/d`,
    summary: 'File a document: Private to start, the type’s rules applied',
    body: UploadBody,
    answer: Created,
    status: 201,
    run: (deps, caller, { body }) =>
      withFile(deps, caller, body, (file) => upload(deps, caller, { ...body, file })),
    shape: created,
  }),
  route({
    name: 'addDocumentVersion',
    method: 'POST',
    path: `${V1}/d/{documentId}/versions`,
    summary: 'A new version of a document',
    params: DocParams,
    body: VersionBody,
    answer: z.object({ version: z.int() }).meta({ title: 'DocumentsVersionAdded' }),
    status: 201,
    run: (deps, caller, { params, body }) =>
      withFile(deps, caller, body, (file) =>
        addVersion(deps, caller, params.documentId, file, body.note),
      ),
  }),
  route({
    name: 'shareDocument',
    method: 'PUT',
    path: `${V1}/d/{documentId}/grants`,
    summary: 'Who it is shared with; none makes it Private',
    params: DocParams,
    body: GrantsBody,
    answer: Created,
    run: (deps, caller, { params, body }) => share(deps, caller, params.documentId, body.grants),
    shape: created,
  }),
  route({
    name: 'setDocumentConfidential',
    method: 'PUT',
    path: `${V1}/d/{documentId}/confidential`,
    summary: 'Turn Confidential on or off',
    params: DocParams,
    body: z.strictObject({ on: z.boolean() }),
    answer: Created,
    run: (deps, caller, { params, body }) =>
      setConfidential(deps, caller, params.documentId, body.on),
    shape: created,
  }),
  route({
    name: 'renameDocument',
    method: 'PUT',
    path: `${V1}/d/{documentId}/title`,
    summary: 'Rename a document',
    params: DocParams,
    body: z.strictObject({ title: z.string().max(200) }),
    answer: Created,
    run: (deps, caller, { params, body }) => rename(deps, caller, params.documentId, body.title),
    shape: created,
  }),
  route({
    name: 'setDocumentExpiry',
    method: 'PUT',
    path: `${V1}/d/{documentId}/expiry`,
    summary: 'When a document expires',
    params: DocParams,
    body: z.strictObject({ expiresOn: CalendarDate.nullable() }),
    answer: Created,
    run: (deps, caller, { params, body }) =>
      setExpiry(deps, caller, params.documentId, body.expiresOn),
    shape: created,
  }),
  route({
    name: 'deleteDocument',
    method: 'POST',
    path: `${V1}/d/{documentId}/delete`,
    summary: 'Move a document to Deleted, for 30 days',
    params: DocParams,
    answer: Created,
    run: (deps, caller, { params }) => deleteDocument(deps, caller, params.documentId),
    shape: created,
  }),
  route({
    name: 'restoreDocument',
    method: 'POST',
    path: `${V1}/d/{documentId}/restore`,
    summary: 'Bring a document back from Deleted',
    params: DocParams,
    answer: Created,
    run: (deps, caller, { params }) => restoreDocument(deps, caller, params.documentId),
    shape: created,
  }),
  route({
    name: 'requestDocumentAccess',
    method: 'POST',
    path: `${V1}/d/{documentId}/access-requests`,
    summary: 'Ask the owner to open a document for you',
    params: DocParams,
    body: z.strictObject({ reason: z.string().max(1000) }),
    answer: Created,
    status: 201,
    run: (deps, caller, { params, body }) =>
      requestAccess(deps, caller, params.documentId, body.reason),
  }),
  route({
    name: 'decideDocumentAccess',
    method: 'POST',
    path: `${V1}/access-requests/{requestId}/decision`,
    summary: 'Grant or refuse an access request',
    params: z.object({ requestId: z.uuid() }),
    body: z.strictObject({ grant: z.boolean() }),
    answer: Created,
    run: (deps, caller, { params, body }) =>
      decideAccess(deps, caller, params.requestId, body.grant),
  }),
  route({
    name: 'createDocumentSection',
    method: 'POST',
    path: `${V1}/sections`,
    summary: 'A personal section, or a company section for HR',
    body: z.strictObject({
      name: z.string().max(60),
      kind: z.enum(['personal', 'company']).default('personal'),
      documentIds: z.array(DocumentId).max(200).default([]),
    }),
    answer: Created,
    status: 201,
    run: (deps, caller, { body }) => createSection(deps, caller, body),
  }),
  route({
    name: 'changeDocumentSection',
    method: 'PATCH',
    path: `${V1}/sections/{sectionId}`,
    summary: 'Rename a section, add or remove documents, or delete it',
    params: z.object({ sectionId: z.uuid() }),
    body: z.strictObject({
      name: z.string().max(60).optional(),
      add: z.array(DocumentId).max(200).optional(),
      remove: z.array(DocumentId).max(200).optional(),
      delete: z.boolean().optional(),
    }),
    answer: Created,
    run: (deps, caller, { params, body }) => changeSection(deps, caller, params.sectionId, body),
  }),
  route({
    name: 'askForDocument',
    method: 'POST',
    path: `${V1}/requests`,
    summary: 'HR asks a person for a document; it becomes a task in their Inbox',
    body: z.strictObject({
      personId: PersonId,
      typeKey: DocumentTypeKey,
      dueOn: CalendarDate.nullable().default(null),
      message: z.string().max(2000).default(''),
    }),
    answer: Created,
    status: 201,
    run: (deps, caller, { body }) => askForDocument(deps, caller, body),
  }),
  route({
    name: 'remindDocumentRequest',
    method: 'POST',
    path: `${V1}/requests/{requestId}/remind`,
    summary: 'Remind a person of a document HR asked for',
    params: z.object({ requestId: z.uuid() }),
    answer: Created,
    run: (deps, caller, { params }) => remindRequest(deps, caller, params.requestId),
  }),
  route({
    name: 'cancelDocumentRequest',
    method: 'POST',
    path: `${V1}/requests/{requestId}/cancel`,
    summary: 'Stop asking for a document',
    params: z.object({ requestId: z.uuid() }),
    answer: Created,
    run: (deps, caller, { params }) => cancelRequest(deps, caller, params.requestId),
  }),
  route({
    name: 'placeLegalHold',
    method: 'POST',
    path: `${V1}/holds`,
    summary: 'Keep documents past retention and deletion for a case',
    body: z.strictObject({
      name: z.string().max(80),
      documentIds: z.array(DocumentId).min(1).max(1000),
    }),
    answer: Created,
    status: 201,
    run: (deps, caller, { body }) => placeHold(deps, caller, body),
  }),
  route({
    name: 'liftLegalHold',
    method: 'POST',
    path: `${V1}/holds/{holdId}/lift`,
    summary: 'Lift a legal hold',
    params: z.object({ holdId: z.uuid() }),
    answer: Created,
    run: (deps, caller, { params }) => liftHold(deps, caller, params.holdId),
  }),
  route({
    name: 'confirmDocumentDeletion',
    method: 'POST',
    path: `${V1}/retention/confirm`,
    summary: 'HR confirms documents whose retention has ended; they go to Deleted',
    body: z.strictObject({ documentIds: z.array(DocumentId).min(1).max(1000) }),
    answer: z.object({ deleted: z.int() }).meta({ title: 'DocumentsRetentionConfirmed' }),
    run: (deps, caller, { body }) => confirmRetention(deps, caller, body.documentIds),
  }),
  route({
    name: 'saveDocumentType',
    method: 'PUT',
    path: `${V1}/types/{typeKey}`,
    summary: 'Create or change a document type',
    params: z.object({ typeKey: DocumentTypeKey }),
    body: z.strictObject({ type: DocumentTypeDefinition, archived: z.boolean().default(false) }),
    answer: z.object({ key: z.string() }).meta({ title: 'DocumentsTypeSaved' }),
    run: async (deps, caller, { params, body }) =>
      body.type.key !== params.typeKey
        ? err(failure('KEY_MISMATCH', 'The key in the path and the type differ', ['type', 'key']))
        : saveType(deps, caller, body.type, body.archived),
  }),
  route({
    name: 'setDocumentAccessSettings',
    method: 'PUT',
    path: `${V1}/settings/access`,
    summary: 'Access and sharing defaults (S5)',
    body: AccessSettingsBody,
    answer: Done,
    run: (deps, caller, { body }) =>
      setAccessSettings(
        deps,
        caller,
        Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
      ),
    shape: done,
  }),
  route({
    name: 'setAskAfterUpload',
    method: 'PUT',
    path: `${V1}/me/ask-after-upload`,
    summary: 'Whether the share question follows your uploads',
    body: z.strictObject({ ask: z.boolean() }),
    answer: Done,
    run: (deps, caller, { body }) => setAskAfterUpload(deps, caller, body.ask),
    shape: done,
  }),
  route({
    name: 'importDocumentMembers',
    method: 'POST',
    path: `${V1}/members/import`,
    summary: 'Who works here, when People is absent',
    body: z.strictObject({ rows: z.array(MemberRow).min(1).max(5000) }),
    answer: z.object({ imported: z.int() }).meta({ title: 'DocumentsMembersImported' }),
    run: (deps, caller, { body }) => importMembers(deps, caller, body.rows),
  }),

  /* ------------------------------------------------------- signatures -- */
  route({
    name: 'sendForSignature',
    method: 'POST',
    path: `${V1}/d/{documentId}/envelopes`,
    summary: 'Send a PDF for signature: signers in order, fields placed, a message and a due date',
    params: DocParams,
    body: z.strictObject({
      signers: z
        .array(
          z.strictObject({
            personId: PersonId.nullable().default(null),
            email: z.string().max(320).nullable().default(null),
            name: z.string().max(200).nullable().default(null),
            order: z.int().min(1).max(10),
            allowDelegate: z.boolean().default(false),
          }),
        )
        .min(1)
        .max(10),
      fields: z.array(FieldBody).max(200).default([]),
      message: z.string().max(2000).default(''),
      dueOn: CalendarDate.nullable().default(null),
      ...OriginBody,
    }),
    answer: Created,
    status: 201,
    run: (deps, caller, { params, body }) =>
      sendForSignature(deps, caller, { documentId: params.documentId, ...body }),
  }),
  route({
    name: 'documentsEnvelopes',
    method: 'GET',
    path: `${V1}/envelopes`,
    summary: 'Every signature request this person follows or must sign (K10)',
    answer: EnvelopesView,
    run: (deps, caller) => envelopesScreen(deps, caller),
  }),
  route({
    name: 'documentsEnvelope',
    method: 'GET',
    path: `${V1}/envelopes/{envelopeId}`,
    summary: 'A signature request, as its signer or its sender sees it (K4, K8)',
    params: EnvelopeParams,
    answer: EnvelopeView,
    run: (deps, caller, { params }) => envelopeScreen(deps, caller, params.envelopeId),
  }),
  route({
    name: 'documentsEnvelopeFile',
    method: 'GET',
    path: `${V1}/envelopes/{envelopeId}/file`,
    summary: 'The version being signed, or the sealed one, as a link that lasts minutes',
    params: EnvelopeParams,
    answer: FileAnswer,
    run: async (deps, caller, { params }) => {
      const f = await envelopeFile(deps, caller, params.envelopeId);
      return f.ok ? ok(await handOut(deps, caller.tenantId, f.value, false)) : f;
    },
  }),
  route({
    name: 'signEnvelope',
    method: 'POST',
    path: `${V1}/envelopes/{envelopeId}/sign`,
    summary: 'Sign as yourself: every field of yours filled, the signature adopted',
    params: EnvelopeParams,
    body: SignBody,
    answer: Completed,
    run: (deps, caller, { params, body }) => signAsMember(deps, caller, params.envelopeId, body),
  }),
  route({
    name: 'declineEnvelope',
    method: 'POST',
    path: `${V1}/envelopes/{envelopeId}/decline`,
    summary: 'Decline to sign, with a reason',
    params: EnvelopeParams,
    body: z.strictObject({ reason: z.string().max(1000) }),
    answer: Created,
    run: (deps, caller, { params, body }) =>
      declineAsMember(deps, caller, params.envelopeId, body.reason),
  }),
  route({
    name: 'askEnvelopeSender',
    method: 'POST',
    path: `${V1}/envelopes/{envelopeId}/ask`,
    summary: 'Ask the sender a question; the request waits',
    params: EnvelopeParams,
    body: z.strictObject({ question: z.string().max(1000) }),
    answer: Created,
    run: (deps, caller, { params, body }) =>
      askSender(deps, caller, params.envelopeId, body.question),
  }),
  route({
    name: 'voidEnvelope',
    method: 'POST',
    path: `${V1}/envelopes/{envelopeId}/void`,
    summary: 'Cancel a request, with a reason',
    params: EnvelopeParams,
    body: z.strictObject({ reason: z.string().max(1000) }),
    answer: Created,
    run: (deps, caller, { params, body }) =>
      voidRequest(deps, caller, params.envelopeId, body.reason),
  }),
  route({
    name: 'remindEnvelope',
    method: 'POST',
    path: `${V1}/envelopes/{envelopeId}/remind`,
    summary: 'Email whoever it waits on now, and nobody else (K8)',
    params: EnvelopeParams,
    body: z.strictObject(OriginBody),
    answer: z
      .object({ id: z.string(), reminded: z.array(z.string()) })
      .meta({ title: 'DocumentsReminded' }),
    run: (deps, caller, { params, body }) => remindSigners(deps, caller, params.envelopeId, body),
  }),
  route({
    name: 'reassignEnvelopeSigner',
    method: 'POST',
    path: `${V1}/envelopes/{envelopeId}/reassign`,
    summary: 'Hand a signer’s turn to a colleague, where the sender allowed it',
    params: EnvelopeParams,
    body: z.strictObject({ signerId: z.string().max(20), personId: PersonId }),
    answer: Created,
    run: (deps, caller, { params, body }) => reassignSigner(deps, caller, params.envelopeId, body),
  }),
  route({
    name: 'sealEnvelope',
    method: 'POST',
    path: `${V1}/envelopes/{envelopeId}/seal`,
    summary: 'Seal a completed request that did not seal the first time',
    params: EnvelopeParams,
    body: z.strictObject({ companyName: z.string().trim().min(1).max(120) }),
    answer: z.object({ version: z.int() }).meta({ title: 'DocumentsSealed' }),
    run: (deps, caller, { params, body }) =>
      sealAgain(deps, caller, params.envelopeId, body.companyName),
  }),
  /* An outside signer's link (K6): public, its token the only key. */
  route({
    name: 'linkEnvelope',
    method: 'GET',
    path: `${V1}/sign/{token}`,
    summary: 'The request a signing link opens',
    params: TokenParams,
    answer: EnvelopeView,
    public: true,
    run: (deps, _caller, { params }) => linkScreen(deps, params.token),
  }),
  route({
    name: 'linkEnvelopeFile',
    method: 'GET',
    path: `${V1}/sign/{token}/file`,
    summary: 'The document a signing link opens, as a link that lasts minutes',
    params: TokenParams,
    answer: FileAnswer,
    public: true,
    run: async (deps, _caller, { params }) => {
      const f = await envelopeFile(deps, { token: params.token }, null);
      return f.ok ? ok(await handOut(deps, params.token.split('.')[0] ?? '', f.value, false)) : f;
    },
  }),
  route({
    name: 'linkRequestCode',
    method: 'POST',
    path: `${V1}/sign/{token}/code`,
    summary: 'Email the signer a six-digit code',
    params: TokenParams,
    body: z.strictObject(OriginBody),
    answer: z.object({ sentTo: z.string() }).meta({ title: 'DocumentsCodeSent' }),
    public: true,
    run: (deps, _caller, { params, body }) => requestCode(deps, params.token, body),
  }),
  route({
    name: 'linkVerifyCode',
    method: 'POST',
    path: `${V1}/sign/{token}/verify`,
    summary: 'Check the code; five wrong tries need a new one',
    params: TokenParams,
    body: z.strictObject({ code: z.string().regex(/^\d{6}$/u) }),
    answer: z.object({ verified: z.boolean() }).meta({ title: 'DocumentsCodeChecked' }),
    public: true,
    run: (deps, _caller, { params, body }) => verifyCode(deps, params.token, body.code),
  }),
  route({
    name: 'linkSign',
    method: 'POST',
    path: `${V1}/sign/{token}/sign`,
    summary: 'Sign from the link',
    params: TokenParams,
    body: SignBody,
    answer: Completed,
    public: true,
    run: (deps, _caller, { params, body }) => signByLink(deps, params.token, body),
  }),
  route({
    name: 'linkDecline',
    method: 'POST',
    path: `${V1}/sign/{token}/decline`,
    summary: 'Decline from the link, with a reason',
    params: TokenParams,
    body: z.strictObject({ reason: z.string().max(1000) }),
    answer: Created,
    public: true,
    run: (deps, _caller, { params, body }) => declineByLink(deps, params.token, body.reason),
  }),
  /* -------------------------------------------------- acknowledgements -- */
  route({
    name: 'sendForAcknowledgement',
    method: 'POST',
    path: `${V1}/d/{documentId}/campaigns`,
    summary: 'Send a policy to everyone, teams or people to read and acknowledge (F2)',
    params: DocParams,
    body: z.strictObject({
      audience: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('everyone') }),
        z.strictObject({
          kind: z.literal('teams'),
          teamKeys: z.array(z.string().max(60)).min(1).max(100),
        }),
        z.strictObject({
          kind: z.literal('people'),
          personIds: z.array(PersonId).min(1).max(5000),
        }),
      ]),
      dueOn: CalendarDate.nullable().default(null),
    }),
    answer: Created,
    status: 201,
    run: (deps, caller, { params, body }) =>
      sendForAcknowledgement(deps, caller, {
        documentId: params.documentId,
        audience: body.audience,
        dueOn: body.dueOn,
      }),
  }),
  route({
    name: 'acknowledgeDocument',
    method: 'POST',
    path: `${V1}/campaigns/{campaignId}/acknowledge`,
    summary: 'I have read it',
    params: z.object({ campaignId: z.uuid() }),
    answer: Created,
    run: (deps, caller, { params }) => acknowledge(deps, caller, params.campaignId),
  }),
  route({
    name: 'documentsCampaign',
    method: 'GET',
    path: `${V1}/campaigns/{campaignId}`,
    summary: 'Who has acknowledged a policy, and who is left (F3)',
    params: z.object({ campaignId: z.uuid() }),
    answer: z
      .object({
        id: z.string(),
        documentId: z.string(),
        title: z.string(),
        version: z.int(),
        dueOn: z.string().nullable(),
        sentAt: z.string(),
        done: z.int(),
        of: z.int(),
        left: z.array(
          z.object({ personId: z.string(), name: z.string(), teamName: z.string().nullable() }),
        ),
      })
      .meta({ title: 'DocumentsCampaign' }),
    run: (deps, caller, { params }) => campaignScreen(deps, caller, params.campaignId),
  }),
  /* ----------------------------------------------- Kithena reading (PRD §14) -- */
  route({
    name: 'documentSummary',
    method: 'GET',
    path: `${V1}/d/{documentId}/summary`,
    summary: 'The document in plain words, each claim cited to its page (D1)',
    params: DocParams,
    answer: SummaryView,
    run: (deps, caller, { params }) => summarize(deps, caller, params.documentId),
  }),
  route({
    name: 'askDocument',
    method: 'POST',
    model: true,
    path: `${V1}/d/{documentId}/ask`,
    summary: 'A question about this document, answered from its pages (D2)',
    params: DocParams,
    body: z.strictObject({ question: z.string().max(500) }),
    answer: AnswerView,
    run: (deps, caller, { params, body }) =>
      askAbout(deps, caller, params.documentId, body.question),
  }),
  route({
    name: 'askDocuments',
    method: 'POST',
    model: true,
    path: `${V1}/ask`,
    summary: 'A question across the documents you can open (B4)',
    body: z.strictObject({ question: z.string().max(500) }),
    answer: AnswerView,
    run: (deps, caller, { body }) => askAcross(deps, caller, body.question),
  }),
  route({
    name: 'compareDocumentVersions',
    method: 'GET',
    path: `${V1}/d/{documentId}/compare/{from}/{to}`,
    summary: 'What changed between two versions (D3)',
    params: z.object({
      documentId: DocumentId,
      from: z.coerce.number().int().positive(),
      to: z.coerce.number().int().positive(),
    }),
    answer: CompareView,
    run: (deps, caller, { params }) =>
      compareVersions(deps, caller, params.documentId, params.from, params.to),
  }),
  route({
    name: 'suggestDocumentFiling',
    method: 'POST',
    model: true,
    path: `${V1}/uploads/{uploadId}/suggest`,
    summary: 'What an upload looks like it is: a type, a person, a name and an expiry (C1)',
    params: z.object({ uploadId: z.uuid() }),
    body: z.strictObject({ name: z.string().trim().min(1).max(255) }),
    answer: z
      .object({
        available: z.boolean(),
        title: z.string().nullable(),
        typeKey: z.string().nullable(),
        subjectPersonId: z.string().nullable(),
        expiresOn: z.string().nullable(),
      })
      .meta({ title: 'DocumentsFilingSuggestion' }),
    run: (deps, caller, { params, body }) =>
      suggestFiling(deps, caller, { uploadId: params.uploadId, name: body.name }),
  }),
  route({
    name: 'describeDocumentType',
    method: 'POST',
    model: true,
    path: `${V1}/types/describe`,
    summary: 'A type described in words, drafted as its settings for HR to save (S4)',
    body: z.strictObject({ text: z.string().max(1000) }),
    answer: z
      .object({
        available: z.boolean(),
        type: DocumentTypeDefinition.nullable(),
        question: z.string().nullable(),
      })
      .meta({ title: 'DocumentsTypeDraft' }),
    run: (deps, caller, { body }) => describeType(deps, caller, body.text),
  }),
  route({
    name: 'readDocumentFields',
    method: 'POST',
    model: true,
    path: `${V1}/d/{documentId}/fields`,
    summary:
      'Values read from the document, each with its page: the names asked, or its type’s (G5)',
    params: DocParams,
    body: z.strictObject({
      names: z.array(z.string().trim().min(1).max(80)).max(40).nullable().default(null),
    }),
    answer: z
      .object({
        available: z.boolean(),
        fields: z.array(z.object({ name: z.string(), value: z.string(), page: z.int() })),
      })
      .meta({ title: 'DocumentsFields' }),
    run: (deps, caller, { params, body }) =>
      readFields(deps, caller, params.documentId, body.names),
  }),
  route({
    name: 'setDocumentsAiSettings',
    method: 'PUT',
    path: `${V1}/settings/ai`,
    summary: 'Switch Kithena’s reading features on or off (S7)',
    body: SettingsView.shape.ai.partial().strict(),
    answer: Done,
    run: (deps, caller, { body }) => setAiSettings(deps, caller, body),
  }),
  /* ------------------------------------------------- splitting a scan (C2) -- */
  route({
    name: 'proposeDocumentSplit',
    method: 'POST',
    model: true,
    path: `${V1}/split`,
    summary: 'Where each document in a scanned stack starts, what it is and whom it is about (C2)',
    body: z.strictObject({ ...OneFile }),
    answer: z
      .object({
        available: z.boolean(),
        pages: z.int(),
        parts: z.array(SplitPart),
      })
      .meta({ title: 'DocumentsSplitProposal' }),
    run: async (deps, caller, { body }) => {
      // Read, not consumed: the same upload is filed once HR has checked the parts.
      const got = await fileOf(deps, caller, body);
      return got.ok ? proposeSplit(deps, caller, got.value.file) : got;
    },
  }),
  route({
    name: 'fileDocumentSplit',
    method: 'POST',
    path: `${V1}/split/file`,
    summary: 'File each part of a scanned stack as a document of its own (C2)',
    body: z.strictObject({ parts: z.array(SplitPart).min(1).max(50), ...OneFile }),
    answer: z.object({ ids: z.array(z.string()) }).meta({ title: 'DocumentsSplitFiled' }),
    status: 201,
    run: (deps, caller, { body }) =>
      withFile(deps, caller, body, (file) => fileSplit(deps, caller, file, body.parts)),
  }),
  /* ------------------------------------------- letters from a template (G3) -- */
  route({
    name: 'documentTemplate',
    method: 'GET',
    path: `${V1}/d/{documentId}/template`,
    summary: 'A Template document’s text and the fields it asks for (G3)',
    params: DocParams,
    answer: z
      .object({ title: z.string(), text: z.string(), fields: z.array(z.string()) })
      .meta({ title: 'DocumentsTemplate' }),
    run: (deps, caller, { params }) => readTemplate(deps, caller, params.documentId),
  }),
  route({
    name: 'generateLetters',
    method: 'POST',
    path: `${V1}/d/{documentId}/letters`,
    summary:
      'A letter per person from a template, filed to each and, when asked, sent to sign (G3)',
    params: DocParams,
    body: z.strictObject({
      title: z.string().trim().min(1).max(200),
      letters: z
        .array(
          z.strictObject({
            personId: PersonId,
            values: z.record(z.string().max(200), z.string().max(2000)),
          }),
        )
        .min(1)
        .max(100),
      sign: z.boolean().default(false),
      ...OriginBody,
    }),
    answer: z.object({ ids: z.array(z.string()) }).meta({ title: 'DocumentsLetters' }),
    status: 201,
    run: (deps, caller, { params, body }) =>
      generateLetters(deps, caller, { templateId: params.documentId, ...body }),
  }),
  /* -------------------------------------- drafted with Kithena (§14.2) -- */
  route({
    name: 'draftDocument',
    method: 'POST',
    model: true,
    path: `${V1}/drafts/turn`,
    summary: 'One turn of drafting a document with Kithena: its reply, and the draft so far',
    body: DraftTurn.extend({ companyName: OriginBody.companyName }),
    answer: DraftView,
    run: (deps, caller, { body }) => draftDocument(deps, caller, body),
  }),
  route({
    name: 'fileDraft',
    method: 'POST',
    path: `${V1}/drafts`,
    summary: 'A drafted document drawn as a PDF, filed and, when asked, sent to sign',
    body: z.strictObject({
      title: z.string().trim().min(1).max(200),
      typeKey: z.string().max(80).nullable(),
      aboutPersonId: PersonId.nullable(),
      body: z.string().trim().min(1).max(20_000),
      signers: z
        .array(
          DraftSigner.omit({ email: true }).extend({
            personId: PersonId.nullable(),
            email: z.string().trim().max(254).nullable(),
          }),
        )
        .max(10),
      send: z.boolean(),
      ...OriginBody,
    }),
    answer: z
      .object({ id: z.string(), envelopeId: z.string().nullable() })
      .meta({ title: 'DocumentsDraftFiled' }),
    status: 201,
    run: (deps, caller, { body }) => fileDraft(deps, caller, body),
  }),
];

/* ----------------------------------------------------------- dispatcher -- */

const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  NOT_ENTITLED: 403,
  FORBIDDEN: 403,
  ABOUT_YOU: 403,
  HR_PROTECTED: 403,
  HR_ONLY_EVERYONE: 403,
  CONFIDENTIAL: 403,
  NOT_FOUND: 404,
  CODE_LOCKED: 429,
  NOT_YOUR_TURN: 409,
  ALREADY_OUT: 409,
  GONE: 410,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  LEGAL_HOLD: 409,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  TOO_LARGE: 413,
  UNAVAILABLE: 503,
};

export function refused(error: DomainFailure): RestResponse {
  return {
    status: STATUS[error.code] ?? 422,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.path ? { path: error.path } : {}),
      },
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  return err(failure('BAD_REQUEST', issue?.message ?? 'invalid request', issue?.path.map(String)));
}

function base(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (;;) {
    const def = s._zod.def as { type: string; innerType?: z.ZodType };
    if (
      def.innerType === undefined ||
      !['optional', 'nullable', 'default', 'prefault'].includes(def.type)
    )
      return s;
    s = def.innerType;
  }
}

/** Query and path text as the parameter's own type: `true`, `2`. */
function coerce(params: z.ZodObject, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, text] of Object.entries(raw)) {
    const field = params.shape[key] as z.ZodType | undefined;
    const type = field === undefined ? 'string' : (base(field)._zod.def as { type: string }).type;
    out[key] =
      type === 'boolean'
        ? text === 'true'
          ? true
          : text === 'false'
            ? false
            : text
        : type === 'number' && text.trim() !== '' && !Number.isNaN(Number(text))
          ? Number(text)
          : text;
  }
  return out;
}

const escape = (s: string) => s.replaceAll(/[.*+?^$()|[\]\\]/gu, '\\$&');

interface Compiled {
  readonly route: Route;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

function compile(r: Route): Compiled {
  const names: string[] = [];
  const source = r.path
    .split(/(\{[a-zA-Z]+\})/u)
    .map((part) => {
      const name = /^\{([a-zA-Z]+)\}$/u.exec(part)?.[1];
      if (name === undefined) return escape(part);
      names.push(name);
      return '([^/]+)';
    })
    .join('');
  return { route: r, pattern: new RegExp(`^${source}$`, 'u'), names };
}

class Raced extends Error {}

/**
 * The write's unit of work, saving the key and its answer in the write's one
 * transaction. Every write here commits in one: bytes are stored before it.
 */
function keyed(uow: UnitOfWork, key: string, stored: (value: unknown) => StoredKey): UnitOfWork {
  let saved = false;
  return {
    run: (tenantId, fn) =>
      uow.run(tenantId, async (tx) => {
        const value = await fn(tx);
        // A refusal writes nothing and keeps no key, so the same key may try again.
        const succeeded = (value as { ok?: unknown } | null)?.ok === true;
        if (!saved && succeeded) {
          if (!(await tx.idempotency.save(key, stored(value)))) throw new Raced();
          saved = true;
        }
        return value;
      }),
  };
}

const KEY_REUSED = failure('IDEMPOTENCY_KEY_REUSED', 'This key was used for a different request');

export function restHandler(
  rest: RestDeps,
): (request: RestRequest) => Promise<RestResponse | null> {
  const compiled = ROUTES.map(compile);
  const { deps } = rest;

  const answer = (r: Route, result: Result<unknown>): RestResponse =>
    result.ok ? { status: r.status, body: r.shape(result.value) } : refused(result.error);

  return async (request) => {
    const url = new URL(request.url, 'http://documents.internal');
    if (!url.pathname.startsWith(`${V1}/`)) return null;
    const matching = compiled.filter((c) => c.pattern.test(url.pathname));
    if (matching.length === 0) return refused(failure('NOT_FOUND', 'No such route'));
    const found = matching.find((c) => c.route.method === request.method);
    if (found === undefined) {
      return {
        status: 405,
        body: { error: { code: 'METHOD_NOT_ALLOWED', message: request.method } },
      };
    }
    const r = found.route;
    const values = found.pattern.exec(url.pathname) ?? [];
    const raw: Record<string, string> = {};
    found.names.forEach((name, i) => {
      raw[name] = decodeURIComponent(values[i + 1] ?? '');
    });
    if (r.method === 'GET') for (const [k, v] of url.searchParams) raw[k] ??= v;
    const params = parse(r.params, coerce(r.params, raw));
    if (!params.ok) return refused(params.error);

    if (r.public) {
      let body: unknown;
      if (r.body !== null) {
        let json: unknown;
        try {
          json = request.body === '' ? {} : JSON.parse(request.body);
        } catch {
          return refused(failure('BAD_REQUEST', 'The body is not JSON'));
        }
        const parsed = parse(r.body, json);
        if (!parsed.ok) return refused(parsed.error);
        body = parsed.value;
      }
      const nobody = {
        tenantId: '' as Caller['tenantId'],
        accountId: '',
        personId: null,
        correlationId: '',
      };
      return answer(r, await r.run(deps, nobody, { params: params.value, body }));
    }
    const caller = await rest.callerFrom(request);
    if (!caller.ok) return refused(caller.error);

    const writes = r.method !== 'GET';
    const key = request.headers['idempotency-key'];
    if (writes && (typeof key !== 'string' || key.length === 0 || key.length > 255)) {
      return refused(
        failure('IDEMPOTENCY_KEY_REQUIRED', 'Every write carries an Idempotency-Key header'),
      );
    }
    let body: unknown;
    if (r.body !== null) {
      let json: unknown;
      try {
        json = request.body === '' ? {} : JSON.parse(request.body);
      } catch {
        return refused(failure('BAD_REQUEST', 'The body is not JSON'));
      }
      const parsed = parse(r.body, json);
      if (!parsed.ok) return refused(parsed.error);
      body = parsed.value;
    }
    const input = { params: params.value, body };
    if (!writes || typeof key !== 'string' || !r.keep)
      return answer(r, await r.run(deps, caller.value, input));

    const tenantId = caller.value.tenantId;
    const requestHash = createHash('sha256')
      .update(
        `${caller.value.accountId}\n${request.method} ${url.pathname}${url.search}\n${request.body}`,
      )
      .digest('hex');
    const replay = async (): Promise<RestResponse | null> => {
      const prior = await deps.uow.run(tenantId, (tx) => tx.idempotency.find(key));
      if (prior === null) return null;
      return prior.requestHash === requestHash
        ? { status: prior.status, body: prior.answer }
        : refused(KEY_REUSED);
    };
    const before = await replay();
    if (before !== null) return before;
    try {
      const result = await r.run(
        {
          ...deps,
          uow: keyed(deps.uow, key, (value) => ({
            requestHash,
            status: r.status,
            answer: JSON.parse(
              JSON.stringify(r.shape((value as { value: unknown }).value) ?? null),
            ) as unknown,
          })),
        },
        caller.value,
        input,
      );
      return answer(r, result);
    } catch (error) {
      if (!(error instanceof Raced)) throw error;
      return (await replay()) ?? refused(KEY_REUSED);
    }
  };
}
