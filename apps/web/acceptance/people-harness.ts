import { afterAll, afterEach, beforeAll, beforeEach, expect, inject } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

import { startStack, type Stack } from './stack';

/**
 * What every People acceptance file shares: its own stack and browser, and
 * the helpers its tests drive them with. A file calls `useStack()` once; the
 * stack and browser are then this module's live bindings, so a helper and a
 * test read the same ones. Each file starts its own stack, so the files run
 * on separate CI runners at once (the `web acceptance` parts in ci.yml).
 */

export let stack: Stack;
export let browser: Browser;

/** Start the stack and the browser before the file's tests; then `setup`, if given. */
export function useStack(setup?: () => Promise<void>): void {
  beforeAll(async () => {
    stack = await startStack(inject('remoteKeys'));
    browser = await chromium.launch();
    await setup?.();
  }, 900_000);

  beforeEach(() => {
    complaints.length = 0;
  });

  // A failed wait says only what it waited for. What the browser said, and
  // what each page left open was showing, is what a flaky one needs to be
  // understood from a CI log alone.
  afterEach(async ({ task }) => {
    if (task.result?.state !== 'fail') return;
    const pages = await Promise.all(
      (browser as Browser | undefined)
        ?.contexts()
        .flatMap((c) => c.pages())
        .map(describePage) ?? [],
    );
    console.log(
      [
        `--- ${task.name}: what the browser said`,
        ...complaints.slice(-40),
        '--- and what each open page showed',
        ...pages,
      ].join('\n'),
    );
  });

  afterAll(async () => {
    // Either may be missing when `beforeAll` failed part way.
    await (browser as Browser | undefined)?.close();
    await (stack as Stack | undefined)?.stop();
  }, 60_000);
}

/** Console errors and uncaught errors from every page of every context, for a failure's log. */
const complaints: string[] = [];

async function describePage(page: Page): Promise<string> {
  try {
    const shown = await page.evaluate(() => {
      const remote = document.querySelector('[data-remote]');
      return {
        remote: remote === null ? null : remote.getAttribute('data-remote'),
        waiting: document.querySelector('[data-remote][data-hydrating]') !== null,
        remoteText: remote instanceof HTMLElement ? remote.innerText.slice(0, 120) : null,
        hiddenParts: document.querySelectorAll('div[hidden][id^="S:"]').length,
        text: document.body.innerText.replaceAll('\n', ' | ').slice(0, 300),
      };
    });
    return `${page.url()} ${JSON.stringify(shown)}`;
  } catch (e) {
    return `${page.url()} (unreadable: ${e instanceof Error ? e.message : String(e)})`;
  }
}

export async function signedIn(
  session: string,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  context.on('page', (page) => {
    page.on('pageerror', (e) => complaints.push(`[pageerror ${page.url()}] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') complaints.push(`[console ${page.url()}] ${m.text()}`);
    });
  });
  await context.addCookies([
    {
      name: '__Host-ksession',
      value: session,
      // `domain` + `path`, not `url`: Chromium refuses a Secure cookie set
      // for an http URL, and accepts it for a `*.localhost` host.
      domain: new URL(stack.shell).hostname,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return context;
}

/** Wait for a query to hold, bounded: the database is the record of what a screen did. */
export async function eventually<T>(
  what: string,
  read: () => Promise<T>,
  holds: (v: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 20_000;
  let last = await read();
  while (!holds(last)) {
    if (Date.now() > deadline) throw new Error(`${what}: still ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await read();
  }
  return last;
}

/** The People item in the shell's sidebar, which People's sections hang off. */
export const peopleItem = (page: Page): Locator =>
  // Exact: the collapsed rail's People flyout ends with a "Settings › People" link.
  page
    .getByRole('navigation', { name: 'Areas' })
    .getByRole('link', { name: 'People', exact: true });

/**
 * People's own navigation in an expanded sidebar: its sections, listed inline
 * under the People item while you are anywhere in People (V2), and next after
 * it in Tab order. Nothing has to be opened.
 */
export async function sections(page: Page): Promise<Locator> {
  await page.waitForLoadState('networkidle');
  const list = page
    .getByRole('navigation', { name: 'Areas' })
    .getByRole('list', { name: 'People sections' });
  await list.waitFor();
  return list;
}

export const person = (
  id: string,
): Promise<{ given_name: string | null; family_name: string | null; status: string }[]> =>
  stack.sql<{ given_name: string | null; family_name: string | null; status: string }[]>`
    SELECT given_name, family_name, status FROM people.person WHERE id = ${id}`;

/**
 * Whether a form's button is on screen, above the keyboard, without scrolling
 * to it (§17.2). Polled, because the page settles after a field takes focus.
 */
export async function inView(page: Page, name: string, form: string): Promise<void> {
  const button = page.getByRole('form', { name: form }).getByRole('button', { name });
  const height = page.viewportSize()?.height ?? 0;
  await expect
    .poll(
      async () => {
        const box = await button.boundingBox();
        if (box !== null && box.y >= 0 && box.y + box.height <= height) return 'on screen';
        // What a failure needs to be understood: the box, the viewport as the
        // page sees it, and every ancestor that scrolls or sticks.
        const layout = await button.evaluate((el) => {
          const chain: string[] = [];
          for (let n = el.parentElement; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (
              cs.position === 'sticky' ||
              /auto|scroll|hidden|clip/.test(cs.overflow) ||
              cs.contain !== 'none' ||
              cs.transform !== 'none' ||
              cs.display === 'contents'
            ) {
              const r = n.getBoundingClientRect();
              chain.push(
                `${n.tagName}.${n.className.slice(0, 60)} ${cs.position} bottom=${cs.bottom} ${cs.overflow} contain=${cs.contain} transform=${cs.transform} display=${cs.display} ${String(Math.round(r.top))}-${String(Math.round(r.bottom))}`,
              );
            }
          }
          return {
            inner: window.innerHeight,
            visual: window.visualViewport?.height,
            scrollY: window.scrollY,
            doc: document.documentElement.scrollHeight,
            html: getComputedStyle(document.documentElement).overflow,
            body: getComputedStyle(document.body).overflow,
            chain,
          };
        });
        return JSON.stringify({ box, layout });
      },
      { timeout: 5_000 },
    )
    .toBe('on screen');
}

/**
 * A software keyboard opening: the viewport loses its lower 40%, and the
 * browser scrolls the focused field into view — which is what a phone does,
 * and what makes a sticky footer take its new place. Resizing the emulated
 * viewport alone does neither.
 */
export async function keyboardUp(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.evaluate(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.scrollIntoView({ block: 'center' });
  });
}

/**
 * Until every remote screen has hydrated. Focus, a typed value or a chosen
 * file given to the server's HTML before then is lost when the browser draws
 * the screen afresh, and how long that takes depends on the bundle's size.
 */
export async function live(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-remote][data-hydrating]') === null,
    undefined,
    { timeout: 30_000 },
  );
}

export async function upload(page: Page, name: string, text: string): Promise<void> {
  // Into the live screen, or the import never moves on.
  await live(page);
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
  });
}
