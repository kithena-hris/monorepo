import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { ADMIN, EMPLOYEE, TENANT, startStack, type Stack } from './stack';

/**
 * The People screens, end to end, in the running shell (PEO-098).
 *
 * - PEO-049: a fresh tenant's administrator reaches a published version 1
 *   and a complete first profile from the setup wizard, at 390×844 with a
 *   software keyboard raised, and abandoning half way leaves a partial record.
 * - PEO-055: an admin takes a broken file, fixes the blocked rows from the
 *   downloaded CSV, and imports them without re-mapping.
 * - Field-level absence: a field the viewer may not read is not in the HTML
 *   the shell sends, nor in what the remote draws.
 *
 * `stack.ts` has what is real and what is stubbed.
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
    expect(await response?.text()).toContain('Personal information');
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
