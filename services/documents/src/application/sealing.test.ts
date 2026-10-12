import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { DocumentId, Instant } from '@kithena/contracts';

import { send, sign, markOpened, type Envelope } from '../domain/signature/envelope.js';
import { seal } from './sealing.js';

const at = '2026-10-09T10:00:00.000Z' as Instant;

async function signedEnvelope(name: string, mark: Parameters<typeof sign>[2]['signature']): Promise<Envelope> {
  const sent = send({
    id: 'env',
    documentId: 'd' as DocumentId,
    version: 1,
    pages: 2,
    senderAccount: 'acc',
    signers: [{ id: 's1', order: 1, personId: 'p' as never, email: null, name, check: 'login', allowDelegate: false, tokenHash: 'h' }],
    fields: [],
    message: '',
    dueOn: null,
    at,
  });
  if (!sent.ok) throw new Error(sent.error.message);
  const opened = markOpened(sent.value, 's1', at);
  if (!opened.ok) throw new Error(opened.error.message);
  const done = sign(opened.value, 's1', { signature: mark, values: {} }, at);
  if (!done.ok) throw new Error(done.error.message);
  return done.value;
}

async function twoPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  return doc.save();
}

describe('sealing (K9)', () => {
  it('draws a drawn signature and appends the certificate', async () => {
    const env = await signedEnvelope('Adam Novak', { kind: 'drawn', path: 'M 10 60 L 120 40 L 300 80' });
    const out = await PDFDocument.load(await seal(await twoPages(), env, [], 'Acme'));
    expect(out.getPageCount()).toBe(3);
  });

  it('a name the standard fonts cannot draw does not stop the seal', async () => {
    const env = await signedEnvelope('佐藤 由紀', { kind: 'typed', text: '佐藤 由紀' });
    const out = await PDFDocument.load(await seal(await twoPages(), env, [], 'Acme'));
    expect(out.getPageCount()).toBe(3);
  });
});
