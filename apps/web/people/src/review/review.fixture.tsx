import { TooltipProvider } from '@reach/ui';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import { Review, type ReviewProps, type ReviewState } from './review';

/** What every test's Review starts from: nothing waiting, read at a fixed moment. */
export const NOTHING: ReviewState = {
  now: '2026-09-24T09:00:00.000Z',
  roles: { hr: true, admin: false, finance: false },
  approvals: null,
  identifiers: null,
  duplicates: null,
  fullValues: null,
  completeness: null,
  share: null,
};

export const done = () => Promise.resolve({ ok: true as const });

/** Every operation Review is handed, each a spy that succeeds. */
export function actions(): Omit<ReviewProps, 'load' | 'tab'> {
  return {
    onDecide: vi.fn(done),
    onWithdraw: vi.fn(done),
    onReviewIdentifier: vi.fn(done),
    onReveal: vi.fn(() => Promise.resolve({ ok: true as const, value: '' })),
    onMerge: vi.fn(done),
    onDismiss: vi.fn(done),
    onUnmerge: vi.fn(done),
    onRequestFullValues: vi.fn(done),
    onDecideFullValues: vi.fn(done),
    onSaveMissing: vi.fn(() => Promise.resolve({ ok: true as const })),
  };
}

/** Review over `state`, on its Waiting tab unless `props` says otherwise, every operation a spy. */
export function reviewOf(
  state: Partial<ReviewState>,
  props: Partial<ReviewProps> = {},
): ReactElement {
  return (
    <Review
      load={{ status: 'ready', data: { ...NOTHING, ...state } }}
      tab="waiting"
      {...actions()}
      {...props}
    />
  );
}

/** `reviewOf`, rendered; charts' tooltips as the host provides them. */
export function renderReview(
  state: Partial<ReviewState>,
  props: Partial<ReviewProps> = {},
): ReturnType<typeof render> {
  return render(reviewOf(state, props), { wrapper: TooltipProvider });
}
