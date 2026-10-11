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
    readonly kind: 'request' | 'access_request';
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
