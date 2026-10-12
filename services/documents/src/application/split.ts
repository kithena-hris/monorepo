import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { DocumentTypeKey, PersonId } from '@kithena/contracts';
import { PDFDocument } from 'pdf-lib';

import { checkParts, type PageRange } from '../domain/document/split.js';
import { RULES } from './ai.js';
import { contextOf, hrOnly } from './context.js';
import { upload, type UploadedFile } from './documents.js';
import type { Caller, Deps } from './ports.js';
import { forModel, pagesOf } from './text.js';

/**
 * A stack scanned as one PDF, split into its documents (C2): Kithena
 * proposes where each starts, what it is and whom it is about; HR corrects
 * it; each part is filed as a document of its own. HR only.
 */

export interface Part extends PageRange {
  readonly title: string;
  readonly typeKey: string | null;
  readonly subjectPersonId: string | null;
}

export async function proposeSplit(
  deps: Deps,
  caller: Caller,
  file: UploadedFile,
): Promise<Result<{ available: boolean; pages: number; parts: Part[] }>> {
  const setup = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    return ok({
      types: (await tx.types.list()).filter((t) => !t.archived && !t.medical && t.aiEnabled),
      people: (await tx.members.list()).filter((m) => m.status !== 'terminated'),
    });
  });
  if (!setup.ok) return setup;
  if (file.mediaType !== 'application/pdf') {
    return err(failure('NOT_A_PDF', 'A scan to split is one PDF', ['file']));
  }
  const pdf = await PDFDocument.load(file.bytes, { ignoreEncryption: true }).catch(() => null);
  if (pdf === null) return err(failure('NOT_A_PDF', 'This PDF could not be read', ['file']));
  const count = pdf.getPageCount();
  const whole: Part[] = [
    {
      from: 1,
      to: count,
      title: file.name.replace(/\.[^.]+$/u, ''),
      typeKey: null,
      subjectPersonId: null,
    },
  ];
  const pages =
    deps.reader === undefined
      ? null
      : await pagesOf(
          file.bytes,
          file.mediaType,
          `split:${file.name}:${String(file.bytes.length)}`,
        );
  if (deps.reader === undefined || pages === null)
    return ok({ available: false, pages: count, parts: whole });
  const answer = await deps.reader.read({
    instruction: `${RULES} These pages are several documents scanned together. Say where each document starts and ends, its type key from the list (or null), the person it is about from the list (or null), and a short name. Shape: {"parts":[{"from":number,"to":number,"typeKey":string|null,"personId":string|null,"title":string}]}, covering every page once, in order.`,
    context: {
      types: setup.value.types.map((t) => ({ key: t.key, name: t.name })),
      people: setup.value.people.map((p) => ({ personId: p.personId, name: p.displayName })),
      pages: forModel(pages, 600, 20_000),
    },
  });
  const types = new Set(setup.value.types.map((t) => t.key as string));
  const people = new Set(setup.value.people.map((p) => p.personId as string));
  const parts: Part[] = Array.isArray(answer?.['parts'])
    ? (answer['parts'] as unknown[]).map((raw) => {
        const o = raw as Record<string, unknown>;
        return {
          from: Number(o['from']),
          to: Number(o['to']),
          title: typeof o['title'] === 'string' ? o['title'].slice(0, 200) : 'Document',
          typeKey:
            typeof o['typeKey'] === 'string' && types.has(o['typeKey']) ? o['typeKey'] : null,
          subjectPersonId:
            typeof o['personId'] === 'string' && people.has(o['personId']) ? o['personId'] : null,
        };
      })
    : [];
  return checkParts(parts, count).ok
    ? ok({ available: true, pages: count, parts })
    : ok({ available: false, pages: count, parts: whole });
}

/** Each part filed as a document of its own, with the type's rules: the parts as HR left them. */
export async function fileSplit(
  deps: Deps,
  caller: Caller,
  file: UploadedFile,
  parts: readonly Part[],
): Promise<Result<{ ids: string[] }>> {
  const source = await PDFDocument.load(file.bytes, { ignoreEncryption: true }).catch(() => null);
  if (source === null) return err(failure('NOT_A_PDF', 'This PDF could not be read', ['file']));
  const fits = checkParts(parts, source.getPageCount());
  if (!fits.ok) return fits;
  const ids: string[] = [];
  for (const part of parts) {
    const out = await PDFDocument.create();
    const range = Array.from({ length: part.to - part.from + 1 }, (_, i) => part.from - 1 + i);
    for (const page of await out.copyPages(source, range)) out.addPage(page);
    const filed = await upload(deps, caller, {
      title: part.title,
      typeKey: part.typeKey as DocumentTypeKey | null,
      subjectPersonId: part.subjectPersonId as PersonId | null,
      sectionId: null,
      expiresOn: null,
      requestId: null,
      file: { name: `${part.title}.pdf`, mediaType: 'application/pdf', bytes: await out.save() },
    });
    // The parts filed before a refusal stay filed; the answer names how far it got.
    if (!filed.ok) {
      return err(
        failure(
          filed.error.code,
          `${filed.error.message} (${String(ids.length)} of ${String(parts.length)} filed)`,
          ['parts'],
        ),
      );
    }
    ids.push(filed.value.id);
  }
  return ok({ ids });
}
