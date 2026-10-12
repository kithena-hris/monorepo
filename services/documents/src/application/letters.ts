import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { DocumentId, DocumentTypeKey, PersonId } from '@kithena/contracts';
import { PDFDocument, rgb } from 'pdf-lib';

import { canOpen } from '../domain/access/access.js';
import { merge, placeholders } from '../domain/letter/letter.js';
import { contextOf, factsOf, hrOnly, load, notFound } from './context.js';
import { upload } from './documents.js';
import { facesFor } from './fonts.js';
import type { Caller, Deps } from './ports.js';
import { sendForSignature, type Origin } from './signatures.js';
import { pagesOf } from './text.js';

/**
 * Letters from a template (G3): a Template document's text, its `{{Field}}`
 * placeholders filled from each person's record (the host reads the record,
 * as the person asking, and sends the values), drawn as a PDF, filed to that
 * person as a Letter and, when asked, sent to them to sign. HR only.
 */

export async function readTemplate(
  deps: Deps,
  caller: Caller,
  templateId: DocumentId,
): Promise<Result<{ title: string; text: string; fields: string[] }>> {
  const found = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const loaded = await load(ctx, templateId);
    if (!loaded.ok) return loaded;
    const { doc, type } = loaded.value;
    if (!canOpen(factsOf(doc, type), ctx.viewer, ctx.today)) return err(notFound());
    if (doc.kind !== 'Template') {
      return err(
        failure('NOT_A_TEMPLATE', 'Letters come from a Template document', ['templateId']),
      );
    }
    const version = await tx.versions.get(doc.id, doc.currentVersion);
    return version === null ? err(notFound()) : ok({ doc, version });
  });
  if (!found.ok) return found;
  const { doc, version } = found.value;
  const bytes = await deps.blobs.get(version.blobKey);
  const pages =
    bytes === null ? null : await pagesOf(bytes, version.mediaType, version.checksum, deps.reader);
  if (pages === null)
    return err(failure('NO_TEXT', 'This template has no text to fill', ['templateId']));
  const text = pages.join('\n\n');
  return ok({ title: doc.title, text, fields: placeholders(text) });
}

/** A letter's text drawn on A4 pages, wrapped, in the faces sealing uses. */
async function draw(title: string, text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const { body, drawable } = await facesFor(pdf);
  const size = 11;
  const width = 595 - 2 * 64;
  let page = pdf.addPage([595, 842]);
  let y = 842 - 72;
  const next = (): void => {
    page = pdf.addPage([595, 842]);
    y = 842 - 72;
  };
  pdf.setTitle(title);
  for (const paragraph of drawable(text).split('\n')) {
    let line = '';
    const flush = (): void => {
      if (y < 72) next();
      page.drawText(line, { x: 64, y, size, font: body, color: rgb(0.1, 0.1, 0.15) });
      y -= size * 1.5;
      line = '';
    };
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const tried = line === '' ? word : `${line} ${word}`;
      if (body.widthOfTextAtSize(tried, size) > width && line !== '') {
        flush();
        line = word;
      } else line = tried;
    }
    if (line !== '') flush();
    else y -= size * 0.75;
  }
  return pdf.save();
}

export interface LetterInput {
  readonly personId: PersonId;
  readonly values: Readonly<Record<string, string>>;
}

export async function generateLetters(
  deps: Deps,
  caller: Caller,
  input: {
    readonly templateId: DocumentId;
    readonly title: string;
    readonly letters: readonly LetterInput[];
    readonly sign: boolean;
  } & Origin,
): Promise<Result<{ ids: string[] }>> {
  const template = await readTemplate(deps, caller, input.templateId);
  if (!template.ok) return template;
  const merged = input.letters.map((l) => ({ ...l, ...merge(template.value.text, l.values) }));
  const short = merged.find((m) => m.missing.length > 0);
  if (short !== undefined) {
    return err(
      failure('MISSING_VALUES', `A letter has no ${short.missing.join(', ')}`, ['letters']),
    );
  }
  const ids: string[] = [];
  for (const letter of merged) {
    const filed = await upload(deps, caller, {
      title: input.title,
      typeKey: 'letter' as DocumentTypeKey,
      subjectPersonId: letter.personId,
      sectionId: null,
      expiresOn: null,
      requestId: null,
      file: {
        name: `${input.title}.pdf`,
        mediaType: 'application/pdf',
        bytes: await draw(input.title, letter.text),
      },
    });
    if (!filed.ok) return filed;
    ids.push(filed.value.id);
    if (input.sign) {
      const sent = await sendForSignature(deps, caller, {
        documentId: filed.value.id,
        signers: [
          { personId: letter.personId, email: null, name: null, order: 1, allowDelegate: false },
        ],
        fields: [],
        message: '',
        dueOn: null,
        origin: input.origin,
        companyName: input.companyName,
      });
      if (!sent.ok) return sent;
    }
  }
  return ok({ ids });
}
