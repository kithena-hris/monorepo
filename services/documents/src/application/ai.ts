import { err, failure, ok, type Result } from '@kithena/domain-kit';
import * as z from 'zod';
import type { DocumentId } from '@kithena/contracts';

import { canOpen } from '../domain/access/access.js';
import { changedLines, datesIn, keepCited, passages } from '../domain/assist/assist.js';
import { checkType, type DocumentType } from '../domain/type/document-type.js';
import { contextOf, factsOf, hrOnly, load, notFound, type Ctx } from './context.js';
import type { Caller, Deps } from './ports.js';
import { forModel, pagesOf } from './text.js';

/**
 * Kithena reading documents (PRD §14, DOC-050 to DOC-056). Every feature is
 * for somebody who may open the document, for that request; the type and the
 * company may switch it off; a medical document is read for dates by code
 * and never sent; every cited page is checked; and with no model each answers
 * "not available" and the screen works without it.
 */

const Title = (title: string) => ({ title });

export const CitedView = z
  .object({ text: z.string(), pages: z.array(z.int()) })
  .meta(Title('DocumentsCited'));

export const SummaryView = z
  .object({
    available: z.boolean(),
    /** Why not, in a sentence: no model, switched off, not a PDF, medical. */
    reason: z.string().nullable(),
    summary: z.array(CitedView),
    facts: z.array(z.object({ label: z.string(), value: z.string(), page: z.int() })),
    watch: CitedView.nullable(),
    questions: z.array(z.string()),
    /** A medical document's dates, read by code alone. */
    dates: z.array(z.string()),
  })
  .meta(Title('DocumentsSummary'));

export const AnswerView = z
  .object({
    available: z.boolean(),
    reason: z.string().nullable(),
    answer: z.array(CitedView),
    sources: z.array(
      z.object({ documentId: z.string(), title: z.string(), pages: z.array(z.int()) }),
    ),
  })
  .meta(Title('DocumentsAnswer'));

export const CompareView = z
  .object({
    available: z.boolean(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    sentences: z.array(z.string()),
  })
  .meta(Title('DocumentsCompare'));

type Summary = z.infer<typeof SummaryView>;
type Answer = z.infer<typeof AnswerView>;

/** The company's AI switches (S7): each on unless HR turned it off. */
export const AI_FEATURES = ['summaries', 'questions', 'across', 'sorting', 'fields'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

async function featureOn(ctx: Ctx, feature: AiFeature): Promise<boolean> {
  const ai = (await ctx.tx.settings.get('ai')) as Partial<Record<AiFeature, boolean>> | null;
  return ai?.[feature] !== false;
}

const none = (reason: string): Summary => ({
  available: false,
  reason,
  summary: [],
  facts: [],
  watch: null,
  questions: [],
  dates: [],
});

const noAnswer = (reason: string): Answer => ({
  available: false,
  reason,
  answer: [],
  sources: [],
});

/** The document's current text, if this viewer may open it and Kithena may read it. */
async function readable(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  feature: AiFeature,
  version: number | null = null,
): Promise<
  Result<
    | { kind: 'refused'; reason: string }
    | { kind: 'medical'; pages: readonly string[] }
    | { kind: 'text'; pages: readonly string[]; title: string; type: DocumentType | null }
  >
> {
  const found = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const loaded = await load(ctx, id);
    if (!loaded.ok) return loaded;
    const { doc, type } = loaded.value;
    if (!canOpen(factsOf(doc, type), ctx.viewer, ctx.today) || doc.deletedAt !== null)
      return err(notFound());
    const on = await featureOn(ctx, feature);
    const v = await tx.versions.get(id, version ?? doc.currentVersion);
    if (v === null) return err(failure('NOT_FOUND', 'No such version'));
    return ok({ doc, type, v, on });
  });
  if (!found.ok) return found;
  const { doc, type, v, on } = found.value;
  if (!on) return ok({ kind: 'refused', reason: 'Your company has switched this off.' });
  if (type !== null && !type.aiEnabled)
    return ok({ kind: 'refused', reason: 'Kithena does not read this kind of document.' });
  const image = v.mediaType.startsWith('image/');
  if (v.mediaType !== 'application/pdf' && !image)
    return ok({ kind: 'refused', reason: 'Kithena reads PDFs and images.' });
  // A medical image could only be read by sending it: it is not (PRD §14.1).
  if (image && type?.medical === true)
    return ok({ kind: 'refused', reason: 'Kithena reads only the dates of a medical PDF.' });
  const bytes = await deps.blobs.get(v.blobKey);
  if (bytes === null) return ok({ kind: 'refused', reason: 'The file is no longer stored.' });
  const pages = await pagesOf(bytes, v.mediaType, v.checksum, deps.reader);
  if (pages === null || pages.every((p) => p === ''))
    return ok({ kind: 'refused', reason: 'There is no text in this file to read.' });
  // A medical document's text never leaves Documents (PRD §14.1).
  if (type?.medical === true) return ok({ kind: 'medical', pages });
  return ok({ kind: 'text', pages, title: doc.title, type });
}

/** An upload's kind, by its name: all `suggestFiling` is told. */
const mediaTypeOf = (name: string): string => {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext === 'pdf'
    ? 'application/pdf'
    : ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : 'other';
};

const asCited = (value: unknown): { text: string; pages: number[] }[] =>
  Array.isArray(value)
    ? value.flatMap((v) => {
        const o = v as { text?: unknown; pages?: unknown; page?: unknown };
        const pages = Array.isArray(o.pages)
          ? o.pages.map(Number)
          : o.page === undefined
            ? []
            : [Number(o.page)];
        return typeof o.text === 'string' ? [{ text: o.text.slice(0, 600), pages }] : [];
      })
    : [];

const RULES =
  'Answer only from the document pages given. Every claim cites the page numbers it comes from. Never invent a page, a number or a name. Plain words, short sentences. Reply with JSON only.';

/** D1, MR1, MR4: the document in plain words, each claim linked to its page. */
export async function summarize(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
): Promise<Result<Summary>> {
  const got = await readable(deps, caller, id, 'summaries');
  if (!got.ok) return got;
  if (got.value.kind === 'refused') return ok(none(got.value.reason));
  if (got.value.kind === 'medical') {
    return ok({
      ...none('Kithena reads only the dates of a medical document.'),
      dates: datesIn(got.value.pages.join('\n')),
    });
  }
  if (deps.reader === undefined) return ok(none('Kithena’s reading is not set up here.'));
  const { pages, title } = got.value;
  const answer = await deps.reader.read({
    instruction: `${RULES} Shape: {"summary":[{"text":string,"pages":[number]}] (2 to 4 sentences), "facts":[{"label":string,"value":string,"page":number}] (up to 6), "watch":{"text":string,"pages":[number]} or null (the one clause worth knowing), "questions":[string] (3 short follow-up questions)}.`,
    context: { title, pages: forModel(pages) },
  });
  if (answer === null) return ok(none('Kithena could not read it just now.'));
  const watch =
    keepCited(asCited(answer['watch'] === null ? [] : [answer['watch']]), pages.length)[0] ?? null;
  const facts = Array.isArray(answer['facts'])
    ? answer['facts'].flatMap((f) => {
        const o = f as { label?: unknown; value?: unknown; page?: unknown };
        const page = Number(o.page);
        return typeof o.label === 'string' &&
          typeof o.value === 'string' &&
          page >= 1 &&
          page <= pages.length
          ? [{ label: o.label.slice(0, 60), value: o.value.slice(0, 200), page }]
          : [];
      })
    : [];
  return ok({
    available: true,
    reason: null,
    summary: keepCited(asCited(answer['summary']), pages.length).slice(0, 4),
    facts: facts.slice(0, 6),
    watch,
    questions: Array.isArray(answer['questions'])
      ? answer['questions']
          .filter((q): q is string => typeof q === 'string')
          .map((q) => q.slice(0, 120))
          .slice(0, 3)
      : [],
    dates: [],
  });
}

/** D2, MR2: a question about this document only, answered with its pages. */
export async function askAbout(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  question: string,
): Promise<Result<Answer>> {
  const q = question.trim();
  if (q.length === 0 || q.length > 500)
    return err(failure('QUESTION', 'Ask in up to 500 characters', ['question']));
  const got = await readable(deps, caller, id, 'questions');
  if (!got.ok) return got;
  if (got.value.kind === 'refused') return ok(noAnswer(got.value.reason));
  if (got.value.kind === 'medical')
    return ok(noAnswer('Kithena reads only the dates of a medical document.'));
  if (deps.reader === undefined) return ok(noAnswer('Kithena’s reading is not set up here.'));
  const { pages, title } = got.value;
  const answer = await deps.reader.read({
    instruction: `${RULES} If the pages do not answer the question, say so in one sentence citing the page you looked at. Shape: {"answer":[{"text":string,"pages":[number]}]} (1 to 3 sentences).`,
    context: { title, question: q, pages: forModel(pages) },
  });
  if (answer === null) return ok(noAnswer('Kithena could not read it just now.'));
  const cited = keepCited(asCited(answer['answer']), pages.length).slice(0, 3);
  return ok({
    available: cited.length > 0,
    reason: cited.length > 0 ? null : 'The document does not say.',
    answer: cited,
    sources: [{ documentId: id, title, pages: [...new Set(cited.flatMap((c) => c.pages))] }],
  });
}

/**
 * B4, MR5: a question across what this person may open. Code chooses the
 * passages (`passages`) among their documents; the model answers from those
 * alone and cites them as "document page".
 */
export async function askAcross(
  deps: Deps,
  caller: Caller,
  question: string,
): Promise<Result<Answer>> {
  const q = question.trim();
  if (q.length === 0 || q.length > 500)
    return err(failure('QUESTION', 'Ask in up to 500 characters', ['question']));
  const listed = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    if (!(await featureOn(ctx, 'across'))) return null;
    const types = new Map((await tx.types.list()).map((t) => [t.key as string, t]));
    const docs = await tx.documents.candidates(ctx.viewer);
    const open = docs.filter((d) => {
      const type = d.typeKey === null ? null : (types.get(d.typeKey) ?? null);
      return (
        d.deletedAt === null &&
        canOpen(factsOf(d, type), ctx.viewer, ctx.today) &&
        type?.medical !== true &&
        type?.aiEnabled !== false
      );
    });
    // ponytail: the 40 most recently changed; an index of every page when libraries grow.
    const recent = open.toSorted((a, b) => b.versionAt.localeCompare(a.versionAt)).slice(0, 40);
    return Promise.all(
      recent.map(async (d) => ({ doc: d, version: await tx.versions.get(d.id, d.currentVersion) })),
    );
  });
  if (listed === null) return ok(noAnswer('Your company has switched this off.'));
  if (deps.reader === undefined) return ok(noAnswer('Kithena’s reading is not set up here.'));
  const texts = [];
  for (const { doc, version } of listed) {
    if (version === null || version.mediaType !== 'application/pdf') continue;
    const bytes = await deps.blobs.get(version.blobKey);
    if (bytes === null) continue;
    const pages = await pagesOf(bytes, version.mediaType, version.checksum);
    if (pages !== null) texts.push({ documentId: doc.id, title: doc.title, pages });
  }
  const top = passages(q, texts, 8);
  if (top.length === 0) return ok(noAnswer('Nothing you can open mentions that.'));
  const numbered = top.map((p, i) => ({
    source: i + 1,
    title: p.title,
    page: p.page,
    text: p.text.slice(0, 2500),
  }));
  const answer = await deps.reader.read({
    instruction: `${RULES} The pages come from several documents; cite each claim with the "source" numbers given. Shape: {"answer":[{"text":string,"sources":[number]}]} (1 to 3 sentences).`,
    context: { question: q, passages: numbered },
  });
  if (answer === null) return ok(noAnswer('Kithena could not read them just now.'));
  const claims = Array.isArray(answer['answer'])
    ? answer['answer'].flatMap((a) => {
        const o = a as { text?: unknown; sources?: unknown };
        const used = Array.isArray(o.sources)
          ? o.sources.map(Number).filter((n) => n >= 1 && n <= top.length)
          : [];
        return typeof o.text === 'string' && used.length > 0
          ? [{ text: o.text.slice(0, 600), used }]
          : [];
      })
    : [];
  const sources = new Map<string, { documentId: string; title: string; pages: Set<number> }>();
  for (const c of claims) {
    for (const n of c.used) {
      const p = top[n - 1];
      if (p === undefined) continue;
      const s = sources.get(p.documentId) ?? {
        documentId: p.documentId,
        title: p.title,
        pages: new Set<number>(),
      };
      s.pages.add(p.page);
      sources.set(p.documentId, s);
    }
  }
  return ok({
    available: claims.length > 0,
    reason: claims.length > 0 ? null : 'The documents you can open do not say.',
    answer: claims
      .slice(0, 3)
      .map((c) => ({ text: c.text, pages: c.used.map((n) => top[n - 1]?.page ?? 0) })),
    sources: [...sources.values()].map((s) => ({
      ...s,
      pages: [...s.pages].toSorted((a, b) => a - b),
    })),
  });
}

/** D3, C4: the lines that changed between two versions, and what that means in a sentence each. */
export async function compareVersions(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  from: number,
  to: number,
): Promise<Result<z.infer<typeof CompareView>>> {
  const [a, b] = await Promise.all([
    readable(deps, caller, id, 'questions', from),
    readable(deps, caller, id, 'questions', to),
  ]);
  if (!a.ok) return a;
  if (!b.ok) return b;
  if (a.value.kind !== 'text' || b.value.kind !== 'text') {
    return ok({ available: false, added: [], removed: [], sentences: [] });
  }
  const lines = (pages: readonly string[]) => pages.flatMap((p) => p.split(/(?<=[.;:])\s+|\n/u));
  const diff = changedLines(lines(a.value.pages), lines(b.value.pages));
  const added = diff.added.slice(0, 40);
  const removed = diff.removed.slice(0, 40);
  let sentences: string[] = [];
  if (deps.reader !== undefined && (added.length > 0 || removed.length > 0)) {
    const answer = await deps.reader.read({
      instruction: `${RULES} Say what changed between two versions of a document, one plain sentence per change, from the lines removed and added only. Shape: {"changes":[string]} (up to 5).`,
      context: { title: a.value.title, removed, added },
    });
    sentences = Array.isArray(answer?.['changes'])
      ? (answer['changes'] as unknown[])
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.slice(0, 300))
          .slice(0, 5)
      : [];
  }
  return ok({ available: true, added, removed, sentences });
}

/**
 * C1, MD3: what an upload is, before it is filed — a type and a person from
 * the company's own, a name and an expiry. The model suggests; code keeps
 * only a type and a person that exist, and HR confirms.
 */
export async function suggestFiling(
  deps: Deps,
  caller: Caller,
  input: { readonly uploadId: string; readonly name: string },
): Promise<
  Result<{
    available: boolean;
    title: string | null;
    typeKey: string | null;
    subjectPersonId: string | null;
    expiresOn: string | null;
  }>
> {
  const empty = {
    available: false,
    title: null,
    typeKey: null,
    subjectPersonId: null,
    expiresOn: null,
  };
  const setup = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    return ok({
      on: await featureOn(ctx, 'sorting'),
      types: (await tx.types.list()).filter((t) => !t.archived && !t.medical && t.aiEnabled),
      people: (await tx.members.list()).filter((m) => m.status !== 'terminated'),
    });
  });
  if (!setup.ok) return setup;
  if (!setup.value.on || deps.reader === undefined || deps.transfers === undefined)
    return ok(empty);
  const bytes = await deps.transfers.readIncoming(
    `incoming/${caller.tenantId}/${input.uploadId}`,
    100 * 1024 * 1024,
  );
  if (bytes === null || bytes === 'too_large') return ok(empty);
  const pages = await pagesOf(
    bytes,
    mediaTypeOf(input.name),
    `upload:${input.uploadId}`,
    deps.reader,
  );
  if (pages === null) return ok(empty);
  const answer = await deps.reader.read({
    instruction: `${RULES} Classify an uploaded document. Choose its type key from the list, the person it is about from the list (or null), a short name, and its expiry date (YYYY-MM-DD) if it states one. Shape: {"typeKey":string|null,"personId":string|null,"title":string,"expiresOn":string|null}.`,
    context: {
      fileName: input.name,
      types: setup.value.types.map((t) => ({ key: t.key, name: t.name })),
      people: setup.value.people.map((p) => ({ personId: p.personId, name: p.displayName })),
      pages: forModel(pages.slice(0, 2), 2500, 5000),
    },
  });
  if (answer === null) return ok(empty);
  const typeKey = setup.value.types.some((t) => t.key === answer['typeKey'])
    ? String(answer['typeKey'])
    : null;
  const person = setup.value.people.some((p) => p.personId === answer['personId'])
    ? String(answer['personId'])
    : null;
  const expires =
    typeof answer['expiresOn'] === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(answer['expiresOn'])
      ? answer['expiresOn']
      : null;
  return ok({
    available: true,
    title: typeof answer['title'] === 'string' ? answer['title'].slice(0, 200) : null,
    typeKey,
    subjectPersonId: person,
    expiresOn: expires,
  });
}

/** S4, MS4: a type described in words, drafted as its sentence; HR saves it. */
export async function describeType(
  deps: Deps,
  caller: Caller,
  text: string,
): Promise<Result<{ available: boolean; type: DocumentType | null; question: string | null }>> {
  const words = text.trim();
  if (words.length === 0 || words.length > 1000)
    return err(failure('DESCRIPTION', 'Describe it in up to 1,000 characters', ['text']));
  const hr = await deps.uow.run(caller.tenantId, async (tx) =>
    hrOnly(await contextOf(deps, tx, caller)),
  );
  if (!hr.ok) return hr;
  if (deps.reader === undefined) return ok({ available: false, type: null, question: null });
  const answer = await deps.reader.read({
    instruction:
      'Turn an HR description of a kind of document into its settings. Reply with JSON only: {"type":{"key":snake_case,"name":string,"kind":"Contract"|"Policy"|"Payslip"|"Letter"|"ID"|"Medical"|"Sheet"|"Template"|"Permit"|"Form","filedTo":"person"|"company","audience":"subject"|"everyone"|"hr","confidential":boolean,"medical":boolean,"signers":["subject"|"hr"],"acknowledge":boolean,"requiredFor":"new_starters"|"everyone"|null,"requiredBy":0,"expiryReminders":[number],"retention":{"kind":"after_leaving","years":number}|{"kind":"until_leaving","plusYears":number}|{"kind":"years","years":number}|{"kind":"days","days":number}|{"kind":"forever"},"aiReads":[string],"aiEnabled":true},"question":string|null} where question is the one thing the description leaves open.',
    context: { description: words },
  });
  if (answer === null) return ok({ available: false, type: null, question: null });
  const checked = checkType(answer['type']);
  return ok({
    available: checked.ok,
    type: checked.ok ? checked.value : null,
    question: typeof answer['question'] === 'string' ? answer['question'].slice(0, 300) : null,
  });
}

/** G5, MP3, K9: the values its type says Kithena reads, each with its page. */
export async function readFields(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  /** What to look for, by name: a host's own field labels. Absent: what the type says Kithena reads. */
  asked: readonly string[] | null = null,
): Promise<
  Result<{ available: boolean; fields: { name: string; value: string; page: number }[] }>
> {
  const got = await readable(deps, caller, id, 'fields');
  if (!got.ok) return got;
  if (got.value.kind !== 'text' || deps.reader === undefined)
    return ok({ available: false, fields: [] });
  const names = asked ?? got.value.type?.aiReads ?? [];
  if (names.length === 0) return ok({ available: false, fields: [] });
  const { pages, title } = got.value;
  const answer = await deps.reader.read({
    instruction: `${RULES} Read these fields from the document, each with the page it is on, exactly as written but dates as YYYY-MM-DD; leave out any the document does not state. Shape: {"fields":[{"name":string,"value":string,"page":number}]}.`,
    context: { title, fields: names, pages: forModel(pages) },
  });
  const fields = Array.isArray(answer?.['fields'])
    ? (answer['fields'] as unknown[]).flatMap((f) => {
        const o = f as { name?: unknown; value?: unknown; page?: unknown };
        const page = Number(o.page);
        return typeof o.name === 'string' &&
          names.includes(o.name) &&
          typeof o.value === 'string' &&
          page >= 1 &&
          page <= pages.length
          ? [{ name: o.name, value: o.value.slice(0, 200), page }]
          : [];
      })
    : [];
  return ok({ available: fields.length > 0, fields });
}

/** S7: the company's switches, for Settings › Documents. */
export async function aiSwitches(ctx: Ctx): Promise<Record<AiFeature, boolean>> {
  const out = {} as Record<AiFeature, boolean>;
  for (const f of AI_FEATURES) out[f] = await featureOn(ctx, f);
  return out;
}

export async function setAiSettings(
  deps: Deps,
  caller: Caller,
  input: Partial<Record<AiFeature, boolean | undefined>>,
): Promise<Result<{ ok: true }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const was = ((await tx.settings.get('ai')) as Partial<Record<AiFeature, boolean>> | null) ?? {};
    const given = Object.entries(input).filter(([, on]) => on !== undefined);
    await tx.settings.set('ai', { ...was, ...Object.fromEntries(given) });
    return ok({ ok: true as const });
  });
}
