// @vitest-environment node
import { createElement, Suspense, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { framed } from '../frame';
import { Analytics as AnalyticsScreen, type AnalyticsState } from './analytics';
import { WhatChanged as WhatChangedScreen } from './what-changed';
import { FOR_NORA, SEPTEMBER } from './what-changed.fixture';

/**
 * Insights on the server, as the shell renders a remote (`remote-renderer.ts`):
 * no window, no document, inside a Suspense boundary. A screen that throws
 * there is caught by the boundary, `<!--$!-->`, and the shell logs "the
 * screen threw while rendering" and draws it in the browser instead (React
 * error #419). Every tab must render whole.
 */

// As `index.ts` exposes them, and the shell renders them.
const Analytics = framed(AnalyticsScreen);
const WhatChanged = framed(WhatChangedScreen);

const serve = <P extends object>(element: ComponentType<P>, props: object): string =>
  renderToString(createElement(Suspense, { fallback: null }, createElement(element, props as P)));

const workforce: AnalyticsState = {
  asOf: '2026-10-01',
  source: 'snapshot',
  sourceNote: 'From the daily snapshot.',
  minimum: 10,
  headcount: {
    value: 412,
    change: 14,
    trend: [
      { label: '2026-08', value: 398 },
      { label: '2026-09', value: 412 },
    ],
  },
  startingSoon: 3,
  attrition: {
    percent: 4.3,
    leavers: 12,
    formula: 'leavers ÷ average headcount',
    trend: [
      { label: '2026-08', value: 4.1 },
      { label: '2026-09', value: 4.3 },
    ],
  },
  complete: { percent: 79, incomplete: 88 },
  expiringIn90Days: 2,
  movement: { period: 'x', opening: 398, joiners: 14, moves: 0, leavers: 0, closing: 412 },
  completenessBySection: [{ label: 'Bank', value: 70 }],
  expiries: {
    today: '2026-10-01',
    items: [{ kind: 'work_permit', personId: 'p', name: 'Sana Khan', day: '2026-10-22' }],
  },
  funnel: null,
  tenure: [{ label: 'Under 6 months', headcount: 30, leavers: 2 }],
  span: [{ label: '3 reports', value: 4 }],
  joiners: {
    months: ['2026-09'],
    departments: ['Engineering'],
    cells: [{ row: 'Engineering', column: '2026-09', value: 9 }],
  },
  composition: {
    categories: ['Engineering'],
    series: [{ label: 'Permanent', values: [40] }],
  },
  selfId: null,
  pay: null,
  segment: null,
  segments: [],
  schedules: null,
};

describe('Insights on the server', () => {
  it.each(['headcount', 'turnover', 'data-quality', 'pay'] as const)(
    'renders the %s tab whole',
    (tab) => {
      const html = serve(Analytics, { tab, load: { status: 'ready', data: workforce } });
      expect(html).not.toContain('<!--$!-->');
      expect(html).toContain('Insights');
    },
  );

  it('renders What changed whole, the export dialog open or not, and a summary sent', () => {
    for (const props of [
      { load: { status: 'ready', data: SEPTEMBER } },
      {
        load: { status: 'ready', data: SEPTEMBER },
        exporting: {
          format: 'pdf',
          recipient: 'nora',
          tone: 'short',
          charts: true,
          madeLine: true,
        },
        onExportingChange: () => undefined,
      },
      {
        load: {
          status: 'ready',
          data: { shared: { id: 's', createdAt: '', expiresAt: '', document: FOR_NORA.document } },
        },
      },
    ]) {
      const html = serve(WhatChanged, props);
      expect(html).not.toContain('<!--$!-->');
    }
  });
});
