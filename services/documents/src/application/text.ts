import { extractText, getDocumentProxy } from 'unpdf';
import type { TenantId } from '@kithena/contracts';

import { pseudonymise, STAND_INS } from '../domain/assist/private.js';
import type { Reader, UnitOfWork } from './ports.js';

/**
 * A file's text, page by page, for Kithena to read (PRD §14): a PDF's by
 * code, an image's (a phone's scan or photo) as a model that sees transcribes
 * it, one page. Remembered per file, by checksum, for the process.
 *
 * ponytail: a hundred files in memory; keep extracted text in Postgres
 * against the version when the same documents are asked about all day.
 */
const kept = new Map<string, readonly string[]>();

/** What a model that sees is sent at most: the providers' own limit for an inline image. */
const MAX_IMAGE = 4 * 1024 * 1024;
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function pagesOf(
  bytes: Uint8Array,
  mediaType: string,
  checksum: string,
  /** The model that sees, for a photo, and whose photo it is. */
  reading?: { readonly reader: Reader | undefined; readonly tenantId: TenantId },
): Promise<readonly string[] | null> {
  const known = kept.get(checksum);
  if (known !== undefined) return known;
  if (IMAGES.has(mediaType)) {
    const reader = reading?.reader;
    if (reader?.see === undefined || reading === undefined || bytes.length > MAX_IMAGE) return null;
    const text = await reader.see({
      tenantId: reading.tenantId,
      instruction:
        'Transcribe every word in this image exactly as written, line by line, keeping numbers and dates as they appear. Reply with the text only.',
      image: { mediaType, bytes },
    });
    if (text === null) return null;
    remember(checksum, [text.trim()]);
    return [text.trim()];
  }
  // A sheet exported as CSV, read as text: fifty rows a page, its header on each.
  if (mediaType === 'text/csv') {
    const [header = '', ...rows] = new TextDecoder().decode(bytes).split(/\r?\n/u).filter(Boolean);
    const pages: string[] = [];
    for (let i = 0; i < Math.max(rows.length, 1); i += 50) {
      pages.push([header, ...rows.slice(i, i + 50)].join('\n'));
    }
    remember(checksum, pages);
    return pages;
  }
  if (mediaType !== 'application/pdf') return null;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t) =>
      t.replaceAll(/[ \t]+/gu, ' ').trim(),
    );
    remember(checksum, pages);
    return pages;
  } catch {
    return null;
  }
}

function remember(checksum: string, pages: readonly string[]): void {
  if (kept.size >= 100) kept.delete(kept.keys().next().value ?? '');
  kept.set(checksum, pages);
}

/** Pages as the model is shown them: numbered, each and all of them bounded. */
export function forModel(
  pages: readonly string[],
  perPage = 3000,
  total = 24_000,
): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  let used = 0;
  for (const [i, text] of pages.entries()) {
    if (used >= total) break;
    const t = text.slice(0, Math.min(perPage, total - used));
    used += t.length;
    out.push({ page: i + 1, text: t });
  }
  return out;
}

/** "Signature", "Signed by", "Sign here", and the same in the languages the packs ship. */
const SIGN_HERE = /^(signature|signed|sign here|firma|unterschrift|signature du|assinatura)\b/iu;

/**
 * Where a PDF says to sign (K2): each line that starts like a signature
 * label, in reading order, as fractions of its page from the top left. A
 * file that is not a PDF, or one with no such line, has none.
 */
export async function signatureLines(
  bytes: Uint8Array,
): Promise<{ page: number; x: number; y: number }[]> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out: { page: number; x: number; y: number }[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      // eslint-disable-next-line no-await-in-loop -- pages in order, a few of them
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      // eslint-disable-next-line no-await-in-loop -- as above
      const content = await page.getTextContent();
      const found = content.items.flatMap((item) => {
        if (!('str' in item) || !SIGN_HERE.test(item.str.trim())) return [];
        const [, , , , tx = 0, ty = 0] = item.transform as number[];
        // Beside the label, a little above its baseline: where a hand would sign.
        return [{ page: n, x: (tx + item.width + 8) / width, y: 1 - (ty + 24) / height }];
      });
      out.push(...found.toSorted((a, b) => a.y - b.y || a.x - b.x));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The model as every feature reaches it (PRD §14.1): each request's people,
 * emails, phone and identity numbers, accounts and document numbers become
 * stand-ins before it leaves, and come back as themselves only here, in this
 * process, for this request. What a provider sees is about nobody.
 *
 * ponytail: an image read by a model that sees goes as it is, since pixels
 * cannot be masked; what it transcribes is masked like any page from then on.
 * Text recognition run here is the upgrade.
 */
export function privately(
  reader: Reader,
  uow: UnitOfWork,
  /** Names the company does not know, found on this server (`infrastructure/names.ts`). */
  findNames?: (text: string) => readonly string[],
): Reader {
  return {
    async read(input) {
      const names = await uow.run(input.tenantId, async (tx) =>
        (await tx.members.list()).map((m) => m.displayName),
      );
      const p = pseudonymise(names, findNames);
      const answer = await reader.read({
        ...input,
        instruction: `${input.instruction}\n${STAND_INS}`,
        context: p.mask(input.context) as Readonly<Record<string, unknown>>,
      });
      return answer === null ? null : (p.unmask(answer) as Readonly<Record<string, unknown>>);
    },
    // A photo cannot be masked, so it goes only where the company said it may.
    ...(reader.see === undefined
      ? {}
      : {
          see: async (input) => {
            const ai = await uow.run(input.tenantId, (tx) => tx.settings.get('ai'));
            const on = (ai as { photos?: boolean } | null)?.photos === true;
            return on ? (reader.see?.(input) ?? null) : null;
          },
        }),
  };
}
