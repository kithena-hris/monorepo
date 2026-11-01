import { DocumentsInboxDetail, PerformanceInboxDetail, type InboxItem } from '@kithena/contracts';

/*
 * Its own file, not `model.ts`: the bell in every page's chrome reads the
 * model, and these schemas are the Inbox page's alone.
 */

/** Recruiting's tasks the Inbox has a form of its own for (`detail-recruiting.tsx`). */
const RECRUITING_HERE = new Set([
  'recruiting.choose-time',
  'recruiting.requisition-approval',
  'recruiting.offer-approval',
  'recruiting.scorecard',
  'recruiting.create-contract',
]);

/**
 * A task the Inbox has no form of its own for: a review to write, feedback
 * to give, peers to pick, an envelope to sign. Its module's own screen is
 * drawn in the pane (`task-screen.tsx`), so it is still done where it sits.
 */
export function opensScreen(item: Pick<InboxItem, 'lane' | 'module' | 'kind' | 'detail'>): boolean {
  if (item.lane !== 'task') return false;
  switch (item.module) {
    case 'performance':
      return !PerformanceInboxDetail.safeParse(item.detail).success;
    case 'documents':
      return !DocumentsInboxDetail.safeParse(item.detail).success;
    case 'recruiting':
      return !RECRUITING_HERE.has(item.kind);
    default:
      return false;
  }
}
