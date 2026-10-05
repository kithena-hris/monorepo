import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { gzipSync } from 'node:zlib';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

import { ADMIN, TENANT, startStack, type Stack } from './stack';

/**
 * Every page at a company's size, timed in a real browser, with budgets.
 *
 * Acme with `PERF_PEOPLE` employees (1,000 unless set; a run with 10,000 is
 * how the numbers in the commit messages were taken), each hired through
 * People's REST as the seed adds people: ten reports to each manager, a title,
 * a department, and two fields nobody has filled in, so Missing details has
 * a gap per person. People's read cache is on, as in production.
 *
 * What is measured, as a person meets each page:
 *
 * - **First load**: largest contentful paint, layout shift, and the
 *   JavaScript the page fetched before the shell began fetching the rest of
 *   the remotes' screens for later, gzipped here (the remotes' included), so
 *   the number is the same whatever the test servers compress.
 * - **Click to paint**: from the pointer going down on a link, tab or button
 *   (rested on first, as a mouse does, so a prefetch has had its chance) to
 *   the frame that shows what it opened, painted.
 * - **Interactions**: the Event Timing API's duration for each press and key
 *   (input to the next paint, which is what INP reports).
 * - **Scrolling**: frames longer than 50 ms while a long list is wheeled
 *   through, from the Long Animation Frames API.
 *
 * The budgets are the targets — 100 ms from a click to its paint and for an
 * interaction, no long frame while scrolling, no layout shift — and the
 * JavaScript each page may fetch. Times are held to off CI only (see `SLACK`);
 * bytes and shifts everywhere.
 * `PERF_OUT` names a file every measurement is appended to.
 */

const N = Number(process.env['PERF_PEOPLE'] ?? '1000');
// A shared CI runner measures the same build 3 to 10 times slower than a desk
// machine, and differently from one run to the next (the 10k-gap grid: 117 ms
// here; 565 and 759 ms on two CI runs). So on CI the milliseconds are written
// down, not held to (`PERF_ENFORCE=1` holds them anyway), as the browser tests
// do (`completeness.browser.test.tsx`); bytes and layout shift are the same
// on any machine and fail CI. Off CI a machine with four cores or fewer gets
// three times the room.
const ENFORCE_TIME = process.env['PERF_ENFORCE'] === '1' || process.env['CI'] === undefined;
const SLACK = Number(process.env['PERF_SLACK'] ?? (availableParallelism() <= 4 ? '3' : '1'));
const BUDGET = {
  clickToPaint: 100 * SLACK,
  interaction: 100 * SLACK,
  longFrameWhileScrolling: 50 * SLACK,
  cls: 0.02,
  lcp: 2500 * SLACK,
};
/**
 * The JavaScript a first load may fetch, gzipped, by area: what the shell and
 * the remotes ship today (People's pages 556–574 KB, Time Off's 526 KB, with
 * every remote screen in its own chunk), and about 5% of room. A page that
 * goes over has gained a dependency or lost a split.
 */
const JS_BUDGET_KB: Readonly<Record<string, number>> = {
  people: 600,
  settings: 600,
  timeoff: 560,
};

/**
 * Where a page is still over a target, its own budget: what it measures now,
 * with room, so it cannot get worse unnoticed. Each is a known debt.
 *
 * The move from the Directory's list to its cards swaps a hundred-row table
 * for a grid of cards in one frame: about 50 ms of style and layout and the
 * commit around them, 115–136 ms in all. Wheeling through the cards lands a
 * page of people now and then, and that render is a frame of 50–80 ms.
 */
const OVER_TARGET: Readonly<Record<string, number>> = {
  'directory → cards': 170,
  'directory cards': 100,
};

let stack: Stack;
let browser: Browser;
const results: {
  page: string;
  metric: string;
  value: number;
  budget: number;
  /** Held to its budget on this run: a size or a shift always, a time off CI. */
  held: boolean;
}[] = [];

function record(pageName: string, metric: string, value: number, target: number): void {
  const known = metric.endsWith(' ms') ? OVER_TARGET[pageName] : undefined;
  const budget = known === undefined ? target : known * SLACK;
  const held = !metric.endsWith(' ms') || ENFORCE_TIME;
  results.push({ page: pageName, metric, value: Math.round(value * 1000) / 1000, budget, held });
  const out = process.env['PERF_OUT'];
  if (out !== undefined && out !== '') {
    appendFileSync(
      out,
      `${String(N)}\t${pageName}\t${metric}\t${value.toFixed(3)}\t${String(budget)}\n`,
    );
  }
}

const DEPARTMENTS = [
  'Engineering',
  'Sales',
  'Support',
  'Finance',
  'People',
  'Marketing',
  'Operations',
  'Legal',
];
const GIVEN = ['Ana', 'Ben', 'Chloé', 'Dmitri', 'Esra', 'Femi', 'Greta', 'Hiro', 'Ines', 'Jonas'];
const FAMILY = ['Alvarez', 'Brown', 'Chen', 'Dubois', 'Eze', 'Fischer', 'García', 'Haddad'];

/** Hires `n` people under Priya, ten to each manager, sixteen at a time. */
async function hire(n: number, entity: string): Promise<void> {
  const write = async (body: unknown): Promise<string> => {
    for (let attempt = 0; ; attempt += 1) {
      const made = await stack.writeAsPeople(ADMIN.account, '/v1/people', body);
      if (made.status === 201) return (made.body as { id: string }).id;
      if (attempt >= 2)
        throw new Error(`hire: ${String(made.status)} ${JSON.stringify(made.body)}`);
    }
  };
  let made = 0;
  let parents = [ADMIN.person];
  // Each level ten times the last until the company is full: 10, 100, 1,000…
  while (made < n) {
    const count = Math.min(n - made, parents.length * 10);
    const ids: string[] = [];
    const width = 16;
    for (let start = 0; start < count; start += width) {
      const batch = Array.from({ length: Math.min(width, count - start) }, (_, k) => start + k);
      ids.push(
        ...(await Promise.all(
          batch.map((i) => {
            const at = made + i;
            const given = GIVEN[at % GIVEN.length] ?? 'Ana';
            const family = `${FAMILY[Math.floor(at / GIVEN.length) % FAMILY.length] ?? 'Brown'}${String(at)}`;
            return write({
              attributes: {
                given_name: given,
                family_name: family,
                work_email: `${given.toLowerCase()}.${family.toLowerCase()}@acme.example`
                  .normalize('NFD')
                  .replace(/\p{M}/gu, ''),
                legal_entity_id: entity,
                manager_id: parents[i % parents.length],
                job_title: `Specialist ${String(at % 40)}`,
                department: (DEPARTMENTS[at % DEPARTMENTS.length] ?? 'Sales').toLowerCase(),
              },
              hireDate: `20${String(15 + (at % 10))}-0${String(1 + (at % 9))}-1${String(at % 9)}`,
            });
          }),
        )),
      );
    }
    made += count;
    parents = ids;
  }
}

beforeAll(async () => {
  // People's read cache on, as production runs it: nothing here writes past People.
  process.env['ACCEPTANCE_VALKEY'] = '1';
  stack = await startStack(inject('remoteKeys'));
  browser = await chromium.launch();

  for (const [path, body] of [
    ['/v1/views/setup/entity', { name: 'Acme', country: 'ES' }],
    ['/v1/views/setup/publish', { country: 'ES', sections: [] }],
  ] as const) {
    const done = await stack.writeAsPeople(ADMIN.account, path, body);
    expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
  }
  const field = (key: string, label: string, over: Record<string, unknown>) =>
    stack.writeAsPeople(ADMIN.account, '/v1/schema/draft/attributes', {
      input: {
        key,
        sectionKey: 'employment',
        label,
        description: null,
        dataType: 'text',
        options: [],
        requiredness: 'never',
        requiredWhen: null,
        ownership: ['hr'],
        collectAt: 'hr_only',
        visibility: ['self', 'manager', 'manager_chain', 'hr', 'directory'],
        visibilityRules: [],
        classification: 'internal',
        piiKind: 'none',
        classificationSource: 'human',
        requiresApproval: null,
        ...over,
      },
      editing: null,
    });
  for (const [key, label, over] of [
    ['job_title', 'Job title', {}],
    ['department', 'Department', { dataType: 'select', options: DEPARTMENTS }],
    // Nobody has these: Missing details has a gap per person, two per person in all.
    ['desk', 'Desk', { requiredness: 'always' }],
    ['cost_centre', 'Cost centre', { requiredness: 'always' }],
  ] as const) {
    const saved = await field(key, label, over);
    expect(saved.status, JSON.stringify(saved.body)).toBeLessThan(300);
  }
  const today = new Date().toISOString().slice(0, 10);
  const published = await stack.writeAsPeople(ADMIN.account, '/v1/schema/draft/publish', {
    requiredFrom: today,
  });
  expect(published.status, JSON.stringify(published.body)).toBeLessThan(300);
  const [entity] = await stack.sql<{ id: string }[]>`
    SELECT id FROM people.legal_entity WHERE tenant_id = ${TENANT} ORDER BY id LIMIT 1`;
  await hire(N, entity?.id ?? '');
  const [{ count } = { count: 0 }] = await stack.sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM people.person WHERE tenant_id = ${TENANT}`;
  expect(count).toBeGreaterThanOrEqual(N);
}, 3_600_000);

afterAll(async () => {
  for (const r of results) {
    const over = r.value > r.budget ? '  OVER' : '';
    console.info(
      `${r.page.padEnd(34)} ${r.metric.padEnd(28)} ${String(r.value).padStart(9)} / ${String(r.budget)}${over}`,
    );
  }
  await (browser as Browser | undefined)?.close();
  await (stack as Stack | undefined)?.stop();
}, 60_000);

async function signedIn(): Promise<BrowserContext> {
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
  // Observers from the first byte, so the first load's paint and shifts count.
  await context.addInitScript(() => {
    const perf = {
      lcp: 0,
      cls: 0,
      frames: [] as { start: number; duration: number }[],
      events: [] as { name: string; start: number; duration: number; id: number }[],
      down: 0,
    };
    (window as unknown as { perf: typeof perf }).perf = perf;
    const watch = (type: string, take: (e: PerformanceEntry) => void, extra = {}): void => {
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) take(e);
        }).observe({ type, buffered: true, ...extra });
      } catch {
        // Not every engine has every entry type; Chromium does.
      }
    };
    watch('largest-contentful-paint', (e) => {
      perf.lcp = e.startTime;
    });
    watch('layout-shift', (e) => {
      const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (!shift.hadRecentInput) perf.cls += shift.value;
    });
    watch('long-animation-frame', (e) => {
      perf.frames.push({ start: e.startTime, duration: e.duration });
    });
    watch(
      'event',
      (e) => {
        const event = e as PerformanceEntry & { interactionId?: number };
        if ((event.interactionId ?? 0) > 0) {
          perf.events.push({
            name: e.name,
            start: e.startTime,
            duration: e.duration,
            id: event.interactionId ?? 0,
          });
        }
      },
      { durationThreshold: 16 },
    );
    addEventListener(
      'pointerdown',
      () => {
        perf.down = performance.now();
      },
      { capture: true },
    );
  });
  return context;
}

interface Perf {
  lcp: number;
  cls: number;
  frames: { start: number; duration: number }[];
  events: { name: string; start: number; duration: number; id: number }[];
  down: number;
}
const perfOf = (page: Page): Promise<Perf> =>
  page.evaluate(() => (window as unknown as { perf: Perf }).perf);

/** Loads `path` from nothing and records what its first load cost. */
async function firstLoad(page: Page, name: string, path: string, ready: Locator): Promise<void> {
  await page.goto(`${stack.shell}${path}`);
  await ready.first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  // A moment for a late shift or a last paint to be reported.
  await page.waitForTimeout(500);
  const perf = await perfOf(page);
  const scripts = await page.evaluate(() => {
    const warm = performance.getEntriesByName('kithena:warm')[0]?.startTime ?? Infinity;
    return [
      ...new Set(
        performance
          .getEntriesByType('resource')
          .filter((r) => r.startTime < warm)
          .map((r) => r.name)
          .filter((name) => new URL(name).pathname.endsWith('.js')),
      ),
    ];
  });
  let js = 0;
  for (const url of scripts) {
    const body = await (await page.request.get(url)).body();
    js += gzipSync(body).length;
  }
  record(name, 'first load: LCP ms', perf.lcp, BUDGET.lcp);
  record(name, 'first load: CLS', perf.cls, BUDGET.cls);
  const area = path.startsWith('/time-off')
    ? 'timeoff'
    : path.startsWith('/settings')
      ? 'settings'
      : 'people';
  record(name, 'first load: JS KB (gzip)', js / 1024, JS_BUDGET_KB[area] ?? 520);
}

/** `PERF_PROFILE=<dir>`: a CPU profile of what `run` does, for DevTools to open. */
async function profiled<T>(page: Page, name: string, run: () => Promise<T>): Promise<T> {
  const dir = process.env['PERF_PROFILE'];
  if (dir === undefined || dir === '') return run();
  const file = `${dir}/${name.replace(/[^\w]+/g, '-')}`;
  if (process.env['PERF_TRACE'] === '1') {
    // A timeline trace instead, for where style and layout went.
    await browser.startTracing(page, {
      path: `${file}.trace.json`,
      categories: ['devtools.timeline'],
    });
    const result = await run();
    await browser.stopTracing();
    return result;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const result = await run();
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync(`${file}.cpuprofile`, JSON.stringify(profile));
  await cdp.detach();
  return result;
}

/**
 * From the pointer going down on `target` to the frame, painted, in which
 * `shown` holds. The pointer rests on it first, as a mouse does.
 */
async function clickToPaint(
  page: Page,
  name: string,
  target: Locator,
  shown: { readonly path?: RegExp; readonly selector?: string; readonly text?: RegExp },
): Promise<number> {
  await target.first().scrollIntoViewIfNeeded();
  await target.first().hover();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (window as unknown as { perf: Perf }).perf.down = 0;
  });
  const painted = page.evaluate(
    ({ path, selector, text }) =>
      new Promise<number>((resolve, reject) => {
        const perf = (window as unknown as { perf: Perf }).perf;
        const deadline = performance.now() + 30_000;
        const holds = (): boolean => {
          if (perf.down === 0) return false;
          if (path !== undefined && !new RegExp(path).test(location.pathname + location.search))
            return false;
          if (selector !== undefined) {
            const found = [...document.querySelectorAll(selector)].filter(
              (el) => (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0,
            );
            if (found.length === 0) return false;
            if (text !== undefined && !found.some((el) => new RegExp(text).test(el.textContent)))
              return false;
          }
          return true;
        };
        const tick = (): void => {
          if (performance.now() > deadline) {
            reject(new Error(`never shown: ${String(path)} ${String(selector)} ${String(text)}`));
            return;
          }
          if (!holds()) {
            requestAnimationFrame(tick);
            return;
          }
          // The frame it was committed in, then the one after: painted.
          requestAnimationFrame(() => {
            setTimeout(() => {
              resolve(performance.now() - perf.down);
            }, 0);
          });
        };
        tick();
      }),
    { path: shown.path?.source, selector: shown.selector, text: shown.text?.source },
  );
  const ms = await profiled(page, name, async () => {
    await target.first().click();
    return painted;
  });
  record(name, 'click to paint ms', ms, BUDGET.clickToPaint);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  return ms;
}

/** The longest interaction (input to next paint) since `since`, which `act` caused. */
async function interaction(
  page: Page,
  name: string,
  what: string,
  act: () => Promise<void>,
): Promise<void> {
  const before = (await perfOf(page)).events.length;
  await profiled(page, `${name} ${what}`, async () => {
    await act();
    await page.waitForTimeout(300);
  });
  const events = (await perfOf(page)).events.slice(before);
  const worst = events.reduce((max, e) => Math.max(max, e.duration), 0);
  record(name, `${what}: INP ms`, worst, BUDGET.interaction);
}

/** Wheels `over` through, `steps` notches, and records the longest frame on the way. */
async function scrolling(page: Page, name: string, over: Locator, steps = 30): Promise<void> {
  const box = await over.first().boundingBox();
  if (box === null) throw new Error(`${name}: nothing to scroll`);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
  const from = await page.evaluate(() => performance.now());
  await profiled(page, `${name} scroll`, async () => {
    for (let i = 0; i < steps; i += 1) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
  });
  const frames = (await perfOf(page)).frames.filter((f) => f.start >= from);
  const worst = frames.reduce((max, f) => Math.max(max, f.duration), 0);
  record(name, 'scroll: longest frame ms', worst, BUDGET.longFrameWhileScrolling);
}

const link = (page: Page, href: string): Locator => page.locator(`a[href="${href}"]:visible`);
const view = (page: Page, path: string, name: RegExp): Locator =>
  page
    .locator(`a[href^="/people/directory/${path}"]:visible`)
    .or(page.getByRole('radio', { name }))
    .or(page.getByRole('link', { name }));

describe(`Every page at ${String(N)} people`, () => {
  it('Directory: list, cards and the org chart', async () => {
    const context = await signedIn();
    const page = await context.newPage();
    await firstLoad(
      page,
      'directory list',
      '/people/directory/list',
      page.locator('table tbody tr'),
    );

    const search = page.getByRole('searchbox').or(page.getByRole('textbox', { name: /search/i }));
    await interaction(page, 'directory list', 'typing in search', async () => {
      await search.first().click();
      await page.keyboard.type('Ana', { delay: 60 });
    });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForLoadState('networkidle');
    await scrolling(page, 'directory list', page.locator('table'));

    await clickToPaint(page, 'directory → cards', view(page, 'cards', /^Cards/), {
      path: /\/people\/directory\/cards/,
      // The cards themselves, not only the address: the switch changes the address first.
      selector: '[role="list"] [data-person-id]',
    });
    await scrolling(page, 'directory cards', page.locator('main'));
    await clickToPaint(page, 'directory → org chart', view(page, 'org-chart', /^Org chart/), {
      path: /\/people\/directory\/org-chart/,
    });
    await scrolling(page, 'org chart', page.locator('[role="tree"]').or(page.locator('main')));
    await context.close();
  });

  it('Review: every chip, Missing details and Fill in for all', async () => {
    const context = await signedIn();
    const page = await context.newPage();
    await firstLoad(
      page,
      'review',
      '/people/review/waiting',
      page.locator('[data-remote="people"] h1'),
    );
    for (const [tab, path] of [
      ['flagged', '/people/review/flagged'],
      ['asked', '/people/review/asked'],
      ['decided', '/people/review/decided'],
      ['waiting', '/people/review/waiting'],
    ] as const) {
      await clickToPaint(page, `review → ${tab}`, link(page, path), { path: new RegExp(path) });
    }
    const chips = page.locator(
      '[data-remote="people"] [role="radio"], [data-remote="people"] [aria-pressed]',
    );
    const count = Math.min(await chips.count(), 8);
    for (let i = 0; i < count; i += 1) {
      const chip = chips.nth(i);
      const label = ((await chip.textContent()) ?? `chip ${String(i)}`).trim().slice(0, 24);
      await interaction(page, `review chip ${label}`, 'switching chip', async () => {
        await chip.click();
      });
    }
    const missing = page
      .getByRole('radio', { name: /missing/i })
      .or(page.getByRole('button', { name: /missing/i }));
    if ((await missing.count()) > 0) {
      await interaction(page, 'review missing details', 'opening chip', async () => {
        await missing.first().click();
      });
      const fill = page.getByRole('button', { name: 'Fill in for all' });
      if ((await fill.count()) > 0) {
        await clickToPaint(page, 'missing → fill in for all', fill, {
          selector: '[role="dialog"], h2',
          text: /Fill in for/,
        });
      }
    }
    await context.close();
  });

  it('Home, Insights, Import & export', async () => {
    const context = await signedIn();
    const page = await context.newPage();
    await firstLoad(page, 'home', '/', page.locator('main h1, main h2'));
    await firstLoad(
      page,
      'insights',
      '/people/insights/what-changed',
      page.locator('[data-remote="people"] h1'),
    );
    for (const tab of ['headcount', 'turnover', 'data-quality', 'pay']) {
      await clickToPaint(page, `insights → ${tab}`, link(page, `/people/insights/${tab}`), {
        path: new RegExp(`/people/insights/${tab}`),
      });
    }
    await clickToPaint(page, 'insights → import & export', link(page, '/people/import-export'), {
      path: /\/people\/import-export/,
    });
    await context.close();
  });

  it('Settings: fields, roles, organisation, activity; a profile', async () => {
    const context = await signedIn();
    const page = await context.newPage();
    await firstLoad(
      page,
      'settings fields',
      '/settings/people/fields',
      page.locator('[data-remote="people"] h1'),
    );
    await clickToPaint(
      page,
      'fields → add a field',
      page.getByRole('button', { name: 'Add field' }),
      {
        selector: '[role="dialog"]',
      },
    );
    await page.keyboard.press('Escape');
    for (const [name, path] of [
      ['roles', '/settings/people/roles'],
      ['organisation', '/settings/people/organisation'],
    ] as const) {
      await page.goto(`${stack.shell}${path}`);
      await page.locator('[data-remote="people"]').waitFor({ timeout: 60_000 });
      await page.waitForLoadState('networkidle');
      const perf = await perfOf(page);
      record(`settings ${name}`, 'first load: LCP ms', perf.lcp, BUDGET.lcp);
      record(`settings ${name}`, 'first load: CLS', perf.cls, BUDGET.cls);
    }
    await page.goto(`${stack.shell}/settings/activity`);
    await page.locator('main').waitFor({ timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    record('settings activity', 'first load: CLS', (await perfOf(page)).cls, BUDGET.cls);
    await scrolling(page, 'settings activity', page.locator('main'));

    await firstLoad(page, 'profile', '/people/me', page.locator('[data-remote="people"] h1'));
    await context.close();
  });

  it('Time Off: calendar, approvals and requests', async () => {
    const context = await signedIn();
    const page = await context.newPage();
    await firstLoad(page, 'time off calendar', '/time-off/calendar/month', page.locator('main h1'));
    for (const view of ['timeline', 'year', 'month']) {
      await clickToPaint(page, `calendar → ${view}`, link(page, `/time-off/calendar/${view}`), {
        path: new RegExp(`/time-off/calendar/${view}`),
      });
      if (view === 'timeline') await scrolling(page, 'calendar timeline', page.locator('main'));
    }
    for (const [name, path] of [
      ['approvals', '/time-off/approvals/waiting'],
      ['requests', '/time-off/requests/upcoming'],
    ] as const) {
      const target = link(page, path);
      if ((await target.count()) === 0) continue;
      await clickToPaint(page, `time off → ${name}`, target, { path: new RegExp(path) });
    }
    await context.close();
  });

  it('stays within every budget', () => {
    const over = results.filter((r) => r.held && r.value > r.budget);
    expect(
      over,
      over.map((r) => `${r.page} ${r.metric} ${String(r.value)} > ${String(r.budget)}`).join('\n'),
    ).toEqual([]);
  });
});
