import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

import { ADMIN, startStack, type Stack } from './stack';

/**
 * Import & export's landing page: what is static is in the server's HTML and
 * paints at once; only the history waits on People.
 */

let stack: Stack;
let browser: Browser;

beforeAll(async () => {
  stack = await startStack();
  browser = await chromium.launch();
  await stack.writeAsPeople(ADMIN.account, '/v1/views/setup/publish', {
    country: 'ES',
    sections: [],
  });
}, 900_000);

afterAll(async () => {
  await (browser as Browser | undefined)?.close();
  await (stack as Stack | undefined)?.stop();
}, 60_000);

const cookie = () => `__Host-ksession=${ADMIN.session}`;

/** Timings, to `LANDING_OUT` when a run asks for them. */
const report = (what: string, numbers: Record<string, number | undefined>): void => {
  const out = process.env['LANDING_OUT'];
  if (out !== undefined) appendFileSync(out, `${what} ${JSON.stringify(numbers)}\n`);
};

/** When each piece of the streamed HTML arrived, from the request's start. */
async function stream(
  path: string,
): Promise<{ ttfb: number; cards: number; history: number; total: number }> {
  const start = performance.now();
  const response = await fetch(`${stack.shell}${path}`, { headers: { cookie: cookie() } });
  if (response.body === null) throw new Error('no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let ttfb = -1;
  let cards = -1;
  let history = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const at = performance.now() - start;
    if (ttfb < 0) ttfb = at;
    html += decoder.decode(value, { stream: true });
    if (cards < 0 && html.includes('Export people')) cards = at;
    if (history < 0 && html.includes('aria-label="Imports and exports"')) history = at;
    if (history < 0 && html.includes('Nothing imported or exported yet')) history = at;
  }
  return { ttfb, cards, history, total: performance.now() - start };
}

describe('Import & export, as the server sends it', () => {
  it('sends the header, both cards and their buttons in the HTML', async () => {
    // Warm: the first request compiles nothing in a production build, but
    // the renderer and the token are made once.
    await stream('/people/import-export');
    const runs: Awaited<ReturnType<typeof stream>>[] = [];
    for (let i = 0; i < 5; i += 1) runs.push(await stream('/people/import-export'));
    const median = (k: keyof (typeof runs)[number]) =>
      runs.map((r) => r[k]).sort((a, b) => a - b)[2];
    report('server', {
      ttfb: median('ttfb'),
      cards: median('cards'),
      history: median('history'),
      total: median('total'),
    });
    expect(median('cards')).toBeGreaterThan(0);

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([
      {
        name: '__Host-ksession',
        value: ADMIN.session,
        domain: new URL(stack.shell).hostname,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    // When the cards, the history's rows and a hydrated screen first appear,
    // from `landing.t0`: the navigation's start, or a click.
    await context.addInitScript(() => {
      const w = window as unknown as { landing: Record<string, number> };
      w.landing = { t0: 0 };
      new MutationObserver(() => {
        const l = w.landing;
        const at = performance.now() - (l['t0'] ?? 0);
        // No body yet while the document is still arriving.
        const text = (document.body as HTMLElement | null)?.textContent ?? '';
        if (l['cards'] === undefined && text.includes('New export')) l['cards'] = at;
        if (
          l['history'] === undefined &&
          (text.includes('Nothing imported or exported yet') ||
            document.querySelector('table[aria-label="Imports and exports"] td') !== null)
        ) {
          l['history'] = at;
        }
        if (
          l['interactive'] === undefined &&
          text.includes('New export') &&
          document.querySelector('[data-remote]:not([data-hydrating])') !== null
        ) {
          l['interactive'] = at;
        }
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    const landed = (page: Page) =>
      page.waitForFunction(
        () => {
          const l = (window as unknown as { landing: Record<string, number> }).landing;
          return l['history'] !== undefined && l['interactive'] !== undefined;
        },
        undefined,
        { timeout: 30_000 },
      );
    const timings = (page: Page) =>
      page.evaluate(() => ({
        ...(window as unknown as { landing: Record<string, number> }).landing,
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1,
      }));
    const mid = (runs: Record<string, number>[], k: string) =>
      runs.map((r) => r[k] ?? -1).sort((a, b) => a - b)[2];
    const keys = ['fcp', 'cards', 'interactive', 'history'];

    const page = await context.newPage();
    const loads: Record<string, number>[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.goto(`${stack.shell}/people/import-export`);
      await landed(page);
      loads.push(await timings(page));
    }
    report('load', Object.fromEntries(keys.map((k) => [k, mid(loads, k)])));

    // Arriving from another People page, in the page: a first visit, so
    // nothing this tab holds can stand in for it.
    const moves: Record<string, number>[] = [];
    for (let i = 0; i < 5; i += 1) {
      const from = await context.newPage();
      await from.goto(`${stack.shell}/people/directory/list`);
      await from.waitForLoadState('networkidle');
      await from.evaluate(() => {
        (window as unknown as { landing: Record<string, number> }).landing = {
          t0: performance.now(),
        };
      });
      await from
        .getByRole('navigation', { name: 'Areas' })
        .getByRole('link', { name: 'Import & export' })
        .click();
      await landed(from);
      moves.push(await timings(from));
      await from.close();
    }
    report('navigation', Object.fromEntries(keys.slice(1).map((k) => [k, mid(moves, k)])));
    await context.close();
  });
});
