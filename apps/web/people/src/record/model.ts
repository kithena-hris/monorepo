import type { SignatureValue } from '@reach/ui';

import type { DataType, ViewerScope } from '../settings/model';
import { t } from '../i18n';

/**
 * One person's record, as the viewer may see it.
 *
 * View models, like `settings/model.ts`. What reaches a screen has already
 * been through the authorization decision: a field the viewer cannot read is
 * not in `fields` at all, so nothing here can draw it — no label, no empty
 * row, no padlock (PRD §6.6).
 */

/** A value as a form holds it. Money is minor units in a string, never a float. */
export type AttributeValue =
  | string
  | boolean
  | readonly string[]
  | { readonly amountMinor: string; readonly currency: string }
  /** An encrypted value as every ordinary read returns it: never the plaintext. */
  | { readonly last4: string | null }
  | null;

export type Values = Readonly<Record<string, AttributeValue>>;

/**
 * A signature field's value, read: the mark's JSON text as People keeps it
 * (`@kithena/contracts`, `SignatureMark`), or null for none or one unreadable.
 */
export function signatureOf(value: AttributeValue | undefined): SignatureValue | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const mark = JSON.parse(value) as Partial<{
      kind: string;
      text: string;
      path: string;
      style: string;
    }>;
    if (mark.kind === 'drawn' && typeof mark.path === 'string')
      return { kind: 'drawn', path: mark.path };
    if (mark.kind === 'typed' && typeof mark.text === 'string') {
      const style = mark.style === 'light' || mark.style === 'bold' ? mark.style : 'flowing';
      return { kind: 'typed', text: mark.text, style };
    }
  } catch {
    // Not a signature: shown as none.
  }
  return null;
}

/** An open-ended date's answer when there is none: People's `INDEFINITE`. */
export const INDEFINITE = 'indefinite';

export interface RecordField {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: DataType;
  /** For the list types, and for a reference: what may be picked. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly required: boolean;
  /**
   * Required of this person and empty, by their completeness verdict: a field
   * required only of some people is missing only on theirs. Absent: not judged.
   */
  readonly missing?: boolean;
  /** Readable by this viewer and not writable by them. */
  readonly readOnly: boolean;
  /** ISO 4217, for a money field. */
  readonly currency?: string;
  /** A date that may instead be `indefinite`: a permanent contract has no end. */
  readonly openEnded?: boolean;
  /** Who may change it, named when this viewer may not (§8.3): "HR". */
  readonly ownedBy?: string;
  /** The upstream system it is kept in for this person (PEO-073): changed there, not here. */
  readonly keptIn?: string;
  /** A change to it waits for HR's approval (PEO-077): marked wherever it is drawn. */
  readonly sensitive?: boolean;
  /** The viewer may ask the person to fill it in (HR or a manager, a field the employee fills). */
  readonly askable?: boolean;
}

/**
 * A value waiting for HR's approval (PEO-077). Never the field's value, which
 * stays what is in force until it is approved; masked as the field is.
 */
export interface PendingValue {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly kind: 'value' | 'correction';
  readonly value: AttributeValue;
  /** When it takes effect once approved. */
  readonly effectiveFrom: string;
  readonly requestedAt: string;
  /** Undecided by then, it lapses. */
  readonly expiresAt: string;
  /** Who asked, in words the viewer may read. */
  readonly requestedBy: string;
  readonly reason: string | null;
  /** The viewer asked, so may withdraw it. */
  readonly mine: boolean;
  /** The viewer may approve or reject it. */
  readonly canDecide: boolean;
  /** The viewer asked and no other HR member may approve it: they approve it alone, once they confirm. */
  readonly canSelfApprove?: boolean;
  /** A national identifier the checks doubt: not approvable until HR accepts its review. */
  readonly awaitingReview?: boolean;
  /** What the checks doubted, while it awaits review. */
  readonly findings?: readonly {
    readonly level: string;
    readonly code: string;
    readonly message: string;
  }[];
}

export interface RecordSection {
  readonly key: string;
  readonly label: string;
  /** Who can read what is entered here, so a form can say so (§8.3). */
  readonly visibility: readonly ViewerScope[];
  readonly fields: readonly RecordField[];
}

/** "Only you and HR can see these": who reads an answer, told to the person giving it. */
export function seenBy(visibility: readonly ViewerScope[]): string {
  if (visibility.includes('directory'))
    return t(
      'record.model.everyone_at_the_company_can_see',
      'Everyone at the company can see these.',
    );
  const others = [
    visibility.some((v) => v === 'manager' || v === 'manager_chain')
      ? t('record.model.your_manager', 'your manager')
      : null,
    visibility.includes('hr') || visibility.includes('admin') ? 'HR' : null,
    visibility.includes('finance') ? t('record.model.finance', 'Finance') : null,
  ].filter((x) => x !== null);
  if (others.length === 0)
    return t('record.model.only_you_can_see_these', 'Only you can see these.');
  const last = others.pop() ?? '';
  const list =
    others.length === 0
      ? last
      : t('record.model.and', '{{join}} and {{last}}', { join: others.join(', '), last });
  return visibility.includes('self')
    ? t('record.model.only_you_and_can_see_these', 'Only you and {{list}} can see these.', { list })
    : t('record.model.only_can_see_these', 'Only {{list}} can see these.', { list });
}

/** Whether a required field still has nothing in it. */
export function isMissing(value: AttributeValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
