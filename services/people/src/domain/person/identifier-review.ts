import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * HR's review of a national identifier our checks doubted (PEO-125; PRD §8.4).
 *
 * A value is never refused for failing a check it has the shape to pass: it
 * is saved, and a finding worse than `ok` opens a review. The reviewer
 * decides, and **the decision is final**: an accepted value is never flagged
 * again, whatever a later check says, and a sent-back one waits for the
 * employee to write a new value, which supersedes it, and always says why.
 *
 * Pure: the caller brings the clock and says whether the value being written
 * is the one the latest review was about (it holds the plaintext; this does
 * not).
 */

export type ReviewState = 'pending' | 'accepted' | 'sent_back' | 'superseded';
export type ReviewDecision = 'accept' | 'send_back';

/** What a check found, as `national-id.ts` reports it. Never the value. */
export interface ReviewFinding {
  readonly level: 'ok' | 'attention' | 'mismatch';
  readonly code: string;
  readonly message: string;
}

export interface IdentifierReview {
  readonly id: string;
  readonly personId: string;
  readonly attributeKey: string;
  /**
   * What the value under review is: the history row that wrote it, or the
   * change holding it for approval (PEO-077), which is reviewed before it is
   * approved. Exactly one; never changed.
   */
  readonly historyId: string | null;
  readonly pendingChangeId: string | null;
  /**
   * A keyed hash of the value under review and the master key it was taken
   * under: how a later write tells the same value from another without
   * reading any plaintext (PEO-125). Never the value.
   */
  readonly valueHash: string;
  readonly keyId: string;
  readonly findings: readonly ReviewFinding[];
  readonly state: ReviewState;
  readonly createdAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
}

export const NOTE_MAX = 500;

const OPEN: ReadonlySet<ReviewState> = new Set(['pending', 'sent_back']);

/** Whether a review is still waiting on somebody: HR, or the employee. */
export const isOpen = (review: IdentifierReview): boolean => OPEN.has(review.state);

/**
 * What a new value of an identifier does to its reviews.
 *
 * `latest` is the newest review of this attribute on this person, whatever
 * its state. `sameAsLatest` is whether the value written is, normalised, the
 * one that review was about.
 */
export function onIdentifierWritten(input: {
  readonly findings: readonly ReviewFinding[];
  readonly latest: IdentifierReview | null;
  readonly sameAsLatest: boolean;
}): { readonly supersede: boolean; readonly open: boolean } {
  const { latest } = input;
  const flagged = input.findings.some((f) => f.level !== 'ok');
  const supersede = latest !== null && isOpen(latest);
  // Accepted is final for that value: re-saving it asks nobody again.
  if (latest?.state === 'accepted' && input.sameAsLatest) return { supersede: false, open: false };
  return { supersede, open: flagged };
}

/** The reviewer's decision on a pending review. */
export function decideReview(
  review: IdentifierReview,
  input: {
    readonly decision: ReviewDecision;
    readonly by: string;
    readonly at: string;
    readonly note: string | null;
  },
): Result<IdentifierReview> {
  if (review.state !== 'pending') {
    return err(failure('REVIEW_DECIDED', 'This value has already been reviewed'));
  }
  const note = input.note?.trim() ?? '';
  // Sent back with no reason, the employee cannot tell what to correct.
  if (input.decision === 'send_back' && note === '') {
    return err(failure('REASON_REQUIRED', 'Say what is wrong; the employee is shown it', ['note']));
  }
  if (note.length > NOTE_MAX) {
    return err(
      failure('VALUE_INVALID', `A note is at most ${String(NOTE_MAX)} characters`, ['note']),
    );
  }
  return ok({
    ...review,
    state: input.decision === 'accept' ? 'accepted' : 'sent_back',
    decidedBy: input.by,
    decidedAt: input.at,
    note: note === '' ? null : note,
  });
}
