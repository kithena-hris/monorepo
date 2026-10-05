'use client';

import { SpeedInsights as VercelSpeedInsights } from '@vercel/speed-insights/next';
import type { JSX } from 'react';

/** A person, a change, an import run: any id in a path is a record, never a page. */
const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/iu;

/**
 * The address a vital is filed under, with nothing in it about anybody: ids
 * become `:id` and the query string goes, because filters and searches carry
 * names. What is left says which screen it was, which is all Speed Insights
 * needs to group by.
 */
export function vitalUrl(url: string): string {
  const at = new URL(url);
  const path = at.pathname
    .split('/')
    .map((part) => (ID.test(part) ? ':id' : part))
    .join('/');
  return `${at.origin}${path}`;
}

/**
 * Vercel Speed Insights: real users' Core Web Vitals (LCP, INP, CLS, FCP,
 * TTFB) per screen, in the Vercel dashboard. Only on Vercel; it sends nothing
 * from a laptop or a test.
 */
export function SpeedInsights(): JSX.Element {
  return <VercelSpeedInsights beforeSend={(event) => ({ ...event, url: vitalUrl(event.url) })} />;
}
