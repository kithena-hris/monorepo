import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { DocumentId, Instant } from '@kithena/contracts';

import { send, sign, markOpened, type Envelope } from '../domain/signature/envelope.js';
import { facesFor } from './fonts.js';
import { seal } from './sealing.js';

const at = '2026-10-09T10:00:00.000Z' as Instant;

function signedEnvelope(name: string, mark: Parameters<typeof sign>[2]['signature']): Envelope {
  const sent = send({
    id: 'env',
    documentId: 'd' as DocumentId,
    version: 1,
    pages: 2,
    senderAccount: 'acc',
    signers: [
      {
        id: 's1',
        order: 1,
        personId: 'p' as never,
        email: null,
        name,
        check: 'login',
        allowDelegate: false,
        tokenHash: 'h',
      },
    ],
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
    const env = signedEnvelope('Adam Novak', {
      kind: 'drawn',
      path: 'M 10 60 L 120 40 L 300 80',
    });
    const out = await PDFDocument.load(await seal(await twoPages(), env, [], 'Acme'));
    expect(out.getPageCount()).toBe(3);
  });

  it('draws a name outside Latin-1 as written, and one no face has without stopping', async () => {
    const polish = signedEnvelope('Łukasz Ołów', { kind: 'typed', text: 'Łukasz Ołów' });
    const sealed = await seal(await twoPages(), polish, [], 'Acme');
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(3);
    // The faces draw it as written; only what no face has becomes "?".
    const { drawable } = await facesFor(await PDFDocument.create());
    expect(drawable('Łukasz Ольга Nguyễn')).toBe('Łukasz Ольга Nguyễn');
    expect(drawable('佐藤')).toBe('??');
    const japanese = signedEnvelope('佐藤 由紀', { kind: 'typed', text: '佐藤 由紀' });
    const out = await PDFDocument.load(await seal(await twoPages(), japanese, [], 'Acme'));
    expect(out.getPageCount()).toBe(3);
  });

  it('writes a typed signature in the handwriting face its signer chose', async () => {
    const faces = async (env: Envelope) => {
      const pdf = await PDFDocument.load(await seal(await twoPages(), env, [], 'Acme'));
      return pdf.context
        .enumerateIndirectObjects()
        .flatMap(([, o]) => (o instanceof PDFDict ? [o.get(PDFName.of('BaseFont'))] : []))
        .filter((f) => f !== undefined)
        .map(String)
        .join(' ');
    };
    const bold = signedEnvelope('Ada Lovelace', {
      kind: 'typed',
      text: 'Ada Lovelace',
      style: 'bold',
    });
    expect(await faces(bold)).toMatch(/MrDafoe/u);
    expect(await faces(bold)).not.toMatch(/GreatVibes/u);
    // A typed one from before styles is drawn in the flowing face.
    const old = signedEnvelope('Ada Lovelace', { kind: 'typed', text: 'Ada Lovelace' });
    expect(await faces(old)).toMatch(/GreatVibes/u);
  });
});
