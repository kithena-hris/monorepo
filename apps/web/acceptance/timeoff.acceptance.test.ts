import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { ADMIN, EMPLOYEE, TENANT, startStack, type Stack } from './stack';

/**
 * Time Off, end to end, in the running shell: its remote and its service
 * behind the router, as a person meets them (`stack.ts` has what is real).
 *
 * Acme starts as the stack leaves it: Priya, People's administrator, and
 * Adam, both provisional in People and so nobody in Time Off. The back
 * office names Priya Time Off's administrator, and she sets up a vacation
 * policy as HR. Adam, not hired yet, is told plainly that he cannot request
 * time off. Then HR hires both in People, Adam reporting to Priya, and People's
 * events make them members by the consumer production runs. Adam requests a
 * day off, Priya approves it, and Adam sees it approved. Moving between Time
 * Off's pages draws each on the server with no skeleton in between, each
 * prefetched on the pointer resting on its link; with `NAV_OUT`, a run writes
 * down how long each move took (and `ACCEPTANCE_LATENCY_MS` puts the hops of
 * production between the servers).
 */

let stack: Stack;
let browser: Browser;

beforeAll(async () => {
  stack = await startStack(inject('remoteKeys'));
  browser = await chromium.launch();

  // The back office names Priya Time Off's administrator: identity's route,
  // and its event to Time Off's consumer through the broker.
  const named = await stack.backOffice(
    'POST',
    `/api/internal/admin/tenants/${TENANT}/administrators`,
    { entitlement: 'module.timeoff', accountId: ADMIN.account, operatorId: randomUUID() },
  );
  expect(named.status).toBe(201);

  // People set up as its wizard sets it up: the legal entity, then version 1.
  for (const [path, body] of [
    ['/v1/views/setup/entity', { name: 'Acme', country: 'ES' }],
    ['/v1/views/setup/publish', { country: 'ES', sections: [] }],
  ] as const) {
    const done = await stack.writeAsPeople(ADMIN.account, path, body);
    expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
  }

  // Priya, HR in Time Off once its consumer has the event: a vacation policy,
  // 25 days from the start of the year.
  await eventually(
    'Priya as Time Off’s HR',
    async () =>
      (await stack.asTimeOff(ADMIN.account, 'GET', '/v1/timeoff/settings/leave-types')).status,
    (status) => status === 200,
  );
  const type = await stack.asTimeOff(ADMIN.account, 'POST', '/v1/timeoff/leave-types', {
    key: 'vacation',
    name: { default: 'Vacation', translations: {} },
    category: 'annual_leave',
    colorToken: 'chart-1',
    icon: 'sun',
    tracked: true,
    paid: 'paid',
    visibility: 'type',
  });
  expect(type.status, JSON.stringify(type.body)).toBe(201);
  const policy = await stack.asTimeOff(ADMIN.account, 'POST', '/v1/timeoff/policies', {
    leaveTypeKey: 'vacation',
    allowance: [{ fromYears: 0, days: '25.000' }],
  });
  expect(policy.status, JSON.stringify(policy.body)).toBe(201);
  const policyId = (policy.body as { policyId: string }).policyId;
  const published = await stack.asTimeOff(
    ADMIN.account,
    'POST',
    `/v1/timeoff/policies/${policyId}/publish`,
    { effectiveFrom: `${String(new Date().getUTCFullYear())}-01-01` },
  );
  expect(published.status, JSON.stringify(published.body)).toBe(200);
}, 900_000);

afterAll(async () => {
  await (browser as Browser | undefined)?.close();
  await (stack as Stack | undefined)?.stop();
}, 60_000);

async function signedIn(
  session: string,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  await context.addCookies([
    {
      name: '__Host-ksession',
      value: session,
      domain: new URL(stack.shell).hostname,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return context;
}

/** Wait for a read to hold, bounded. */
async function eventually<T>(
  what: string,
  read: () => Promise<T>,
  holds: (v: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  let last = await read();
  while (!holds(last)) {
    if (Date.now() > deadline) throw new Error(`${what}: still ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await read();
  }
  return last;
}

/** Every loading skeleton put into the page from now on, kept on `window.skeletons`. */
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

const member = (personId: string) =>
  stack.sql<{ account_id: string | null; manager_person_id: string | null }[]>`
    SELECT account_id::text, manager_person_id::text FROM timeoff.member
     WHERE tenant_id = ${TENANT} AND person_id = ${personId}`;

/** The first Monday of next month, and the Tuesday after it, as dates and as the calendar names them. */
function nextMonthsFirstMonday(): { from: string; to: string; fromName: string; toName: string } {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1);
  const tuesday = new Date(day.getTime() + 86_400_000);
  const name = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  return {
    from: day.toISOString().slice(0, 10),
    to: tuesday.toISOString().slice(0, 10),
    fromName: name(day),
    toName: name(tuesday),
  };
}

describe('Somebody People has not hired yet', () => {
  it('is offered no request, and the request page says plainly why', async () => {
    expect(await member(EMPLOYEE.person)).toEqual([]);
    const context = await signedIn(EMPLOYEE.session);
    const page = await context.newPage();
    await page.goto(`${stack.shell}/time-off/overview`);
    await page.getByText('Nothing here for you yet').first().waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    expect(await page.getByRole('link', { name: 'Request time off' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Request time off' }).count()).toBe(0);

    await page.goto(`${stack.shell}/time-off/request`);
    const panel = page.getByRole('dialog', { name: 'Request time off' });
    await panel.getByText('You can’t request time off yet').waitFor({ timeout: 30_000 });
    expect(await panel.getByText(/Time Off does not have you as an employee yet/).count()).toBe(1);
    expect(await page.getByText(/Not permitted/).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Try again' }).count()).toBe(0);
    await context.close();
  });
});

describe('A day off, requested, approved and seen approved', () => {
  it('HR hires both in People; Adam requests from his balance, Priya approves, Adam sees it', async () => {
    // Hired in People, Adam reporting to Priya: names and the line first, as HR fills them in.
    const [entity] = await stack.sql<{ id: string }[]>`
      SELECT id::text FROM people.legal_entity WHERE tenant_id = ${TENANT} LIMIT 1`;
    for (const [who, given, family, manager] of [
      [ADMIN, 'Priya', 'Shah', null],
      [EMPLOYEE, 'Adam', 'Ruiz', ADMIN.person],
    ] as const) {
      const patched = (await stack.asPeople(ADMIN.account, `/v1/people/${who.person}`, {
        method: 'PATCH',
        body: {
          attributes: {
            given_name: given,
            family_name: family,
            ...(manager === null ? {} : { manager_id: manager }),
          },
        },
      })) as { id?: string };
      expect(patched.id, JSON.stringify(patched)).toBe(who.person);
      const hired = await stack.writeAsPeople(ADMIN.account, `/v1/people/${who.person}/hire`, {
        hireDate: '2025-01-06',
        legalEntityId: entity?.id,
      });
      expect(hired.status, JSON.stringify(hired.body)).toBe(200);
    }
    // Members by People's events alone, through the broker and Time Off's consumer.
    await eventually(
      'Adam as a member, reporting to Priya',
      () => member(EMPLOYEE.person),
      ([m]) => m?.account_id === EMPLOYEE.account && m.manager_person_id === ADMIN.person,
    );
    await eventually(
      'Priya as a member',
      () => member(ADMIN.person),
      ([m]) => m?.account_id === ADMIN.account,
    );

    // Adam: his balance, then the panel from the page's action.
    const adam = await signedIn(EMPLOYEE.session);
    const page = await adam.newPage();
    await page.goto(`${stack.shell}/time-off/overview`);
    await page.getByRole('heading', { name: /Adam/ }).waitFor({ timeout: 30_000 });
    const balances = page.getByRole('region', { name: 'Your balances' });
    await balances.getByText('Vacation').first().waitFor();
    expect(await balances.getByText('days left').count()).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Request time off' }).click();
    await page.waitForURL(/\/time-off\/request(\?|$)/);
    const panel = page.getByRole('dialog', { name: 'Request time off' });
    // The card, not the radio inside it, which its icon covers.
    await panel.getByText('Vacation', { exact: true }).click();
    await page.waitForURL(/type=vacation/);
    const days = nextMonthsFirstMonday();
    await panel.getByRole('button', { name: 'Next month' }).click();
    await panel.getByRole('button', { name: days.fromName, exact: true }).click();
    await panel.getByRole('button', { name: days.toName, exact: true }).click();
    await page.waitForURL(
      new RegExp(`from=${days.from}.*to=${days.to}|to=${days.to}.*from=${days.from}`),
    );
    // The preview: what the two days cost, and who approves.
    await panel.getByText('Priya Shah approves.').waitFor({ timeout: 30_000 });
    const send = panel.getByRole('button', { name: 'Send to Priya' });
    await expect.poll(() => send.isEnabled()).toBe(true);
    await send.click();
    await page.waitForURL(/\/time-off\/requests\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const requestId = page.url().split('/').pop() ?? '';
    await eventually(
      'the request, waiting',
      () => stack.sql<{ status: string }[]>`
        SELECT status FROM timeoff.request WHERE tenant_id = ${TENANT} AND id = ${requestId}`,
      ([r]) => r?.status === 'pending',
    );

    // Priya: waiting for her, approved.
    const priya = await signedIn(ADMIN.session);
    const queue = await priya.newPage();
    await queue.goto(`${stack.shell}/time-off/approvals/waiting`);
    const approve = queue.getByRole('button', { name: /^Approve Adam.*request$/ });
    await approve.waitFor({ timeout: 30_000 });
    await queue.waitForLoadState('networkidle');
    await approve.click();
    await eventually(
      'the request, approved',
      () => stack.sql<{ status: string }[]>`
        SELECT status FROM timeoff.request WHERE tenant_id = ${TENANT} AND id = ${requestId}`,
      ([r]) => r?.status === 'approved',
    );
    await priya.close();

    // Adam sees it approved among what is coming up.
    await page.goto(`${stack.shell}/time-off/requests/upcoming`);
    await page.getByText('Approved').first().waitFor({ timeout: 30_000 });
    await adam.close();
  });
});

/**
 * Moving between Time Off's pages as a person does, as People's moves are
 * timed (`people.acceptance.test.ts`): a pointer that rests on a link before
 * pressing it, each move timed from the press to the address changing, when
 * the next page is drawn. The previous page stays until then, with no
 * skeleton in between, and the rest on the link has fetched the page.
 */
describe('Moving between Time Off’s sections and tabs', () => {
  it('lands every move from a page prefetched on hover, with no skeleton between pages', async () => {
    const context = await signedIn(ADMIN.session);
    const page = await context.newPage();
    // Every page the router fetched, by its path: a prefetch is one of these.
    const fetched: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['rsc'] === '1') fetched.push(new URL(r.url()).pathname);
    });
    await page.goto(`${stack.shell}/people/directory/list`);
    await page.locator('[data-remote="people"]').waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await watchSkeletons(page);

    const named = (name: string) => new RegExp(`^${name}`);
    const sidebar = (name: string) =>
      page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: named(name) });
    const tab = (section: string, name: string) =>
      page
        .getByRole('navigation', { name: `${section} tabs` })
        .getByRole('link', { name: named(name) });
    const moves: [string, number][] = [];
    const move = async (link: ReturnType<typeof sidebar>, to: RegExp): Promise<void> => {
      const href = (await link.first().getAttribute('href')) ?? '';
      await link.first().hover();
      // The rest on the link fetches the page it leads to.
      await expect
        .poll(() => fetched.includes(new URL(href, stack.shell).pathname), { timeout: 10_000 })
        .toBe(true);
      await page.waitForTimeout(150);
      const start = performance.now();
      await link.first().click();
      await page.waitForURL(to, { timeout: 30_000 });
      moves.push([to.source, Math.round(performance.now() - start)]);
      // A moment on the page, as somebody reading it.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1_000);
    };
    await move(sidebar('Time off'), /\/time-off\/overview/);
    await move(sidebar('Calendar'), /\/time-off\/calendar\/month/);
    await move(tab('Calendar', 'Timeline'), /\/time-off\/calendar\/timeline/);
    // A manager's and HR's name for My requests.
    await move(sidebar('Requests'), /\/time-off\/approvals\/waiting/);
    await move(tab('Requests', 'Decided'), /\/time-off\/approvals\/decided/);
    await move(tab('Requests', 'Upcoming'), /\/time-off\/requests\/upcoming/);
    await move(sidebar('Insights'), /\/time-off\/insights\/what-changed/);
    await move(tab('Insights', 'Balances'), /\/time-off\/insights\/balances/);
    await move(sidebar('Overview'), /\/time-off\/overview/);

    // The request panel, from the overview's action: open, with the overview behind it.
    const action = page.getByRole('link', { name: 'Request time off' });
    await action.hover();
    await page.waitForTimeout(150);
    const start = performance.now();
    await action.click();
    await page
      .getByRole('dialog', { name: 'Request time off' })
      .getByRole('radio')
      .first()
      .waitFor({
        timeout: 30_000,
      });
    moves.push(['request panel', Math.round(performance.now() - start)]);

    const out = process.env['NAV_OUT'];
    if (out !== undefined) {
      for (const [to, ms] of moves) appendFileSync(out, `${to} ${String(ms)}\n`);
    }
    expect(moves).toHaveLength(10);
    expect(await skeletons(page)).toEqual([]);
    await context.close();
  });
});
