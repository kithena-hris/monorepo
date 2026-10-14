/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/restrict-template-expressions --
   A test reads the JSON a transport answered by its path, and every path it reads is asserted. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { fixedClock, ok } from '@kithena/domain-kit';
import type { DocumentId, PersonId, TenantId } from '@kithena/contracts';

import { seedTypes } from '../application/organise.js';
import type { Caller, Reader } from '../application/ports.js';
import { documentsServer } from '../http/server.js';
import { documentsConsumer } from '../infrastructure/consumers/handle.js';
import { memoryWorld } from '../testing/memory.js';

/**
 * Kithena reading documents (DOC-050 to DOC-056), alone and with a model
 * stubbed in process: what reaches the model, and what comes back of it. The
 * acceptance suite covers the same routes with no model at all.
 */

const TENANT = '00000000-0000-4000-8000-0000000000ac' as TenantId;
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
};
type Who = keyof typeof ids;

const seen: Readonly<Record<string, unknown>>[] = [];
let reply: Record<string, unknown> | null = null;
const looked: string[] = [];
const reader: Reader = {
  read: ({ context }) => {
    seen.push(context);
    return Promise.resolve(reply);
  },
  see: ({ image }) => {
    looked.push(image.mediaType);
    return Promise.resolve('Residence permit. Valid until 2027-03-01.');
  },
};

const world = memoryWorld();
let counter = 0;
const server = documentsServer({
  uow: world.uow,
  blobs: world.blobs,
  reader,
  assistantCallerFrom: (request) => {
    const who = request.headers['x-test'] as Who;
    return ok({
      tenantId: TENANT,
      accountId: ids[who].account,
      personId: ids[who].person as PersonId,
      correlationId: '00000000-0000-4000-8000-000000000001',
    } satisfies Caller);
  },
  clock: fixedClock('2026-10-12T09:00:00.000Z'),
  newId: () => `01890000-0000-7000-8000-${String(++counter).padStart(12, '0')}`,
  callerFrom: (request) => {
    const who = request.headers['x-test'] as Who;
    return ok({
      tenantId: TENANT,
      accountId: ids[who].account,
      personId: ids[who].person as PersonId,
      correlationId: '00000000-0000-4000-8000-000000000001',
    } satisfies Caller);
  },
});

let keyN = 0;
async function call(who: Who, method: string, url: string, body?: unknown) {
  const answer = await server.rest({
    method,
    url,
    headers: { 'x-test': who, ...(method === 'GET' ? {} : { 'idempotency-key': `k${++keyN}` }) },
    body: body === undefined ? '' : JSON.stringify(body),
  });
  if (answer === null) throw new Error(`no route for ${url}`);
  return answer as { status: number; body: any };
}

async function pdf(...pages: string[]): Promise<string> {
  const doc = await PDFDocument.create();
  for (const text of pages) doc.addPage([400, 400]).drawText(text, { x: 20, y: 360, size: 10 });
  return Buffer.from(await doc.save()).toString('base64');
}

const file = async (title: string, who: Who, extra: object, ...pages: string[]) =>
  (
    await call(who, 'POST', '/v1/documents/d', {
      title,
      ...extra,
      file: { name: `${title}.pdf`, mediaType: 'application/pdf', base64: await pdf(...pages) },
    })
  ).body.id as string;

const hired = (who: Who, given: string, n: number) => ({
  eventId: `01890000-0000-7000-8000-${String(900 + n).padStart(12, '0')}`,
  eventName: 'people.person.hired',
  eventVersion: 1,
  tenantId: TENANT,
  occurredAt: '2026-01-01T00:00:00.000Z',
  recordedAt: '2026-01-01T00:00:00.000Z',
  effectiveFrom: '2024-01-01',
  aggregate: { type: 'Person', id: ids[who].person, version: 1 },
  actor: { kind: 'system', process: 'test' },
  correlationId: '00000000-0000-4000-8000-000000000002',
  causationId: null,
  payload: {
    personId: ids[who].person,
    identityAccountId: ids[who].account,
    name: { given, family: 'Test', preferred: null },
    workEmail: `${given.toLowerCase()}@acme.example`,
    managerId: null,
    orgUnitId: null,
    legalEntityId: null,
    employment: { from: '2024-01-01', to: null },
    status: 'active',
    schemaVersion: 1,
    sourceOfRecord: 'own',
  },
});

let contract: string;
let mortgage: string;
let sickNote: string;

beforeAll(async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('nothing leaves the process');
  });
  const consume = documentsConsumer(world.uow);
  await consume(hired('adam', 'Adam', 1));
  await consume(hired('marco', 'Marco', 2));
  await consume(hired('ada', 'Ada', 3));
  await consume({
    ...hired('ada', 'Ada', 4),
    eventName: 'identity.tenant.administrator_named',
    payload: { accountId: ids.ada.account, entitlement: 'module.documents', namedBy: null },
  });
  await seedTypes(server.deps, TENANT);
  contract = await file(
    'Employment contract',
    'ada',
    { typeKey: 'employment_contract', subjectPersonId: ids.adam.person },
    'Salary is 52000 a year.',
    'Notice period is three months.',
  );
  mortgage = await file('Mortgage', 'adam', {}, 'The mortgage offer expires soon.');
  sickNote = await file(
    'Sick note',
    'ada',
    { typeKey: 'sick_note', subjectPersonId: ids.adam.person },
    'Unfit for work from 14/10/2026 to 2026-10-21 with a diagnosis.',
  );
});

describe('a summary (D1)', () => {
  it('keeps only claims cited to pages the document has', async () => {
    reply = {
      summary: [
        { text: 'A permanent contract.', pages: [1] },
        { text: 'An invented clause.', pages: [9] },
      ],
      facts: [
        { label: 'Notice', value: 'Three months', page: 2 },
        { label: 'Bonus', value: 'Huge', page: 40 },
      ],
      watch: { text: 'Notice is long.', pages: [2] },
      questions: ['What is the notice period?'],
    };
    const got = await call('adam', 'GET', `/v1/documents/d/${contract}/summary`);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      available: true,
      summary: [{ text: 'A permanent contract.', pages: [1] }],
      facts: [{ label: 'Notice', page: 2 }],
      watch: { pages: [2] },
    });
    expect(JSON.stringify(seen.at(-1))).toContain('Notice period is three months.');
  });

  it('is not written for somebody who cannot open the document', async () => {
    const before = seen.length;
    expect((await call('marco', 'GET', `/v1/documents/d/${mortgage}/summary`)).status).toBe(404);
    expect(seen.length).toBe(before);
  });

  it('a medical document is read for its dates by code, and never sent', async () => {
    const before = seen.length;
    const got = await call('ada', 'GET', `/v1/documents/d/${sickNote}/summary`);
    expect(got.body).toMatchObject({ available: false, dates: ['2026-10-14', '2026-10-21'] });
    expect(seen.length).toBe(before);
  });

  it('says it is not available when the model fails', async () => {
    reply = null;
    const got = await call('adam', 'GET', `/v1/documents/d/${contract}/summary`);
    expect(got.body).toMatchObject({ available: false, summary: [] });
  });
});

describe('asking (D2, B4)', () => {
  it('across documents, the model sees only what the asker may open', async () => {
    reply = { answer: [{ text: 'It expires soon.', sources: [1] }] };
    await call('marco', 'POST', '/v1/documents/ask', {
      question: 'When does the mortgage offer expire?',
    });
    expect(JSON.stringify(seen.at(-1))).not.toContain('mortgage offer');
    const mine = await call('adam', 'POST', '/v1/documents/ask', {
      question: 'When does the mortgage offer expire?',
    });
    expect(JSON.stringify(seen.at(-1))).toContain('mortgage offer');
    expect(mine.body).toMatchObject({
      available: true,
      sources: [{ documentId: mortgage, pages: [1] }],
    });
  });

  it('a medical document never reaches the model, even for HR', async () => {
    reply = { answer: [] };
    await call('ada', 'POST', '/v1/documents/ask', { question: 'Who is unfit for work?' });
    expect(JSON.stringify(seen)).not.toContain('diagnosis');
  });
});

describe('the company’s switches (S7)', () => {
  it('only HR changes them, and off means not available', async () => {
    expect(
      (await call('adam', 'PUT', '/v1/documents/settings/ai', { summaries: false })).status,
    ).toBe(403);
    expect(
      (await call('ada', 'PUT', '/v1/documents/settings/ai', { summaries: false })).status,
    ).toBe(200);
    expect((await call('ada', 'GET', '/v1/documents/settings')).body.ai).toMatchObject({
      summaries: false,
      questions: true,
    });
    const before = seen.length;
    const got = await call('adam', 'GET', `/v1/documents/d/${contract}/summary`);
    expect(got.body).toMatchObject({
      available: false,
      reason: 'Your company has switched this off.',
    });
    expect(seen.length).toBe(before);
  });
});

describe('reading fields for a host (G5)', () => {
  it('reads the names asked, keeping only those asked and pages that exist', async () => {
    reply = {
      fields: [
        { name: 'Notice period', value: 'Three months', page: 2 },
        { name: 'Salary', value: '52000', page: 9 },
        { name: 'Shoe size', value: '44', page: 1 },
      ],
    };
    const got = await call('ada', 'POST', `/v1/documents/d/${contract}/fields`, {
      names: ['Notice period', 'Salary'],
    });
    expect(got.body).toEqual({
      available: true,
      fields: [{ name: 'Notice period', value: 'Three months', page: 2 }],
    });
    expect(JSON.stringify(seen.at(-1))).toContain('Notice period');
  });
});

describe('a phone’s photo (MD3, OCR)', () => {
  const photo = async (title: string, who: 'ada' | 'adam', extra: object) =>
    (
      await call(who, 'POST', '/v1/documents/d', {
        title,
        ...extra,
        file: {
          name: `${title}.jpg`,
          mediaType: 'image/jpeg',
          base64: Buffer.from('jpeg').toString('base64'),
        },
      })
    ).body.id as string;

  it('is never sent until the company switches photos on (PRD §14.1)', async () => {
    await call('ada', 'PUT', '/v1/documents/settings/ai', { summaries: true });
    const before = looked.length;
    const id = await photo('Passport photo', 'adam', {});
    const got = await call('adam', 'GET', `/v1/documents/d/${id}/summary`);
    expect(got.body).toMatchObject({
      available: false,
      reason: 'Your company keeps photos and scans away from AI.',
    });
    expect(looked.length).toBe(before);
  });

  it('is read by a model that sees, then summarised like any page', async () => {
    await call('ada', 'PUT', '/v1/documents/settings/ai', { summaries: true, photos: true });
    const id = await photo('Permit photo', 'adam', {});
    reply = {
      summary: [{ text: 'A residence permit.', pages: [1] }],
      facts: [],
      watch: null,
      questions: [],
    };
    const got = await call('adam', 'GET', `/v1/documents/d/${id}/summary`);
    expect(got.body).toMatchObject({ available: true, summary: [{ text: 'A residence permit.' }] });
    expect(looked).toContain('image/jpeg');
    expect(JSON.stringify(seen.at(-1))).toContain('Valid until 2027-03-01');
  });

  it('a medical photo is never sent to be read', async () => {
    const before = looked.length;
    const id = await photo('Note photo', 'ada', {
      typeKey: 'sick_note',
      subjectPersonId: ids.adam.person,
    });
    const got = await call('ada', 'GET', `/v1/documents/d/${id}/summary`);
    expect(got.body).toMatchObject({ available: false });
    expect(looked.length).toBe(before);
  });
});

describe('splitting a scanned stack (C2)', () => {
  it('Kithena proposes the parts; HR files each as its own document', async () => {
    const base64 = await pdf('Employment contract for Adam', 'Page two', 'Bank details form');
    reply = {
      parts: [
        {
          from: 1,
          to: 2,
          typeKey: 'employment_contract',
          personId: ids.adam.person,
          title: 'Contract',
        },
        {
          from: 3,
          to: 3,
          typeKey: 'bank_details',
          personId: ids.adam.person,
          title: 'Bank details',
        },
      ],
    };
    const file = { name: 'stack.pdf', mediaType: 'application/pdf', base64 };
    const proposed = await call('ada', 'POST', '/v1/documents/split', { file });
    expect(proposed.body).toMatchObject({
      available: true,
      pages: 3,
      parts: [
        { from: 1, to: 2 },
        { from: 3, to: 3 },
      ],
    });
    expect((await call('adam', 'POST', '/v1/documents/split', { file })).status).toBe(403);
    const filed = await call('ada', 'POST', '/v1/documents/split/file', {
      file,
      parts: proposed.body.parts,
    });
    expect(filed.status).toBe(201);
    expect(filed.body.ids).toHaveLength(2);
    const contract = await call('adam', 'GET', `/v1/documents/d/${filed.body.ids[0]}`);
    expect(contract.body.document.row).toMatchObject({
      title: 'Contract',
      pages: 2,
      aboutMe: true,
    });
  });

  it('refuses parts that leave a page out', async () => {
    const file = { name: 'stack.pdf', mediaType: 'application/pdf', base64: await pdf('a', 'b') };
    const filed = await call('ada', 'POST', '/v1/documents/split/file', {
      file,
      parts: [{ from: 1, to: 1, title: 'A', typeKey: null, subjectPersonId: null }],
    });
    expect(filed.status).toBe(422);
  });
});

describe('letters from a template (G3)', () => {
  it('HR fills a template for a person, files it to them and sends it to sign', async () => {
    const template = await file(
      'Promotion letter',
      'ada',
      { typeKey: 'template' },
      'Dear {{Preferred name}}, from {{Start date}} you are {{Job title}}.',
    );
    const read = await call('ada', 'GET', `/v1/documents/d/${template}/template`);
    expect(read.body.fields).toEqual(['Preferred name', 'Start date', 'Job title']);
    expect((await call('adam', 'GET', `/v1/documents/d/${template}/template`)).status).toBe(403);
    const origin = { origin: 'https://acme.app.kithena.com', companyName: 'Acme' };
    const short = await call('ada', 'POST', `/v1/documents/d/${template}/letters`, {
      title: 'Promotion',
      letters: [{ personId: ids.adam.person, values: { 'Preferred name': 'Adam' } }],
      ...origin,
    });
    expect(short.status).toBe(422);
    const made = await call('ada', 'POST', `/v1/documents/d/${template}/letters`, {
      title: 'Promotion',
      letters: [
        {
          personId: ids.adam.person,
          values: {
            'Preferred name': 'Adam',
            'Start date': '1 November 2026',
            'Job title': 'Senior engineer',
          },
        },
      ],
      sign: true,
      ...origin,
    });
    expect(made.status).toBe(201);
    const letter = await call('adam', 'GET', `/v1/documents/d/${made.body.ids[0]}`);
    expect(letter.body.document.row).toMatchObject({
      title: 'Promotion',
      kind: 'Letter',
      aboutMe: true,
    });
    expect(letter.body.document.signing).toMatchObject({ status: 'sent', mine: true });
  });
});

describe('a document drafted with Kithena (§14.2)', () => {
  const origin = { origin: 'https://acme.app.kithena.com', companyName: 'Acme' };
  const said = [{ role: 'user', text: 'An offer for Adam at 60,000 a year. Marco signs, then me.' }];

  it('asks, then drafts: signers found in order, figures nobody gave pointed out', async () => {
    reply = { reply: 'From when does it start?', draft: null };
    const asked = await call('ada', 'POST', '/v1/documents/drafts/turn', {
      messages: said,
      draft: null,
      companyName: 'Acme',
    });
    expect(asked.body).toEqual({
      available: true,
      reply: 'From when does it start?',
      action: null,
      draft: null,
    });
    // The model is shown stand-ins, never a name (PRD §14.1).
    expect(seen.at(-1)).toMatchObject({
      you: '[[Person 3]]',
      messages: [{ role: 'user', text: 'An offer for [[Person 1]] at 60,000 a year. [[Person 2]] signs, then me.' }],
    });
    expect(JSON.stringify(seen.at(-1))).not.toMatch(/Ada|Adam|Marco/u);

    // Somebody outside the company, found on this server, never reaches the model either.
    await call('ada', 'POST', '/v1/documents/drafts/turn', {
      messages: [{ role: 'user', text: 'An NDA with Grace Hopper of Navy Labs, grace@navy.example.' }],
      draft: null,
      companyName: 'Acme',
    });
    expect(JSON.stringify(seen.at(-1))).not.toMatch(/Grace|Hopper|navy\.example/u);

    reply = {
      reply: 'Here is the offer.',
      draft: {
        title: 'Offer letter',
        typeKey: 'employment_contract',
        about: 'Adam',
        body: 'Dear Adam,\n\nYour salary is 60000 a year, with a 10% bonus.',
        signers: [
          { name: 'Marco Test', email: null, order: 1 },
          { name: 'Ada Test', email: null, order: 2 },
          { name: 'Grace Hopper', email: null, order: 3 },
        ],
      },
    };
    const turn = await call('ada', 'POST', '/v1/documents/drafts/turn', {
      messages: said,
      draft: null,
      companyName: 'Acme',
    });
    expect(turn.body.draft).toMatchObject({
      aboutPersonId: ids.adam.person,
      figures: ['10'],
      ready: false,
      signers: [
        { name: 'Marco Test', personId: ids.marco.person },
        { name: 'Ada Test', personId: ids.ada.person },
        { name: 'Grace Hopper', personId: null, email: null },
      ],
    });
    expect(turn.body.reply).toMatch(/can’t find Grace Hopper/);

    // "Send it" while Grace is unknown: not sent, and said why.
    reply = { ...reply, action: 'send' };
    const early = await call('ada', 'POST', '/v1/documents/drafts/turn', {
      messages: [...said, { role: 'user', text: 'Send it' }],
      draft: null,
      companyName: 'Acme',
    });
    expect(early.body.action).toBeNull();
    expect(early.body.reply).toMatch(/^It is not ready yet\. I can’t find Grace Hopper/);

    // Once everybody is known, the words are the button.
    const draft = (reply as { draft: { signers: unknown[] } }).draft;
    reply = { ...reply, draft: { ...draft, signers: draft.signers.slice(0, 2) } };
    const sent = await call('ada', 'POST', '/v1/documents/drafts/turn', {
      messages: [...said, { role: 'user', text: 'Send it' }],
      draft: null,
      companyName: 'Acme',
    });
    expect(sent.body).toMatchObject({ action: 'send', draft: { ready: true } });

    // What the model answers with stand-ins comes back as the people they stand for.
    reply = {
      reply: 'Drafted for [[Person 1]].',
      draft: { ...(reply['draft'] as object), about: '[[Person 1]]', signers: [{ name: '[[Person 2]]', email: null, order: 1 }] },
    };
    const back = await call('ada', 'POST', '/v1/documents/drafts/turn', {
      messages: said,
      draft: null,
      companyName: 'Acme',
    });
    expect(back.body).toMatchObject({
      reply: 'Drafted for Adam.',
      draft: { aboutPersonId: ids.adam.person, signers: [{ name: 'Marco Test', personId: ids.marco.person }] },
    });
    expect((await call('adam', 'POST', '/v1/documents/drafts/turn', { messages: said, draft: null, companyName: 'Acme' })).status).toBe(403);
  });

  it('is filed and sent with each signer’s box on their own line, in order', async () => {
    const made = await call('ada', 'POST', '/v1/documents/drafts', {
      title: 'Offer letter',
      typeKey: 'employment_contract',
      aboutPersonId: ids.adam.person,
      body: 'Dear Adam,\n\nYour salary is 60000 a year.',
      signers: [
        { name: 'Marco Test', personId: ids.marco.person, email: null, order: 1 },
        { name: 'Grace Hopper', personId: null, email: 'grace@outside.example', order: 2 },
      ],
      send: true,
      ...origin,
    });
    expect(made.status).toBe(201);
    const documentId = made.body.id as DocumentId;
    const [envelope] = await world.uow.run(TENANT, (tx) => tx.envelopes.forDocument(documentId));
    expect(envelope?.id).toBe(made.body.envelopeId);
    const [marco, grace] = envelope?.fields ?? [];
    expect([marco?.signerId, grace?.signerId]).toEqual(['s1', 's2']);
    // Marco's line comes first on the page, Grace's under it: not the default foot of the page.
    expect(marco?.y).toBeLessThan(grace?.y ?? 0);
    expect(marco?.y).toBeLessThan(0.7);
  });
});

describe('what a model answers is never stored (PRD §14.1)', () => {
  it('asks the model again on a retry, rather than replaying a kept answer', async () => {
    reply = { answer: [{ text: 'Three months.', pages: [2] }] };
    const ask = () =>
      server.rest({
        method: 'POST',
        url: `/v1/documents/d/${contract}/ask`,
        headers: { 'x-test': 'ada', 'idempotency-key': 'same-key' },
        body: JSON.stringify({ question: 'What is the notice period?' }),
      });
    const before = seen.length;
    expect((await ask())?.status).toBe(200);
    expect((await ask())?.status).toBe(200);
    expect(seen.length).toBe(before + 2);
    const kept = await world.uow.run(TENANT, (tx) => tx.idempotency.find('same-key'));
    expect(kept).toBeNull();
  });
});

describe('the assistant’s door (DOC-052)', () => {
  const door = (who: 'ada' | 'adam' | 'marco', method: string, url: string, body = '') =>
    server.capabilities({ method, url, headers: { 'x-test': who }, body });

  it('offers what waits and what expires, and answers each as the asker', async () => {
    const catalogue = await door('adam', 'GET', '/internal/capabilities');
    expect(catalogue?.body).toMatchObject({
      module: 'documents',
      serves: [{ name: 'documents.waiting' }, { name: 'documents.expiring' }],
    });
    const waits = await door('adam', 'POST', '/internal/capabilities/documents.waiting', '{"limit":25}');
    expect(waits?.body).toMatchObject({ kind: 'items' });
    // The promotion letter sent to Adam to sign waits for him.
    expect(JSON.stringify(waits?.body)).toContain('Promotion');
    const marco = await door('marco', 'POST', '/internal/capabilities/documents.waiting', '{"limit":25}');
    expect(JSON.stringify(marco?.body)).not.toContain('Promotion');
    expect((await door('adam', 'POST', '/internal/capabilities/nothing', '{}'))?.status).toBe(404);
  });
});
