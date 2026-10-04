import { reviewItem } from './shell-data';

/**
 * The Inbox's three views (design MA6): what there is to do, the changes
 * People's checks flagged for the viewer to decide, and updates. Each is its
 * own address (`?view=`), so Back and a shared link land on the same one.
 */

export const INBOX_VIEWS = ['todo', 'flagged', 'updates'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const inboxView = (value: string | undefined): InboxView =>
  INBOX_VIEWS.find((v) => v === value) ?? 'todo';

type Value = unknown;

/** One change waiting for the viewer, flagged, as Approvals answered it. */
export interface FlaggedSource {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly readable: boolean;
  readonly canDecide: boolean;
  readonly flagSummary?: string | null;
  readonly value: Value;
  readonly current: Value;
}

export interface FlaggedRow {
  readonly id: string;
  readonly name: string;
  /** "Base salary €61k → €84k", or the field alone where no amount shows. */
  readonly change: string;
  /** Why, on the row: "A 38% raise, above the band". */
  readonly why: string;
  readonly href: string;
}

const isMoney = (v: Value): v is { readonly amountMinor: string; readonly currency: string } =>
  typeof v === 'object' && v !== null && 'amountMinor' in v && 'currency' in v;

/** "€84k", for a row. Display only: whole units from the digits, never arithmetic on the amount. */
function compact(v: Value): string | null {
  if (!isMoney(v)) return null;
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: v.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const whole = Number(v.amountMinor.slice(0, Math.max(0, v.amountMinor.length - digits)) || '0');
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: v.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(whole)
    .replace(/K$/u, 'k');
}

/** The flagged changes the viewer decides, each opening on Approvals. */
export function flaggedRows(items: readonly FlaggedSource[]): FlaggedRow[] {
  return items
    .filter((i) => i.canDecide && (i.flagSummary ?? '') !== '')
    .map((i) => {
      const before = i.readable ? compact(i.current) : null;
      const after = i.readable ? compact(i.value) : null;
      return {
        id: i.id,
        name: i.name,
        change: before !== null && after !== null ? `${i.label} ${before} → ${after}` : i.label,
        why: i.flagSummary ?? '',
        href: reviewItem('flagged', 'changes', `change-${i.id}`),
      };
    });
}
