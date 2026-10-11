import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';

import { ADMIN, EMPLOYEE, TENANT } from './stack';
import { browser, eventually, person, signedIn, stack, useStack } from './people-harness';

/**
 * People's pages as Acme's HR and staff use them: the overview, Insights'
 * tabs, Import & export as the server sends it, a page while the VM sleeps,
 * and moving between sections. Split from people.acceptance.test.ts so it
 * runs on a runner of its own. Acme starts as the setup wizard leaves it, its
 * legal entity confirmed and version 1 published; each test makes the rest
 * of what it reads.
 */

useStack(async () => {
  for (const [path, body] of [
    ['/v1/views/setup/entity', { name: 'Acme', country: 'ES' }],
    ['/v1/views/setup/publish', { country: 'ES', sections: [] }],
  ] as const) {
    const done = await stack.writeAsPeople(ADMIN.account, path, body);
    expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
  }
});

describe('People overview: who you are here, what needs you, what is missing', () => {
  /** Where the screenshots go, when a run is asked for them. */
  const shots = process.env['OVERVIEW_SHOTS'];
  const shot = async (page: Page, name: string): Promise<void> => {
    if (shots === undefined || shots === '') return;
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  };
  const desktop = { viewport: { width: 1440, height: 1000 } };
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const titled = (page: Page, name: string | RegExp) =>
    page.locator('section', { has: page.getByRole('heading', { level: 2, name }) });

  it('shows HR the change waiting; the employee themselves, their gap, and their photo', async () => {
    // Published, as the wizard would; then a detail each employee gives, one
    // whose change HR approves, and a title.
    await stack.writeAsPeople(ADMIN.account, '/v1/views/setup/publish', {
      country: 'ES',
      sections: [],
    });
    const field = (key: string, label: string, over: Record<string, unknown>) =>
      stack.writeAsPeople(ADMIN.account, '/v1/schema/draft/attributes', {
        input: {
          key,
          sectionKey: 'personal',
          label,
          description: null,
          dataType: 'text',
          options: [],
          requiredness: 'never',
          requiredWhen: null,
          ownership: ['employee', 'hr'],
          collectAt: 'onboarding',
          visibility: ['self', 'hr'],
          visibilityRules: [],
          classification: 'confidential',
          piiKind: 'contact',
          classificationSource: 'human',
          requiresApproval: null,
          ...over,
        },
        editing: null,
      });
    await field('emergency_contact', 'Emergency contact', { requiredness: 'always' });
    await field('desk', 'Desk', {
      requiresApproval: true,
      piiKind: 'none',
      classification: 'internal',
    });
    await field('job_title', 'Job title', {
      sectionKey: 'employment',
      ownership: ['hr'],
      collectAt: 'hr_only',
      visibility: ['self', 'manager', 'manager_chain', 'hr', 'directory'],
      classification: 'internal',
      piiKind: 'none',
    });
    const today = new Date().toISOString().slice(0, 10);
    await stack.writeAsPeople(ADMIN.account, '/v1/schema/draft/publish', { requiredFrom: today });

    // Adam reports to Priya; each has a title.
    const patch = (id: string, attributes: Record<string, unknown>) =>
      fetch(`${stack.peopleUrl}/v1/people/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          'x-internal-token': 'acceptance-people-token',
          'x-correlation-id': randomUUID(),
          'x-kithena-principal': JSON.stringify({
            userId: ADMIN.account,
            tenantId: TENANT,
            roles: [],
            entitlements: ['module.people'],
          }),
        },
        body: JSON.stringify({ attributes }),
      });
    // Named, when an earlier test has not named them already, and Adam hired,
    // so People judges his record complete or not.
    for (const [id, given, family] of [
      [ADMIN.person, 'Priya', 'Shah'],
      [EMPLOYEE.person, 'Adam', 'Ruiz'],
    ] as const) {
      const [row] = await person(id);
      if (row?.given_name === null) {
        expect((await patch(id, { given_name: given, family_name: family })).status).toBeLessThan(
          300,
        );
      }
    }
    const [adam] = await person(EMPLOYEE.person);
    if (adam?.status === 'provisional') {
      const [entity] = await stack.sql<{ id: string }[]>`
        SELECT id FROM people.legal_entity WHERE tenant_id = ${TENANT} ORDER BY id LIMIT 1`;
      const hired = await stack.writeAsPeople(ADMIN.account, `/v1/people/${EMPLOYEE.person}/hire`, {
        hireDate: '2025-02-03',
        ...(entity === undefined ? {} : { legalEntityId: entity.id }),
      });
      expect(hired.status).toBeLessThan(300);
    }
    // As People names somebody: the preferred name first, when there is one.
    const nameOf = async (id: string) => {
      const [row] = await stack.sql<{ name: string }[]>`
        SELECT concat_ws(' ', coalesce(nullif(preferred_name, ''), given_name), family_name) AS name
          FROM people.person WHERE id = ${id}`;
      return row?.name ?? '';
    };
    const priya = await nameOf(ADMIN.person);
    const adamName = await nameOf(EMPLOYEE.person);
    expect((await patch(ADMIN.person, { job_title: 'Head of People' })).status).toBeLessThan(300);
    expect(
      (await patch(EMPLOYEE.person, { manager_id: ADMIN.person, job_title: 'Support Engineer' }))
        .status,
    ).toBeLessThan(300);
    // Adam asks for a new desk: held for HR.
    const asked = await stack.writeAsPeople(EMPLOYEE.account, '/v1/views/me/sections', {
      changed: { desk: 'B-204' },
    });
    expect(asked.status).toBeLessThan(300);

    // HR's overview (W2): the state of the records, and Adam's change waiting.
    for (const [scheme, options, name] of [
      ['light', desktop, 'overview-hr-desktop-light'],
      ['dark', desktop, 'overview-hr-desktop-dark'],
      ['light', phone, 'overview-hr-phone-light'],
    ] as const) {
      const context = await signedIn(ADMIN.session, { ...options, colorScheme: scheme });
      const page = await context.newPage();
      // Home for HR (B2): People's overview, folded into Home.
      await page.goto(`${stack.shell}/`);
      await page.getByRole('heading', { level: 1, name: /^Hi / }).waitFor({ timeout: 30_000 });
      await page.waitForLoadState('networkidle');
      const needs = titled(page, 'Needs HR');
      const changes = needs.getByRole('link', { name: /changes? to approve$/ }).first();
      await changes.waitFor();
      expect(await changes.getAttribute('href')).toBe('/people/review/waiting?kind=changes');
      expect(await needs.getByRole('link', { name: 'Open Review' }).getAttribute('href')).toBe(
        '/people/review/waiting',
      );
      await shot(page, name);
      await context.close();
    }

    // The employee's Home (B1): his manager above him, and the detail only he can give.
    const context = await signedIn(EMPLOYEE.session, { ...desktop, colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/`);
    await page.getByRole('heading', { level: 1, name: /^Hi / }).waitFor({ timeout: 30_000 });
    // Who he is here, in the card beside his To do list.
    await page.getByRole('heading', { level: 2, name: adamName }).waitFor();
    await page.waitForLoadState('networkidle');
    await titled(page, 'Your reporting line').getByRole('link', { name: priya }).waitFor();
    // His To do is the Inbox's first rows: what his record still needs is one
    // checklist there, opened in the Inbox.
    const gap = titled(page, 'To do')
      .getByRole('link', { name: /Finish your profile/ })
      .first();
    await gap.waitFor();
    expect(await gap.getAttribute('href')).toBe(
      `/inbox/todo?item=${encodeURIComponent(`people:onboarding:${EMPLOYEE.person}`)}`,
    );
    await shot(page, 'overview-employee-desktop-light');

    // A field's own link opens his profile at that field, cursor in it, marked missing.
    await page.goto(`${stack.shell}/people/me?field=emergency_contact`);
    const input = page.getByRole('textbox', { name: /Emergency contact/ });
    await input.waitFor({ timeout: 30_000 });
    await expect.poll(() => input.evaluate((el) => el === document.activeElement)).toBe(true);
    await page
      .getByText(/^(\d+ missing|Missing)$/)
      .first()
      .waitFor();
    await shot(page, 'profile-missing-editing-desktop-light');

    // His photo: picked on his profile, shrunk, straight to storage, kept by People.
    await page.goto(`${stack.shell}/people/me`);
    await page.waitForLoadState('networkidle');
    const png = Buffer.from(
      await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(600, 600);
        const g = canvas.getContext('2d');
        if (g === null) throw new Error('no canvas');
        g.fillStyle = '#dbeafe';
        g.fillRect(0, 0, 600, 600);
        g.fillStyle = '#1d4ed8';
        g.beginPath();
        g.arc(300, 250, 110, 0, Math.PI * 2);
        g.fill();
        g.fillRect(140, 400, 320, 200);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return [...new Uint8Array(await blob.arrayBuffer())];
      }),
    );
    await page
      .getByLabel('Photo')
      .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    const [kept] = await eventually(
      'the photo kept',
      () => stack.sql<{ media_type: string }[]>`
        SELECT media_type FROM people.person_photo WHERE person_id = ${EMPLOYEE.person}`,
      (rows) => rows.length === 1,
    );
    // The browser sent a small JPEG drawn from it, not the file picked.
    expect(kept?.media_type).toBe('image/jpeg');
    await page.reload();
    const photo = page.locator('img[src*="/people/photos/"]').first();
    await photo.waitFor({ timeout: 30_000 });
    await expect
      .poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await context.close();

    // And HR sees it beside his name, in the Directory.
    const hr = await signedIn(ADMIN.session, desktop);
    const hrPage = await hr.newPage();
    await hrPage.goto(`${stack.shell}/people/directory/list`);
    await hrPage.waitForLoadState('networkidle');
    const his = hrPage.locator(`img[src*="/people/photos/${EMPLOYEE.person}"]`).first();
    await his.waitFor();
    await expect
      .poll(() => his.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    // The URL itself opens nothing: without a session there is no photo.
    const src = (await his.getAttribute('src')) ?? '';
    const anonymous = await fetch(new URL(src, stack.shell), { redirect: 'manual' });
    expect(anonymous.status).not.toBe(200);
    await shot(hrPage, 'overview-hr-with-photo-desktop-light');
    await hr.close();

    // The profile with its gaps marked, light and dark, and on a phone.
    for (const [scheme, options, name] of [
      ['light', desktop, 'profile-missing-desktop-light'],
      ['dark', desktop, 'profile-missing-desktop-dark'],
      ['light', phone, 'profile-missing-phone-light'],
    ] as const) {
      const c = await signedIn(EMPLOYEE.session, { ...options, colorScheme: scheme });
      const p = await c.newPage();
      await p.goto(`${stack.shell}/people/me`);
      await p
        .getByText(/^(\d+ missing|Missing)$/)
        .first()
        .waitFor({ timeout: 30_000 });
      await p.waitForLoadState('networkidle');
      await shot(p, name);
      await c.close();
    }
  });
});

describe('A tab changes the page under the header, not the page', () => {
  /** Every loading skeleton put into the page from now on. */
  const watchSkeletons = (page: Page): Promise<void> =>
    page.evaluate(() => {
      const w = window as unknown as { skeletons: string[] };
      w.skeletons = [];
      new MutationObserver(() => {
        for (const s of document.querySelectorAll('[role=status]')) {
          if (/Loading/.test(s.textContent)) w.skeletons.push(s.textContent);
        }
      }).observe(document.body, { subtree: true, childList: true });
    });
  const skeletons = (page: Page): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { skeletons: string[] }).skeletons);
  const tab = (page: Page, name: string) =>
    page
      .getByRole('navigation', { name: 'Insights tabs' })
      .getByRole('link', { name, exact: true });

  it('keeps the header the same element, and shows a page seen before at once after the stale time', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/insights/headcount`);
    await page.getByRole('heading', { level: 1, name: 'Insights' }).waitFor({ timeout: 30_000 });
    // Presses count once the remote has hydrated.
    await page.waitForLoadState('networkidle');

    // Another tab of the same screen: the header is the element it was, and
    // nothing in the page is a skeleton at any moment.
    await page.evaluate(() => {
      const h1 = document.querySelector<HTMLElement>('[data-remote] h1');
      if (h1 !== null) Object.assign(h1, { kept: true });
    });
    await watchSkeletons(page);
    await tab(page, 'Turnover').click();
    await page.waitForURL(/\/people\/insights\/turnover$/);
    await expect.poll(() => tab(page, 'Turnover').getAttribute('aria-current')).toBe('page');
    await page.waitForLoadState('networkidle');
    expect(
      await page.evaluate(
        () => (document.querySelector('[data-remote] h1') as { kept?: true } | null)?.kept,
      ),
    ).toBe(true);
    expect(await skeletons(page)).toEqual([]);

    // A screen of its own behind a tab, seen once, then left for longer than
    // the browser keeps a page (`staleTimes.dynamic`, 30 s): shown as it was,
    // with no skeleton, while it is fetched again.
    await tab(page, 'What changed').click();
    await page.waitForURL(/\/people\/insights\/what-changed$/);
    await page.waitForLoadState('networkidle');
    await tab(page, 'Headcount').click();
    await page.waitForURL(/\/people\/insights\/headcount$/);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(31_000);
    await watchSkeletons(page);
    await tab(page, 'What changed').click();
    await page.waitForURL(/\/people\/insights\/what-changed$/);
    await page.waitForLoadState('networkidle');
    expect(await skeletons(page)).toEqual([]);
    expect(await tab(page, 'What changed').getAttribute('aria-current')).toBe('page');
    await context.close();
  });
});

/**
 * Import & export's landing page: what is the same every time is in the
 * server's HTML and paints at once; only the history may follow it. With
 * `ACCEPTANCE_ROUTER_LATENCY_MS` (and `ACCEPTANCE_SLOW_OPERATION`) and
 * `LANDING_OUT`, a run also writes down how long each part took.
 */
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

describe('A People page while the VM behind it is asleep', () => {
  it('says People is waking, asks again by itself, and shows the page in place when it is up', async () => {
    const context = await signedIn(EMPLOYEE.session);
    const page = await context.newPage();
    const address = `${stack.shell}/people/directory/list?q=shah`;
    stack.router.asleep();
    try {
      await page.goto(address);
      // The server's own answer: the header and the waking state, not an error.
      await page.getByText('Waking up People, usually under a minute').waitFor({ timeout: 30_000 });
      expect(await page.getByText(/The server sleeps when nobody is using it/).count()).toBe(1);
      expect(await page.getByText(/is unavailable/).count()).toBe(0);
      // Still waking after a few of its own asks.
      await page.waitForTimeout(6_000);
      expect(await page.getByText('Waking up People, usually under a minute').count()).toBe(1);
      // Marked, so a reload would show: a new document has no mark.
      await page.evaluate(() => {
        (window as unknown as { stayed?: true }).stayed = true;
      });
    } finally {
      stack.router.awake();
    }

    // The screen People's remote draws, whatever this tenant holds by now.
    await page
      .locator('[data-remote="people"]')
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 });
    expect(await page.getByText(/Waking up People/).count()).toBe(0);
    expect(await page.getByText(/is unavailable/).count()).toBe(0);
    expect(await page.getByRole('status').filter({ hasText: 'People is ready' }).count()).toBe(1);
    expect(page.url()).toBe(address);
    expect(await page.evaluate(() => (window as unknown as { stayed?: true }).stayed)).toBe(true);
    await context.close();
  });
});

/**
 * Moving between People's pages as a person does: a pointer that rests on a
 * link a moment before pressing it, on a page they have had a second to
 * read. Each move is timed from the press to the address changing, which is
 * when the next page is drawn: the previous one stays until then, with no
 * skeleton in between. With `NAV_OUT`, a run writes the timings down.
 */
describe('Moving between People’s sections, tabs and views', () => {
  it('lands every move, with no skeleton between pages', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/directory/list`);
    await page
      .locator('[data-remote="people"]')
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const w = window as unknown as { skeletons: string[] };
      w.skeletons = [];
      new MutationObserver(() => {
        for (const s of document.querySelectorAll('[role=status]')) {
          if (/Loading/.test(s.textContent)) w.skeletons.push(s.textContent);
        }
      }).observe(document.body, { subtree: true, childList: true });
    });
    // A place's name, whatever its count says beside it when something waits there.
    const named = (name: string) => new RegExp(`^${name}`);
    const sidebar = (name: string) =>
      page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: named(name) });
    const tab = (section: string, name: string) =>
      page
        .getByRole('navigation', { name: `${section} tabs` })
        .getByRole('link', { name: named(name) });
    const moves: [string, number][] = [];
    const move = async (link: ReturnType<typeof sidebar>, to: RegExp): Promise<void> => {
      await link.first().hover();
      await page.waitForTimeout(150);
      const start = performance.now();
      await link.first().click();
      await page.waitForURL(to, { timeout: 30_000 });
      moves.push([to.source, Math.round(performance.now() - start)]);
      // A moment on the page, as somebody reading it.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1_000);
    };
    await move(sidebar('Review'), /\/people\/review\/waiting/);
    await move(tab('Review', 'Decided'), /\/people\/review\/decided/);
    await move(tab('Review', 'Flagged'), /\/people\/review\/flagged/);
    await move(sidebar('Insights'), /\/people\/insights\/what-changed/);
    await move(tab('Insights', 'Headcount'), /\/people\/insights\/headcount/);
    await move(tab('Insights', 'Turnover'), /\/people\/insights\/turnover/);
    await move(sidebar('Import & export'), /\/people\/import-export/);
    await move(sidebar('Directory'), /\/people\/directory\/list/);
    await move(sidebar('Review'), /\/people\/review\/waiting/);
    await move(sidebar('Directory'), /\/people\/directory\/list/);
    const out = process.env['NAV_OUT'];
    if (out !== undefined) {
      for (const [to, ms] of moves) appendFileSync(out, `${to} ${String(ms)}\n`);
    }
    expect(moves).toHaveLength(10);
    expect(
      await page.evaluate(() => (window as unknown as { skeletons: string[] }).skeletons),
    ).toEqual([]);
    await context.close();
  });
});
