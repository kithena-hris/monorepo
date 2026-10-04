import { TooltipProvider } from '@reach/ui';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { framed } from '../frame';
import { serveAndHydrate } from '../test/hydrate';
import type { ApprovalItem } from '../approvals/approvals';
import { Review as ReviewScreen, type ReviewProps, type ReviewState } from './review';
import { actions, NOTHING } from './review.fixture';

/**
 * Review as the shell serves it (`remote-renderer.ts`): rendered on the
 * server whole, the tab, the chip and the item in the address already
 * chosen, then hydrated in the browser over that HTML without a mismatch.
 * Nothing on the first paint may change on hydration but becoming
 * interactive: every age is read against the time People answered.
 */

const Review = framed(ReviewScreen);

const change: ApprovalItem = {
  id: 'c1',
  key: 'base_salary',
  label: 'Base salary',
  kind: 'value',
  value: { amountMinor: '8400000', currency: 'EUR' },
  current: { amountMinor: '6100000', currency: 'EUR' },
  effectiveFrom: '2026-10-01',
  requestedAt: '2026-09-22T09:40:00.000Z',
  expiresAt: '2026-09-29T09:40:00.000Z',
  requestedBy: 'Marco Ruiz',
  reason: 'Matching a competing offer',
  mine: false,
  canDecide: true,
  personId: 'p1',
  name: 'Tom Fischer',
  readable: true,
  flagSummary: 'A 38% raise, above the band',
  flags: [{ code: 'raise', title: 'A 38% raise', detail: 'Raises in Sales were 3% to 9%.' }],
  canAsk: true,
};

const state: Partial<ReviewState> = {
  approvals: { isHr: true, items: [change], checks: [], canTune: false, last90: null },
  identifiers: {
    items: [
      {
        personId: 'p2',
        name: 'Adam Novak',
        attributeKey: 'es_nif',
        label: 'National ID',
        last4: '4821',
        findings: [{ level: 'mismatch', code: 'check', message: 'The check letter should be Z.' }],
        enteredAt: '2026-10-02T09:00:00.000Z',
      },
    ],
  },
};

const element = (props: Partial<ReviewProps>): ReactElement =>
  createElement(
    TooltipProvider,
    null,
    createElement(Review, {
      load: { status: 'ready', data: { ...NOTHING, ...state } },
      tab: 'waiting',
      ...actions(),
      ...props,
    }),
  );

describe('Review on the server, then in the browser', () => {
  it.each([
    { tab: 'waiting' as const, item: 'change-c1' },
    { tab: 'waiting' as const, kind: 'ids', item: 'id-p2~es_nif' },
    { tab: 'flagged' as const },
    { tab: 'decided' as const },
  ])('renders %o whole, and hydrates it without a mismatch', async (address) => {
    const props = { ...address, onKindChange: vi.fn(), onItemChange: vi.fn() };
    const { html, errors } = await serveAndHydrate(element(props));
    expect(html).not.toContain('<!--$!-->');
    // The item the address names is open in the first HTML.
    if (address.item === 'change-c1') expect(html).toContain('Why this is flagged');
    if (address.item?.startsWith('id-') === true) expect(html).toContain('What the checks found');

    expect(errors).toEqual([]);
  });
});
