import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { FormAnswers, FormDefinition } from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';
import { plainText, subjectView } from '@kithena/form-kit';

import { label } from '../domain/cycle.js';
import { isSubmitted, standing, type Review } from '../domain/review.js';
import { audit, hrOnly, names, notFound, type Ctx } from './context.js';
import { formOf } from './forms.js';
import { load } from './reviews.js';
import { settingsOf } from './settings.js';
import { storedZip } from './zip.js';

/**
 * PDFs (PRD §20, PRF-048): one review, or a cycle's reviews in one file, each
 * with the subject's view applied when the reader is the subject, so a
 * private question never reaches paper. Noto Sans is embedded for People's
 * reason: "Łukasz" must print as Łukasz.
 *
 * A bulk export is the reader's choice: one PDF with a page per review, or a
 * zip with each review as its own PDF and an index of them all.
 *
 * ponytail: built in the request; a background job when a cycle outgrows one.
 */

const FONT_DIR = ['../../assets/fonts/', '../../../assets/fonts/']
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  .find((dir) => existsSync(join(dir, 'OFL.txt')));
const font = (name: string) => (FONT_DIR === undefined ? 'Helvetica' : join(FONT_DIR, name));
const BODY = font('NotoSans_400Regular.ttf');
const BOLD = font('NotoSans_700Bold.ttf');

interface Page {
  readonly title: string;
  /** For the zip's index: whose, which review, by whom, when, the score. */
  readonly index: readonly string[];
  readonly lines: readonly string[];
  readonly definition: FormDefinition;
  readonly answers: FormAnswers;
  readonly score: string | null;
}

const answerText = (def: FormDefinition, id: string, answers: FormAnswers): string => {
  const q = def.sections.flatMap((s) => s.questions).find((x) => x.id === id);
  const v = answers[id]?.value;
  if (q === undefined || v === undefined || v === null) return '—';
  if (q.type === 'scale') return q.options.find((o) => o.value === v)?.label ?? String(v);
  if (q.type === 'binary') return v === true ? q.yes : q.no;
  if (q.type === 'choice')
    return (Array.isArray(v) ? v : [String(v)])
      .map((x) => q.options.find((o) => o.id === x)?.label ?? x)
      .join(', ');
  if (typeof v === 'string') return plainText(v);
  return String(v);
};

function draw(pages: readonly Page[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: pages[0]?.title ?? 'Review', Producer: 'Kithena' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
    pages.forEach((p, i) => {
      if (i > 0) doc.addPage();
      doc.font(BOLD).fontSize(18).fillColor('#111827').text(p.title);
      doc.moveDown(0.3);
      doc.font(BODY).fontSize(10).fillColor('#6b7280');
      for (const l of p.lines) doc.text(l);
      doc.moveDown(0.8);
      for (const s of p.definition.sections) {
        doc.font(BOLD).fontSize(12).fillColor('#111827').text(s.title);
        doc.moveDown(0.3);
        for (const q of s.questions) {
          doc.font(BOLD).fontSize(10).fillColor('#111827').text(q.prompt);
          const shown =
            q.type === 'performance_score'
              ? (p.score ?? '—')
              : answerText(p.definition, q.id, p.answers);
          doc.font(BODY).fontSize(10).fillColor('#374151').text(shown);
          const comment = p.answers[q.id]?.comment;
          if (comment) doc.fillColor('#6b7280').text(`Comment: ${plainText(comment)}`);
          doc.moveDown(0.5);
        }
        doc.moveDown(0.4);
      }
    });
    doc.end();
  });
}

async function pageOf(ctx: Ctx, r: Review, asSubject: boolean): Promise<Page | null> {
  const form = await formOf(ctx, r);
  if (form === null) return null;
  const name = await names(ctx);
  const c = r.cycleId === null ? null : await ctx.tx.cycles.get(r.cycleId);
  const view = asSubject
    ? subjectView(form, standing(r))
    : { definition: form, answers: standing(r) };
  const s = r.calibrated?.hundredths ?? r.submitted.at(-1)?.scoreHundredths ?? null;
  const scale = (await settingsOf(ctx)).general.scale;
  const word =
    s === null
      ? null
      : scale.reduce(
          (best, o) => (Math.abs(o.value - s / 100) <= Math.abs(best.value - s / 100) ? o : best),
          scale[0] ?? { value: 0, label: '' },
        ).label;
  const kind = label(r.kind);
  const by = asSubject && r.confidential ? 'A colleague' : name(r.authorId);
  const submitted = r.submitted.at(-1)?.at.slice(0, 10) ?? '';
  return {
    title: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}: ${name(r.subjectId)}`,
    index: [
      name(r.subjectId),
      `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
      by,
      submitted,
      s === null ? '' : (s / 100).toFixed(1),
    ],
    lines: [
      c?.name ?? '',
      asSubject && r.confidential ? 'Written by a colleague' : `By ${name(r.authorId)}`,
      `Submitted ${r.submitted.at(-1)?.at.slice(0, 10) ?? '—'}`,
    ].filter((x) => x !== ''),
    definition: view.definition,
    answers: view.answers,
    score: s === null ? null : `${(s / 100).toFixed(1)} · ${word ?? ''}`,
  };
}

/** One review's PDF, for whoever may read it, as they may read it. */
export async function reviewPdf(
  ctx: Ctx,
  id: string,
): Promise<Result<{ filename: string; base64: string }>> {
  const loaded = await load(ctx, id);
  if (!loaded.ok) return loaded;
  const page = await pageOf(ctx, loaded.value.review, loaded.value.access === 'subject');
  if (page === null) return err(notFound('form'));
  await audit(ctx, { kind: 'review', action: 'Downloaded a review as PDF', target: page.title, targetId: id });
  return ok({
    filename: `${page.title.replaceAll(/[^\w -]+/gu, '')}.pdf`,
    base64: (await draw([page])).toString('base64'),
  });
}

/** A file name without what a file system would refuse. */
const safe = (name: string): string => name.replaceAll(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'Review';

/** One CSV cell: quoted, its quotes doubled, a leading formula character defused. */
const cell = (v: string): string => `"${(/^[=+\-@]/u.test(v) ? `'${v}` : v).replaceAll('"', '""')}"`;

/** The zip: each review its own PDF, named for whose it is, and `index.csv` listing them. */
async function zipOf(pages: readonly Page[]): Promise<Buffer> {
  const used = new Set<string>();
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const p of pages) {
    const base = safe(`${p.index[0] ?? ''} - ${p.index[1] ?? ''}`);
    let name = `${base}.pdf`;
    for (let n = 2; used.has(name); n += 1) name = `${base} (${String(n)}).pdf`;
    used.add(name);
    files.push({ name, bytes: await draw([p]) });
  }
  const rows = [
    ['File', 'Subject', 'Review', 'Written by', 'Submitted', 'Score'],
    ...pages.map((p, i) => [files[i]?.name ?? '', ...p.index]),
  ];
  const csv = `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
  return Buffer.from(
    storedZip([{ name: 'index.csv', bytes: new TextEncoder().encode(csv) }, ...files]),
  );
}

/** PF5h: a cycle's reviews, as each subject would see them or in full for HR (logged as a sensitive read). */
export async function cyclePdf(
  ctx: Ctx,
  cycleId: string,
  input: { full: boolean; kinds: string[]; format?: 'pdf' | 'zip' },
): Promise<
  Result<{ filename: string; base64: string; count: number; mediaType: string }>
> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(cycleId);
  if (c === null) return err(notFound('cycle'));
  const pages: Page[] = [];
  for (const r of await ctx.tx.reviews.find({ cycleId })) {
    if (
      !isSubmitted(r) ||
      r.detached !== null ||
      (input.kinds.length > 0 && !input.kinds.includes(r.kind))
    )
      continue;
    const p = await pageOf(ctx, r, !input.full);
    if (p !== null) pages.push(p);
  }
  await audit(ctx, { kind: 'cycle',
    action: input.full
      ? 'Exported full reviews (sensitive read)'
      : 'Exported reviews as subjects see them',
    fields: [input.format === 'zip' ? 'zip' : 'pdf'],
    target: `${c.name} · ${String(pages.length)}`,
    targetId: cycleId,
  });
  if (pages.length === 0)
    return err({ code: 'EMPTY', message: 'No submitted reviews to export yet' });
  const zip = input.format === 'zip';
  return ok({
    filename: `${safe(c.name)}.${zip ? 'zip' : 'pdf'}`,
    base64: (zip ? await zipOf(pages) : await draw(pages)).toString('base64'),
    count: pages.length,
    mediaType: zip ? 'application/zip' : 'application/pdf',
  });
}
