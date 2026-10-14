/**
 * What Documents answers each screen with, as the remote reads it: the
 * service's view models (`services/documents/src/application/views.ts`),
 * restated here because a remote imports no service. Plain JSON.
 */

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type Kind =
  | 'Contract'
  | 'Policy'
  | 'Payslip'
  | 'Letter'
  | 'ID'
  | 'Personal'
  | 'Medical'
  | 'Sheet'
  | 'Template'
  | 'Permit'
  | 'Form';

export interface PersonRef {
  readonly personId: string;
  readonly name: string;
  readonly teamName: string | null;
}

export interface Row {
  readonly id: string;
  readonly title: string;
  readonly kind: Kind;
  readonly typeKey: string | null;
  readonly typeName: string | null;
  readonly level: 'private' | 'shared';
  readonly confidential: boolean;
  readonly everyone: boolean;
  readonly who: { readonly label: string; readonly people: readonly PersonRef[] };
  readonly subject: PersonRef | null;
  readonly pages: number | null;
  /** The current version's. */
  readonly mediaType: string | null;
  readonly updatedAt: string;
  readonly expiresOn: string | null;
  readonly status: { readonly label: string; readonly tone: Tone } | null;
  readonly mine: boolean;
  readonly aboutMe: boolean;
  readonly deletedAt: string | null;
  readonly sectionIds: readonly string[];
}

export interface Section {
  readonly id: string;
  readonly kind: 'company' | 'personal';
  readonly name: string;
  readonly count: number;
}

export interface TypeOption {
  readonly key: string;
  readonly name: string;
  readonly kind: Kind;
  readonly filedTo: 'person' | 'company';
  readonly confidential: boolean;
}

export type QueueKey = 'to_sign' | 'expiring' | 'missing' | 'to_delete';

export interface LibraryData {
  readonly viewer: {
    readonly hr: boolean;
    readonly name: string | null;
    readonly personId: string | null;
    readonly askAfterUpload: boolean;
  };
  readonly show: string;
  readonly q: string;
  readonly queue: QueueKey | null;
  readonly deleted: boolean;
  readonly sections: readonly Section[];
  readonly needsYou: readonly {
    readonly id: string;
    readonly kind: 'request' | 'access_request' | 'sign' | 'acknowledge';
    readonly title: string;
    readonly detail: string;
    readonly dueOn: string | null;
    readonly documentId: string | null;
    readonly typeKey: string | null;
  }[];
  readonly tiles: readonly {
    readonly key: QueueKey;
    readonly label: string;
    readonly count: number;
    readonly detail: string;
  }[];
  readonly queueRows: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: Kind;
    readonly person: PersonRef | null;
    readonly detail: string;
    readonly dueOn: string | null;
    readonly tone: Tone;
    readonly documentId: string | null;
    readonly requestId: string | null;
    readonly typeKey: string | null;
    readonly action: 'view' | 'ask' | 'remind' | 'confirm_delete' | 'sign';
  }[];
  readonly rows: readonly Row[];
  readonly total: number;
  readonly types: readonly TypeOption[];
  readonly people: readonly PersonRef[];
}

export interface VersionView {
  readonly n: number;
  readonly fileName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly pages: number | null;
  readonly note: string | null;
  readonly uploadedAt: string;
  readonly uploadedBy: string | null;
}

export interface DocumentData {
  readonly document: {
    readonly row: Row;
    readonly owner: string;
    readonly versions: readonly VersionView[];
    readonly current: VersionView;
    readonly grants: readonly {
      readonly kind: 'member' | 'team' | 'everyone';
      readonly id: string;
      readonly label: string;
      readonly permission: 'view' | 'edit';
      readonly endsOn: string | null;
    }[];
    readonly may: {
      readonly edit: boolean;
      readonly share: boolean;
      readonly download: boolean;
      readonly delete: boolean;
      readonly protect: boolean;
      readonly unprotect: boolean;
    };
    readonly confidentialBy: 'owner' | 'hr' | 'type' | null;
    readonly views: readonly {
      readonly who: string;
      readonly action: string;
      readonly at: string;
    }[];
    readonly activity: readonly {
      readonly who: string;
      readonly action: string;
      readonly at: string;
    }[];
    readonly accessRequests: readonly {
      readonly id: string;
      readonly who: string;
      readonly reason: string;
      readonly at: string;
    }[];
    readonly held: boolean;
    /** Who it could be shared with; empty unless this viewer shares it. */
    readonly people: readonly PersonRef[];
    readonly signing: {
      readonly id: string;
      readonly status: string;
      readonly signed: number;
      readonly of: number;
      readonly mine: boolean;
    } | null;
    readonly campaigns: readonly {
      readonly id: string;
      readonly done: number;
      readonly of: number;
      readonly dueOn: string | null;
      readonly acknowledged: boolean;
      readonly asked: boolean;
    }[];
    readonly pdf: boolean;
  } | null;
  readonly closed: { readonly owner: string; readonly requested: boolean } | null;
}

export interface PersonFileData {
  readonly person: PersonRef;
  readonly jobLine: string;
  readonly hireDate: string | null;
  readonly checklist: readonly {
    readonly typeKey: string;
    readonly name: string;
    readonly kind: Kind;
    readonly state: 'have' | 'expired' | 'asked' | 'missing';
    readonly detail: string;
    readonly documentId: string | null;
    readonly requestId: string | null;
    readonly dueOn: string | null;
    readonly action: 'view' | 'remind' | 'ask';
  }[];
  readonly have: number;
  readonly of: number;
  readonly rows: readonly Row[];
  readonly hr: boolean;
  readonly types: readonly TypeOption[];
}

export type Retention =
  | { readonly kind: 'after_leaving'; readonly years: number }
  | { readonly kind: 'until_leaving'; readonly plusYears: number }
  | { readonly kind: 'years'; readonly years: number }
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'forever' };

export interface DocumentType {
  readonly key: string;
  readonly name: string;
  readonly kind: Kind;
  readonly filedTo: 'person' | 'company';
  readonly audience: 'subject' | 'everyone' | 'hr';
  readonly confidential: boolean;
  readonly medical: boolean;
  readonly signers: readonly ('subject' | 'hr')[];
  readonly acknowledge: boolean;
  readonly requiredFor: 'new_starters' | 'everyone' | null;
  readonly requiredBy: number;
  readonly expiryReminders: readonly number[];
  readonly retention: Retention;
  readonly aiReads: readonly string[];
  readonly aiEnabled: boolean;
}

export interface SettingsData {
  readonly types: readonly (DocumentType & {
    readonly archived: boolean;
    readonly used: number;
    readonly retentionWords: string;
  })[];
  readonly sections: readonly Section[];
  readonly access: {
    readonly askAfterUpload: boolean;
    readonly peopleMayTurnOffQuestion: boolean;
    readonly everyoneShare: 'hr' | 'anyone';
    readonly companyLinks: boolean;
    readonly outsideSharing: boolean;
    readonly watermark: boolean;
    readonly blockDownload: boolean;
    readonly personalSections: boolean;
  };
  readonly holds: readonly {
    readonly id: string;
    readonly name: string;
    readonly setBy: string;
    readonly setAt: string;
    readonly count: number;
  }[];
  readonly ai: AiSettings;
  readonly hr: boolean;
}

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };
export type Created =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly message: string };

export interface FileRef {
  readonly uploadId: string;
  readonly name: string;
  readonly mediaType: string;
}

export type StartUpload = (file: { name: string; mediaType: string; size: number }) => Promise<
  | {
      readonly ok: true;
      readonly put: {
        readonly uploadId: string;
        readonly url: string;
        readonly method: 'PUT';
        readonly headers: Readonly<Record<string, string>>;
      };
    }
  | { readonly ok: false; readonly message: string }
>;

export type FileLink = (
  documentId: string,
  mode: 'view' | 'download',
  version?: number | null,
) => Promise<
  | {
      readonly ok: true;
      readonly url: string;
      readonly fileName: string;
      readonly mediaType: string;
    }
  | { readonly ok: false; readonly message: string }
>;

export interface GrantInput {
  readonly grantee:
    | { readonly kind: 'member'; readonly personId: string }
    | { readonly kind: 'team'; readonly teamKey: string }
    | { readonly kind: 'everyone' };
  readonly permission: 'view' | 'edit';
  readonly endsOn: string | null;
}

export type SignerStatus = 'waiting' | 'sent' | 'opened' | 'verified' | 'signed' | 'declined';
export type FieldKind = 'signature' | 'initials' | 'date' | 'name' | 'title' | 'checkbox' | 'text';

export interface EnvelopeData {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly version: number;
  readonly pages: number;
  readonly status: 'sent' | 'completed' | 'declined' | 'voided';
  readonly message: string;
  readonly dueOn: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly signedVersion: number | null;
  readonly sender: string;
  readonly voidReason: string | null;
  readonly follows: boolean;
  readonly signers: readonly {
    readonly id: string;
    readonly order: number;
    readonly name: string;
    readonly email: string | null;
    readonly check: 'login' | 'email_code';
    readonly status: SignerStatus;
    readonly signedAt: string | null;
    readonly allowDelegate: boolean;
  }[];
  readonly fields: readonly {
    readonly id: string;
    readonly signerId: string;
    readonly kind: FieldKind;
    readonly page: number;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly required: boolean;
    readonly label: string | null;
    readonly value: string | null;
  }[];
  readonly me: {
    readonly signerId: string;
    readonly status: string;
    readonly turn: boolean;
  } | null;
  readonly trail: readonly {
    readonly who: string;
    readonly action: string;
    readonly at: string;
    readonly note: string | null;
  }[];
  readonly people: readonly { readonly personId: string; readonly name: string }[];
  /**
   * The signer's own signature, where People keeps one (the shell joins it):
   * signed with when on file, and kept from this signing when there is none.
   */
  /** The signer's legal first and last name, from People: what a typed signature says. */
  readonly legalName?: string | null;
  readonly signature?: {
    readonly mark: Mark | null;
    readonly canKeep: boolean;
    readonly pending: boolean;
  } | null;
}

export interface EnvelopesData {
  readonly rows: readonly {
    readonly id: string;
    readonly documentId: string;
    readonly title: string;
    readonly status: 'sent' | 'completed' | 'declined' | 'voided';
    readonly signed: number;
    readonly of: number;
    readonly waitingOn: string | null;
    readonly dueOn: string | null;
    readonly createdAt: string;
    readonly needsYou: boolean;
  }[];
}

export interface CampaignData {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly version: number;
  readonly dueOn: string | null;
  readonly sentAt: string;
  readonly done: number;
  readonly of: number;
  readonly left: readonly PersonRef[];
}

/** A signature: typed in one of three handwriting faces, or drawn (`@kithena/contracts`). */
export type Mark =
  | {
      readonly kind: 'typed';
      readonly text: string;
      readonly style?: 'flowing' | 'light' | 'bold';
    }
  | { readonly kind: 'drawn'; readonly path: string };

/* -------------------------------------------------- Kithena reading -- */

/** A server action's answer: the data, or why not. */
export type Read<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly message: string };

/** A sentence and the pages it comes from: every claim Kithena makes carries one. */
export interface Cited {
  readonly text: string;
  readonly pages: readonly number[];
}

export interface Summary {
  readonly available: boolean;
  readonly reason: string | null;
  readonly summary: readonly Cited[];
  readonly facts: readonly {
    readonly label: string;
    readonly value: string;
    readonly page: number;
  }[];
  readonly watch: Cited | null;
  readonly questions: readonly string[];
  readonly dates: readonly string[];
}

export interface Answer {
  readonly available: boolean;
  readonly reason: string | null;
  readonly answer: readonly Cited[];
  readonly sources: readonly {
    readonly documentId: string;
    readonly title: string;
    readonly pages: readonly number[];
  }[];
}

export interface Comparison {
  readonly available: boolean;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly sentences: readonly string[];
}

export interface FilingSuggestion {
  readonly available: boolean;
  readonly title: string | null;
  readonly typeKey: string | null;
  readonly subjectPersonId: string | null;
  readonly expiresOn: string | null;
}

export interface TypeDraft {
  readonly available: boolean;
  readonly type: DocumentType | null;
  readonly question: string | null;
}

export type AiFeature = 'summaries' | 'questions' | 'across' | 'sorting' | 'fields' | 'photos';
export type AiSettings = Readonly<Record<AiFeature, boolean>>;
