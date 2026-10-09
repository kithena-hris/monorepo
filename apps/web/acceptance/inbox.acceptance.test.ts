import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext } from 'playwright';

import { ADMIN, EMPLOYEE, TENANT, startStack, type Stack } from './stack';

/**
 * The Inbox, end to end (INB-061): the shell merging People's and Time Off's
 * items behind the router, as a person meets them.
 *
 * Priya, HR, hires herself and Adam, who reports to her. She asks Adam for a
 * detail, which is a task in his Inbox that he fills in there; she sees it
 * done. Adam asks for two days off, which is a task in Priya's Inbox that she
 * approves in place; he sees the decision. Priya sends Adam a document to
 * sign, he signs it from his Inbox, and it is Priya's to countersign.
 */

let stack: Stack;
let browser: Browser;

beforeAll(async () => {
  stack = await startStack(inject('remoteKeys'));
  browser = await chromium.launch();

  const named = await stack.backOffice(
    'POST',
    `/api/internal/admin/tenants/${TENANT}/administrators`,
    { entitlement: 'module.timeoff', accountId: ADMIN.account, operatorId: randomUUID() },
  );
  expect(named.status).toBe(201);
  for (const [path, body] of [
    ['/v1/views/setup/entity', { name: 'Acme', country: 'ES' }],
    ['/v1/views/setup/publish', { country: 'ES', sections: [] }],
  ] as const) {
    const done = await stack.writeAsPeople(ADMIN.account, path, body);
    expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
  }

  // Hired, Adam reporting to Priya.
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
      hireDate: '2025-01-06',
      legalEntityId: entity?.id,
    });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);
  }

  // Time Off: a vacation policy, once Priya is its HR by its consumer.
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
  const policyId = (policy.body as { policyId: string }).policyId;
  await stack.asTimeOff(ADMIN.account, 'POST', `/v1/timeoff/policies/${policyId}/publish`, {
    effectiveFrom: `${String(new Date().getUTCFullYear())}-01-01`,
  });
  await eventually(
    'Adam as a member, reporting to Priya',
    () => stack.sql<{ manager: string | null }[]>`
      SELECT manager_person_id::text AS manager FROM timeoff.member
       WHERE tenant_id = ${TENANT} AND person_id = ${EMPLOYEE.person}`,
    ([m]) => m?.manager === ADMIN.person,
  );
}, 900_000);

afterAll(async () => {
  await (browser as Browser | undefined)?.close();
  await (stack as Stack | undefined)?.stop();
}, 60_000);

async function signedIn(session: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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

/** A detail Adam fills in himself and has not yet, from the published version: Spain's NAF. */
async function employeeField(): Promise<{ key: string; label: string }> {
  const [row] = await stack.sql<{ document: { attributes: unknown[] } }[]>`
    SELECT document FROM people.schema_version
     WHERE tenant_id = ${TENANT} ORDER BY version DESC LIMIT 1`;
  const found = (row?.document.attributes ?? []).find((a) => {
    const d = a as {
      key: string;
      dataType: string;
      ownership: string[];
      visibility: string[];
      deprecatedAt: string | null;
      label: { default: string };
    };
    return (
      !['given_name', 'family_name', 'preferred_name', 'work_email'].includes(d.key) &&
      d.key !== 'es_nif' &&
      d.ownership.includes('employee') &&
      d.visibility.includes('hr') &&
      d.deprecatedAt === null &&
      ['text', 'phone', 'email', 'national_id'].includes(d.dataType)
    );
  }) as { key: string; label: { default: string } } | undefined;
  if (found === undefined) throw new Error('No field the employee fills in');
  return { key: found.key, label: found.label.default };
}

describe('The Inbox', () => {
  it('is where Adam fills in what HR asked for, and Priya sees it done', async () => {
    const field = await employeeField();
    const asked = await stack.writeAsPeople(ADMIN.account, '/v1/asks', {
      personIds: [EMPLOYEE.person],
      keys: [field.key],
      message: 'We need this before the offsite. Thanks!',
      dueOn: null,
    });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);

    const adam = await signedIn(EMPLOYEE.session);
    const page = await adam.newPage();
    await page.goto(`${stack.shell}/inbox/todo`);
    const row = page.getByRole('link', { name: `Add your ${field.label.toLowerCase()}` });
    await row.waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await row.click();
    const pane = page.getByRole('article');
    await pane.getByText('We need this before the offsite. Thanks!').waitFor();
    // A Social Security number whose two check digits hold (mod 97).
    await pane.getByRole('textbox', { name: field.label }).fill('281234567840');
    await pane.getByRole('button', { name: 'Add to my record' }).click();
    await eventually(
      'the ask, done',
      () => stack.sql<{ state: string }[]>`
        SELECT state FROM people.detail_ask WHERE tenant_id = ${TENANT} AND person_id = ${EMPLOYEE.person}`,
      ([a]) => a?.state === 'done',
    );
    await page.getByText(`${field.label} added`).first().waitFor({ timeout: 10_000 });
    await adam.close();

    const priya = await signedIn(ADMIN.session);
    const hers = await priya.newPage();
    await hers.goto(`${stack.shell}/inbox/updates`);
    await hers
      .getByRole('link', { name: 'Adam Ruiz added what you asked for' })
      .waitFor({ timeout: 30_000 });
    await priya.close();
  });

  it('is where Priya approves Adam’s time off in place, and Adam sees the decision', async () => {
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7) + 14);
    const from = monday.toISOString().slice(0, 10);
    const to = new Date(monday.getTime() + 86_400_000).toISOString().slice(0, 10);
    const sent = await stack.asTimeOff(EMPLOYEE.account, 'POST', '/v1/timeoff/requests', {
      leaveTypeKey: 'vacation',
      span: { from, to },
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const requestId = (sent.body as { requestId: string }).requestId;

    const priya = await signedIn(ADMIN.session);
    const page = await priya.newPage();
    await page.goto(
      `${stack.shell}/inbox/todo?item=${encodeURIComponent(`timeoff:approval:${requestId}`)}`,
    );
    const pane = page.getByRole('article');
    await pane.getByRole('heading', { name: /^Adam Ruiz · / }).waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await pane.getByRole('textbox', { name: 'Note to Adam' }).fill('Enjoy!');
    await pane.getByRole('button', { name: /^Approve/ }).click();
    await eventually(
      'the request, approved',
      () => stack.sql<{ status: string }[]>`
        SELECT status FROM timeoff.request WHERE tenant_id = ${TENANT} AND id = ${requestId}`,
      ([r]) => r?.status === 'approved',
    );
    await priya.close();

    const adam = await signedIn(EMPLOYEE.session);
    const his = await adam.newPage();
    await his.goto(`${stack.shell}/inbox/updates`);
    await his
      .getByRole('link', { name: 'Priya approved your time off' })
      .waitFor({ timeout: 30_000 });
    await adam.close();
  });

  it('is where Adam signs what HR sent, and Priya countersigns', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
    const started = await stack.writeAsPeople(ADMIN.account, '/v1/documents/uploads', {
      personId: EMPLOYEE.person,
      name: 'Remote-work addendum.pdf',
      size: pdf.byteLength,
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const target = started.body as {
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    };
    const { 'content-length': _length, ...signed } = target.headers;
    const put = await fetch(target.url, { method: 'PUT', headers: signed, body: pdf });
    expect(put.status).toBe(200);
    const sent = await stack.writeAsPeople(ADMIN.account, '/v1/documents', {
      personId: EMPLOYEE.person,
      uploadId: target.uploadId,
      mode: 'sign',
      message: 'Please sign this by Friday.',
      dueOn: null,
      countersigner: ADMIN.account,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const documentId = (sent.body as { id: string }).id;

    const adam = await signedIn(EMPLOYEE.session);
    const page = await adam.newPage();
    await page.goto(
      `${stack.shell}/inbox/todo?item=${encodeURIComponent(`people:document:${documentId}`)}`,
    );
    const pane = page.getByRole('article');
    await pane
      .getByRole('heading', { name: 'Sign Remote-work addendum.pdf' })
      .waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    // Sign once it has been opened.
    const opened = adam.waitForEvent('page');
    await pane.getByRole('button', { name: 'Preview' }).click();
    await (await opened).close();
    await pane.getByRole('button', { name: 'Sign', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Sign Remote-work/ });
    await dialog.getByRole('textbox', { name: 'Your full name' }).fill('Adam Ruiz');
    await dialog.getByRole('checkbox').click();
    await dialog.getByRole('button', { name: 'Sign', exact: true }).click();
    await eventually(
      'the document, signed',
      () => stack.sql<{ state: string; signed_name: string | null }[]>`
        SELECT state, signed_name FROM people.document WHERE tenant_id = ${TENANT} AND id = ${documentId}`,
      ([d]) => d?.state === 'signed' && d.signed_name === 'Adam Ruiz',
    );
    await adam.close();

    const priya = await signedIn(ADMIN.session);
    const hers = await priya.newPage();
    await hers.goto(`${stack.shell}/inbox/todo`);
    await hers
      .getByRole('link', { name: 'Countersign Remote-work addendum.pdf' })
      .waitFor({ timeout: 30_000 });
    await priya.close();
  });
});
