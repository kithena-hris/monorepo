import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { DocumentId, DocumentTypeKey, PersonId } from '@kithena/contracts';
import { PDFDocument, rgb } from 'pdf-lib';

import { canOpen } from '../domain/access/access.js';
import * as z from 'zod';

import {
  figuresToCheck,
  matchName,
  merge,
  placeholders,
  signingBlock,
} from '../domain/letter/letter.js';
import { contextOf, factsOf, hrOnly, load, notFound } from './context.js';
import { upload } from './documents.js';
import { facesFor } from './fonts.js';
import type { Caller, Deps, Member } from './ports.js';
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
    bytes === null
      ? null
      : await pagesOf(bytes, version.mediaType, version.checksum, {
          reader: deps.reader,
          tenantId: caller.tenantId,
        });
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

/* ------------------------------------------------ drafted with Kithena -- */

/**
 * A document drafted in a conversation (PRD §14.2, "Draft a document"): HR
 * says what they need, Kithena asks for what is missing and writes it, and
 * the finished draft is drawn as a PDF, filed and sent to sign without a box
 * placed by hand. The model writes the words and names who signs, in order;
 * Kithena finds each signer among the company's people, points out every
 * figure nobody gave it, and writes the lines to sign on, so each signer's
 * box lands on their own (`signatureLines`). Nothing is kept until it is
 * filed: the conversation travels with each turn.
 */

export const DraftSigner = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).nullable(),
  order: z.int().min(1).max(10),
});

/** What the model answers: a reply, and the draft once there is one. */
const Answer = z.object({
  reply: z.string().trim().min(1).max(2000),
  action: z.enum(['send', 'file']).nullable().catch(null),
  draft: z
    .object({
      title: z.string().trim().min(1).max(200),
      typeKey: z.string().max(80).nullable().catch(null),
      about: z.string().trim().max(120).nullable().catch(null),
      body: z.string().trim().min(1).max(20_000),
      signers: z.array(DraftSigner).max(10),
    })
    .nullable()
    .catch(null),
});

export const DraftTurn = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        text: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
  draft: z
    .strictObject({
      title: z.string().max(200),
      typeKey: z.string().max(80).nullable(),
      about: z.string().max(120).nullable(),
      body: z.string().max(20_000),
      signers: z.array(DraftSigner).max(10),
    })
    .nullable(),
});
export type DraftTurn = z.infer<typeof DraftTurn>;

const Title = (title: string) => ({ title });

export const DraftView = z
  .object({
    available: z.boolean(),
    reply: z.string(),
    /**
     * What the sender asked for in words ("send it", "just file it"), once
     * the draft is ready: the screen then files it, and sends it for `send`,
     * as the buttons would.
     */
    action: z.enum(['send', 'file']).nullable(),
    draft: z
      .object({
        title: z.string(),
        typeKey: z.string().nullable(),
        typeName: z.string().nullable(),
        about: z.string().nullable(),
        aboutPersonId: z.string().nullable(),
        body: z.string(),
        signers: z.array(
          z.object({
            name: z.string(),
            email: z.string().nullable(),
            order: z.int(),
            personId: z.string().nullable(),
          }),
        ),
        /** Figures in the draft that nobody said: shown to check before it is sent. */
        figures: z.array(z.string()),
        /** Every signer is known and the type is satisfied: it can be filed and sent. */
        ready: z.boolean(),
      })
      .nullable(),
  })
  .meta(Title('DocumentsDraft'));
type DraftView = z.infer<typeof DraftView>;

const DRAFTING = [
  'You draft one HR document for a company, in a conversation with a member of its HR team.',
  'The JSON you get has: "messages", the conversation so far, oldest first; "draft", your last draft or null;',
  '"you", the name of the person you talk with ("me" and "I" in their messages); "company"; "today";',
  'and "types", the company\'s document types, each {key, name, filedTo}.',
  'Answer with JSON only: {"reply": string, "action": "send" | "file" | null, "draft": null | {"title": string, "typeKey": string | null,',
  '"about": string | null, "body": string, "signers": [{"name": string, "email": string | null, "order": number}]}}.',
  'Rules:',
  '- When something essential is missing (whom it is for, who signs, the terms that matter), ask for it in "reply",',
  '  one short question at a time, and keep "draft" as it was (null if there is none yet).',
  '- Never invent a name, figure, date or term the conversation did not give. Write [to be confirmed] in its place.',
  '- "body" is the whole document as plain text: no markdown, paragraphs separated by a blank line,',
  '  and no signature lines, names under them or dates to sign: Kithena adds those.',
  '- "signers" are the people who sign, in signing order: order 1 signs first, and two with the same order sign',
  '  at the same time. Use "you" for the person you talk with when they sign. An email only for someone outside',
  '  the company, and only when they gave one.',
  '- "about" is the full name of the employee the document is about, or null. "typeKey" is the key of the type',
  '  that fits best, or null when none does.',
  '- When asked for a change, return the whole revised draft. "reply" is one or two sentences: what you drafted',
  '  or changed, or your question. Write in the language of the conversation.',
  '- "action" is "send" when the last message asks to send the draft for signature now ("send it", "go ahead"),',
  '  "file" when it asks to save or file it without sending, and null otherwise. With an action, return the draft',
  '  unchanged and say in "reply" that it is being sent or filed.',
].join('\n');

const noDraft = (reply: string): DraftView => ({
  available: false,
  reply,
  action: null,
  draft: null,
});

export async function draftDocument(
  deps: Deps,
  caller: Caller,
  input: DraftTurn & { readonly companyName: string },
): Promise<Result<DraftView>> {
  const known = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const people = (await tx.members.list()).filter(
      (m) => m.terminationDate === null || m.terminationDate >= ctx.today,
    );
    const types = (await tx.types.list()).filter((t) => !t.archived);
    return ok({ you: ctx.member, people, types, today: ctx.today });
  });
  if (!known.ok) return known;
  const { you, people, types, today } = known.value;
  if (deps.reader === undefined) return ok(noDraft('Kithena cannot draft without its AI key.'));

  const read = await deps.reader.read({
    tenantId: caller.tenantId,
    instruction: DRAFTING,
    context: {
      messages: input.messages,
      draft: input.draft,
      you: you?.displayName ?? null,
      company: input.companyName,
      today,
      types: types.map((t) => ({ key: t.key, name: t.name, filedTo: t.filedTo })),
    },
    maxTokens: 6000,
  });
  const answer = Answer.safeParse(read);
  if (!answer.success) return ok(noDraft('Kithena could not draft that just now. Try again.'));
  const { reply, draft, action } = answer.data;
  if (draft === null) {
    return ok({
      available: true,
      reply: action === null ? reply : 'There is nothing to send yet. What do you need?',
      action: null,
      draft: null,
    });
  }

  // Who each name is: the person talking, somebody here, or somebody outside by email.
  const asks: string[] = [];
  const whom = (name: string): Member | null => {
    if (you !== null && matchName(name, [you]) === you) return you;
    const found = matchName(name, people);
    if (found === 'ambiguous') asks.push(`Which ${name} do you mean? Give me their full name.`);
    return found === 'ambiguous' ? null : found;
  };
  const signers = draft.signers.map((s) => {
    const email = s.email?.toLowerCase() || null;
    const inside = email === null ? null : people.find((p) => p.workEmail?.toLowerCase() === email);
    const member = inside ?? (email === null ? whom(s.name) : null);
    if (member === null && email === null && !asks.some((a) => a.includes(s.name))) {
      asks.push(
        `I can’t find ${s.name} here. If they are outside the company, what is their email?`,
      );
    }
    return {
      name: member?.displayName ?? s.name,
      email: member === null ? email : null,
      order: s.order,
      personId: member?.personId ?? null,
    };
  });
  const type = types.find((t) => t.key === draft.typeKey) ?? null;
  const subject = type?.filedTo === 'company' || draft.about === null ? null : whom(draft.about);
  if (
    type?.filedTo === 'person' &&
    subject === null &&
    !asks.some((a) => a.includes(draft.about ?? '\u0000'))
  ) {
    asks.push(`Whom is this ${type.name.toLowerCase()} about?`);
  }
  const said = input.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join('\n');
  const ready =
    asks.length === 0 &&
    signers.every((s) => s.personId !== null || s.email !== null) &&
    (type === null || type.filedTo === 'company' || subject !== null);
  // Asked in words, done only when the buttons could: ready, and somebody to send it to.
  const done = !ready || (action === 'send' && signers.length === 0) ? null : action;
  if (action !== null && done === null) {
    asks.unshift(
      signers.length === 0
        ? 'Nobody signs it yet, so there is nobody to send it to.'
        : 'It is not ready yet.',
    );
  }
  return ok({
    available: true,
    reply: [action !== null && done === null ? '' : reply, ...asks].filter(Boolean).join(' '),
    action: done,
    draft: {
      title: draft.title,
      typeKey: type?.key ?? null,
      typeName: type?.name ?? null,
      about: subject?.displayName ?? draft.about,
      aboutPersonId: subject?.personId ?? null,
      body: draft.body,
      signers,
      figures: figuresToCheck(`${draft.title}\n${draft.body}`, said),
      ready,
    },
  });
}

/** The finished draft: drawn with a line for each signer, filed, and sent to sign when asked. */
export async function fileDraft(
  deps: Deps,
  caller: Caller,
  input: {
    readonly title: string;
    readonly typeKey: string | null;
    readonly aboutPersonId: PersonId | null;
    readonly body: string;
    readonly signers: readonly {
      readonly personId: PersonId | null;
      readonly email: string | null;
      readonly name: string;
      readonly order: number;
    }[];
    readonly send: boolean;
  } & Origin,
): Promise<Result<{ id: string; envelopeId: string | null }>> {
  const inOrder = input.signers.toSorted((a, b) => a.order - b.order);
  const filed = await upload(deps, caller, {
    title: input.title,
    typeKey: input.typeKey as DocumentTypeKey | null,
    subjectPersonId: input.aboutPersonId,
    sectionId: null,
    expiresOn: null,
    requestId: null,
    file: {
      name: `${input.title}.pdf`,
      mediaType: 'application/pdf',
      bytes: await draw(input.title, input.body + signingBlock(inOrder.map((s) => s.name))),
    },
  });
  if (!filed.ok || !input.send)
    return filed.ok ? ok({ id: filed.value.id, envelopeId: null }) : filed;
  const sent = await sendForSignature(deps, caller, {
    documentId: filed.value.id,
    signers: inOrder.map((s) => ({
      personId: s.personId,
      email: s.personId === null ? s.email : null,
      name: s.name,
      order: s.order,
      allowDelegate: false,
    })),
    fields: [],
    message: '',
    dueOn: null,
    origin: input.origin,
    companyName: input.companyName,
  });
  return sent.ok ? ok({ id: filed.value.id, envelopeId: sent.value.id }) : sent;
}
