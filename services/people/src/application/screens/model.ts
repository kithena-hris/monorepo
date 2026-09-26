/**
 * What the People screens are drawn from, as this module computes it (PEO-098).
 *
 * The remote (`apps/web/people`) defines the same shapes for itself, because
 * a remote may not import anything that talks to a server; these are the
 * producing side. They are view models: every one is built from a read that
 * has already been through the application layer's authorization, so a field
 * the viewer may not read is not in them at all.
 *
 * `apps/web/people/src/*` has the reading side of each, named the same.
 */

export type ViewerScope =
  'self' | 'manager' | 'manager_chain' | 'hr' | 'finance' | 'admin' | 'directory';

/** A value as a form holds it. Money is minor units in a string, never a float. */
export type FormValue =
  | string
  | boolean
  | readonly string[]
  | { readonly amountMinor: string; readonly currency: string }
  | { readonly last4: string | null }
  | null;

export type FormValues = Readonly<Record<string, FormValue>>;

export interface RecordField {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly currency?: string;
  readonly ownedBy?: string;
  /** A change to it waits for HR's approval (PEO-077): marked wherever the field is drawn. */
  readonly sensitive: boolean;
  /**
   * The upstream system that is the source of record for it on this person
   * (PEO-073): read-only for everybody here, changed there.
   */
  readonly keptIn?: string;
}

/**
 * A value waiting for HR's approval (PEO-077), on a field the viewer reads:
 * never the field's value, which stays what is in force. Masked as the field
 * is — a sealed one reads `{ last4 }`.
 */
export interface PendingFieldView {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly kind: 'value' | 'correction';
  readonly value: FormValue;
  /** When it takes effect once approved. */
  readonly effectiveFrom: string;
  readonly requestedAt: string;
  /** Undecided by then, it expires. */
  readonly expiresAt: string;
  /** Who asked, in words the viewer may read. */
  readonly requestedBy: string;
  readonly reason: string | null;
  /** The viewer asked, so may withdraw it. */
  readonly mine: boolean;
  /** The viewer holds HR and is neither the requester nor the person. */
  readonly canDecide: boolean;
  /** The viewer asked and is the only HR member: they approve it alone, once they confirm. */
  readonly canSelfApprove: boolean;
  /** A doubted national identifier: nobody approves it until HR accepts its review (PEO-125). */
  readonly awaitingReview: boolean;
  /** What the checks doubted, while it awaits review. Never the value. */
  readonly findings: readonly {
    readonly level: string;
    readonly code: string;
    readonly message: string;
  }[];
}

export interface RecordSection {
  readonly key: string;
  readonly label: string;
  readonly visibility: readonly ViewerScope[];
  readonly fields: readonly RecordField[];
}

/**
 * What a country check found on one national identifier a form carried
 * (PEO-125): a warning, never a refusal. The message never repeats the value.
 */
export interface IdentifierFindingView {
  readonly key: string;
  readonly label: string;
  readonly level: 'attention' | 'mismatch';
  readonly code: string;
  readonly message: string;
  /** `pending`: HR will review it. `accepted`: HR already accepted this value. */
  readonly review: 'pending' | 'accepted' | 'sent_back' | 'none';
}

/** A person's own doubted identifier, still waiting on somebody (PEO-125). */
export interface IdentifierReviewEntry {
  readonly key: string;
  readonly label: string;
  /** `pending`: with HR. `sent_back`: HR asked the employee to correct it. */
  readonly state: 'pending' | 'sent_back';
  readonly findings: readonly {
    readonly level: string;
    readonly code: string;
    readonly message: string;
  }[];
  /** What HR wrote when sending it back. */
  readonly note: string | null;
}

export interface Outcome {
  readonly ok: boolean;
  readonly message?: string;
}
