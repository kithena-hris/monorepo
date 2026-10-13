import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';

import { ADMIN, EMPLOYEE, ROOT, TENANT } from './stack';
import {
  eventually,
  inView,
  keyboardUp,
  live,
  person,
  sections,
  signedIn,
  stack,
  upload,
  useStack,
} from './people-harness';

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

useStack();

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

    await live(page);
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
    await live(page);
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
    // The one on screen: React's streamed copy can linger hidden after a load.
    await page
      .getByText('Complete', { exact: true })
      .filter({ visible: true })
      .waitFor({ timeout: 20_000 });
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
  async function late(session: string): Promise<{
    page: Page;
    errors: string[];
    release: () => void;
    close: () => Promise<void>;
  }> {
    const context = await signedIn(session);
    // Held until the test has pressed (`release`), not for a fixed time: a
    // slow runner once spent all of a 2 s hold before the button was on
    // screen, and the screen was live by the time the test pressed it.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route(/\/remoteEntry\.js$/, async (route) => {
      await Promise.race([held, new Promise((resolve) => setTimeout(resolve, 30_000))]);
      await route.continue();
    });
    const page = await context.newPage();
    // What the browser complained of: a hydration React gave up on says why here.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    return {
      page,
      errors,
      release,
      close: async () => {
        release();
        await context.close();
      },
    };
  }

  it('saves a section once, with what was typed before it', async () => {
    const saves = async (): Promise<number> => {
      const [row] = await stack.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM people.outbox
         WHERE event_name = 'people.person.profile_updated' AND aggregate_id = ${ADMIN.person}`;
      return row?.n ?? 0;
    };
    const before = await saves();
    const { page, release, close } = await late(ADMIN.session);
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
    release();
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
    const { page, errors, release, close } = await late(ADMIN.session);
    await page.goto(`${stack.shell}/people/${EMPLOYEE.person}`, { waitUntil: 'commit' });
    const edit = page.getByRole('button', { name: /^Edit .+/ }).first();
    await edit.waitFor({ timeout: 30_000 });
    expect(await waiting(page), errors.join('\n')).toBe(true);
    const entries = await page.evaluate(() => history.length);
    await edit.click();
    release();
    await page.getByText('Editing').waitFor({ timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get('edit')).not.toBeNull();
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await close();
  });

  // Without the hold, a link pressed this early was a full page load.
  it('follows a tab’s link once, in the page', async () => {
    const { page, release, close } = await late(ADMIN.session);
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
    release();
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
    // Her NIF's tail, whole or masked; not a timestamp's milliseconds (".678Z").
    expect(html).not.toMatch(/(?<!\.)678Z/);

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
      // The one on screen: the server's streamed copy can linger hidden
      // (`<div hidden id="S:…">`) when the browser drew the screen first.
      const shown = await page
        .getByTestId('their-day')
        .filter({ visible: true })
        .innerText({ timeout: 30_000 });
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
    // Nothing of this page still asking People: a read on its way when the
    // file is claimed would be shared with the reload after it (`alongside` in
    // `people.ts`) and answer "Ready to download" for a file already taken.
    await asks.waitForLoadState('networkidle');
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
  it('adds T-shirt size step by step, says when it is asked, and publishes it', async () => {
    const context = await signedIn(ADMIN.session, { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${stack.shell}/settings/people/fields`);
    await page.getByRole('heading', { name: 'Employee fields' }).waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Add field' }).filter({ visible: true }).first().click();
    const sheet = page.getByRole('dialog', { name: 'New field' });
    await sheet.getByRole('button', { name: 'T-shirt size' }).click();
    // Five steps, a new field walked through them in order.
    await sheet.getByRole('navigation', { name: 'Parts of the field' }).waitFor();
    await sheet.getByRole('button', { name: 'Next: Access' }).click();
    await sheet.getByRole('button', { name: /^Next: When/ }).click();
    // Each moment it can be asked, with what it does.
    const onboarding = sheet.getByRole('radio', { name: 'During onboarding' });
    expect(await onboarding.isChecked()).toBe(true);
    expect(await onboarding.getAttribute('aria-describedby')).toBeTruthy();
    await sheet
      .getByText(/The employee is asked for their T-shirt size during onboarding\./)
      .waitFor({ timeout: 30_000 });
    await sheet.getByRole('button', { name: 'Next: Sensitivity' }).click();
    // The least protection offered: whatever the suggestion, never below its floor.
    const least = sheet
      .getByRole('group', { name: 'What kind of data is this?' })
      .getByRole('radio')
      .last();
    await least.waitFor({ timeout: 30_000 });
    await least.click();
    await sheet.getByRole('button', { name: 'Next: Review' }).click();
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
    // The whole row opens the editor: its name is the button.
    await page.getByRole('button', { name: 'First day', exact: true }).click({ timeout: 30_000 });
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
