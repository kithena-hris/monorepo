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
}

export interface RecordSection {
  readonly key: string;
  readonly label: string;
  readonly visibility: readonly ViewerScope[];
  readonly fields: readonly RecordField[];
}

export interface Outcome {
  readonly ok: boolean;
  readonly message?: string;
}
