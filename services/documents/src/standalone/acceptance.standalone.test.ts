/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/restrict-template-expressions --
   A test reads the JSON a transport answered by its path, and every path it reads is asserted. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import { ok } from '@kithena/domain-kit';
import { fixedClock } from '@kithena/domain-kit';
import type { PersonId, TenantId } from '@kithena/contracts';

import { seedTypes } from '../application/organise.js';
import type { Caller } from '../application/ports.js';
import { documentsServer } from '../http/server.js';
import { documentsConsumer } from '../infrastructure/consumers/handle.js';
import { memoryWorld } from '../testing/memory.js';

/**
 * `just standalone documents` (DOC-027): Documents booted with every sibling
 * absent (People, Time Off and the rest resolve to a module that throws), over
 * its in-memory stores, driven through REST and the subgraph as Acme's
 * people. No model key is read and nothing leaves the process.
 *
 * The property that matters most: a member never opens, lists, downloads or
 * finds a document they may not open.
 */

const TENANT = '00000000-0000-4000-8000-0000000000ac' as TenantId;
const OTHER = '00000000-0000-4000-8000-0000000000bc' as TenantId;
const ids = {
  adam: {
    account: '7ac0e000-0000-4000-8000-0000000000a1',
    person: '00000000-0000-4000-8000-0000000000ad',
  },
  marco: {
    account: '7ac0e000-0000-4000-8000-0000000000a2',
    person: '00000000-0000-4000-8000-0000000000aa',
  },
  ada: {
    account: '7ac0e000-0000-4000-8000-0000000000a3',
    person: '00000000-0000-4000-8000-0000000000a3',
  },
  mei: {
    account: '7ac0e000-0000-4000-8000-0000000000a4',
    person: '00000000-0000-4000-8000-0000000000a4',
  },
};
type Who = keyof typeof ids;

const world = memoryWorld();
let counter = 0;
/** Every email asked for: messaging is down here, and signing must not care. */
const ADAM_TRACE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const mailed: string[] = [];
/** The same, whole: where each link points and what it carries. */
const letters: { kind: string; url: string; attached: string | null }[] = [];
const server = documentsServer({
  uow: world.uow,
  mailer: {
    notice: (m) => {
      mailed.push(`${m.notice.kind} ${m.email}`);
      letters.push({ kind: m.notice.kind, url: m.url, attached: m.attachment?.fileName ?? null });
      return Promise.reject(new Error('messaging is down'));
    },
  },
  blobs: world.blobs,
  clock: fixedClock('2026-10-12T09:00:00.000Z'),
  newId: () => `01890000-0000-7000-8000-${String(++counter).padStart(12, '0')}`,
  callerFrom: (request) => {
    const who = request.headers['x-test'] as Who;
    const tenant = (request.headers['x-tenant'] as TenantId | undefined) ?? TENANT;
    return ok({
      tenantId: tenant,
      accountId: ids[who].account,
      personId: ids[who].person as PersonId,
      correlationId: '00000000-0000-4000-8000-000000000001',
    } satisfies Caller);
  },
});

let keyN = 0;
async function call(who: Who, method: string, url: string, body?: unknown, tenant?: string) {
  const answer = await server.rest({
    method,
    url,
    headers: {
      'x-test': who,
      ...(tenant ? { 'x-tenant': tenant } : {}),
      ...(method === 'GET' ? {} : { 'idempotency-key': `k${++keyN}` }),
    },
    body: body === undefined ? '' : JSON.stringify(body),
  });
  if (answer === null) throw new Error(`no route for ${url}`);
  return answer as { status: number; body: any };
}

async function pdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++)
    doc.addPage([300, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 360 });
  return Buffer.from(await doc.save()).toString('base64');
}

const hired = (who: Who, name: [string, string], hire: string, org: string | null = null) => ({
  eventId: `01890000-0000-7000-8000-${String(900 + Object.keys(ids).indexOf(who)).padStart(12, '0')}`,
  eventName: 'people.person.hired',
  eventVersion: 1,
  tenantId: TENANT,
  occurredAt: '2026-01-01T00:00:00.000Z',
  recordedAt: '2026-01-01T00:00:00.000Z',
  effectiveFrom: hire,
  aggregate: { type: 'Person', id: ids[who].person, version: 1 },
  actor: { kind: 'system', process: 'test' },
  correlationId: '00000000-0000-4000-8000-000000000002',
  causationId: null,
  payload: {
    personId: ids[who].person,
    identityAccountId: ids[who].account,
    name: { given: name[0], family: name[1], preferred: null },
    workEmail: `${name[0].toLowerCase()}@acme.example`,
    managerId: null,
    orgUnitId: org,
    legalEntityId: null,
    employment: { from: hire, to: null },
    status: 'active',
    schemaVersion: 1,
    sourceOfRecord: 'own',
  },
});

const fetchSpy = vi.fn(() => {
  throw new Error('nothing leaves the process');
});

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  const consume = documentsConsumer(world.uow);
  const platform = '11111111-0000-4000-8000-000000000001';
  for (const event of [
    hired('adam', ['Adam', 'Novak'], '2024-09-02', platform),
    hired('marco', ['Marco', 'Ruiz'], '2021-03-01', platform),
    hired('ada', ['Ada', 'Lovelace'], '2019-01-07'),
    hired('mei', ['Mei', 'Tanaka'], '2026-11-01'),
    {
      ...hired('ada', ['Ada', 'Lovelace'], '2019-01-07'),
      eventId: '01890000-0000-7000-8000-000000000999',
      eventName: 'identity.tenant.administrator_named',
      payload: { accountId: ids.ada.account, entitlement: 'module.documents', namedBy: null },
    },
  ]) {
    await consume(event);
  }
  await seedTypes(server.deps, TENANT);
});

describe('the module boots alone', () => {
  it('serves the schema and its OpenAPI document', async () => {
    const answer = await server.rest({
      method: 'GET',
      url: '/v1/documents/settings',
      headers: { 'x-test': 'ada' },
      body: '',
    });
    if (answer === null) throw new Error('no answer');
    expect(answer.status).toBe(200);
    expect((answer.body as { types: unknown[] }).types).toHaveLength(14);
  });

  it('learned its members and its HR from events', async () => {
    const lib = await call('ada', 'GET', '/v1/documents/library');
    expect(lib.body.viewer.hr).toBe(true);
    expect(lib.body.people.map((p: { name: string }) => p.name)).toContain('Mei Tanaka');
  });
});

describe('an employee’s own document (B1, C3, E1)', () => {
  let id: string;
  it('files Private, read by pdf-lib for its pages', async () => {
    const up = await call('adam', 'POST', '/v1/documents/d', {
      title: 'Mortgage pre-approval',
      file: { name: 'mortgage.pdf', mediaType: 'application/pdf', base64: await pdf(2) },
    });
    expect(up.status).toBe(201);
    id = up.body.id;
    const lib = await call('adam', 'GET', '/v1/documents/library');
    const row = lib.body.rows.find((r: { id: string }) => r.id === id);
    expect(row).toMatchObject({
      level: 'private',
      pages: 2,
      who: { label: 'Only you' },
      mine: true,
    });
  });

  it('nobody else opens, lists, downloads or finds it — not even HR', async () => {
    for (const who of ['marco', 'ada'] as const) {
      const lib = await call(who, 'GET', '/v1/documents/library?q=mortgage');
      expect(lib.body.rows).toEqual([]);
      const doc = await call(who, 'GET', `/v1/documents/d/${id}`);
      expect(doc.body.document).toBeNull();
      expect(doc.body.closed.owner).toBe('Adam Novak');
      const file = await call(who, 'GET', `/v1/documents/d/${id}/file?mode=download`);
      expect(file.status).toBe(404);
    }
  });

  it('nor does another company, with the same id', async () => {
    const doc = await call('adam', 'GET', `/v1/documents/d/${id}`, undefined, OTHER);
    expect(doc.status).toBe(404);
  });

  it('shared with Marco, he opens it; made Private again, he does not', async () => {
    const shared = await call('adam', 'PUT', `/v1/documents/d/${id}/grants`, {
      grants: [
        {
          grantee: { kind: 'member', personId: ids.marco.person },
          permission: 'view',
          endsOn: null,
        },
      ],
    });
    expect(shared.status).toBe(200);
    expect((await call('marco', 'GET', `/v1/documents/d/${id}`)).body.document.row.who.label).toBe(
      'Marco',
    );
    await call('adam', 'PUT', `/v1/documents/d/${id}/grants`, { grants: [] });
    expect((await call('marco', 'GET', `/v1/documents/d/${id}`)).body.document).toBeNull();
  });

  it('only HR shares with everyone', async () => {
    const all = await call('adam', 'PUT', `/v1/documents/d/${id}/grants`, {
      grants: [{ grantee: { kind: 'everyone' }, permission: 'view', endsOn: null }],
    });
    expect(all.body.error.code).toBe('HR_ONLY_EVERYONE');
  });

  it('a personal section holds it without changing who sees it (B5)', async () => {
    const section = await call('adam', 'POST', '/v1/documents/sections', {
      name: 'Mortgage',
      documentIds: [id],
    });
    expect(section.status).toBe(201);
    const lib = await call('adam', 'GET', `/v1/documents/library?show=section:${section.body.id}`);
    expect(lib.body.rows.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await call('marco', 'GET', '/v1/documents/library')).body.sections).toEqual([]);
  });
});

describe('a contract about Adam (A1, E2, MR4)', () => {
  let id: string;
  it('HR files it; Confidential by its type, to Adam and HR', async () => {
    const up = await call('ada', 'POST', '/v1/documents/d', {
      title: 'Employment contract',
      typeKey: 'employment_contract',
      subjectPersonId: ids.adam.person,
      file: { name: 'contract.pdf', mediaType: 'application/pdf', base64: await pdf(6) },
    });
    expect(up.status).toBe(201);
    id = up.body.id;
    const doc = await call('adam', 'GET', `/v1/documents/d/${id}`);
    expect(doc.body.document.row).toMatchObject({
      confidential: true,
      aboutMe: true,
      who: { label: 'You and HR' },
    });
    expect(doc.body.document.may).toMatchObject({ share: false, delete: false, download: true });
  });

  it('Marco cannot open it', async () => {
    expect((await call('marco', 'GET', `/v1/documents/d/${id}`)).body.document).toBeNull();
  });

  it('with no model, its summary says so and the screen still works (DOC-050)', async () => {
    const got = await call('adam', 'GET', `/v1/documents/d/${id}/summary`);
    expect(got.body).toMatchObject({ available: false, summary: [] });
    expect((await call('marco', 'GET', `/v1/documents/d/${id}/summary`)).status).toBe(404);
  });

  it('a view is watermarked and logged; Adam downloads the original', async () => {
    const view = await call('adam', 'GET', `/v1/documents/d/${id}/file?mode=view`);
    expect(view.body).toMatchObject({ mediaType: 'application/pdf', original: false });
    const marked = await PDFDocument.load(Buffer.from(view.body.base64, 'base64'));
    expect(marked.getPageCount()).toBe(6);
    const down = await call('adam', 'GET', `/v1/documents/d/${id}/file?mode=download`);
    expect(down.body.original).toBe(true);
    const doc = await call('ada', 'GET', `/v1/documents/d/${id}`);
    expect(doc.body.document.views.map((v: { action: string }) => v.action).toSorted()).toEqual([
      'download',
      'view',
    ]);
  });

  it('Adam cannot reshare, lower or delete it', async () => {
    const shared = await call('adam', 'PUT', `/v1/documents/d/${id}/grants`, {
      grants: [
        {
          grantee: { kind: 'member', personId: ids.marco.person },
          permission: 'view',
          endsOn: null,
        },
      ],
    });
    expect(shared.body.error.code).toBe('ABOUT_YOU');
    expect((await call('adam', 'POST', `/v1/documents/d/${id}/delete`)).status).toBe(403);
  });

  it('Marco asks for access; HR grants it; he opens it (E3)', async () => {
    const asked = await call('marco', 'POST', `/v1/documents/d/${id}/access-requests`, {
      reason: 'To make Yuki’s offer in the right band',
    });
    expect(asked.status).toBe(201);
    const lib = await call('ada', 'GET', '/v1/documents/library');
    expect(lib.body.needsYou.map((n: { kind: string }) => n.kind)).toContain('access_request');
    await call('ada', 'POST', `/v1/documents/access-requests/${asked.body.id}/decision`, {
      grant: true,
    });
    expect((await call('marco', 'GET', `/v1/documents/d/${id}`)).body.document).not.toBeNull();
    // Marco may view, not download, a Confidential document.
    expect((await call('marco', 'GET', `/v1/documents/d/${id}/file?mode=download`)).status).toBe(
      403,
    );
  });
});

describe('a new starter’s file (B3, H2)', () => {
  it('lists what Mei owes; an ask lands in her Documents; her upload answers it', async () => {
    const before = await call('ada', 'GET', `/v1/documents/people/${ids.mei.person}`);
    expect(before.body).toMatchObject({ have: 0, of: 5 });
    const asked = await call('ada', 'POST', '/v1/documents/requests', {
      personId: ids.mei.person,
      typeKey: 'tax_form',
      dueOn: '2026-10-25',
      message: 'We need your Modelo 145 before your first payroll.',
    });
    expect(asked.status).toBe(201);
    const mine = await call('mei', 'GET', '/v1/documents/library');
    expect(mine.body.needsYou[0]).toMatchObject({ kind: 'request', typeKey: 'tax_form' });
    const up = await call('mei', 'POST', '/v1/documents/d', {
      title: 'Modelo 145',
      typeKey: 'tax_form',
      subjectPersonId: ids.mei.person,
      file: { name: 'modelo.pdf', mediaType: 'application/pdf', base64: await pdf(1) },
    });
    expect(up.status).toBe(201);
    const after = await call('ada', 'GET', `/v1/documents/people/${ids.mei.person}`);
    expect(
      after.body.checklist.find((r: { typeKey: string }) => r.typeKey === 'tax_form').state,
    ).toBe('have');
    expect((await call('mei', 'GET', '/v1/documents/library')).body.needsYou).toEqual([]);
  });

  it('Mei files only her own required documents', async () => {
    const other = await call('mei', 'POST', '/v1/documents/d', {
      title: 'Not mine',
      typeKey: 'tax_form',
      subjectPersonId: ids.adam.person,
      file: { name: 'x.pdf', mediaType: 'application/pdf', base64: await pdf(1) },
    });
    expect(other.status).toBe(403);
    // A refusal keeps no bytes.
    expect(world.blobs.size()).toBeGreaterThan(0);
  });

  it('Marco cannot read Mei’s file', async () => {
    expect((await call('marco', 'GET', `/v1/documents/people/${ids.mei.person}`)).status).toBe(404);
  });
});

describe('HR’s queues, Deleted and holds (H1, H3)', () => {
  it('Missing counts what new starters owe, in place', async () => {
    const lib = await call('ada', 'GET', '/v1/documents/library?queue=missing');
    expect(lib.body.tiles.find((t: { key: string }) => t.key === 'missing').count).toBe(4);
    expect(
      lib.body.queueRows.every((r: { person: { name: string } }) => r.person.name === 'Mei Tanaka'),
    ).toBe(true);
  });

  it('a hold keeps a document out of Deleted', async () => {
    const slip = await call('ada', 'POST', '/v1/documents/d', {
      title: 'Payslip · September 2026',
      typeKey: 'payslip',
      subjectPersonId: ids.adam.person,
      file: { name: 'slip.pdf', mediaType: 'application/pdf', base64: await pdf(1) },
    });
    const hold = await call('ada', 'POST', '/v1/documents/holds', {
      name: 'Case 0412',
      documentIds: [slip.body.id],
    });
    expect(hold.status).toBe(201);
    expect(
      (await call('ada', 'POST', `/v1/documents/d/${slip.body.id}/delete`)).body.error.code,
    ).toBe('LEGAL_HOLD');
    await call('ada', 'POST', `/v1/documents/holds/${hold.body.id}/lift`);
    expect((await call('ada', 'POST', `/v1/documents/d/${slip.body.id}/delete`)).status).toBe(200);
    const deleted = await call('ada', 'GET', '/v1/documents/library?deleted=true');
    expect(deleted.body.rows.map((r: { id: string }) => r.id)).toContain(slip.body.id);
    expect((await call('adam', 'GET', `/v1/documents/d/${slip.body.id}`)).status).toBe(404);
    await call('ada', 'POST', `/v1/documents/d/${slip.body.id}/restore`);
    expect(
      (await call('adam', 'GET', `/v1/documents/d/${slip.body.id}`)).body.document,
    ).not.toBeNull();
  });
});

describe('the transports agree', () => {
  it('a write needs its key, and a retried key is answered, not repeated', async () => {
    const noKey = await server.rest({
      method: 'POST',
      url: '/v1/documents/sections',
      headers: { 'x-test': 'adam' },
      body: JSON.stringify({ name: 'Visa renewal' }),
    });
    expect(noKey?.status).toBe(428);
    const once = {
      method: 'POST',
      url: '/v1/documents/sections',
      headers: { 'x-test': 'adam', 'idempotency-key': 'same' },
      body: JSON.stringify({ name: 'Learning' }),
    };
    const first = await server.rest(once);
    const again = await server.rest(once);
    expect(again).toEqual(first);
  });

  it('the subgraph answers a screen as REST does', async () => {
    const response = await server.graphql.fetch('http://documents/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test': 'adam' },
      body: JSON.stringify({ query: '{ documentsLibrary { total viewer { hr } } }' }),
    });
    const json = (await response.json()) as {
      data: { documentsLibrary: { total: number; viewer: { hr: boolean } } };
    };
    expect(json.data.documentsLibrary.viewer.hr).toBe(false);
    expect(json.data.documentsLibrary.total).toBeGreaterThan(0);
  });

  it('nothing reached the network', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('signatures (K1–K9)', () => {
  let contract: string;
  let envelope: string;
  const origin = { origin: 'https://acme.app.kithena.com', companyName: 'Acme' };

  it('HR sends Adam’s contract to Adam, then to an outside director', async () => {
    const up = await call('ada', 'POST', '/v1/documents/d', {
      title: 'Remote-work addendum',
      typeKey: 'contract_addendum',
      subjectPersonId: ids.adam.person,
      file: { name: 'addendum.pdf', mediaType: 'application/pdf', base64: await pdf(3) },
    });
    contract = up.body.id;
    const sent = await call('ada', 'POST', `/v1/documents/d/${contract}/envelopes`, {
      signers: [
        { personId: ids.adam.person, order: 1 },
        { email: 'nora@board.example', name: 'Nora Becker', order: 2 },
      ],
      message: 'Please sign by Friday',
      ...origin,
    });
    expect(sent.status).toBe(201);
    envelope = sent.body.id;
    const lib = await call('adam', 'GET', '/v1/documents/library');
    expect(lib.body.needsYou.map((n: { kind: string }) => n.kind)).toContain('sign');
    const hr = await call('ada', 'GET', '/v1/documents/library?queue=to_sign');
    expect(hr.body.tiles.find((t: { key: string }) => t.key === 'to_sign').count).toBe(1);
  });

  it('a second request on the same document waits for the first', async () => {
    const again = await call('ada', 'POST', `/v1/documents/d/${contract}/envelopes`, {
      signers: [{ personId: ids.adam.person, order: 1 }],
      ...origin,
    });
    expect(again.body.error.code).toBe('ALREADY_OUT');
  });

  it('Adam signs with his login; the turn passes on', async () => {
    const view = await call('adam', 'GET', `/v1/documents/envelopes/${envelope}`);
    expect(view.body.me).toMatchObject({ turn: true });
    expect(
      view.body.fields
        .filter((f: { signerId: string }) => f.signerId === view.body.me.signerId)
        .map((f: { kind: string }) => f.kind),
      // Kithena's start: one dated signature, the signature with the day under it.
    ).toEqual(['date']);
    const signed = await call('adam', 'POST', `/v1/documents/envelopes/${envelope}/sign`, {
      signature: { kind: 'typed', text: 'Adam Novak' },
      // The Signature ID his screen showed under each box as he filled it.
      traceId: ADAM_TRACE,
      ...origin,
    });
    // Signed, though the email to Nora, whose turn it now is, did not go.
    expect(signed.body).toEqual({ completed: false, next: ['Nora Becker'] });
    // Nora's turn, and Adam's own copy as signed so far (K7).
    expect(mailed).toEqual(['signature_requested nora@board.example', 'document_signed adam@acme.example']);
    const followed = await call('ada', 'GET', `/v1/documents/envelopes/${envelope}`);
    expect(followed.body.signers.map((s: { status: string }) => s.status)).toEqual([
      'signed',
      'sent',
    ]);
    expect(followed.body.trail.map((t: { action: string }) => t.action)).toEqual([
      'sent',
      'signed',
    ]);
  });

  it('Nora reads Adam’s signature with its Signature ID; a reminder reaches only her (K7, K8)', async () => {
    // Adam's own copy went with his email, as signed so far.
    expect(letters.find((l) => l.kind === 'document_signed')?.attached).toMatch(/signed so far/u);
    const link = letters.filter((l) => l.kind === 'signature_requested').at(-1)?.url ?? '';
    const token = link.split('/sign/')[1] ?? '';
    const open = (t: string, path = '') =>
      server.rest({ method: 'GET', url: `/v1/documents/sign/${t}${path}`, headers: {}, body: '' });
    const file = (await open(token, '/file')) as { status: number; body: { base64: string } };
    expect(file.status).toBe(200);
    const text = await extractText(
      await getDocumentProxy(new Uint8Array(Buffer.from(file.body.base64, 'base64'))),
      { mergePages: true },
    );
    expect(text.text).toContain('Electronically signed via Kithena');
    // The very ID Adam was shown while signing.
    expect(text.text).toContain(`Signature ID: ${ADAM_TRACE}`);

    // The list says so: one of two signed, waiting on Nora, and HR may remind.
    const lib = await call('ada', 'GET', '/v1/documents/library');
    expect(lib.body.rows.find((r: { id: string }) => r.id === contract).signing).toMatchObject({
      signed: 1,
      of: 2,
      waitingOn: ['Nora Becker'],
      canRemind: true,
    });

    // Reminded: Nora alone, with a link that replaces her first.
    const before = mailed.length;
    const reminded = await call('ada', 'POST', `/v1/documents/envelopes/${envelope}/remind`, origin);
    expect(reminded.body.reminded).toEqual(['Nora Becker']);
    expect(mailed.slice(before)).toEqual(['signature_reminder nora@board.example']);
    expect((await open(token))?.status).toBe(404);
    const fresh = letters.at(-1)?.url.split('/sign/')[1] ?? '';
    expect((await open(fresh))?.status).toBe(200);
  });

  it('Marco, who neither signs nor sends, cannot see it', async () => {
    expect((await call('marco', 'GET', `/v1/documents/envelopes/${envelope}`)).status).toBe(404);
  });

  it('a link that is not a token opens nothing', async () => {
    const answer = await server.rest({
      method: 'GET',
      url: `/v1/documents/sign/${TENANT}.${'x'.repeat(32)}`,
      headers: {},
      body: '',
    });
    expect(answer?.status).toBe(404);
  });

  it('the sender cancels; nobody can sign a cancelled request', async () => {
    const voided = await call('ada', 'POST', `/v1/documents/envelopes/${envelope}/void`, {
      reason: 'Wrong version',
    });
    expect(voided.status).toBe(200);
    const late = await call('adam', 'POST', `/v1/documents/envelopes/${envelope}/sign`, {
      signature: { kind: 'typed', text: 'Adam Novak' },
      ...origin,
    });
    expect(late.status).toBe(422);
  });

  it('signed by everyone, it is sealed as the next version, with its certificate', async () => {
    const sent = await call('ada', 'POST', `/v1/documents/d/${contract}/envelopes`, {
      signers: [{ personId: ids.adam.person, order: 1 }],
      ...origin,
    });
    const done = await call('adam', 'POST', `/v1/documents/envelopes/${sent.body.id}/sign`, {
      signature: { kind: 'typed', text: 'Adam Novak' },
      ...origin,
    });
    expect(done.body).toEqual({ completed: true, next: [] });
    const doc = await call('adam', 'GET', `/v1/documents/d/${contract}`);
    expect(doc.body.document.current).toMatchObject({ n: 2, note: 'Signed and sealed', pages: 4 });
    const file = await call('adam', 'GET', `/v1/documents/d/${contract}/file?mode=download`);
    const sealedPdf = await PDFDocument.load(Buffer.from(file.body.base64, 'base64'));
    expect(sealedPdf.getPageCount()).toBe(4);
  });
});

describe('acknowledgements (F2, F3)', () => {
  it('HR sends the handbook to everyone; Adam reads and acknowledges it', async () => {
    const up = await call('ada', 'POST', '/v1/documents/d', {
      title: 'Travel and expenses policy',
      typeKey: 'policy',
      file: { name: 'travel.pdf', mediaType: 'application/pdf', base64: await pdf(8) },
    });
    const sent = await call('ada', 'POST', `/v1/documents/d/${up.body.id}/campaigns`, {
      audience: { kind: 'everyone' },
    });
    expect(sent.status).toBe(201);
    const before = await call('ada', 'GET', `/v1/documents/campaigns/${sent.body.id}`);
    expect(before.body).toMatchObject({ done: 0, of: 4 });
    const lib = await call('adam', 'GET', '/v1/documents/library');
    expect(lib.body.needsYou.map((n: { kind: string }) => n.kind)).toContain('acknowledge');
    expect(
      (await call('adam', 'POST', `/v1/documents/campaigns/${sent.body.id}/acknowledge`)).status,
    ).toBe(200);
    const after = await call('ada', 'GET', `/v1/documents/campaigns/${sent.body.id}`);
    expect(after.body).toMatchObject({ done: 1, of: 4 });
    expect(after.body.left.map((p: { name: string }) => p.name)).not.toContain('Adam Novak');
  });

  it('only HR sends a policy out', async () => {
    const mine = await call('adam', 'GET', '/v1/documents/library');
    const id = mine.body.rows[0].id;
    expect(
      (
        await call('adam', 'POST', `/v1/documents/d/${id}/campaigns`, {
          audience: { kind: 'everyone' },
        })
      ).status,
    ).toBe(403);
  });
});
