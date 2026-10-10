import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

import { ADMIN, EMPLOYEE, TENANT, startStack, type Stack } from './stack';

/**
 * The directory's filters, end to end: a condition built in the Filters
 * dialog narrows the list People answers, and its chip removes it again.
 * And what the browser already holds is not asked for again: no page is
 * prefetched just for being on screen, and a profile's documents are read
 * once however often it is opened within half a minute.
 */

let stack: Stack;
let browser: Browser;

beforeAll(async () => {
  stack = await startStack(inject('remoteKeys'));
  browser = await chromium.launch();
  for (const [path, body] of [
    ['/v1/views/setup/entity', { name: 'Acme', country: 'ES' }],
    ['/v1/views/setup/publish', { country: 'ES', sections: [] }],
  ] as const) {
    const done = await stack.writeAsPeople(ADMIN.account, path, body);
    expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
  }
  const [entity] = await stack.sql<{ id: string }[]>`
    SELECT id::text FROM people.legal_entity WHERE tenant_id = ${TENANT} LIMIT 1`;
  for (const [who, given, family, manager] of [
    [ADMIN, 'Priya', 'Shah', null],
    [EMPLOYEE, 'Adam', 'Ruiz', ADMIN.person],
  ] as const) {
    await stack.asPeople(ADMIN.account, `/v1/people/${who.person}`, {
      method: 'PATCH',
      body: {
        attributes: {
          given_name: given,
          family_name: family,
          ...(manager === null ? {} : { manager_id: manager }),
        },
      },
    });
    const hired = await stack.writeAsPeople(ADMIN.account, `/v1/people/${who.person}/hire`, {
      hireDate: who === ADMIN ? '2024-03-04' : '2025-01-06',
      legalEntityId: entity?.id,
    });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);
  }
}, 900_000);

afterAll(async () => {
  await (browser as Browser | undefined)?.close();
  await (stack as Stack | undefined)?.stop();
}, 60_000);

async function admin(): Promise<{ page: Page; errors: string[] }> {
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
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Vercel's Speed Insights script is served on Vercel alone.
    if (m.type() === 'error' && !m.location().url.includes('/_vercel/')) errors.push(m.text());
  });
  return { page, errors };
}

/** Who the list shows, by name: the table's rows, not the quick look beside it. */
const names = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('tbody tr, li')]
      .map((r) => r.textContent)
      .flatMap((t) => ['Adam Ruiz', 'Priya Shah'].filter((n) => t.includes(n)))
      .filter((n, i, all) => all.indexOf(n) === i)
      .sort(),
  );

describe('the directory filters', () => {
  it('narrows the list by a condition from the Filters dialog, and widens it from its chip', async () => {
    const { page, errors } = await admin();
    // Each error with the step it came in, so a failure says where.
    const seen = (step: string) => errors.splice(0).map((e) => `${step}: ${e}`);
    const problems: string[] = [];
    await page.goto(`${stack.shell}/people/directory/list`);
    await expect.poll(() => names(page), { timeout: 30_000 }).toEqual(['Adam Ruiz', 'Priya Shah']);
    problems.push(...seen('first load'));

    await page.getByRole('button', { name: 'Add filter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Filter people' });
    await dialog.getByRole('combobox', { name: 'Condition 1 field' }).click();
    await page.getByRole('option', { name: 'Manager', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Condition 1 operator' }).click();
    await page.getByRole('option', { name: 'is empty', exact: true }).click();
    // Applying closes the dialog; the close must not undo the navigation.
    await dialog.getByRole('button', { name: 'Apply 1 condition' }).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('conditions'), { timeout: 15_000 })
      .toBe(JSON.stringify([{ key: 'manager_id', op: 'empty', values: [] }]));
    expect(new URL(page.url()).searchParams.get('filters')).toBeNull();
    await expect.poll(() => names(page), { timeout: 15_000 }).toEqual(['Priya Shah']);
    await page.waitForLoadState('networkidle');
    problems.push(...seen('applied'));

    await page.getByRole('button', { name: 'Remove Manager is empty' }).click();
    await expect.poll(() => names(page), { timeout: 15_000 }).toEqual(['Adam Ruiz', 'Priya Shah']);
    await page.waitForLoadState('networkidle');
    problems.push(...seen('removed'));
    expect(problems).toEqual([]);
  });
});

describe('what the browser already holds', () => {
  it('prefetches no page for being on screen, and reads a profile’s documents once', async () => {
    const { page } = await admin();
    const asked: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (r.headers()['next-action'] !== undefined) asked.push(`action ${url.pathname}`);
      else if (url.searchParams.has('_rsc')) asked.push(`page ${url.pathname}`);
    });
    await page.goto(`${stack.shell}/people/directory/list`);
    await page.waitForLoadState('networkidle');
    // The directory's other views are fetched whole on purpose (`useWarmPages`);
    // the sidebar's sections, merely visible, are not.
    for (const section of ['/', '/inbox/todo', '/time-off/overview', '/settings']) {
      expect(asked, section).not.toContain(`page ${section}`);
    }

    const adam = `/people/${EMPLOYEE.person}`;
    const openAdam = async () => {
      await page.locator('tbody tr', { hasText: 'Adam Ruiz' }).click();
      await page.getByRole('button', { name: 'Open profile' }).click();
      await page.waitForURL((u) => u.pathname === adam);
      await page.getByRole('heading', { name: 'Adam Ruiz' }).first().waitFor();
      await page.waitForLoadState('networkidle');
    };
    await openAdam();
    await page
      .getByRole('navigation', { name: 'Areas' })
      .getByRole('link', { name: 'Directory' })
      .click();
    await page.waitForURL(/\/people\/directory\//);
    await page.waitForLoadState('networkidle');
    await openAdam();
    // Their documents: asked for on the first visit, drawn from the tab's copy on the second.
    expect(asked.filter((a) => a === `action ${adam}`)).toHaveLength(1);
  });
});
