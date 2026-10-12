import * as z from 'zod';
import { DocumentKind, DocumentTypeDefinition } from '@kithena/contracts';

/**
 * The view models Documents' screens render from (DOC-021): one per screen,
 * each answering the whole screen in one read. REST answers with them and the
 * subgraph's output types are generated from them, so each is written once.
 *
 * These are answers to a person who may open what they hold, so their fields
 * are not event payloads and carry no classification; the routes are the
 * boundary.
 */

const Title = (title: string) => ({ title });

export const PersonRef = z
  .object({ personId: z.string(), name: z.string(), teamName: z.string().nullable() })
  .meta(Title('DocumentsPerson'));

export const Who = z
  .object({
    /** "You and HR", "Everyone at Acme", "Marco, Omar" (whoTxt in the design). */
    label: z.string(),
    people: z.array(PersonRef),
  })
  .meta(Title('DocumentsWho'));

export const Status = z
  .object({
    label: z.string(),
    tone: z.enum(['accent', 'success', 'warning', 'danger', 'info', 'neutral']),
  })
  .meta(Title('DocumentsStatus'));

export const DocumentRow = z
  .object({
    id: z.string(),
    title: z.string(),
    kind: DocumentKind,
    typeKey: z.string().nullable(),
    typeName: z.string().nullable(),
    level: z.enum(['private', 'shared']),
    confidential: z.boolean(),
    everyone: z.boolean(),
    who: Who,
    subject: PersonRef.nullable(),
    pages: z.int().nullable(),
    updatedAt: z.string(),
    expiresOn: z.string().nullable(),
    status: Status.nullable(),
    mine: z.boolean(),
    aboutMe: z.boolean(),
    deletedAt: z.string().nullable(),
    sectionIds: z.array(z.string()),
  })
  .meta(Title('DocumentsRow'));
export type DocumentRow = z.infer<typeof DocumentRow>;

export const SectionView = z
  .object({
    id: z.string(),
    kind: z.enum(['company', 'personal']),
    name: z.string(),
    count: z.int(),
  })
  .meta(Title('DocumentsSection'));

export const NeedsYou = z
  .object({
    id: z.string(),
    kind: z.enum(['request', 'access_request', 'sign', 'acknowledge']),
    title: z.string(),
    detail: z.string(),
    dueOn: z.string().nullable(),
    documentId: z.string().nullable(),
    typeKey: z.string().nullable(),
  })
  .meta(Title('DocumentsNeedsYou'));

export const Tile = z
  .object({
    key: z.enum(['to_sign', 'expiring', 'missing', 'to_delete']),
    label: z.string(),
    count: z.int(),
    detail: z.string(),
  })
  .meta(Title('DocumentsTile'));

export const QueueRow = z
  .object({
    id: z.string(),
    title: z.string(),
    kind: DocumentKind,
    person: PersonRef.nullable(),
    detail: z.string(),
    dueOn: z.string().nullable(),
    tone: z.enum(['accent', 'success', 'warning', 'danger', 'info', 'neutral']),
    documentId: z.string().nullable(),
    requestId: z.string().nullable(),
    typeKey: z.string().nullable(),
    action: z.enum(['view', 'ask', 'remind', 'confirm_delete', 'sign']),
  })
  .meta(Title('DocumentsQueueRow'));

export const TypeOption = z
  .object({
    key: z.string(),
    name: z.string(),
    kind: DocumentKind,
    filedTo: z.enum(['person', 'company']),
    confidential: z.boolean(),
  })
  .meta(Title('DocumentsTypeOption'));

export const LibraryView = z
  .object({
    viewer: z.object({
      hr: z.boolean(),
      name: z.string().nullable(),
      personId: z.string().nullable(),
      askAfterUpload: z.boolean(),
    }),
    show: z.string(),
    q: z.string(),
    queue: z.string().nullable(),
    deleted: z.boolean(),
    sections: z.array(SectionView),
    needsYou: z.array(NeedsYou),
    tiles: z.array(Tile),
    queueRows: z.array(QueueRow),
    rows: z.array(DocumentRow),
    total: z.int(),
    types: z.array(TypeOption),
    people: z.array(PersonRef),
  })
  .meta(Title('DocumentsLibrary'));
export type LibraryView = z.infer<typeof LibraryView>;

export const VersionView = z
  .object({
    n: z.int(),
    fileName: z.string(),
    mediaType: z.string(),
    size: z.int(),
    pages: z.int().nullable(),
    note: z.string().nullable(),
    uploadedAt: z.string(),
    uploadedBy: z.string().nullable(),
  })
  .meta(Title('DocumentsVersion'));

export const GrantView = z
  .object({
    kind: z.enum(['member', 'team', 'everyone']),
    id: z.string(),
    label: z.string(),
    permission: z.enum(['view', 'edit']),
    endsOn: z.string().nullable(),
  })
  .meta(Title('DocumentsGrant'));

export const LogEntry = z
  .object({ who: z.string(), action: z.string(), at: z.string() })
  .meta(Title('DocumentsLogEntry'));

export const DocumentView = z
  .object({
    row: DocumentRow,
    owner: z.string(),
    versions: z.array(VersionView),
    current: VersionView,
    grants: z.array(GrantView),
    may: z.object({
      edit: z.boolean(),
      share: z.boolean(),
      download: z.boolean(),
      delete: z.boolean(),
      protect: z.boolean(),
      unprotect: z.boolean(),
    }),
    confidentialBy: z.enum(['owner', 'hr', 'type']).nullable(),
    views: z.array(LogEntry),
    activity: z.array(LogEntry),
    accessRequests: z.array(
      z.object({ id: z.string(), who: z.string(), reason: z.string(), at: z.string() }),
    ),
    held: z.boolean(),
    people: z.array(PersonRef),
    /** The latest signature request on it, if any (K8). */
    signing: z
      .object({
        id: z.string(),
        status: z.string(),
        signed: z.int(),
        of: z.int(),
        mine: z.boolean(),
      })
      .nullable(),
    /** Its policy campaigns, for HR (F3); this person's own, to acknowledge. */
    campaigns: z.array(
      z.object({
        id: z.string(),
        done: z.int(),
        of: z.int(),
        dueOn: z.string().nullable(),
        acknowledged: z.boolean(),
        asked: z.boolean(),
      }),
    ),
    pdf: z.boolean(),
  })
  .meta(Title('DocumentsDocument'));
export type DocumentView = z.infer<typeof DocumentView>;

/** What someone who cannot open it sees (E3): its owner, never its title. */
export const ClosedView = z
  .object({ owner: z.string(), requested: z.boolean() })
  .meta(Title('DocumentsClosed'));

export const OpenOrClosed = z
  .object({ document: DocumentView.nullable(), closed: ClosedView.nullable() })
  .meta(Title('DocumentsOpenOrClosed'));

export const ChecklistRowView = z
  .object({
    typeKey: z.string(),
    name: z.string(),
    kind: DocumentKind,
    state: z.enum(['have', 'expired', 'asked', 'missing']),
    detail: z.string(),
    documentId: z.string().nullable(),
    requestId: z.string().nullable(),
    dueOn: z.string().nullable(),
    action: z.enum(['view', 'remind', 'ask']),
  })
  .meta(Title('DocumentsChecklistRow'));

export const PersonFileView = z
  .object({
    person: PersonRef,
    jobLine: z.string(),
    hireDate: z.string().nullable(),
    checklist: z.array(ChecklistRowView),
    have: z.int(),
    of: z.int(),
    rows: z.array(DocumentRow),
    hr: z.boolean(),
    types: z.array(TypeOption),
  })
  .meta(Title('DocumentsPersonFile'));

export const TypeView = DocumentTypeDefinition.extend({
  archived: z.boolean(),
  used: z.int(),
  retentionWords: z.string(),
}).meta(Title('DocumentsType'));

export const HoldView = z
  .object({
    id: z.string(),
    name: z.string(),
    setBy: z.string(),
    setAt: z.string(),
    count: z.int(),
  })
  .meta(Title('DocumentsHold'));

export const SettingsView = z
  .object({
    types: z.array(TypeView),
    sections: z.array(SectionView),
    access: z.object({
      askAfterUpload: z.boolean(),
      peopleMayTurnOffQuestion: z.boolean(),
      everyoneShare: z.enum(['hr', 'anyone']),
      companyLinks: z.boolean(),
      outsideSharing: z.boolean(),
      watermark: z.boolean(),
      blockDownload: z.boolean(),
      personalSections: z.boolean(),
    }),
    holds: z.array(HoldView),
    hr: z.boolean(),
  })
  .meta(Title('DocumentsSettings'));
