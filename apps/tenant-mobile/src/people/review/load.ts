import { ask, valueOf, type Signed } from '../api';
import type {
  AccessState,
  ApprovalItem,
  ApprovalsState,
  ApprovalWire,
  CompletenessState,
  Counts,
  DecidedId,
  DuplicatesState,
  IdState,
  ReviewData,
  Share,
} from './model';

/** An approval with its values read out of their entries, as the web's `VIEWS.Approvals`. */
export const approvalOf = ({ before, ...w }: ApprovalWire): ApprovalItem => ({
  ...w,
  value: valueOf(w.value),
  current: valueOf(w.current),
  ...(before === undefined ? {} : { before: before === null ? null : valueOf(before) }),
});

type ApprovalsWire = Omit<ApprovalsState, 'items' | 'decided'> & {
  readonly items: readonly ApprovalWire[];
  readonly decided: readonly ApprovalWire[] | null;
};

export const approvalsOf = (w: ApprovalsWire): ApprovalsState => ({
  ...w,
  items: w.items.map(approvalOf),
  decided: (w.decided ?? []).map(approvalOf),
});

/** A JSON answer People sends as a string (`ExportShare`, `ExportSharesWaiting`). */
export function parsed(text: unknown): unknown {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const data = <T>(answer: { ok: true; data: T } | { ok: false }): T | null =>
  answer.ok ? answer.data : null;

/**
 * Every queue Review lists, read at once and each as the viewer: the web's
 * `review()` (`apps/web/src/lib/people-screens.ts`). A queue People refuses
 * this viewer is null, and the rest still draw. `flagged` asks only for the
 * changes the checks flag.
 */
export async function readReview(signed: Signed, flagged: boolean): Promise<ReviewData | string> {
  const roles = await ask<{ hr: boolean; admin: boolean; finance: boolean }>(signed, 'Home');
  if (!roles.ok) return roles.message;
  const { hr, admin, finance } = roles.data;
  const none = Promise.resolve({ ok: false as const });
  const [approvals, identifiers, duplicates, access, completeness, analytics, shares, own, counts] =
    await Promise.all([
      ask<ApprovalsWire>(signed, 'Approvals', flagged ? { flagged: true } : {}),
      hr ? ask<IdState>(signed, 'IdentifierReviews') : none,
      hr ? ask<DuplicatesState>(signed, 'Duplicates', { a: null, b: null }) : none,
      hr || finance ? ask<AccessState>(signed, 'FullValues') : none,
      hr ? ask<CompletenessState>(signed, 'Completeness') : none,
      hr ? ask<{ complete: ReviewData['complete'] }>(signed, 'Analytics', { segment: null }) : none,
      admin ? ask<string>(signed, 'ExportSharesWaiting') : none,
      hr ? none : ask<{ changes: ApprovalWire[]; identifiers: DecidedId[] }>(signed, 'OwnDecided'),
      ask<Counts>(signed, 'Waiting'),
    ]);
  const ownDecided = data(own);
  return {
    roles: roles.data,
    approvals: approvals.ok ? approvalsOf(approvals.data) : null,
    identifiers: data(identifiers),
    duplicates: data(duplicates),
    access: data(access),
    completeness: data(completeness),
    complete: data(analytics)?.complete ?? null,
    shares: (parsed(data(shares)) as { items?: Share[] } | null)?.items ?? null,
    ownDecided:
      ownDecided === null
        ? null
        : { changes: ownDecided.changes.map(approvalOf), identifiers: ownDecided.identifiers },
    counts: data(counts),
  };
}
