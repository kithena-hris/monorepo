import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { ADMIN, EMPLOYEE } from './stack';
import {
  browser,
  eventually,
  peopleItem,
  sections,
  signedIn,
  stack,
  upload,
  useStack,
} from './people-harness';

/**
 * People in companies other than Acme, each made here: Globex with nobody in
 * People yet, and companies the back office has just created, set up from
 * nothing by their administrator. Split from people.acceptance.test.ts so it
 * runs on a runner of its own; it needs nothing that file sets up.
 */

useStack();

describe('People inside the shell: its sections, and always a way to add somebody', () => {
  /** A second company with nobody in People yet, and one person holding HR and People admin. */
  const GLOBEX = {
    tenant: '00000000-0000-4000-8000-00000000bb00',
    identity: '00000000-0000-4000-8000-0000000000c9',
    account: '00000000-0000-4000-8000-0000000000b9',
    session: '00000000-0000-4000-8000-0000000000d9',
  };

  it('takes HR from an empty directory to a new employee without leaving the shell', async () => {
    await stack.sql`INSERT INTO platform.tenant (id, slug, display_name, address_line1, address_city, address_country)
                    VALUES (${GLOBEX.tenant}, 'globex', 'Globex', 'Gran Vía 1', 'Madrid', 'ES')`;
    await stack.sql`INSERT INTO platform.identity (id) VALUES (${GLOBEX.identity})`;
    await stack.sql`INSERT INTO platform.account (id, tenant_id, identity_id, status, work_email, time_zone,
                                                  employment_start, session_limit, given_name, family_name)
                    VALUES (${GLOBEX.account}, ${GLOBEX.tenant}, ${GLOBEX.identity}, 'active', 'mia@globex.example',
                            'Europe/Madrid', '2026-01-01', 4, 'Mia', 'Lind')`;
    await stack.sql`INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at, amr)
                    VALUES (${GLOBEX.session}, ${GLOBEX.tenant}, ${GLOBEX.account}, 1, now() + interval '1 day', ARRAY['hwk'])`;
    await stack.sql`INSERT INTO people.role_grant (tenant_id, account_id, role)
                    VALUES (${GLOBEX.tenant}, ${GLOBEX.account}, 'people_admin'), (${GLOBEX.tenant}, ${GLOBEX.account}, 'hr')`;
    await stack.writeTuples([
      {
        user: `user:${GLOBEX.account}`,
        relation: 'people_admin',
        object: `tenant:${GLOBEX.tenant}`,
      },
      { user: `user:${GLOBEX.account}`, relation: 'hr', object: `tenant:${GLOBEX.tenant}` },
    ]);
    const shell = stack.shell.replace('//acme.', '//globex.');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([
      {
        name: '__Host-ksession',
        value: GLOBEX.session,
        domain: new URL(shell).hostname,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();

    // Nothing published: the administrator is taken to the wizard, not left
    // on a directory that cannot load.
    await page.goto(`${shell}/people/directory/list`);
    await page.waitForURL(/\/people\/setup$/);
    await page
      .getByRole('heading', { name: 'Confirm the legal entity' })
      .waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/Spain: \d+ sections?, \d+ fields/).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Publish version 1' }).click();
    await eventually(
      'version 1',
      () => stack.sql`SELECT 1 FROM people.schema_version WHERE tenant_id = ${GLOBEX.tenant}`,
      (rows) => rows.length === 1,
    );

    // The shell's sidebar, and People's four sections inline under its item
    // while you are in People (A1): nothing opens on hover, nothing covers the screen.
    await page.goto(`${shell}/people/review/waiting`);
    await page.waitForLoadState('networkidle');
    expect(await page.getByRole('navigation', { name: 'Areas' }).isVisible()).toBe(true);

    // The company at the top, never Kithena: Globex's initial while it has no
    // logo, and its logo, uncropped, once it has one.
    const brand = page.getByRole('link', { name: 'Globex, home' });
    expect(await brand.getByText('G', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByTitle('Kithena').count()).toBe(0);
    const logo = `data:image/svg+xml,${encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 32'><circle cx='16' cy='16' r='12' fill='#1f2937'/><rect x='34' y='10' width='56' height='12' rx='3' fill='#1f2937'/></svg>",
    )}`;
    await stack.sql`UPDATE platform.tenant SET logo_url = ${logo} WHERE id = ${GLOBEX.tenant}`;
    await page.reload();
    await brand.locator('img').waitFor();
    expect(await brand.locator('img').getAttribute('src')).toBe(logo);
    const shots = process.env['OVERVIEW_SHOTS'];
    const shot = async (name: string): Promise<void> => {
      if (shots !== undefined && shots !== '')
        await page.screenshot({ path: join(shots, `${name}.png`) });
    };
    await page.waitForLoadState('networkidle');
    await shot('sidebar-logo-desktop-light');
    const dark = (on: boolean) =>
      page.evaluate((d) => document.documentElement.classList.toggle('dark', d), on);
    await dark(true);
    await page.waitForTimeout(400); // the colours' own transition
    await shot('sidebar-logo-desktop-dark');
    await dark(false);

    const nav = await sections(page);
    expect(await nav.getByRole('link', { name: /^Review/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await nav.getByRole('link').count()).toBe(4);
    // The People item is a place to go, not a menu to open.
    expect(await peopleItem(page).getAttribute('aria-expanded')).toBeNull();
    const flyout = page.getByRole('navigation', { name: 'People sections' });
    await peopleItem(page).hover();
    await page.waitForTimeout(300);
    expect(await flyout.count()).toBe(0);

    // Collapsed to the rail, the same sections come out beside People on
    // hover (V8), after a moment, and Escape puts them away.
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await nav.waitFor({ state: 'detached' });
    await page.mouse.move(900, 600);
    // The rail keeps the mark, and the link its name.
    expect(await brand.locator('img').isVisible()).toBe(true);
    await shot('sidebar-logo-rail-light');
    expect(await peopleItem(page).getAttribute('aria-expanded')).toBe('false');
    await peopleItem(page).hover();
    await flyout.waitFor();
    expect(await peopleItem(page).getAttribute('aria-expanded')).toBe('true');
    expect(await flyout.getByRole('link', { name: /^Review/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    await page.keyboard.press('Escape');
    await flyout.waitFor({ state: 'detached' });
    await page.mouse.move(900, 600);
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await sections(page);
    // Review carries the design's trail, People › Review, whose crumb
    // switches to a sibling section.
    await page.getByRole('navigation', { name: 'Breadcrumb' }).waitFor();

    // A marker on the window: it survives a client-side move and not a reload.
    await page.evaluate(() => {
      (window as unknown as { kept?: boolean }).kept = true;
    });
    const kept = () => page.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

    await nav.getByRole('link', { name: 'Directory' }).click();
    await page.waitForURL(/\/people\/directory\/list$/);
    await page.getByText('No employees yet').waitFor({ timeout: 30_000 });
    expect(await kept()).toBe(true);
    // One header: where you are stays on screen once the sections close, in
    // the screen's own header above its title.
    const screenHeader = page.locator('[data-remote="people"]').filter({ visible: true }).first();
    expect(
      await screenHeader
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByText('Directory')
        .isVisible(),
    ).toBe(true);

    // Add person in the screen's header (the design's name for it, W3), last
    // in the row after the screen's own List / Cards / Org chart switch (V2),
    // and never repeated in a bar above it.
    await page.waitForLoadState('networkidle');
    const header = page.getByRole('main').getByRole('link', { name: 'Add person' });
    expect(await header.count()).toBe(1);
    expect(await screenHeader.getByRole('link', { name: 'Add person' }).count()).toBe(1);
    expect(
      await header.evaluate((a) => {
        // Before it in the row as laid out. The phone bar that holds the
        // frame's actions is `display: contents` at a desk: a wrapper, not a box.
        let at: Element = a;
        while (
          at.previousElementSibling === null &&
          at.parentElement !== null &&
          getComputedStyle(at.parentElement).display === 'contents'
        ) {
          at = at.parentElement;
        }
        return /Org chart/.test(at.previousElementSibling?.textContent ?? '');
      }),
    ).toBe(true);
    // The empty directory says how people arrive and offers both ways in
    // (C9): Import, and Add person. Both Add persons are one way to add
    // somebody: the same dialog, centred over the directory, at the address
    // the header links to.
    const empty = page.getByRole('main');
    expect(await empty.getByRole('button', { name: 'Import' }).count()).toBe(1);
    const add = empty.getByRole('button', { name: 'Add person' });
    expect(await add.count()).toBe(1);
    expect(await header.getAttribute('href')).toBe('/people/directory/list?add=person');
    await add.click();
    await page.waitForURL(/\/people\/directory\/list\?add=person$/);
    expect(await kept()).toBe(true);
    const form = page
      .getByRole('dialog', { name: 'Add a person' })
      .getByRole('form', { name: 'Add employee' });
    await form.waitFor({ timeout: 30_000 });
    await form.getByRole('textbox', { name: /Legal first name/ }).fill('Lena');
    await form.getByRole('textbox', { name: /Legal family name/ }).fill('Moreau');
    await form.getByRole('textbox', { name: /Work email/ }).fill('lena@globex.example');
    // Starting today: hired, and active, rather than provisional.
    await form.getByRole('button', { name: /Start date/ }).click();
    await page.getByRole('dialog').locator('[aria-current="date"]').click();
    await form.getByRole('button', { name: 'Add employee' }).click();

    // Her record, to fill in the rest, under the Directory; and she is in it.
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    expect(
      await (
        await sections(page)
      )
        .getByRole('link', { name: 'Directory' })
        .getAttribute('aria-current'),
    ).toBe('page');
    const [lena] = await stack.sql<{ status: string; hire_date: string | null }[]>`
      SELECT status, hire_date::text FROM people.person
       WHERE tenant_id = ${GLOBEX.tenant} AND work_email = 'lena@globex.example'`;
    expect(lena).toEqual({ status: 'active', hire_date: new Date().toISOString().slice(0, 10) });
    await (await sections(page)).getByRole('link', { name: 'Directory' }).click();
    await page.waitForURL(/\/people\/directory\/list$/);
    await page
      .getByRole('grid', { name: 'People' })
      .getByText('Lena Moreau')
      .waitFor({ timeout: 30_000 });
    // Counts that say what the list holds: everybody, then who is active.
    await page.getByText(/^\d+ (people|person) · \d+ active/).waitFor();
    expect(await kept()).toBe(true);

    // Every section is reachable from the keyboard and stays inside the shell:
    // focus on People, Tab on into its sections to the one wanted, Enter — a
    // client-side move, the sidebar still there, never another origin.
    const hrefs = await (
      await sections(page)
    )
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs).toContain('/people/import-export');
    for (const href of hrefs) {
      await sections(page);
      await peopleItem(page).focus();
      for (let tabs = 0; tabs <= hrefs.length; tabs += 1) {
        await page.keyboard.press('Tab');
        const at = await page.evaluate(() => document.activeElement?.getAttribute('href') ?? '');
        if (at === href) break;
      }
      // Straight from People into its sections: nothing sits between them.
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('[aria-label="People sections"]') != null,
        ),
      ).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.getAttribute('href'))).toBe(href);
      await page.keyboard.press('Enter');
      await page.waitForURL((url) => url.pathname === href);
      expect(new URL(page.url()).origin).toBe(new URL(shell).origin);
      expect(await kept()).toBe(true);
      expect(await page.getByRole('navigation', { name: 'Areas' }).isVisible()).toBe(true);
    }
    await context.close();

    // Anybody else: the sections their roles open, and no way to add anybody.
    const employee = await signedIn(EMPLOYEE.session, { viewport: { width: 1280, height: 900 } });
    const theirs = await employee.newPage();
    await theirs.goto(`${stack.shell}/people/directory/list`);
    expect(await theirs.getByRole('link', { name: 'Add person' }).count()).toBe(0);
    expect(await theirs.getByRole('button', { name: 'Add person' }).count()).toBe(0);
    await theirs.goto(`${stack.shell}/people/import-export`);
    await theirs.getByRole('link', { name: 'New export' }).waitFor({ timeout: 30_000 });
    expect(await theirs.getByRole('link', { name: 'Start import' }).count()).toBe(0);
    await employee.close();
  });
});

describe('A company the back office has just created, with nothing published', () => {
  /** A Chicago company, as Meridian Freight was made: People and Time off, one administrator. */
  const company = (slug: string, displayName: string, admin: string) =>
    stack.provisionCompany({
      slug,
      displayName,
      admin,
      address: {
        country: 'US',
        line1: '233 S Wacker Dr',
        city: 'Chicago',
        subdivision: 'IL',
        postcode: '60606',
      },
      timeZone: 'America/Chicago',
      entitlements: ['module.people', 'module.timeoff'],
      name: { given: 'Ines', family: 'Okafor', preferred: 'Ini' },
    });

  async function asAdministrator(made: Awaited<ReturnType<typeof company>>) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([
      {
        name: '__Host-ksession',
        value: made.session,
        domain: new URL(made.shell).hostname,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    // What Meridian's administrator met: the remote's code refused, or a screen that threw.
    const problems: string[] = [];
    page.on('pageerror', (e) => {
      // A text mismatch React recovers from by drawing in the browser (#418) is
      // not this, and a page on this path has one still to find.
      if (!e.message.includes('error #418')) problems.push(e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && /Federation|dynamically imported module/.test(m.text())) {
        problems.push(m.text());
      }
    });
    const unavailable = () => page.getByText(/is unavailable/).count();
    return { context, page, problems, unavailable };
  }

  it('takes its administrator from People through setup, and back to People', async () => {
    const made = await company('meridian-freight', 'Meridian Freight', 'ines@meridian.example');
    const { context, page, problems, unavailable } = await asAdministrator(made);
    // People told identity who administers it, with the token both hold: the
    // back office's view, which production's 401 left empty, not her rights.
    const [report] = await stack.sql<{ holders: { accountId: string; roles: string[] }[] }[]>`
      SELECT holders FROM platform.module_role_report
       WHERE tenant_id = ${made.tenantId} AND entitlement = 'module.people'`;
    expect(report?.holders).toEqual([{ accountId: made.account, roles: ['people_admin', 'hr'] }]);

    // Home draws; People, by the sidebar, opens its first section, which sends her to setup.
    await page.goto(`${made.shell}/`);
    await page.waitForLoadState('networkidle');
    await page
      .getByRole('navigation', { name: 'Areas' })
      .getByRole('link', { name: 'People' })
      .click();
    await page.waitForURL(/\/people\/setup$/);
    await page.getByRole('heading', { name: 'Confirm the legal entity' }).waitFor();
    await page.waitForLoadState('networkidle');
    // The company as the back office recorded it, ready to confirm.
    expect(await page.getByRole('textbox', { name: /Registered name/ }).inputValue()).toBe(
      'Meridian Freight',
    );
    expect(await unavailable()).toBe(0);

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/United States: \d+ sections?, \d+ fields?/).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Publish version 1' }).click();
    const personal = page.getByRole('form', { name: 'Personal information' });
    await personal.waitFor({ timeout: 30_000 });
    const versions = await stack.sql<{ version: number }[]>`
      SELECT version FROM people.schema_version WHERE tenant_id = ${made.tenantId}`;
    expect(versions.map((v) => v.version)).toEqual([1]);

    await personal.getByRole('textbox', { name: /Legal first name/ }).fill('Ines');
    await personal.getByRole('textbox', { name: /Legal family name/ }).fill('Okafor');
    await personal.getByRole('button', { name: 'Save' }).click();
    await eventually(
      'her names',
      () => stack.sql<{ family_name: string | null }[]>`
        SELECT family_name FROM people.person WHERE tenant_id = ${made.tenantId}`,
      ([p]) => p?.family_name === 'Okafor',
    );
    await page.getByRole('button', { name: /^Finish/ }).click();
    await page.waitForURL(/\/people\/me$/);
    await page.getByRole('heading', { name: /Okafor/ }).waitFor({ timeout: 30_000 });

    // People, set up: the directory is the directory now, not setup.
    await page.goto(`${made.shell}/people/directory/list`);
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/people/directory/list');
    await page.getByText('Okafor').first().waitFor({ timeout: 30_000 });
    expect(await unavailable()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  });

  it('loads the remote in a browser that has already opened another company', async () => {
    // Meridian's administrator had opened Dunder Mifflin first. One browser,
    // its cache kept: the remote's files are already held from the first
    // company, and the second revalidates them, a 304.
    const made = await company('northwind-haulage', 'Northwind Haulage', 'ines@northwind.example');
    const second = made.shell;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(
      [
        [stack.shell, ADMIN.session],
        [second, made.session],
      ].map(([shell, session]) => ({
        name: '__Host-ksession',
        value: session ?? '',
        domain: new URL(shell ?? '').hostname,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax' as const,
      })),
    );
    const refused: string[] = [];
    context.on('console', (m) => {
      if (/Federation|dynamically imported module/.test(m.text())) refused.push(m.text());
    });
    const page = await context.newPage();
    const hydrated = () =>
      page.waitForFunction(() => document.querySelector('[data-remote][data-hydrating]') === null);

    await page.goto(`${stack.shell}/people/directory/list`);
    await page.waitForLoadState('networkidle');
    await hydrated();

    await page.goto(`${second}/people/setup`);
    await page.getByRole('heading', { name: 'Confirm the legal entity' }).waitFor();
    await page.waitForLoadState('networkidle');
    await hydrated();
    // Before, here: the federation runtime's RUNTIME-008, and "People is unavailable".
    expect(refused).toEqual([]);
    expect(await page.getByText(/is unavailable/).count()).toBe(0);
    // A press the screen answers: its code came, from this company's own host.
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/United States: \d+ sections?, \d+ fields?/).waitFor({ timeout: 30_000 });
    // Through the shell, the remote's caching arrives as the remote sent it.
    const cached = await page.evaluate(async () => {
      const first = await fetch('/_people/remoteEntry.js', { cache: 'no-store' });
      const etag = first.headers.get('etag') ?? '';
      const again = await fetch('/_people/remoteEntry.js', {
        cache: 'no-store',
        headers: { 'if-none-match': etag },
      });
      return {
        status: first.status,
        cacheControl: first.headers.get('cache-control'),
        nosniff: first.headers.get('x-content-type-options'),
        etag: etag !== '',
        revalidated: again.status,
      };
    });
    expect(cached).toEqual({
      status: 200,
      cacheControl: 'no-cache',
      nosniff: 'nosniff',
      etag: true,
      revalidated: 304,
    });
    await context.close();
  });

  it('lets its administrator go straight to the import, which sets the company up', async () => {
    const made = await company('harbour-logistics', 'Harbour Logistics', 'ines@harbour.example');
    const { context, page, problems, unavailable } = await asAdministrator(made);

    // Import & export, then Import: the upload, not "an administrator imports the first file".
    await page.goto(`${made.shell}/people/import-export`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Start import' }).first().click();
    await page.waitForURL(/\/people\/import$/);
    expect(await page.getByText('An administrator imports the first file').count()).toBe(0);
    await upload(
      page,
      'harbour.csv',
      [
        'given_name,family_name,work_email,hire_date,Employment Status,Termination Date,Termination Reason',
        'Maya,Chen,maya@harbour.example,2025-01-06,Active,,',
        'Luis,Ortega,luis@harbour.example,2025-02-03,Active,,',
        'Ana,Ruiz,ana@harbour.example,2019-04-01,Terminated,2023-06-30,Resignation - personal',
      ].join('\n'),
    );
    await page.getByRole('button', { name: 'Next: decide what’s new' }).click({ timeout: 30_000 });
    await page.waitForURL(/\?step=review$/);
    // The lifecycle columns are People's own: the plan says what they do, in one line.
    await page
      .getByText('1 person already left (offboarded from their termination date)', { exact: true })
      .waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Approve and run' }).click();
    await page.getByRole('heading', { name: /^Imported 3 people/ }).waitFor({ timeout: 30_000 });
    const ana = await stack.sql<{ status: string; day: string; account: string | null }[]>`
      SELECT status, last_working_day::text AS day, identity_account_id AS account
        FROM people.person WHERE tenant_id = ${made.tenantId} AND work_email = 'ana@harbour.example'`;
    expect(ana).toEqual([{ status: 'terminated', day: '2023-06-30', account: null }]);

    // Approving the plan published version 1, so People opens on the directory.
    const versions = await stack.sql<{ version: number }[]>`
      SELECT version FROM people.schema_version WHERE tenant_id = ${made.tenantId}`;
    expect(versions.map((v) => v.version)).toEqual([1]);
    await page.goto(`${made.shell}/people/directory/list`);
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/people/directory/list');
    await page.getByText('Ortega').first().waitFor({ timeout: 30_000 });
    expect(await unavailable()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  });

  it('runs an approved import in the background, through a reload, while Import waits for it', async () => {
    const made = await company('cascade-transit', 'Cascade Transit', 'ines@cascade.example');
    const { context, page, problems, unavailable } = await asAdministrator(made);
    const ROWS = 400;
    const csv = [
      'given_name,family_name,work_email,hire_date',
      ...Array.from(
        { length: ROWS },
        (_, i) => `Person${String(i)},Cascade,p${String(i)}@cascade.example,2025-01-06`,
      ),
    ].join('\n');
    await page.goto(`${made.shell}/people/import`);
    // Hydrated first: a file chosen before the remote's handlers are on goes nowhere.
    await page.waitForLoadState('networkidle');
    await upload(page, 'cascade.csv', csv);
    await page.getByRole('button', { name: 'Next: decide what’s new' }).click({ timeout: 120_000 });
    await page.waitForURL(/\?step=review$/);
    const approve = page.getByRole('button', { name: 'Approve and run' });
    await approve.waitFor({ timeout: 120_000 });
    const approving = Date.now();
    await approve.click();

    // Answered at once, with the run: its own address replaces the plan's.
    await page.waitForURL(/\/people\/import\?run=[0-9a-f-]{36}$/, { timeout: 15_000 });
    expect(Date.now() - approving).toBeLessThan(15_000);
    const runUrl = page.url();
    const importing = page.getByRole('heading', { name: 'Importing' });
    const imported = page.getByRole('heading', { name: /^Imported 400 people/ });
    await importing.waitFor({ timeout: 15_000 });
    await page.getByText(/It carries on if you close this page/).waitFor();

    // Meanwhile nobody starts another: Import & export's Import is off, saying why.
    const other = await context.newPage();
    await other.goto(`${made.shell}/people/import-export`);
    const start = other.getByRole('button', { name: 'Start import' }).first();
    await start.waitFor({ timeout: 30_000 });
    expect(await start.isDisabled()).toBe(true);
    await other
      .getByText(/^An import is running\. Started by you at \d\d:\d\d\.$/)
      .first()
      .waitFor();
    expect(
      await other.getByRole('link', { name: 'See the import' }).first().getAttribute('href'),
    ).toBe(new URL(runUrl).pathname + new URL(runUrl).search);
    // The upload takes no file either.
    await other.goto(`${made.shell}/people/import`);
    await other.getByText('An import is running', { exact: true }).waitFor({ timeout: 30_000 });
    expect(await other.locator('input[type=file]').count()).toBe(0);
    await other.close();

    // A reload, as closing the browser and coming back would be: the same run, still going or done.
    await page.reload();
    expect(page.url()).toBe(runUrl);
    await importing.or(imported).waitFor({ timeout: 30_000 });

    // Done by itself, with what it did: every row created.
    const runId = new URL(runUrl).searchParams.get('run') ?? '';
    const over = async () => {
      const [run] = await stack.sql<
        {
          status: string;
          phase: string;
          done: number;
          total: number | null;
          failure: string | null;
        }[]
      >`SELECT status, phase, done, total, failure FROM people.import_run
         WHERE tenant_id = ${made.tenantId} AND id = ${runId}`;
      return run;
    };
    const deadline = Date.now() + 420_000;
    let run = await over();
    while (run !== undefined && (run.status === 'queued' || run.status === 'running')) {
      if (Date.now() > deadline) throw new Error(`still ${JSON.stringify(run)}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      run = await over();
    }
    expect(run).toMatchObject({ status: 'succeeded', failure: null });
    // The page, which nobody reloaded, says so by itself.
    await imported.waitFor({ timeout: 30_000 });
    expect(await page.getByRole('group', { name: 'What the import did' }).textContent()).toContain(
      'Created400',
    );
    const created = await stack.sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM people.person
         WHERE tenant_id = ${made.tenantId} AND family_name = 'Cascade'`;
    expect(created).toEqual([{ count: String(ROWS) }]);

    // Over: Import is back, the history says Imported, and the Inbox has the news.
    await page.goto(`${made.shell}/people/import-export`);
    await page.getByRole('link', { name: 'Start import' }).first().waitFor({ timeout: 30_000 });
    await page
      .getByText(/^Imported · 400 created or updated$/)
      .first()
      .waitFor({ timeout: 30_000 });
    await page.goto(`${made.shell}/inbox/updates`);
    await page.getByText('Your import finished: 400 people').first().waitFor({ timeout: 30_000 });
    expect(await unavailable()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  }, 600_000);
});
