import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { createWorker } from 'tesseract.js';
import { extractText, getDocumentProxy } from 'unpdf';

import { nifIn, offerFacts } from '../../../../lib/mobile/read';
import { personFor } from '../../../../lib/session';
import { serverWords } from '../../../../lib/server-words';

/**
 * Reading for the phone app instead of typing (Kithena Mobile v3): a photo of
 * an ID card becomes the identifier on it (P15), an offer letter becomes the
 * new starter's name, email, start date and manager (P19).
 *
 * Read here, on the company's own host, as the person signed in, and kept
 * nowhere: the bytes live for the length of the request, only the facts go
 * back, and no model sees either. What the person does with them is an
 * ordinary write People checks as it would a typed value.
 */
const NO_STORE = { 'cache-control': 'no-store' };
/** A Vercel function takes 4.5 MB; base64 is a third bigger than the file. */
const MOST = 3_200_000;

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const t = await serverWords();
  const tenantId = (await headers()).get('x-tenant-id');
  const bearer = request.headers.get('authorization') ?? '';
  const sessionId = /^Bearer \S+$/.test(bearer) ? bearer.slice('Bearer '.length) : null;
  if (tenantId === null || tenantId === '' || sessionId === null) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if ((await personFor(sessionId, tenantId)) === null) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const read = (key: string): unknown =>
    body !== null && typeof body === 'object' ? Reflect.get(body, key) : undefined;
  const kind = read('kind');
  const data = read('data');
  if ((kind !== 'id-card' && kind !== 'offer') || typeof data !== 'string' || data.length > MOST) {
    return NextResponse.json(
      {
        ok: false,
        code: 'BAD_REQUEST',
        message: t(
          'app.api.mobile.read.route.send_a_photo_or_a_pdf_of',
          'Send a photo or a PDF of up to 2 MB.',
        ),
      },
      { status: 400, headers: NO_STORE },
    );
  }
  const bytes = Buffer.from(data, 'base64');

  if (kind === 'id-card') {
    const worker = await createWorker('eng', undefined, { cachePath: join(tmpdir(), 'tesseract') });
    try {
      const { data: seen } = await worker.recognize(bytes);
      return NextResponse.json(
        { ok: true, data: { value: nifIn(seen.text) } },
        { headers: NO_STORE },
      );
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: 'UNREADABLE',
          message: t(
            'app.api.mobile.read.route.that_photo_could_not_be_read_try',
            'That photo could not be read. Try again in better light.',
          ),
        },
        { headers: NO_STORE },
      );
    } finally {
      await worker.terminate();
    }
  }

  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return NextResponse.json({ ok: true, data: offerFacts(text) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: 'UNREADABLE',
        message: t(
          'app.api.mobile.read.route.that_file_is_not_a_pdf_with',
          'That file is not a PDF with text in it.',
        ),
      },
      { headers: NO_STORE },
    );
  }
}
