import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { ADMIN, EMPLOYEE, ROOT, TENANT, startStack, type Stack } from './stack';

/**
 * The People screens, end to end, in the running shell (PEO-098).
 *
 * - PEO-049: a fresh tenant's administrator reaches a published version 1
 *   and a complete first profile from the setup wizard, at 390×844 with a
 *   software keyboard raised, and abandoning half way leaves a partial record.
 * - PEO-055: an admin takes a broken file, fixes the blocked rows from the
 *   downloaded CSV, and imports them without re-mapping.
 * - PEO-112: the People administrator grants a role on the roles screen, with
 *   a reason, and an employee cannot open it.
 * - Field-level absence: a field the viewer may not read is not in the HTML
 *   the shell sends, nor in what the remote draws.
 * - PEO-122: HR sees a permit about to expire; a manager outside the chain
 *   does not, and sees their own report's.
 * - PEO-113: all of it through identity's token and the router; the shell has
 *   no way into People of its own, and People refuses what the shell holds.
 *
 * `stack.ts` has what is real: all of it.
 */

let stack: Stack;
let browser: Browser;

beforeAll(async () => {
  stack = await startStack();
  browser = await chromium.launch();
}, 900_000);

afterAll(async () => {
  // Either may be missing when `beforeAll` failed part way.
  await (browser as Browser | undefined)?.close();
  await (stack as Stack | undefined)?.stop();
}, 60_000);

async function signedIn(
  session: string,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
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
async function eventually<T>(
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

const person = (id: string) =>
  stack.sql<{ given_name: string | null; family_name: string | null; status: string }[]>`
    SELECT given_name, family_name, status FROM people.person WHERE id = ${id}`;

/**
 * Whether a form's button is on screen, above the keyboard, without scrolling
 * to it (§17.2). Polled, because the page settles after a field takes focus.
 */
async function inView(page: Page, name: string, form: string): Promise<void> {
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
async function keyboardUp(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.evaluate(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.scrollIntoView({ block: 'center' });
  });
}

describe('PEO-113: the shell reaches People only through the router', () => {
  it('is configured with the router and identity, and nothing of People', () => {
    const env = stack.shellEnv;
    expect(Object.keys(env).filter((key) => key.startsWith('PEOPLE_API'))).toEqual([]);
    expect(Object.values(env).some((value) => value.includes(new URL(stack.peopleUrl).port))).toBe(
      false,
    );
    expect(env['ROUTER_URL']).toBeDefined();
  });

  it('holds nothing People accepts: its internal token and a principal are refused', async () => {
    const direct = await fetch(`${stack.peopleUrl}/v1/views/profile`, {
      headers: {
        'x-internal-token': stack.shellToken,
        'x-kithena-principal': JSON.stringify({
          userId: ADMIN.account,
          tenantId: TENANT,
          roles: [],
          entitlements: ['module.people'],
        }),
      },
    });
    expect(direct.status).toBe(401);
  });
});

describe('PEO-049: the setup wizard, on a phone', () => {
  it('publishes version 1 and saves the first profile a section at a time, keyboard up', async () => {
    const context = await signedIn(ADMIN.session, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/setup`);

    // The legal entity, as the back office recorded the company.
    await expect
      .poll(() => page.getByRole('heading', { name: 'Confirm the legal entity' }).isVisible(), {
        timeout: 30_000,
      })
      .toBe(true);
    expect(await page.getByRole('textbox', { name: /Registered name/ }).inputValue()).toBe('Acme');
    // The heading is the server's; a press counts once the remote has hydrated it.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Continue' }).click();

    // The Spanish pack, accepted as it is.
    await page.getByText(/Spain: \d+ sections?, \d+ fields/).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('button', { name: 'Publish version 1' }).click();
    const personal = page.getByRole('form', { name: 'Personal information' });
    await personal.waitFor({ timeout: 30_000 });
    const versions = await stack.sql<{ version: number }[]>`
      SELECT version FROM people.schema_version WHERE tenant_id = ${TENANT}`;
    expect(versions.map((v) => v.version)).toEqual([1]);

    await personal.getByRole('textbox', { name: /Legal first name/ }).focus();
    await keyboardUp(page);
    await personal.getByRole('textbox', { name: /Legal first name/ }).fill('Priya');
    await personal.getByRole('textbox', { name: /Legal family name/ }).fill('Shah');
    await inView(page, 'Save', 'Personal information');
    await personal.getByRole('button', { name: 'Save' }).click();
    await eventually(
      'the names',
      () => person(ADMIN.person),
      ([p]) => p?.family_name === 'Shah',
    );

    // Abandoned here, before the identification section.
    await page.goto(`${stack.shell}/people`);
    const [partial] = await person(ADMIN.person);
    expect(partial).toMatchObject({ given_name: 'Priya', family_name: 'Shah' });
    const secrets =
      await stack.sql`SELECT 1 FROM people.person_secret WHERE person_id = ${ADMIN.person}`;
    expect(secrets).toHaveLength(0);

    // Back tomorrow: the wizard resumes at the profile, and it is finished.
    await page.goto(`${stack.shell}/people/setup`);
    const identification = page.getByRole('form', { name: 'Identification & right to work' });
    await identification.waitFor({ timeout: 30_000 });
    expect(await page.getByRole('textbox', { name: /Legal first name/ }).inputValue()).toBe(
      'Priya',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await identification.getByRole('textbox', { name: /NIF \/ NIE/ }).focus();
    await keyboardUp(page);
    await identification.getByRole('textbox', { name: /NIF \/ NIE/ }).fill('12345678Z');
    await inView(page, 'Save', 'Identification & right to work');
    await identification.getByRole('button', { name: 'Save' }).click();
    await eventually(
      'the NIF',
      () => stack.sql`SELECT 1 FROM people.person_secret WHERE person_id = ${ADMIN.person}`,
      (rows) => rows.length === 1,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('Complete', { exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForURL(/\/people\/me$/);
    await page.getByRole('heading', { name: 'Priya Shah' }).waitFor({ timeout: 30_000 });
    await context.close();
  });
});

describe('PEO-094: the remote, rendered on the server', () => {
  it('sends the screen in the HTML, and hydrates it without a mismatch', async () => {
    // The remote's JavaScript never arrives: whatever is on the page, the
    // server drew. React's own inline script reveals the streamed screen; no
    // bundle of the remote's is involved.
    const bare = await signedIn(ADMIN.session);
    await bare.route(/\/(remoteEntry\.js|assets\/.*\.js)$/, (route) => route.abort());
    const page = await bare.newPage();
    const response = await page.goto(`${stack.shell}/people/me`);
    const sent = (await response?.text()) ?? '';
    expect(sent).toContain('Personal information');
    // Drawn by the renderer process, from the signed build (PEO-115).
    expect(sent).toContain('data-remote="people"');
    await expect
      .poll(() => page.evaluate(() => document.body.innerText.replaceAll('\n', ' | ')), {
        timeout: 10_000,
      })
      .toContain('Legal first name');
    expect(await page.getByText('Loading People').count()).toBe(0);
    await bare.close();

    // With JavaScript: the same markup hydrates, and the form answers.
    const context = await signedIn(ADMIN.session);
    const live = await context.newPage();
    const problems: string[] = [];
    live.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    live.on('pageerror', (error) => problems.push(error.message));
    await live.goto(`${stack.shell}/people/me`);
    // Pressed as soon as it is on screen: it answers once the remote hydrates.
    await live.getByRole('button', { name: 'Edit Personal information' }).click();
    const personal = live.getByRole('form', { name: 'Personal information' });
    await personal.getByRole('textbox', { name: /Preferred name/ }).fill('Pri');
    await personal.getByRole('button', { name: 'Save' }).click();
    await eventually(
      'the preferred name',
      () => stack.sql<{ preferred_name: string | null }[]>`
        SELECT preferred_name FROM people.person WHERE id = ${ADMIN.person}`,
      ([p]) => p?.preferred_name === 'Pri',
    );
    expect(problems.filter((p) => /hydrat/i.test(p))).toEqual([]);
    await context.close();
  });

  it('refuses a server build that is not the one signed, and draws the screen in the browser', async () => {
    // What a compromised host would do: serve other code under the same name,
    // beside the genuine signed manifest. One harmless byte is enough; the
    // same length, so the static server's cached headers still describe it.
    const file = join(ROOT, 'apps/web/people/dist/ssr/people.cjs');
    const genuine = await readFile(file, 'utf8');
    await writeFile(file, `${genuine.slice(0, -1)}${genuine.endsWith('\n') ? ' ' : '\n'}`);
    try {
      const bare = await signedIn(ADMIN.session);
      await bare.route(/\/(remoteEntry\.js|assets\/.*\.js)$/, (route) => route.abort());
      const page = await bare.newPage();
      const response = await page.goto(`${stack.shell}/people/me`);
      // No screen drawn on the server — only the spinner in its place. (The
      // labels are still in the page's data, which is not a rendering.)
      const html = (await response?.text()) ?? '';
      expect(html).not.toContain('data-remote="people"');
      expect(html).toContain('Loading People');
      expect(await page.evaluate(() => document.body.innerText)).not.toContain('Legal first name');
      await bare.close();

      // With JavaScript, the browser build draws it as before PEO-094.
      const context = await signedIn(ADMIN.session);
      const live = await context.newPage();
      await live.goto(`${stack.shell}/people/me`);
      await live.getByRole('button', { name: 'Edit Personal information' }).waitFor({
        timeout: 30_000,
      });
      await context.close();
    } finally {
      await writeFile(file, genuine);
    }
  });
});

describe('Field-level absence, end to end', () => {
  it('leaves a field the viewer may not read out of the HTML and out of the screen', async () => {
    const context = await signedIn(EMPLOYEE.session);
    const page = await context.newPage();
    const response = await page.goto(`${stack.shell}/people/${ADMIN.person}`);
    const html = (await response?.text()) ?? '';

    // Adam may read Priya's name (the directory may) and not her NIF (self and HR only).
    expect(html).toContain('Priya');
    expect(html).not.toContain('es_nif');
    expect(html).not.toContain('NIF / NIE');
    expect(html).not.toContain('678Z');

    // "Pri Shah": the preferred name the test before set.
    await expect
      .poll(() => page.evaluate(() => document.body.innerText), { timeout: 30_000 })
      .toContain('Pri Shah');
    expect(await page.getByText('NIF / NIE').count()).toBe(0);
    expect(await page.getByText('Identification & right to work').count()).toBe(0);
    await context.close();
  });
});

describe('PEO-117: the directory searches and filters in People', () => {
  it('finds a person by name server-side, and refuses a filter the viewer cannot run', async () => {
    const context = await signedIn(EMPLOYEE.session);
    const page = await context.newPage();
    const text = () =>
      page.evaluate(() => document.body.innerText.replaceAll('\n', ' | '));

    // Adam reads every name, so he may search them: Priya, and nobody else.
    await page.goto(`${stack.shell}/people/directory?search=shah`);
    await expect.poll(text, { timeout: 30_000 }).toContain('Pri Shah');
    expect(await page.getByText(EMPLOYEE.email).count()).toBe(0);

    // Her NIF is hers and HR's: who matched a filter on it would tell him the rest.
    await page.goto(`${stack.shell}/people/directory?filter=es_nif:1`);
    await expect.poll(text, { timeout: 30_000 }).toContain('You cannot filter people by es_nif');
    await context.close();
  });
});

/** A CSV row into cells, quotes and all. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (quoted) {
      if (c === '"' && line.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cell);
      cell = '';
    } else cell += c;
  }
  out.push(cell);
  return out;
}

async function upload(page: Page, name: string, text: string): Promise<void> {
  // The screen is server-rendered and becomes interactive when the remote's
  // JavaScript has loaded; a file chosen before that is not seen (PEO-094).
  await page.waitForLoadState('networkidle');
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
  });
}

describe('PEO-055: an import with broken rows, fixed from the downloaded CSV', () => {
  it('imports the good rows, then the fixed ones, without mapping anything by hand', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/import`);

    const broken = [
      'given_name,family_name,work_email,hire_date',
      'Ada,Lovelace,ada@acme.example,2025-01-06',
      'Marco,Rossi,marco@acme.example,2025-02-03',
      'Ines,Blanco,,2025-03-03',
      'Tom,Price,tom@acme.example,31/02/2025',
    ].join('\n');
    await upload(page, 'people.csv', broken);

    // Every column maps itself: its header is the field's key.
    const review = page.getByRole('button', { name: 'Review before importing' });
    await review.waitFor({ timeout: 30_000 });
    expect(await review.isEnabled()).toBe(true);
    await review.click();

    await page.getByRole('heading', { name: 'Blocked rows' }).waitFor({ timeout: 30_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download all 2 as CSV/ }).click();
    const file = await (await download).path();
    const report = await readFile(file, 'utf8');

    await page.getByRole('button', { name: 'Import 2 rows' }).click();
    await page.getByText(/people\.csv is imported/).waitFor({ timeout: 30_000 });
    const afterFirst = await stack.sql`SELECT 1 FROM people.person WHERE tenant_id = ${TENANT}`;
    expect(afterFirst).toHaveLength(4);

    // Fix the two cells the report names, and nothing else.
    const lines = report.trim().split(/\r?\n/);
    const header = cells(lines[0] ?? '');
    const email = header.indexOf('work_email');
    const hired = header.indexOf('hire_date');
    const fixed = [
      lines[0],
      ...lines.slice(1).map((line) => {
        const row = cells(line);
        if (row[email] === '') row[email] = 'ines@acme.example';
        if (row[hired] === '31/02/2025') row[hired] = '2025-02-28';
        return row.map((c) => (/[",]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',');
      }),
    ].join('\n');

    await page.goto(`${stack.shell}/people/import`);
    await upload(page, 'people-blocked.csv', fixed);
    await page
      .getByRole('button', { name: 'Review before importing' })
      .waitFor({ timeout: 30_000 });
    // No column needs a decision: the report's own columns are recognised and left out.
    expect(await page.getByRole('button', { name: 'Review before importing' }).isEnabled()).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Review before importing' }).click();
    await page.getByRole('button', { name: 'Import 2 rows' }).click();
    await page.getByText(/people-blocked\.csv is imported/).waitFor({ timeout: 30_000 });

    const everyone = await stack.sql<{ work_email: string }[]>`
      SELECT work_email FROM people.person WHERE tenant_id = ${TENANT}`;
    expect(everyone.map((p) => p.work_email).toSorted()).toEqual([
      'ada@acme.example',
      'adam@acme.example',
      'ines@acme.example',
      'marco@acme.example',
      'priya@acme.example',
      'tom@acme.example',
    ]);
    await context.close();
  });
});

describe('PEO-112: granting a role on the roles screen', () => {
  it('grants Finance to an employee with a reason, audited; the employee cannot see the screen', async () => {
    const context = await signedIn(ADMIN.session);
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/settings/roles`);
    await page.getByRole('checkbox', { name: `Finance for ${EMPLOYEE.email}` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /Reason/ }).fill('Covers payroll this quarter');
    await dialog.getByRole('button', { name: 'Grant' }).click();
    await eventually(
      'the grant',
      () =>
        stack.sql<{ role: string }[]>`
          SELECT role FROM people.role_grant WHERE account_id = ${EMPLOYEE.account}`,
      (rows) => rows.some((r) => r.role === 'finance'),
    );
    const [event] = await stack.sql<{ payload: Record<string, unknown> }[]>`
      SELECT envelope -> 'payload' AS payload FROM people.outbox
       WHERE event_name = 'people.role.granted' AND envelope -> 'payload' ->> 'accountId' = ${EMPLOYEE.account}`;
    expect(event?.payload).toEqual({
      accountId: EMPLOYEE.account,
      role: 'finance',
      by: ADMIN.account,
      via: 'people',
      reason: 'Covers payroll this quarter',
    });
    await context.close();

    const employee = await signedIn(EMPLOYEE.session);
    const theirs = await employee.newPage();
    await theirs.goto(`${stack.shell}/people/settings/roles`);
    await theirs.getByText('Could not load the roles').waitFor({ timeout: 30_000 });
    await employee.close();
  });
});

/** Today where a zone is, as People reads it. */
const todayIn = (zone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

describe('PEO-119: a location in another zone changes a person’s day', () => {
  it('adds a location on the settings screen, and HR sees the person’s day follow its zone', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // Reached from People's home, not typed.
    await page.goto(`${stack.shell}/people`);
    await page.getByRole('link', { name: 'Legal entities, locations and numbering' }).click();
    await page.waitForURL(/\/people\/settings\/organisation$/);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: 'Locations' }).click();
    await page.getByRole('button', { name: 'Add location' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a location' });
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Pago Pago office');
    await dialog.getByRole('button', { name: 'Time zone' }).click();
    await page.getByRole('combobox', { name: 'Time zone search' }).fill('Pago_Pago');
    await page.getByRole('option', { name: 'Pacific/Pago_Pago' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('cell', { name: /^Pago Pago office/ }).waitFor({ timeout: 30_000 });
    const [office] = await stack.sql<{ id: string }[]>`
      SELECT id FROM people.location WHERE tenant_id = ${TENANT} AND name = 'Pago Pago office'`;
    if (office === undefined) throw new Error('the location was not created');

    // Adam's day before he works there: the tenant's.
    const theirDay = async (): Promise<string> => {
      await page.goto(`${stack.shell}/people/${EMPLOYEE.person}`);
      return page.getByTestId('their-day').innerText({ timeout: 30_000 });
    };
    expect(await theirDay()).toBe(`${todayIn('Etc/UTC')} (Etc/UTC)`);

    // PEO-123: HR places him there from his profile. The move is dated on
    // the office's calendar, and from then on his day is the office's.
    await page.waitForLoadState('networkidle');
    const placement = page.getByRole('form', { name: 'Placement' });
    await placement.getByRole('combobox', { name: /Work location/ }).click();
    await page.getByRole('option', { name: 'Pago Pago office' }).click();
    await placement.getByRole('button', { name: 'Move' }).click();
    await eventually(
      'the placement',
      () => stack.sql<{ location_id: string | null }[]>`
        SELECT location_id FROM people.person WHERE id = ${EMPLOYEE.person}`,
      ([p]) => p?.location_id === office.id,
    );
    const [placed] = await stack.sql<{ effective: string; payload: Record<string, unknown> }[]>`
      SELECT envelope ->> 'effectiveFrom' AS effective, envelope -> 'payload' AS payload
        FROM people.outbox
       WHERE aggregate_id = ${EMPLOYEE.person} AND event_name = 'people.person.org_changed'
       ORDER BY created_at DESC LIMIT 1`;
    expect(placed?.effective).toBe(todayIn('Pacific/Pago_Pago'));
    expect(placed?.payload).toMatchObject({ locationId: office.id });
    expect(await theirDay()).toBe(`${todayIn('Pacific/Pago_Pago')} (Pacific/Pago_Pago)`);

    // The office moves across the date line from today there: 25 hours
    // ahead, so his day is always a different date.
    await page.goto(`${stack.shell}/people/settings/organisation`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Locations' }).click();
    await page.getByRole('button', { name: 'Change the time zone of Pago Pago office' }).click();
    const move = page.getByRole('dialog');
    await move.getByRole('button', { name: 'New time zone' }).click();
    await page.getByRole('combobox', { name: 'New time zone search' }).fill('Kiritimati');
    await page.getByRole('option', { name: 'Pacific/Kiritimati' }).click();
    await move.getByRole('button', { name: 'Save' }).click();
    await move.waitFor({ state: 'detached', timeout: 30_000 });

    const after = await theirDay();
    expect(after).toBe(`${todayIn('Pacific/Kiritimati')} (Pacific/Kiritimati)`);
    expect(todayIn('Pacific/Kiritimati')).not.toBe(todayIn('Pacific/Pago_Pago'));
    const [event] = await stack.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM people.outbox WHERE event_name = 'people.location.zone_changed'`;
    expect(event?.n).toBe(1);
    await context.close();
  });
});

describe('PEO-120: HR terminates somebody, ending their access now, then rehires them', () => {
  it('moves the record through both on the profile, each an event', async () => {
    const [ada] = await stack.sql<{ id: string }[]>`
      SELECT id FROM people.person WHERE work_email = 'ada@acme.example'`;
    if (ada === undefined) throw new Error('Ada was not imported');
    const status = async () =>
      (await stack.sql<{ status: string }[]>`SELECT status FROM people.person WHERE id = ${ada.id}`)[0]
        ?.status;
    expect(await status()).toBe('active');

    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/${ada.id}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Terminate' }).click();
    const terminate = page.getByRole('dialog', { name: 'Terminate' });
    await terminate.getByRole('combobox', { name: /Reason/ }).click();
    await page.getByRole('option', { name: 'Dismissed' }).click();
    await terminate.getByRole('checkbox', { name: 'End their access now' }).click();
    await terminate.getByRole('button', { name: 'Terminate' }).click();
    await eventually('the termination', status, (s) => s === 'terminated');
    const ended = await stack.sql`
      SELECT 1 FROM people.outbox
       WHERE event_name = 'people.person.access_ended' AND envelope -> 'payload' ->> 'personId' = ${ada.id}`;
    expect(ended).toHaveLength(1);

    // The page comes back from People with the leaver's move offered.
    await page.getByRole('button', { name: 'Rehire' }).click();
    const rehire = page.getByRole('dialog', { name: 'Rehire' });
    await rehire.getByRole('button', { name: 'Rehire' }).click();
    // From the day after the last working day, which is still ahead: pre-hire.
    await eventually('the rehire', status, (s) => s === 'pre_hire');
    const periods = await stack.sql<{ period: number }[]>`
      SELECT period FROM people.employment_period WHERE person_id = ${ada.id} ORDER BY period`;
    expect(periods.map((p) => p.period)).toEqual([1, 2]);
    await page
      .getByRole('table', { name: 'Employment periods' })
      .getByRole('cell', { name: '2', exact: true })
      .waitFor({ timeout: 30_000 });
    await context.close();
  });
});

describe('PEO-121: finance asks for full values, HR approves, one download', () => {
  it('issues one file behind a link that works once', async () => {
    // Adam holds finance since PEO-112's test granted it; the tuple that grant
    // syncs to OpenFGA arrives by Kafka, which this stack has not got.
    await stack.writeTuples([
      { user: `user:${EMPLOYEE.account}`, relation: 'finance', object: `tenant:${TENANT}` },
    ]);
    const finance = await signedIn(EMPLOYEE.session, { viewport: { width: 1280, height: 900 } });
    const asks = await finance.newPage();
    await asks.goto(`${stack.shell}/people`);
    await asks.getByRole('link', { name: 'Full values' }).click();
    await asks.waitForURL(/\/people\/full-values$/);
    await asks.waitForLoadState('networkidle');
    await asks.getByRole('checkbox', { name: 'NIF / NIE' }).click();
    await asks.getByRole('textbox', { name: /Reason/ }).fill('Social security filing, September');
    await asks.getByRole('button', { name: 'Ask HR' }).click();
    const [request] = await eventually(
      'the request',
      () => stack.sql<{ id: string; state: string }[]>`
        SELECT id::text, state FROM people.full_values_request WHERE tenant_id = ${TENANT}`,
      (rows) => rows.length === 1,
    );

    const hr = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const decides = await hr.newPage();
    await decides.goto(`${stack.shell}/people/full-values`);
    await decides.waitForLoadState('networkidle');
    await decides
      .getByRole('table', { name: 'Waiting for a decision' })
      .getByRole('button', { name: /^Approve the request from/ })
      .click();
    const dialog = decides.getByRole('dialog', { name: 'Approve the request' });
    await dialog.getByRole('button', { name: 'Approve' }).click();
    // No Temporal here: the decision settles in-process, and the file is issued.
    await eventually(
      'the file',
      () => stack.sql<{ export_id: string | null }[]>`
        SELECT export_id::text FROM people.full_values_request WHERE id = ${request?.id ?? ''}`,
      ([row]) => row?.export_id !== null && row?.export_id !== undefined,
    );
    // HR is never handed the link.
    await decides.reload();
    await decides.getByText('Ready to download').waitFor({ timeout: 30_000 });
    expect(await decides.getByRole('link', { name: 'Download, once' }).count()).toBe(0);
    await hr.close();

    await asks.reload();
    const link = asks.getByRole('link', { name: 'Download, once' });
    await link.waitFor({ timeout: 30_000 });
    const href = (await link.getAttribute('href')) ?? '';
    expect((await fetch(href)).status).toBe(200);
    expect((await fetch(href)).status).toBe(410);
    const [spent] = await stack.sql<{ downloaded_at: Date | null }[]>`
      SELECT downloaded_at FROM people.full_values_request WHERE id = ${request?.id ?? ''}`;
    expect(spent?.downloaded_at).not.toBeNull();
    await asks.reload();
    await asks.getByText('Downloaded', { exact: true }).waitFor({ timeout: 30_000 });
    await finance.close();
  });
});

describe('PEO-121: the webhook delivery log', () => {
  it('shows a failed delivery and replays it', async () => {
    // An endpoint, as the integrations screen makes one, subscribed to an
    // event nothing in this run raises.
    const made = await stack.writeAsPeople(ADMIN.account, '/v1/webhooks/endpoints', {
      url: 'https://example.com/kithena-acceptance',
      events: ['people.schema.published'],
      allowlist: [],
      alertEmail: 'integrations@acme.example',
    });
    expect(made.status).toBe(201);
    const endpointId = (made.body as { id: string }).id;
    // A delivery that failed for good: what 24 hours of refusals leave behind.
    await stack.sql`
      INSERT INTO people.webhook_delivery
             (tenant_id, endpoint_id, event_id, event_name, aggregate_id, envelope, status, attempts, last_response)
      VALUES (${TENANT}, ${endpointId}, gen_random_uuid(), 'people.person.hired', ${ADMIN.person},
              '{}'::jsonb, 'failed', 12, 500)`;

    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/settings/integrations`);
    await page.waitForLoadState('networkidle');
    await page
      .getByRole('button', { name: 'Delivery log for https://example.com/kithena-acceptance' })
      .click();
    await page.waitForURL(new RegExp(`/people/settings/integrations/${endpointId}$`));
    await page.waitForLoadState('networkidle');
    const table = page.getByRole('table', { name: 'Deliveries' });
    await table.getByText('Failed').waitFor({ timeout: 30_000 });
    expect(await table.getByText('HTTP 500').count()).toBe(1);

    await table.getByRole('button', { name: /^Replay people\.person\.hired/ }).click();
    await page.getByText(/Replayed\./).waitFor({ timeout: 30_000 });
    const rows = await stack.sql<{ replay_of: string | null }[]>`
      SELECT replay_of::text FROM people.webhook_delivery WHERE endpoint_id = ${endpointId} ORDER BY seq`;
    expect(rows).toHaveLength(2);
    expect(rows[1]?.replay_of).not.toBeNull();
    await table.getByText('A replay').waitFor({ timeout: 30_000 });
    await context.close();
  });
});

// Last: it adds two people, which the counts in the tests above would see.
describe('PEO-122: what is about to expire, to whom', () => {
  it('shows HR a permit expiring in 30 days; a manager outside the chain does not see it', async () => {
    // A permit the holder, their chain and HR may read, published as the
    // administrator publishes a field.
    const drafted = await stack.writeAsPeople(ADMIN.account, '/v1/schema/draft/attributes', {
      input: {
        key: 'work_permit_expiry',
        sectionKey: 'employment',
        label: 'Work permit expiry',
        description: null,
        dataType: 'date',
        options: [],
        requiredness: 'never',
        ownership: ['hr'],
        collectAt: 'hr_only',
        visibility: ['self', 'manager_chain', 'hr'],
        classification: 'confidential',
        piiKind: 'none',
        classificationSource: 'human',
      },
      editing: null,
    });
    expect(drafted).toMatchObject({ status: 200, body: { ok: true } });
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const published = await stack.writeAsPeople(ADMIN.account, '/v1/schema/draft/publish', {
      requiredFrom: day(0),
    });
    expect(published.status).toBe(201);

    // Sana reports to Priya; Rui reports to Adam. Adam manages, and not Sana.
    const SANA = '00000000-0000-4000-8000-0000000000a5';
    const RUI = '00000000-0000-4000-8000-0000000000a6';
    for (const [id, given, family, manager, expiry] of [
      [SANA, 'Sana', 'Khan', ADMIN.person, day(30)],
      [RUI, 'Rui', 'Dias', EMPLOYEE.person, day(20)],
    ] as const) {
      await stack.sql`
        INSERT INTO people.person (id, tenant_id, status, hire_date, given_name, family_name,
                                   manager_id, completeness, custom)
        VALUES (${id}, ${TENANT}, 'active', '2025-01-01', ${given}, ${family}, ${manager},
                'complete', ${stack.sql.json({ work_permit_expiry: expiry })})`;
    }
    await stack.writeTuples([
      { user: `person:${ADMIN.person}`, relation: 'reports_to', object: `person:${SANA}` },
      { user: `person:${EMPLOYEE.person}`, relation: 'reports_to', object: `person:${RUI}` },
    ]);

    const numbers = async (session: string): Promise<string> => {
      const context = await signedIn(session);
      const page = await context.newPage();
      await page.goto(`${stack.shell}/people/analytics`);
      // The innermost section holding the heading: ancestors come first.
      const section = page
        .locator('section', { has: page.getByRole('heading', { name: 'What expires next' }) })
        .last();
      await section.getByRole('button', { name: 'Show the numbers' }).click({ timeout: 30_000 });
      const table = section.getByRole('table', { name: 'What expires next: the numbers' });
      const text = await table.innerText();
      await context.close();
      return text.replaceAll(/\s+/g, ' ');
    };

    const hr = await numbers(ADMIN.session);
    expect(hr).toContain(`Sana Khan: Work permit ${day(30)}`);
    expect(hr).toContain(`Rui Dias: Work permit ${day(20)}`);

    // Adam's chain is Rui. Sana's permit is not on his timeline, nor a gap for it.
    const manager = await numbers(EMPLOYEE.session);
    expect(manager).toContain(`Rui Dias: Work permit ${day(20)}`);
    expect(manager).not.toContain('Sana');
  });
});
