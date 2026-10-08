import { isEmpty, type Value } from './api';

export interface HistoryChange {
  readonly id: string;
  readonly key: string;
  readonly effectiveFrom: string;
  readonly recordedAt: string;
  readonly by: string;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly actor: { readonly kind: string } | null;
  readonly value: Value;
}

/**
 * What stood before a change: for a correction, what it corrects; otherwise
 * the value of the same field in force just before it, corrections applied.
 * The web's `previousOf` (`profile/history.tsx`).
 */
export function previousOf(
  change: HistoryChange,
  all: readonly HistoryChange[],
): HistoryChange | undefined {
  if (change.supersedes !== null) return all.find((c) => c.id === change.supersedes);
  return all
    .filter(
      (c) =>
        c.key === change.key &&
        c.id !== change.id &&
        c.supersededBy === null &&
        (c.effectiveFrom < change.effectiveFrom ||
          (c.effectiveFrom === change.effectiveFrom && c.recordedAt < change.recordedAt)),
    )
    .toSorted(
      (a, b) =>
        a.effectiveFrom.localeCompare(b.effectiveFrom) || a.recordedAt.localeCompare(b.recordedAt),
    )
    .at(-1);
}

/** "Salary changed", "Phone added", "Job title corrected", "Address cleared". */
export function titleOf(label: string, change: HistoryChange, previous?: HistoryChange): string {
  if (change.supersedes !== null) return `${label} corrected`;
  if (isEmpty(change.value)) return `${label} cleared`;
  if (previous === undefined || isEmpty(previous.value)) return `${label} added`;
  return `${label} changed`;
}
