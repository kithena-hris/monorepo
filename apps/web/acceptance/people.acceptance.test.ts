import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
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
 *   Her NIF requires approval, and as the only member of HR she approves it
 *   herself, once a dialog says what that means (PEO-077).
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
  stack = await startStack(inject('remoteKeys'));
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

/** The People item in the shell's sidebar, which People's sections hang off. */
const peopleItem = (page: Page) =>
  // Exact: the collapsed rail's People flyout ends with a "Settings › People" link.
  page
    .getByRole('navigation', { name: 'Areas' })
    .getByRole('link', { name: 'People', exact: true });

/**
 * People's own navigation in an expanded sidebar: its sections, listed inline
 * under the People item while you are anywhere in People (V2), and next after
 * it in Tab order. Nothing has to be opened.
 */
async function sections(page: Page) {
  await page.waitForLoadState('networkidle');
  const list = page
    .getByRole('navigation', { name: 'Areas' })
    .getByRole('list', { name: 'People sections' });
  await list.waitFor();
  return list;
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
    await page.goto(`${stack.shell}/`);
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

    // A NIF requires approval (PEO-077): held, and the form says so.
    await identification
      .getByText(/NIF \/ NIE is not changed until HR approves/)
      .waitFor({ timeout: 30_000 });
    const [held] = await eventually(
      'the held NIF',
      () => stack.sql<{ id: string }[]>`
        SELECT id::text FROM people.pending_change
         WHERE person_id = ${ADMIN.person} AND attribute_key = 'es_nif' AND state = 'pending'`,
      (rows) => rows.length === 1,
    );
    const decision = `/v1/pending-changes/${held?.id ?? ''}/decision`;
    // Nobody approves a change to their own record without saying so, HR or not.
    expect((await stack.writeAsPeople(ADMIN.account, decision, { approve: true })).status).toBe(
      403,
    );
    // She is the only member of HR, so nobody else can: she approves it
    // herself, once the dialog says there is no other approver and that the
    // audit trail records it as hers alone.
    await page.setViewportSize({ width: 390, height: 844 });
    await identification
      .getByRole('button', { name: 'Approve the change to NIF / NIE yourself' })
      .click();
    const alone = page.getByRole('dialog');
    await alone
      .getByText(/No other HR member can approve this change/)
      .waitFor({ timeout: 30_000 });
    await alone.getByText(/audit log will show you approved your own change/).waitFor();
    await alone.getByRole('button', { name: 'Approve it myself' }).click();
    await eventually(
      'the NIF',
      () => stack.sql`SELECT 1 FROM people.person_secret WHERE person_id = ${ADMIN.person}`,
      (rows) => rows.length === 1,
    );
    const [decided] = await stack.sql<{ decided_by: string; decided_as: string }[]>`
      SELECT decided_by::text, decided_as FROM people.pending_change WHERE id = ${held?.id ?? ''}`;
    expect(decided).toEqual({ decided_by: ADMIN.account, decided_as: 'sole_hr' });
    const [audit] = await stack.sql<{ envelope: { payload: unknown; actor: unknown } }[]>`
      SELECT envelope FROM people.outbox
       WHERE event_name = 'people.person.change_decided'
         AND envelope -> 'payload' ->> 'changeId' = ${held?.id ?? ''}`;
    expect(audit?.envelope.payload).toMatchObject({ decision: 'approved', decidedAs: 'sole_hr' });
    expect(audit?.envelope.actor).toEqual({ kind: 'user', userId: ADMIN.account });
    await page.reload();
    await page.getByText('Complete', { exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForURL(/\/people\/me$/);
    await page.getByRole('heading', { name: 'Priya Shah' }).waitFor({ timeout: 30_000 });
    await context.close();
  });
});

describe('A People screen reached from a shell page, on a phone', () => {
  it('keeps Reach’s phone layout, as when the screen is loaded in full', async () => {
    const context = await signedIn(ADMIN.session, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/inbox`);
    await page.waitForLoadState('networkidle');
    // The tab bar's People, then a section: navigations in the page, no load.
    await page.getByRole('link', { name: 'People', exact: true }).first().click();
    await page.waitForURL(/\/people\/menu$/);
    await page
      .getByRole('link', { name: /^Directory/ })
      .first()
      .click();
    await page.waitForURL(/\/people\/directory/);
    // The header's back link is Reach's: `font-medium`, and `touch:font-normal`
    // under a finger. The remote compiled `font-medium` too; its copy must
    // not win over the phone's rule, whichever stylesheet arrived last.
    const back = page.locator('[data-remote] a.tap-target').first();
    await back.waitFor({ timeout: 30_000 });
    const weight = (): Promise<string> => back.evaluate((e) => getComputedStyle(e).fontWeight);
    expect(await weight()).toBe('400');
    await page.reload();
    await back.waitFor({ timeout: 30_000 });
    expect(await weight()).toBe('400');
    await context.close();
  });
});

describe('PEO-094: the remote, rendered on the server', () => {
  it('sends the screen in the HTML, and hydrates it without a mismatch', async () => {
    // The remote's JavaScript never arrives: whatever is on the page, the
    // server drew. React's own inline script reveals the streamed screen; no
    // bundle of the remote's is involved.
    // Held, not refused: a remote that fails to load is said to be unavailable.
    const bare = await signedIn(ADMIN.session);
    await bare.route(/\/(remoteEntry\.js|assets\/.*\.js)$/, () => undefined);
    const page = await bare.newPage();
    // Not `load`, which the preloaded remote entry would hold back for ever.
    const response = await page.goto(`${stack.shell}/people/me`, { waitUntil: 'domcontentloaded' });
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
      // No screen drawn on the server, and nothing standing in for it: there
      // is no skeleton. (The labels are still in the page's data, which is
      // not a rendering.)
      const html = (await response?.text()) ?? '';
      expect(html).not.toContain('data-remote="people"');
      expect(html).not.toContain('Loading People');
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

/** Whether the screen is still the server's HTML, waiting for the remote's code. */
const waiting = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.querySelector('[data-remote][data-hydrating]') !== null);

describe('A press on a People screen before its code has loaded', () => {
  /** A page whose remote code arrives 2 s late: the screen is the server's HTML until then. */
  async function late(session: string): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await signedIn(session);
    await context.route(/\/remoteEntry\.js$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    return { page: await context.newPage(), close: () => context.close() };
  }

  it('saves a section once, with what was typed before it', async () => {
    const saves = async (): Promise<number> => {
      const [row] = await stack.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM people.outbox
         WHERE event_name = 'people.person.profile_updated' AND aggregate_id = ${ADMIN.person}`;
      return row?.n ?? 0;
    };
    const before = await saves();
    const { page, close } = await late(ADMIN.session);
    // Not waiting for `load`, which the preloaded remote entry holds back.
    await page.goto(`${stack.shell}/people/me?field=preferred_name`, { waitUntil: 'commit' });
    const personal = page.getByRole('form', { name: 'Personal information' });
    const save = personal.getByRole('button', { name: 'Save' });
    await save.waitFor({ timeout: 30_000 });
    expect(await waiting(page)).toBe(true);
    await personal.getByRole('textbox', { name: /Preferred name/ }).fill('Pria');
    await save.click();
    // Held, and seen to be, until the screen can answer it.
    expect(await save.getAttribute('data-early-press')).toBe('');
    await eventually(
      'the preferred name',
      () => stack.sql<{ preferred_name: string | null }[]>`
        SELECT preferred_name FROM people.person WHERE id = ${ADMIN.person}`,
      ([p]) => p?.preferred_name === 'Pria',
    );
    await page.waitForLoadState('networkidle');
    expect(await saves()).toBe(before + 1);
    // Answered, so no longer shown as waiting (and the form has closed).
    expect(await page.locator('[data-early-press]').count()).toBe(0);
    await close();
  });

  // A section's Edit, pressed before the page is live, opens its editor once:
  // the press held here must not open it a second time.
  it('opens a record’s section editor once', async () => {
    const { page, close } = await late(ADMIN.session);
    await page.goto(`${stack.shell}/people/${EMPLOYEE.person}`, { waitUntil: 'commit' });
    const edit = page.getByRole('button', { name: /^Edit .+/ }).first();
    await edit.waitFor({ timeout: 30_000 });
    expect(await waiting(page)).toBe(true);
    const entries = await page.evaluate(() => history.length);
    await edit.click();
    await page.getByText('Editing').waitFor({ timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get('edit')).not.toBeNull();
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await close();
  });

  // Without the hold, a link pressed this early was a full page load.
  it('follows a tab’s link once, in the page', async () => {
    const { page, close } = await late(ADMIN.session);
    await page.goto(`${stack.shell}/people/review/waiting`, { waitUntil: 'commit' });
    const tab = page
      .getByRole('navigation', { name: 'Review tabs' })
      .getByRole('link', { name: /^Flagged/ });
    await tab.waitFor({ timeout: 30_000 });
    expect(await waiting(page)).toBe(true);
    const entries = await page.evaluate(() => {
      (window as unknown as { stayed?: boolean }).stayed = true;
      return history.length;
    });
    await tab.click();
    await page.waitForURL(/\/people\/review\/flagged$/, { timeout: 30_000 });
    await expect.poll(() => tab.getAttribute('aria-current'), { timeout: 30_000 }).toBe('page');
    await page.waitForLoadState('networkidle');
    const stayed = await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed);
    expect(stayed).toBe(true);
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await close();
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

    // "Pria Shah": the preferred name a test before set.
    await expect
      .poll(() => page.evaluate(() => document.body.innerText), { timeout: 30_000 })
      .toContain('Pria Shah');
    expect(await page.getByText('NIF / NIE').count()).toBe(0);
    expect(await page.getByText('Identification & right to work').count()).toBe(0);
    await context.close();
  });
});

describe('PEO-117: the directory searches and filters in People', () => {
  it('finds a person by name server-side, and refuses a filter the viewer cannot run', async () => {
    const context = await signedIn(EMPLOYEE.session);
    const page = await context.newPage();
    const text = () => page.evaluate(() => document.body.innerText.replaceAll('\n', ' | '));

    // Adam reads every name, so he may search them: Priya, and nobody else.
    await page.goto(`${stack.shell}/people/directory/list?q=shah`);
    await expect.poll(text, { timeout: 30_000 }).toContain('Pria Shah');
    expect(await page.getByText(EMPLOYEE.email).count()).toBe(0);

    // Her NIF is hers and HR's: who matched a filter on it would tell him the rest.
    await page.goto(`${stack.shell}/people/directory/list?filter=es_nif:1`);
    await expect.poll(text, { timeout: 30_000 }).toContain('You cannot filter people by es_nif');
    await context.close();
  });
});

async function upload(page: Page, name: string, text: string): Promise<void> {
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
  });
}

describe('PEO-055: an import with broken cells, which blocks nothing', () => {
  it('imports every row and lists what it left empty for HR, without mapping anything by hand', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    // From Import & export, a page of its own, under its trail: not a modal.
    await page.goto(`${stack.shell}/people/import-export`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Start import' }).first().click();
    await page.waitForURL(/\/people\/import$/);
    expect(await page.getByRole('dialog').count()).toBe(0);
    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await trail.getByRole('link', { name: 'Import & export' }).waitFor();
    expect(await trail.getByText('Import', { exact: true }).count()).toBe(1);
    await page.getByRole('navigation', { name: 'Importing people' }).waitFor();

    const broken = [
      'given_name,family_name,work_email,hire_date',
      'Ada,Lovelace,ada@acme.example,2025-01-06',
      'Marco,Rossi,marco@acme.example,2025-02-03',
      'Ines,Blanco,,2025-03-03',
      'Tom,Price,tom@acme.example,31/02/2025',
    ].join('\n');
    await upload(page, 'people.csv', broken);

    // Every column maps itself: its header is the field's key, and nothing is
    // new, so Decide what's new skips itself.
    const review = page.getByRole('button', { name: 'Next: decide what’s new' });
    await review.waitFor({ timeout: 30_000 });
    // Each step is its own address.
    expect(new URL(page.url()).search).toBe('?step=map');
    expect(await review.isEnabled()).toBe(true);
    await review.click();
    await page.waitForURL(/\?step=review$/);

    // Nothing is blocked: Ines waits for a work email, Tom for a real start date,
    // each named, under the plan's "See rows".
    await page.getByRole('button', { name: 'See rows' }).click({ timeout: 30_000 });
    const left = page.getByRole('table', { name: 'Left empty for HR' });
    await left.waitFor({ timeout: 30_000 });
    expect(await left.getByRole('row').count()).toBe(3);
    expect(await page.getByRole('table', { name: 'Skipped rows' }).count()).toBe(0);

    await page.getByRole('button', { name: 'Approve and run' }).click();
    await page.getByRole('heading', { name: /^Imported 4 people/ }).waitFor({ timeout: 30_000 });
    // The run's own address replaced the plan's: Back never offers a run that has happened.
    expect(new URL(page.url()).search).toMatch(/^\?run=[0-9a-f-]{36}$/);

    const everyone = await stack.sql<{ work_email: string | null; status: string }[]>`
      SELECT work_email, status FROM people.person WHERE tenant_id = ${TENANT}`;
    expect(everyone.map((p) => `${p.work_email ?? '(none)'} ${p.status}`).toSorted()).toEqual([
      '(none) provisional',
      'ada@acme.example active',
      'adam@acme.example provisional',
      'marco@acme.example active',
      'priya@acme.example provisional',
      'tom@acme.example provisional',
    ]);
    await context.close();
  });
});

describe('Work locations set up inside the import', () => {
  it('adds the one a file names, by the name HR gives it, and places its people there', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/import`);
    await upload(
      page,
      'offices.csv',
      [
        'given_name,family_name,work_email,hire_date,location_id',
        'Andy,Bernard,andy@acme.example,2025-05-05,Stamford',
        'Karen,Filippelli,karen@acme.example,2025-05-05,stamford',
      ].join('\n'),
    );
    await page.getByRole('button', { name: 'Next: decide what’s new' }).click({ timeout: 30_000 });
    await page.waitForURL(/\?step=decide$/);
    // Every value already has a suggestion, so its block starts closed: open it.
    const block = page.getByRole('button', { name: /^Work locations/ });
    if ((await block.getAttribute('aria-expanded')) !== 'true') await block.click();
    const stamford = page.getByRole('radiogroup', { name: 'What happens to “Stamford”' });
    expect(
      await stamford.getByRole('radio', { name: /Add it as a new work location/ }).isChecked(),
    ).toBe(true);
    // Both people, by name, whatever the file's spelling.
    expect(
      await page.getByText('2 people in the file: Andy Bernard, Karen Filippelli').count(),
    ).toBe(1);
    await page.getByRole('textbox', { name: /^Name/ }).fill('Stamford Branch');
    await page.getByRole('button', { name: 'Next: review the plan' }).click();
    await page.getByText('Add 1 work location: Stamford Branch').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Approve and run' }).click();
    await page.getByRole('heading', { name: /^Imported 2 people/ }).waitFor({ timeout: 30_000 });

    const placed = await stack.sql<{ work_email: string; name: string }[]>`
      SELECT p.work_email, l.name FROM people.person p JOIN people.location l ON l.id = p.location_id
       WHERE p.tenant_id = ${TENANT} AND p.work_email IN ('andy@acme.example', 'karen@acme.example')
       ORDER BY p.work_email`;
    expect(placed).toEqual([
      { work_email: 'andy@acme.example', name: 'Stamford Branch' },
      { work_email: 'karen@acme.example', name: 'Stamford Branch' },
    ]);
    await context.close();
  });
});

describe('PEO-112: granting a role on the roles screen', () => {
  it('grants Finance to an employee with a reason, audited; the employee cannot see the screen', async () => {
    const context = await signedIn(ADMIN.session);
    const page = await context.newPage();
    await page.goto(`${stack.shell}/settings/people/roles`);
    // Hydrated first, as elsewhere here: a press on the server's markup is lost.
    await page.waitForLoadState('networkidle');
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
    await theirs.goto(`${stack.shell}/settings/people/roles`);
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

/**
 * The profile's "Their day" as it reads in `zone`: "14:05, Pago Pago", the
 * time from when People answered. Either side of a minute turning over.
 */
const dayIn = (zone: string): readonly string[] =>
  [new Date(), new Date(Date.now() - 60_000), new Date(Date.now() - 120_000)].map(
    (at) =>
      `${new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: zone }).format(at)}, ${(
        zone.split('/').at(-1) ?? zone
      ).replaceAll('_', ' ')}`,
  );

describe('PEO-119: a location in another zone changes a person’s day', () => {
  it('adds a location on the settings screen, and HR sees the person’s day follow its zone', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // Reached from Settings, not typed.
    await page.goto(`${stack.shell}/settings`);
    await page.getByRole('link', { name: /^Organisation/ }).click();
    await page.waitForURL(/\/settings\/people\/organisation$/);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: 'Locations' }).click();
    await page.getByRole('button', { name: 'Add location' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a location' });
    await dialog.getByRole('textbox', { name: /Name/ }).fill('Pago Pago office');
    await dialog.getByRole('button', { name: 'Time zone' }).click();
    await page.getByRole('combobox', { name: 'Time zone search' }).fill('Pago_Pago');
    await page.getByRole('option', { name: 'Pacific/Pago_Pago' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    // A row of a table with row menus: a grid's cell.
    await page.getByRole('gridcell', { name: /^Pago Pago office/ }).waitFor({ timeout: 30_000 });
    const [office] = await stack.sql<{ id: string }[]>`
      SELECT id FROM people.location WHERE tenant_id = ${TENANT} AND name = 'Pago Pago office'`;
    if (office === undefined) throw new Error('the location was not created');

    const theirDayIs = async (zone: string): Promise<void> => {
      await page.goto(`${stack.shell}/people/${EMPLOYEE.person}`);
      const shown = await page.getByTestId('their-day').innerText({ timeout: 30_000 });
      expect(dayIn(zone)).toContain(shown);
    };
    // Adam's day before he works there: the tenant's.
    await theirDayIs('Etc/UTC');

    // PEO-123: HR places him there from his profile. The move is dated on
    // the office's calendar, and from then on his day is the office's.
    await page.waitForLoadState('networkidle');
    // Changed from the profile's Actions menu, in a dialog.
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Change placement' }).click();
    const placement = page.getByRole('form', { name: 'Change placement' });
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
    await theirDayIs('Pacific/Pago_Pago');

    // The office moves across the date line from today there: 25 hours
    // ahead, so his day is always a different date, and his clock an hour on.
    await page.goto(`${stack.shell}/settings/people/organisation/locations`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Actions for Pago Pago office' }).click();
    await page.getByRole('menuitem', { name: 'Change time zone' }).click();
    const move = page.getByRole('dialog');
    await move.getByRole('button', { name: 'New time zone' }).click();
    await page.getByRole('combobox', { name: 'New time zone search' }).fill('Kiritimati');
    await page.getByRole('option', { name: 'Pacific/Kiritimati' }).click();
    await move.getByRole('button', { name: 'Save' }).click();
    await move.waitFor({ state: 'detached', timeout: 30_000 });

    await theirDayIs('Pacific/Kiritimati');
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
      (
        await stack.sql<{ status: string }[]>`SELECT status FROM people.person WHERE id = ${ada.id}`
      )[0]?.status;
    expect(await status()).toBe('active');

    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/${ada.id}`);
    await page.waitForLoadState('networkidle');

    // A move is in the profile's Actions menu.
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Terminate' }).click();
    const terminate = page.getByRole('dialog', { name: /^Terminate / });
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
    // A move is in the profile's Actions menu.
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Rehire' }).click();
    const rehire = page.getByRole('dialog', { name: /^Rehire / });
    await rehire.getByRole('button', { name: 'Rehire' }).click();
    // From the day after the last working day, which is still ahead: pre-hire.
    await eventually('the rehire', status, (s) => s === 'pre_hire');
    const periods = await stack.sql<{ period: number }[]>`
      SELECT period FROM people.employment_period WHERE person_id = ${ada.id} ORDER BY period`;
    expect(periods.map((p) => p.period)).toEqual([1, 2]);
    // Both periods, newest first, under their header row.
    const table = page.getByRole('table', { name: 'Employment periods' });
    await table.waitFor({ timeout: 30_000 });
    await expect.poll(() => table.getByRole('row').count()).toBe(3);
    await context.close();
  });
});

describe('Hiring somebody added without a start date', () => {
  const statusOf = async (email: string) =>
    (
      await stack.sql<{ status: string }[]>`
        SELECT status FROM people.person WHERE tenant_id = ${TENANT} AND work_email = ${email}`
    )[0]?.status;

  it('HR adds a person with no start date, then hires them from their profile', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/directory/list?add=person`);
    const form = page.getByRole('form', { name: 'Add employee' });
    await form.waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await form.getByRole('textbox', { name: /Legal first name/ }).fill('Edith');
    await form.getByRole('textbox', { name: /Legal family name/ }).fill('Clarke');
    await form.getByRole('textbox', { name: /Work email/ }).fill('edith@acme.example');
    await form.getByRole('button', { name: 'Add employee' }).click();
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    expect(await statusOf('edith@acme.example')).toBe('provisional');

    // Placed nowhere yet: the hire asks where, and starts today.
    // A move is in the profile's Actions menu.
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Hire' }).click();
    // Titled as the design's question (W17); its button still says Hire.
    const hire = page.getByRole('dialog', { name: 'Is Edith Clarke an employee?' });
    await hire.getByText(/Edith Clarke becomes an employee from/).waitFor();
    await hire.getByRole('combobox', { name: /Legal entity/ }).click();
    await page.getByRole('option').first().click();
    await hire.getByRole('button', { name: 'Hire' }).click();
    await eventually(
      'the hire',
      () => statusOf('edith@acme.example'),
      (s) => s === 'active',
    );
    await context.close();
  });

  it('HR hires two people not started together, placing the one placed nowhere and moving one start date', async () => {
    const [entity] = await stack.sql<{ id: string }[]>`
      SELECT id::text FROM people.legal_entity WHERE tenant_id = ${TENANT} ORDER BY name LIMIT 1`;
    // Alan is placed; Joan is placed nowhere, and is placed by the bulk hire.
    for (const [given, email] of [
      ['Alan', 'alan@acme.example'],
      ['Joan', 'joan@acme.example'],
    ] as const) {
      const made = await stack.writeAsPeople(ADMIN.account, '/v1/people', {
        attributes: { given_name: given, family_name: 'Bulkhire', work_email: email },
      });
      expect(made.status).toBe(201);
      const id = (made.body as { id: string }).id;
      if (given === 'Alan') {
        const placed = await stack.writeAsPeople(ADMIN.account, `/v1/people/${id}/placement`, {
          legalEntityId: entity?.id,
        });
        expect(placed.status).toBe(200);
      }
      expect(await statusOf(email)).toBe('provisional');
    }

    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/people/directory/list?q=Bulkhire`);
    await page.waitForLoadState('networkidle');
    const people = page.getByRole('grid', { name: 'People' });
    await people.getByText('Alan Bulkhire').waitFor({ timeout: 30_000 });
    await page.getByRole('checkbox', { name: 'Select Alan Bulkhire' }).click();
    await page.getByRole('checkbox', { name: 'Select Joan Bulkhire' }).click();
    await page.getByRole('button', { name: 'Edit together' }).click();
    await page.waitForURL(/\/people\/bulk-edit/);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: 'Hire' }).click();
    // One placement for everybody placed nowhere.
    await page.getByRole('combobox', { name: 'Legal entity', exact: true }).click();
    await page.getByRole('option').first().click();
    // The preview asks itself, and follows the placement 0.4 s later.
    await page.getByRole('table', { name: 'Per person' }).waitFor({ timeout: 30_000 });
    const rows = page.getByRole('table', { name: 'Per person' });
    await rows.getByText(/Legal entity: .*→/).waitFor();
    expect(await statusOf('alan@acme.example')).toBe('provisional');

    // Joan from the first of last month, changed in her row: the preview follows.
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const firstIso = first.toISOString().slice(0, 10);
    const day = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(first);
    await rows.getByRole('button', { name: 'Start date for Joan Bulkhire' }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: day, exact: true }).click();
    await rows.getByText(new RegExp(`Start date: .*→ ${firstIso}`)).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Hire 2 people' }).click();
    await page.getByText('Hired 2 people.').waitFor({ timeout: 30_000 });
    expect([await statusOf('alan@acme.example'), await statusOf('joan@acme.example')]).toEqual([
      'active',
      'active',
    ]);
    const [joan] = await stack.sql<{ hire_date: string; legal_entity_id: string | null }[]>`
      SELECT hire_date::text, legal_entity_id::text FROM people.person
       WHERE tenant_id = ${TENANT} AND work_email = 'joan@acme.example'`;
    expect(joan).toEqual({ hire_date: firstIso, legal_entity_id: entity?.id });
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
    await (await sections(asks)).getByRole('link', { name: /^Review/ }).click();
    await asks.waitForURL(/\/people\/review\/waiting$/);
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
    // The request is an item in Review, under its Full values chip.
    await decides.goto(`${stack.shell}/people/review/waiting?kind=access`);
    await decides.waitForLoadState('networkidle');
    await decides.getByRole('button', { name: /^Approve the request from/ }).click();
    const dialog = decides.getByRole('dialog', { name: 'Allow the request' });
    await dialog.getByRole('button', { name: 'Allow' }).click();
    // No Temporal here: the decision settles in-process, and the file is issued.
    await eventually(
      'the file',
      () => stack.sql<{ export_id: string | null }[]>`
        SELECT export_id::text FROM people.full_values_request WHERE id = ${request?.id ?? ''}`,
      ([row]) => row?.export_id !== null && row?.export_id !== undefined,
    );
    // HR is never handed the link: under Decided, its state alone.
    await decides.goto(`${stack.shell}/people/review/decided?kind=access`);
    // The visible one: a streamed part can briefly sit on the page twice, once hidden.
    await decides
      .getByText('Ready to download')
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 30_000 });
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
    // event nothing in this run raises. It points at the harness's own HTTPS
    // receiver on loopback: a replay really sends, and never to the internet.
    const hookUrl = `${stack.receiver.url}/kithena-acceptance`;
    const made = await stack.writeAsPeople(ADMIN.account, '/v1/webhooks/endpoints', {
      url: hookUrl,
      events: ['people.schema.published'],
      allowlist: [],
      alertEmail: 'integrations@acme.example',
    });
    expect(made.status).toBe(201);
    const endpointId = (made.body as { id: string }).id;
    // A delivery that failed for good: what 24 hours of refusals leave behind.
    // A hire's envelope, which every allowlist lets through, so the replay is
    // sent rather than skipped.
    const eventId = '00000000-0000-4000-8000-0000000121e0';
    const envelope = stack.sql.json({
      eventId,
      eventName: 'people.person.hired',
      payload: { personId: ADMIN.person, name: null },
    });
    await stack.sql`
      INSERT INTO people.webhook_delivery
             (tenant_id, endpoint_id, event_id, event_name, aggregate_id, envelope, status, attempts, last_response)
      VALUES (${TENANT}, ${endpointId}, ${eventId}, 'people.person.hired', ${ADMIN.person},
              ${envelope}, 'failed', 12, 500)`;

    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/settings/people/integrations/webhooks`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: `Delivery log for ${hookUrl}` }).click();
    await page.waitForURL(new RegExp(`/settings/people/integrations/webhooks/${endpointId}$`));
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
    // The replay was sent, signed, to the receiver and nowhere else.
    await expect
      .poll(() => stack.receiver.received.filter((r) => r.path === '/kithena-acceptance').length, {
        timeout: 30_000,
      })
      .toBe(1);
    const [sent] = stack.receiver.received.filter((r) => r.path === '/kithena-acceptance');
    expect(sent?.headers['kithena-event-id']).toBe(eventId);
    expect(sent?.headers['kithena-signature']).toBeTruthy();
    await context.close();
  });
});

describe('Employee fields: a field from a template, explained, then published', () => {
  it('adds T-shirt size on one page, says when it is asked, and publishes it', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/settings/people/fields`);
    await page.getByRole('heading', { name: 'Employee fields' }).waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Add field' }).filter({ visible: true }).first().click();
    const sheet = page.getByRole('dialog', { name: 'New field' });
    await sheet.getByRole('button', { name: 'T-shirt size' }).click();
    // Every part is on the page, with the list of parts beside it.
    await sheet.getByRole('navigation', { name: 'Parts of the field' }).waitFor();
    // Each moment it can be asked, with what it does.
    const onboarding = sheet.getByRole('radio', { name: 'During onboarding' });
    expect(await onboarding.isChecked()).toBe(true);
    expect(await onboarding.getAttribute('aria-describedby')).toBeTruthy();
    await sheet
      .getByText(/The employee is asked for their T-shirt size during onboarding\./)
      .waitFor({ timeout: 30_000 });
    // The least protection offered: whatever the suggestion, never below its floor.
    const least = sheet
      .getByRole('group', { name: 'What kind of data is this?' })
      .getByRole('radio')
      .last();
    await least.waitFor({ timeout: 30_000 });
    await least.click();
    await sheet.getByRole('button', { name: 'Add field' }).click();
    await sheet.waitFor({ state: 'detached', timeout: 30_000 });

    await page.getByRole('button', { name: /^Publish version/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Publish/ });
    await dialog.getByRole('button', { name: /^Publish version/ }).click({ timeout: 30_000 });
    await eventually(
      'the published field',
      () => stack.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM people.schema_version
         WHERE tenant_id = ${TENANT} AND document::text LIKE '%t_shirt_size%'`,
      ([row]) => (row?.n ?? 0) > 0,
    );
    await context.close();
  });
});

describe('Employee fields: a text field becomes a date, its values reviewed', () => {
  it('converts what it can, fixes two bad values on the spot, and publishes them together', async () => {
    // A text field, published, with one date-like value and two that are not.
    const registry = (await stack.asPeople(ADMIN.account, '/v1/views/registry')) as {
      sections: { key: string }[];
    };
    const sectionKey = registry.sections[0]?.key ?? 'hr_information';
    const input = {
      key: 'first_day',
      sectionKey,
      label: 'First day',
      description: null,
      dataType: 'text',
      options: [],
      requiredness: 'never',
      requiredWhen: null,
      ownership: ['hr'],
      collectAt: 'hr_only',
      visibility: ['self', 'hr'],
      visibilityRules: [],
      classification: 'internal',
      piiKind: 'none',
      classificationSource: 'human',
      requiresApproval: null,
    };
    await stack.asPeople(ADMIN.account, '/v1/schema/draft/attributes', {
      method: 'POST',
      body: { input, editing: null },
    });
    await stack.asPeople(ADMIN.account, '/v1/schema/draft/publish', {
      method: 'POST',
      body: { requiredFrom: '2026-01-01' },
    });
    const [other] = await stack.sql<{ id: string; given_name: string; family_name: string }[]>`
      SELECT id, given_name, family_name FROM people.person
       WHERE tenant_id = ${TENANT} AND id NOT IN (${ADMIN.person}, ${EMPLOYEE.person})
         AND given_name IS NOT NULL AND status = 'active'
       ORDER BY id LIMIT 1`;
    if (other === undefined) throw new Error('nobody else to give a value to');
    for (const [id, value] of [
      [ADMIN.person, '12/03/2024'],
      [EMPLOYEE.person, 'the Monday after Easter'],
      [other.id, 'n/a'],
    ] as const) {
      await stack.asPeople(ADMIN.account, `/v1/people/${id}`, {
        method: 'PATCH',
        body: { attributes: { first_day: value } },
      });
    }

    const context = await signedIn(ADMIN.session, { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/settings/people/fields?q=First%20day`);
    await page.getByRole('button', { name: 'Edit First day' }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog', { name: 'Edit First day' });
    await sheet.getByRole('combobox', { name: /Type of answer/ }).click();
    await page.getByRole('option', { name: 'Date', exact: true }).click();
    await sheet.getByRole('button', { name: 'Save field' }).click({ timeout: 30_000 });

    // The review, at its own address: nothing is written until it is published.
    await page.waitForURL(/\/settings\/people\/fields\/first_day\/change\?to=date$/, {
      timeout: 30_000,
    });
    await page.getByRole('heading', { name: 'Change First day to date' }).waitFor();
    await page.getByText('1 converts', { exact: true }).waitFor();
    await page.getByText('12 Mar 2024').waitFor();
    // The two values that do not fit, by the names the review shows for them:
    // a record's name is whatever People displays, not a column of its own.
    const selects = page.getByRole('checkbox', { name: /^Select / });
    await expect.poll(() => selects.count(), { timeout: 30_000 }).toBe(2);
    const names = (
      await selects.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    ).map((label) => (label ?? '').replace(/^Select /, ''));
    expect(names.every((n) => n.trim() !== '')).toBe(true);
    for (const name of names) {
      await page.getByRole('combobox', { name: `What to do with ${name}’s value` }).click();
      await page.getByRole('option', { name: 'Type the right value' }).click();
      await page.getByRole('button', { name: new RegExp(`New First day for ${name}`) }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /\b15\b/ })
        .first()
        .click();
    }
    await page.getByRole('button', { name: 'Publish the change' }).click();
    await page.waitForURL(/\/settings\/people\/fields$/, { timeout: 30_000 });

    const values = await eventually(
      'the converted and corrected values',
      () => stack.sql<{ id: string; v: string | null }[]>`
        SELECT id, custom->>'first_day' AS v FROM people.person
         WHERE id IN (${ADMIN.person}, ${EMPLOYEE.person}, ${other.id})`,
      (rows) => rows.every((r) => r.v !== null && /^\d{4}-\d{2}-\d{2}$/.test(r.v)),
    );
    expect(values.find((r) => r.id === ADMIN.person)?.v).toBe('2024-03-12');
    expect(values.filter((r) => r.v?.endsWith('-15') === true)).toHaveLength(2);
    const [corrections] = await stack.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM people.outbox
       WHERE event_name = 'people.person.attribute_corrected'
         AND envelope->'payload'->'attribute'->>'key' = 'first_day'`;
    expect(corrections?.n).toBe(3);
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
      await page.goto(`${stack.shell}/people/insights/data-quality`);
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

describe('PEO-125: a NIF our checks doubt, reviewed by HR, then approved', () => {
  it('warns the employee, holds it, and HR reviews it before approving it; both audited', async () => {
    // 12345678 mod 23 is Z; A is the wrong control letter.
    const employee = await signedIn(EMPLOYEE.session, { viewport: { width: 1280, height: 900 } });
    const own = await employee.newPage();
    await own.goto(`${stack.shell}/people/me`);
    await own.waitForLoadState('networkidle');
    await own.getByRole('button', { name: 'Edit Identification & right to work' }).click();
    const form = own.getByRole('form', { name: 'Identification & right to work' });
    const nif = form.getByRole('textbox', { name: /NIF \/ NIE/ });
    await nif.fill('12345678A');
    await form.getByRole('button', { name: 'Save' }).click();

    // Warned, on the field and above the button, and nothing is saved yet.
    await form
      .getByText('Our checks suggest this may be wrong', { exact: true })
      .waitFor({ timeout: 30_000 });
    const describedBy = (await nif.getAttribute('aria-describedby')) ?? '';
    const description = await own
      .locator(
        describedBy
          .split(' ')
          .map((id) => `[id="${id}"]`)
          .join(', '),
      )
      .allTextContents();
    expect(description.join(' ')).toMatch(/control letter does not compute/);
    const before = await stack.sql`
      SELECT 1 FROM people.person_secret WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`;
    expect(before).toHaveLength(0);

    // Submitted anyway. A NIF requires approval (PEO-077), so it is held, not
    // yet written — and because the checks doubt it, HR reviews it first: the
    // review opens now, against the held value.
    await form.getByRole('button', { name: 'Save anyway' }).click();
    // The form closes; the section says where the value went.
    await own.getByText(/NIF \/ NIE is not changed until HR approves/).waitFor({ timeout: 30_000 });
    const [heldNif] = await eventually(
      'the held NIF',
      () => stack.sql<{ id: string; state: string }[]>`
        SELECT id::text, state FROM people.pending_change
         WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`,
      (rows) => rows.length === 1 && rows[0]?.state === 'pending',
    );
    const [pending] = await stack.sql<
      { state: string; findings: { code: string }[]; history_id: string | null; change: string }[]
    >`
      SELECT state, findings, history_id::text, pending_change_id::text AS change
        FROM people.identifier_review
       WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`;
    expect(pending).toMatchObject({ state: 'pending', history_id: null, change: heldNif?.id });
    expect(pending?.findings.map((f) => f.code)).toEqual(['check_mismatch']);
    await own.reload();
    await own.getByText('NIF / NIE is with HR for review').waitFor({ timeout: 30_000 });
    await own.getByText('Awaiting identifier review').waitFor();
    await employee.close();

    // HR's inbox shows it waiting on its review, with what the checks found,
    // and offers no approval yet.
    const hr = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const approvals = await hr.newPage();
    await approvals.goto(`${stack.shell}/people/review/waiting?kind=changes`);
    await approvals.waitForLoadState('networkidle');
    // The inbox is a list beside the selected change; its detail is the page's.
    const inbox = approvals.getByRole('main');
    await inbox.getByText('Awaiting identifier review').first().waitFor({ timeout: 30_000 });
    await inbox
      .getByText(/control letter does not compute/)
      .first()
      .waitFor();
    expect(
      await inbox.getByRole('button', { name: /^Approve the change to .*NIF \/ NIE$/ }).count(),
    ).toBe(0);

    // HR sees what the checks found, reveals the held value, and accepts it.
    const reviews = await hr.newPage();
    await reviews.goto(`${stack.shell}/people/directory/list`);
    await (await sections(reviews)).getByRole('link', { name: /^Review/ }).click();
    await reviews.waitForURL(/\/people\/review\/waiting$/);
    await reviews
      .getByRole('main')
      .getByRole('radio', { name: /^ID checks/ })
      .click();
    await reviews.waitForURL(/\/people\/review\/waiting\?kind=ids$/);
    await reviews.waitForLoadState('networkidle');
    const table = reviews.getByRole('main');
    await table
      .getByText(/control letter does not compute/)
      .first()
      .waitFor({ timeout: 30_000 });
    expect(await table.getByText('12345678A').count()).toBe(0);
    await table.getByRole('button', { name: /^Show .* NIF \/ NIE in full$/ }).click();
    await table.getByText('12345678A').waitFor({ timeout: 30_000 });
    await table.getByRole('button', { name: /^Accept / }).click();
    await reviews.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
    await eventually(
      'the decision',
      () => stack.sql<{ state: string }[]>`
        SELECT state FROM people.identifier_review
         WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`,
      ([row]) => row?.state === 'accepted',
    );
    await reviews.getByText('Nothing to review').waitFor({ timeout: 30_000 });
    expect(
      await stack.sql`SELECT 1 FROM people.person_secret
                       WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`,
    ).toHaveLength(0);

    // Now it can be approved, and the approval writes it — without a second review.
    await approvals.reload();
    await approvals.waitForLoadState('networkidle');
    // Approve decides in the row (design AI7); only a flagged change asks for a note first.
    await inbox.getByRole('button', { name: /^Approve the change to .*NIF \/ NIE$/ }).click();
    await eventually(
      'the NIF',
      () => stack.sql`SELECT 1 FROM people.person_secret
                       WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`,
      (rows) => rows.length === 1,
    );
    const after = await stack.sql<{ state: string }[]>`
      SELECT state FROM people.identifier_review
       WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`;
    expect(after.map((r) => r.state)).toEqual(['accepted']);
    await hr.close();

    // Audited by codes, never by value; the reveal is audited too.
    const audit = await stack.sql<{ event_name: string; envelope: unknown }[]>`
      SELECT event_name, envelope FROM people.outbox
       WHERE event_name IN ('people.person.identifier_reviewed', 'people.person.identifier_revealed')
         AND envelope -> 'payload' ->> 'personId' = ${EMPLOYEE.person}
       ORDER BY created_at`;
    expect(audit.map((e) => e.event_name)).toEqual([
      'people.person.identifier_revealed',
      'people.person.identifier_reviewed',
    ]);
    expect(JSON.stringify(audit)).not.toContain('12345678');
    const reviewed = audit[1]?.envelope as { payload: Record<string, unknown>; actor: unknown };
    expect(reviewed.payload).toMatchObject({
      decision: 'accepted',
      findingCodes: ['check_mismatch'],
      changeId: heldNif?.id,
    });
    expect(reviewed.actor).toEqual({ kind: 'user', userId: ADMIN.account });
  });

  it('tells the employee why when HR’s review finds errors, and lets them correct it', async () => {
    // 87654321 mod 23 is X; A is the wrong control letter.
    const employee = await signedIn(EMPLOYEE.session, { viewport: { width: 1280, height: 900 } });
    const own = await employee.newPage();
    await own.goto(`${stack.shell}/people/me`);
    await own.waitForLoadState('networkidle');
    await own.getByRole('button', { name: 'Edit Identification & right to work' }).click();
    const form = own.getByRole('form', { name: 'Identification & right to work' });
    await form.getByRole('textbox', { name: /NIF \/ NIE/ }).fill('87654321A');
    await form.getByRole('button', { name: 'Save' }).click();
    await form.getByRole('button', { name: 'Save anyway' }).click();
    const [heldNif] = await eventually(
      'the held NIF',
      () => stack.sql<{ id: string }[]>`
        SELECT id::text FROM people.pending_change
         WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif' AND state = 'pending'`,
      (rows) => rows.length === 1,
    );

    // HR's review finds the letter wrong, and says so; the reason is required.
    const hr = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const reviews = await hr.newPage();
    await reviews.goto(`${stack.shell}/people/review/waiting?kind=ids`);
    await reviews.waitForLoadState('networkidle');
    const table = reviews.getByRole('main');
    await table.getByText('Waiting for approval').waitFor({ timeout: 30_000 });
    await table.getByRole('button', { name: /^Send .* NIF \/ NIE back$/ }).click();
    const dialog = reviews.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: /What is wrong/ })
      .fill('The letter on your card is X');
    await dialog.getByRole('button', { name: 'Send back' }).click();
    const [declined] = await eventually(
      'the declined change',
      () => stack.sql<{ state: string; decided_as: string | null; note: string | null }[]>`
        SELECT state, decided_as, note FROM people.pending_change WHERE id = ${heldNif?.id ?? ''}`,
      ([row]) => row?.state === 'rejected',
    );
    expect(declined).toEqual({
      state: 'rejected',
      decided_as: 'identifier_review',
      note: 'The letter on your card is X',
    });
    await hr.close();
    // Still what HR accepted before: nothing was written.
    const [kept] = await stack.sql<{ last4: string }[]>`
      SELECT last4 FROM people.person_secret
       WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'`;
    expect(kept?.last4).toBe('678A');

    // The employee sees why on their record, and opens the field to correct it.
    await own.reload();
    // The record draws the notice for a desk and for a phone, one of them
    // hidden: wait for whichever is shown, not for exactly one match.
    await own
      .getByText('HR could not accept your NIF / NIE')
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 30_000 });
    await own
      .getByText(/The letter on your card is X\. Please correct it\./)
      .filter({ visible: true })
      .first()
      .waitFor();
    await own.getByRole('button', { name: 'Correct NIF / NIE' }).click();
    await own.getByRole('form', { name: 'Identification & right to work' }).waitFor();

    // Their corrected value answers the review, and waits for approval only.
    const fix = own.getByRole('form', { name: 'Identification & right to work' });
    await fix.getByRole('textbox', { name: /NIF \/ NIE/ }).fill('87654321X');
    await fix.getByRole('button', { name: 'Save' }).click();
    await eventually(
      'the answered review',
      () => stack.sql<{ state: string }[]>`
        SELECT state FROM people.identifier_review
         WHERE person_id = ${EMPLOYEE.person} AND attribute_key = 'es_nif'
         ORDER BY created_at DESC LIMIT 1`,
      ([row]) => row?.state === 'superseded',
    );
    const [answer] = await stack.sql<{ envelope: { payload: Record<string, unknown> } }[]>`
      SELECT envelope FROM people.outbox
       WHERE event_name = 'people.person.change_requested'
         AND envelope -> 'payload' ->> 'personId' = ${EMPLOYEE.person}
       ORDER BY created_at DESC LIMIT 1`;
    expect(answer?.envelope.payload).toHaveProperty('supersedesReview');
    expect(answer?.envelope.payload).not.toHaveProperty('reviewId');
    await employee.close();
  });
});

describe('An import larger than a Vercel function takes, straight to storage (§14.2)', () => {
  it('uploads 5 MB past the app’s server, imports the good row, and hands the blocked rows over a link', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const shellHost = new URL(stack.shell).host;
    // What the browser sends the shell, and what it PUTs anywhere else.
    let toShell = 0;
    const puts: string[] = [];
    // Measured as sent. A File body is not reported (a PUT's is 0 here), so
    // the file's arrival is proven by its checksum below instead.
    page.on('requestfinished', (request) => {
      void request.sizes().then(({ requestBodySize: bytes }) => {
        if (new URL(request.url()).host === shellHost) toShell = Math.max(toShell, bytes);
        else if (request.method() === 'PUT') puts.push(request.url());
      });
    });
    await page.goto(`${stack.shell}/people/import`);

    // One good row and five thousand wide ones that are nobody (no name, no
    // email), so they are skipped: past 4.5 MB, and a skipped-row report past it too.
    const pad = 'x'.repeat(1000);
    const csv = [
      'given_name,family_name,work_email,hire_date',
      'Grace,Hopper,grace@acme.example,2025-04-07',
      ...Array.from({ length: 5_000 }, (_, i) => `,,,${pad}${String(i)}`),
    ].join('\n');
    expect(Buffer.byteLength(csv)).toBeGreaterThan(4.5 * 1024 * 1024);
    await upload(page, 'big.csv', csv);

    const review = page.getByRole('button', { name: 'Next: decide what’s new' });
    await review.waitFor({ timeout: 120_000 });
    // What storage holds is the file, whole: People read it back and pinned
    // the SHA-256 of exactly these bytes.
    const [held] = await stack.sql<{ size: string; checksum: string }[]>`
      SELECT size::text, checksum FROM people.import_upload WHERE tenant_id = ${TENANT}`;
    expect(held).toEqual({
      size: String(Buffer.byteLength(csv)),
      checksum: createHash('sha256').update(csv).digest('hex'),
    });
    await review.click();
    await page.getByRole('button', { name: 'See rows' }).click({ timeout: 120_000 });
    await page.getByRole('heading', { name: 'Skipped rows' }).waitFor({ timeout: 120_000 });
    // The review lists the first twenty; the file has all of them.
    expect(
      await page.getByRole('table', { name: 'Skipped rows' }).getByRole('row').count(),
    ).toBeLessThanOrEqual(21);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download all 5000 as CSV/ }).click();
    const report = await readFile(await (await download).path(), 'utf8');
    expect(Buffer.byteLength(report)).toBeGreaterThan(4.5 * 1024 * 1024);
    expect(report.trim().split(/\r?\n/)).toHaveLength(5_001);

    await page.getByRole('button', { name: 'Approve and run' }).click();
    await page.getByRole('heading', { name: /^Imported 1 person/ }).waitFor({ timeout: 120_000 });
    const grace = await stack.sql`
      SELECT 1 FROM people.person WHERE tenant_id = ${TENANT} AND work_email = 'grace@acme.example'`;
    expect(grace).toHaveLength(1);

    // The file went to storage once, whole, and never through the app's server.
    expect(puts).toHaveLength(1);
    expect(puts[0]).toContain('/people-uploads/');
    expect(toShell).toBeLessThan(64 * 1024);
    // Committed: the upload is gone, row and object.
    const left = await stack.sql`SELECT 1 FROM people.import_upload WHERE tenant_id = ${TENANT}`;
    expect(left).toHaveLength(0);
    await context.close();
  });
});

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
    const gap = titled(page, 'To do')
      .getByRole('link', { name: /Add your emergency contact/ })
      .first();
    await gap.waitFor();
    await shot(page, 'overview-employee-desktop-light');

    // The link opens his profile at that field, cursor in it, marked missing.
    await gap.click();
    await page.waitForURL(/\/people\/me\?field=emergency_contact$/);
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

    // Over: Import is back, the history says Imported, and the bell says so too.
    await page.goto(`${made.shell}/people/import-export`);
    await page.getByRole('link', { name: 'Start import' }).first().waitFor({ timeout: 30_000 });
    await page
      .getByText(/^Imported · 400 created or updated$/)
      .first()
      .waitFor({ timeout: 30_000 });
    await page.goto(`${made.shell}/inbox`);
    await page.getByText('Import finished: 400 people').first().waitFor({ timeout: 30_000 });
    expect(await unavailable()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  }, 600_000);
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
