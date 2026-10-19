import { createHash, randomBytes, randomInt } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DocumentId, PersonId, TenantId } from '@kithena/contracts';

import { canOpen, canShare } from '../domain/access/access.js';
import {
  addVersion as nextVersion,
  setConfidential as protect,
} from '../domain/document/document.js';
import {
  checkCode,
  decline,
  fieldsAt,
  issueCode,
  markOpened,
  reassign,
  sealed,
  send,
  sign,
  voidEnvelope,
  type Envelope,
  type Field,
  type SignatureMark,
} from '../domain/signature/envelope.js';
import { signatureLines } from './text.js';
import {
  contextOf,
  event,
  factsOf,
  load,
  notFound,
  record,
  type Ctx,
  type Mail,
} from './context.js';
import { sha256 } from './files.js';
import type { Caller, Deps, Tx } from './ports.js';
import { seal, stampSoFar } from './sealing.js';

/**
 * Signatures (PRD §10, DOC-041 to DOC-047): sending, signing as a member or
 * from an emailed link, the code that proves an outside signer, declining,
 * passing a turn on, cancelling, and sealing the signed file.
 *
 * An outside signer's link carries `<tenant>.<random>`: the tenant, so the
 * public route knows whose rows to read under row-level security, and the
 * random part, stored only as its SHA-256.
 */

export interface SignerInput {
  readonly personId: PersonId | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly order: number;
  readonly allowDelegate: boolean;
}

/** Where links point and whose name is on the email: the shell's, which knows the company's host. */
export interface Origin {
  readonly origin: string;
  readonly companyName: string;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = (tenantId: string) => `${tenantId}.${randomBytes(24).toString('base64url')}`;
export const tenantOfToken = (token: string): string | null => {
  const tenant = token.split('.')[0] ?? '';
  return /^[0-9a-f-]{36}$/iu.test(tenant) ? tenant : null;
};

async function trail(
  ctx: Ctx,
  envelopeId: string,
  signerId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
  /** The event's id when the caller already showed it: a Signature ID shown while signing. */
  id: string = ctx.deps.newId(),
) {
  await ctx.tx.envelopes.record({
    id,
    envelopeId,
    signerId,
    action,
    detail,
    at: ctx.at,
  });
}

/** Who may send a document for signature: whoever controls it (HR, its owner). */
async function controlling(ctx: Ctx, documentId: DocumentId) {
  const found = await load(ctx, documentId);
  if (!found.ok) return found;
  const facts = factsOf(found.value.doc, found.value.type);
  if (!canOpen(facts, ctx.viewer, ctx.today)) return err(notFound());
  const may = canShare(facts, ctx.viewer);
  if (!may.ok) return may;
  return ok(found.value);
}

/**
 * Send the emails a committed transaction asked for. After the commit, so an
 * email that fails never undoes a signature or a request: the mailer logs why
 * (`infrastructure/messaging.ts`). The kinds that did not go, for a caller to
 * whom one matters (a code the signer is waiting for).
 */
async function deliver(deps: Deps, mail: readonly Mail[]): Promise<Mail['notice']['kind'][]> {
  const failed: Mail['notice']['kind'][] = [];
  for (const m of mail) {
    try {
      await deps.mailer?.notice(m);
    } catch {
      failed.push(m.notice.kind);
    }
  }
  return failed;
}

export async function sendForSignature(
  deps: Deps,
  caller: Caller,
  input: {
    readonly documentId: DocumentId;
    readonly signers: readonly SignerInput[];
    readonly fields: readonly Field[];
    readonly message: string;
    readonly dueOn: CalendarDate | null;
    /** Another module's reference, echoed on `envelope.completed` (Recruiting PRD §21.2). */
    readonly subjectRef?: string | null;
  } & Origin,
): Promise<Result<{ id: string }>> {
  const mail: Mail[] = [];
  const sent = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller, mail);
    const found = await controlling(ctx, input.documentId);
    if (!found.ok) return found;
    const { doc } = found.value;
    const version = await tx.versions.get(doc.id, doc.currentVersion);
    if (version === null || version.mediaType !== 'application/pdf' || version.pages === null) {
      return err(failure('NOT_A_PDF', 'Only a PDF can be signed here'));
    }
    if ((await tx.envelopes.forDocument(doc.id)).some((e) => e.status === 'sent')) {
      return err(failure('ALREADY_OUT', 'This document is already out for signature'));
    }
    const outside: { email: string; token: string }[] = [];
    const signers = [];
    for (const [i, s] of input.signers.entries()) {
      const id = `s${String(i + 1)}`;
      if (s.personId !== null) {
        const member = await tx.members.get(s.personId);
        if (member === null)
          return err(failure('NO_SUCH_PERSON', 'A signer does not work here', ['signers']));
        signers.push({
          id,
          order: s.order,
          personId: s.personId,
          email: null,
          name: member.displayName,
          check: 'login' as const,
          allowDelegate: s.allowDelegate,
          tokenHash: hash(newToken(caller.tenantId)),
        });
      } else {
        const email = s.email?.trim().toLowerCase() ?? '';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
          return err(failure('SIGNERS', 'An outside signer needs an email address', ['signers']));
        }
        const token = newToken(caller.tenantId);
        outside.push({ email, token });
        signers.push({
          id,
          order: s.order,
          personId: null,
          email,
          name: s.name?.trim() || email,
          check: 'email_code' as const,
          allowDelegate: s.allowDelegate,
          tokenHash: hash(token),
        });
      }
    }
    // K2: with no fields drawn, each signer signs beside a line the document has.
    const bytes = input.fields.length === 0 ? await deps.blobs.get(version.blobKey) : null;
    const fields =
      bytes === null
        ? input.fields
        : fieldsAt(
            signers.toSorted((a, b) => a.order - b.order).map((s) => s.id),
            await signatureLines(bytes),
            version.pages,
          );
    const env = send({
      id: deps.newId(),
      documentId: doc.id,
      version: doc.currentVersion,
      pages: version.pages,
      senderAccount: caller.accountId,
      signers,
      fields,
      message: input.message,
      dueOn: input.dueOn,
      at: ctx.at,
      subjectRef: input.subjectRef ?? null,
    });
    if (!env.ok) return env;
    await tx.envelopes.save(env.value);
    await trail(ctx, env.value.id, null, 'sent');
    await tx.outbox.publish([
      event(
        ctx,
        'documents.envelope.sent',
        { type: 'Envelope', id: env.value.id },
        {
          envelopeId: env.value.id,
          documentId: doc.id,
          version: doc.currentVersion,
          signers: env.value.signers.map((s) => ({
            personId: s.personId,
            email: s.email,
            order: s.order,
          })),
          dueOn: input.dueOn,
        },
      ),
    ]);
    await record(ctx, 'sent_for_signature', doc.id, { envelopeId: env.value.id });
    // Outside signers in the first order get their link now; the rest when their turn comes.
    const first = Math.min(...env.value.signers.map((s) => s.order));
    for (const o of outside) {
      const signer = env.value.signers.find((s) => s.email === o.email);
      if (signer?.order !== first) continue;
      ctx.mail.push({
        tenantId: caller.tenantId,
        email: o.email,
        url: `${input.origin.replace(/\/$/u, '')}/sign/${o.token}`,
        companyName: input.companyName,
        dedupeKey: `sign:${env.value.id}:${signer.id}`,
        notice: { kind: 'signature_requested' },
      });
    }
    return ok({ id: env.value.id });
  });
  if (sent.ok) await deliver(deps, mail);
  return sent;
}

/** The envelope and the signer this caller is, a member signing with their login. */
async function asMember(ctx: Ctx, envelopeId: string) {
  const env = await ctx.tx.envelopes.get(envelopeId);
  if (env === null) return err(failure('NOT_FOUND', 'No such request'));
  const signer = env.signers.find((s) => s.personId !== null && s.personId === ctx.viewer.personId);
  return ok({ env, signer: signer ?? null });
}

/** Whether this caller may follow the envelope: its sender, HR, or whoever controls the document. */
async function follows(ctx: Ctx, env: Envelope): Promise<boolean> {
  if (env.senderAccount === ctx.caller.accountId || ctx.viewer.hr) return true;
  const found = await load(ctx, env.documentId);
  return found.ok && canShare(factsOf(found.value.doc, found.value.type), ctx.viewer).ok;
}

/** After a signer signs: an outside signer whose turn just came gets their email. */
async function passTurn(ctx: Ctx, before: Envelope, after: Envelope, origin: Origin | null) {
  await ctx.tx.envelopes.save(after);
  if (after.status === 'completed') {
    await trail(ctx, after.id, null, 'completed');
    return;
  }
  for (const s of after.signers) {
    const was = before.signers.find((x) => x.id === s.id);
    if (was?.status !== 'waiting' || s.status !== 'sent') continue;
    if (s.personId === null && s.email !== null && origin !== null) {
      // A fresh token: the first was never sent, so nobody holds it.
      const token = newToken(ctx.caller.tenantId);
      const next = {
        ...after,
        signers: after.signers.map((x) => (x.id === s.id ? { ...x, tokenHash: hash(token) } : x)),
      };
      await ctx.tx.envelopes.save(next);
      ctx.mail.push({
        tenantId: ctx.caller.tenantId,
        email: s.email,
        url: `${origin.origin.replace(/\/$/u, '')}/sign/${token}`,
        companyName: origin.companyName,
        dedupeKey: `sign:${after.id}:${s.id}`,
        notice: { kind: 'signature_requested' },
      });
    }
  }
}

export interface SignInput {
  readonly signature: SignatureMark;
  readonly values: Readonly<Record<string, string>>;
  /** The signer's own calendar day, for the date box; the domain bounds it by the clock. */
  readonly day?: string | undefined;
  /** The Signature ID shown under each box as it was filled, kept as the signed event's id. */
  readonly traceId?: string | undefined;
}

/** The signing transaction, shared by a member and an outside signer. */
async function signIn(
  ctx: Ctx,
  env: Envelope,
  signerId: string,
  input: SignInput,
  origin: Origin | null,
) {
  const next = sign(env, signerId, input, ctx.at);
  if (!next.ok) return next;
  await trail(ctx, env.id, signerId, 'signed', { device: 'web' }, input.traceId);
  await passTurn(ctx, env, next.value, origin);
  const signer = next.value.signers.find((s) => s.id === signerId);
  await ctx.tx.outbox.publish([
    event(
      ctx,
      'documents.envelope.signed',
      { type: 'Envelope', id: env.id },
      {
        envelopeId: env.id,
        signerId,
        personId: signer?.personId ?? null,
      },
    ),
  ]);
  return ok(next.value);
}

export function signAsMember(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
  input: SignInput & Origin,
): Promise<Result<Signed>> {
  const mail: Mail[] = [];
  return withSeal(deps, caller.tenantId, input, async () => {
    const signed = await deps.uow.run(caller.tenantId, async (tx) => {
      const ctx = await contextOf(deps, tx, caller, mail);
      const found = await asMember(ctx, envelopeId);
      if (!found.ok) return found;
      const { env, signer } = found.value;
      if (signer === null) return err(failure('NOT_FOUND', 'No such request'));
      const opened = markOpened(env, signer.id, ctx.at);
      if (!opened.ok) return opened;
      const done = await signIn(ctx, opened.value, signer.id, input, input);
      if (!done.ok) return done;
      return ok({ envelope: done.value, signerId: signer.id, link: null });
    });
    // The next signer's email, once the signature is safely in.
    if (signed.ok) await deliver(deps, mail);
    return signed;
  });
}

/** What a signer is told at Finish: whether it is done, and whose turn it is now. */
export interface Signed {
  readonly completed: boolean;
  /** Who signs next, by name: "Sent to Lahari Rao for their signature". */
  readonly next: readonly string[];
}

/** Whose turn it is: asked, and not yet signed or declined. */
const onTurn = (env: Envelope) =>
  env.signers.filter(
    (s) => s.status === 'sent' || s.status === 'opened' || s.status === 'verified',
  );

/** A copy attached to an email: within what one request to messaging carries, else only a link. */
const MAX_ATTACHED = 3_000_000;

/**
 * After the signing transaction commits (bytes cannot join a transaction):
 * the document as signed so far is drawn and kept for the next signer (K7),
 * and the signer is emailed their copy; once everybody has signed, it is
 * sealed and every signer is emailed the sealed one. A failure here never
 * undoes the signature: a seal that did not finish is offered again on the
 * tracking page, and a copy that was not drawn is drawn by the next one.
 */
async function withSeal(
  deps: Deps,
  tenantId: TenantId,
  origin: Origin,
  signed: () => Promise<Result<{ envelope: Envelope; signerId: string; link: string | null }>>,
): Promise<Result<Signed>> {
  const done = await signed();
  if (!done.ok) return done;
  const { envelope: env, signerId, link } = done.value;
  if (env.status !== 'completed') {
    const copy = await workingCopy(deps, tenantId, env.id).catch(() => null);
    if (copy !== null) {
      await emailCopies(deps, tenantId, origin, env.id, [signerId], 'document_signed', copy, link);
    }
    return ok({ completed: false, next: onTurn(env).map((s) => s.name) });
  }
  const sealedNow = await sealEnvelope(deps, tenantId, env.id, origin.companyName);
  if (!sealedNow.ok) return sealedNow;
  const copy = await signedCopy(deps, tenantId, env.id).catch(() => null);
  if (copy !== null) {
    await emailCopies(
      deps,
      tenantId,
      origin,
      env.id,
      env.signers.map((s) => s.id),
      'document_completed',
      copy,
      link === null ? null : { signerId, token: link },
    );
  }
  return ok({ completed: true, next: [] });
}

interface Copy {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

/**
 * The document as signed so far, drawn and kept on the request (K7). Kept
 * only if nobody signed meanwhile; whoever did draws the newer one.
 */
async function workingCopy(
  deps: Deps,
  tenantId: TenantId,
  envelopeId: string,
): Promise<Copy | null> {
  const got = await deps.uow.run(tenantId, async (tx) => {
    const env = await tx.envelopes.get(envelopeId);
    if (env === null || env.status !== 'sent') return null;
    const version = await tx.versions.get(env.documentId, env.version);
    return version === null ? null : { env, version, trail: await tx.envelopes.trail(env.id) };
  });
  if (got === null) return null;
  const original = await deps.blobs.get(got.version.blobKey);
  if (original === null) return null;
  const bytes = await stampSoFar(original, got.env, got.trail);
  const key = `${tenantId}/${got.env.documentId}/${deps.newId()}`;
  await deps.blobs.put(key, bytes, 'application/pdf');
  const signedIds = (e: Envelope) =>
    e.signers
      .filter((x) => x.status === 'signed')
      .map((x) => x.id)
      .join(',');
  const previous = await deps.uow.run(tenantId, async (tx) => {
    const fresh = await tx.envelopes.get(envelopeId);
    if (fresh === null || signedIds(fresh) !== signedIds(got.env)) return undefined;
    await tx.envelopes.save({ ...fresh, workingBlobKey: key });
    return fresh.workingBlobKey ?? null;
  });
  // The copy it replaces is nobody's now.
  if (previous !== undefined && previous !== null)
    await deps.blobs.delete(previous).catch(() => undefined);
  return { bytes, fileName: got.version.fileName.replace(/\.pdf$/iu, '') + ' (signed so far).pdf' };
}

/** The sealed version's bytes, to send to every signer. */
async function signedCopy(
  deps: Deps,
  tenantId: TenantId,
  envelopeId: string,
): Promise<Copy | null> {
  const version = await deps.uow.run(tenantId, async (tx) => {
    const env = await tx.envelopes.get(envelopeId);
    if (env?.signedVersion == null) return null;
    return tx.versions.get(env.documentId, env.signedVersion);
  });
  if (version === null) return null;
  const bytes = await deps.blobs.get(version.blobKey);
  return bytes === null ? null : { bytes, fileName: version.fileName };
}

/**
 * Each signer's copy by email (K7): a colleague's to their work address,
 * opening the request; somebody outside's to the address they signed with,
 * opening their signing page. An outside signer whose link this request does
 * not hold gets a fresh one, which replaces the one they had.
 */
async function emailCopies(
  deps: Deps,
  tenantId: TenantId,
  origin: Origin,
  envelopeId: string,
  signerIds: readonly string[],
  kind: 'document_signed' | 'document_completed',
  copy: Copy,
  link: string | { signerId: string; token: string } | null,
): Promise<void> {
  const base = origin.origin.replace(/\/$/u, '');
  const mail = await deps.uow.run(tenantId, async (tx) => {
    const env = await tx.envelopes.get(envelopeId);
    if (env === null) return [];
    const out: Mail[] = [];
    let signers = env.signers;
    for (const id of signerIds) {
      const s = signers.find((x) => x.id === id);
      if (s === undefined) continue;
      let email: string | null = s.email;
      let url = `${base}/documents/envelopes/${env.id}`;
      if (s.personId !== null) {
        // oxlint-disable-next-line no-await-in-loop -- a request's few signers, in one transaction
        email = (await tx.members.get(s.personId))?.workEmail ?? null;
      } else {
        const held =
          typeof link === 'string' && signerIds.length === 1
            ? link
            : typeof link === 'object' && link?.signerId === id
              ? link.token
              : null;
        const token = held ?? newToken(tenantId);
        if (held === null) {
          signers = signers.map((x) => (x.id === id ? { ...x, tokenHash: hash(token) } : x));
        }
        url = `${base}/sign/${token}`;
      }
      if (email === null) continue;
      out.push({
        tenantId,
        email,
        url,
        companyName: origin.companyName,
        dedupeKey: `${kind}:${env.id}:${id}`,
        notice: { kind },
        ...(copy.bytes.byteLength > MAX_ATTACHED
          ? {}
          : {
              attachment: {
                fileName: copy.fileName,
                base64: Buffer.from(copy.bytes).toString('base64'),
              },
            }),
      });
    }
    if (signers !== env.signers) await tx.envelopes.save({ ...env, signers });
    return out;
  });
  await deliver(deps, mail);
}

export async function sealEnvelope(
  deps: Deps,
  tenantId: TenantId,
  envelopeId: string,
  company: string,
): Promise<Result<{ version: number }>> {
  const system: Caller = {
    tenantId,
    accountId: 'system',
    personId: null,
    correlationId: deps.newId(),
  };
  const got = await deps.uow.run(tenantId, async (tx) => {
    const env = await tx.envelopes.get(envelopeId);
    if (env === null || env.status !== 'completed')
      return err(failure('NOT_COMPLETED', 'Not everybody has signed'));
    if (env.signedVersion !== null) return ok({ env, version: null, trail: [] as const });
    return ok({
      env,
      version: await tx.versions.get(env.documentId, env.version),
      trail: await tx.envelopes.trail(env.id),
    });
  });
  if (!got.ok) return got;
  const { env, version } = got.value;
  if (version === null) return ok({ version: env.signedVersion ?? 0 });
  const original = await deps.blobs.get(version.blobKey);
  if (original === null) return err(failure('GONE', 'The signed file is no longer stored'));
  const bytes = await seal(original, env, got.value.trail, company);
  const key = `${tenantId}/${env.documentId}/${deps.newId()}`;
  await deps.blobs.put(key, bytes, 'application/pdf');
  return deps.uow.run(tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, system);
    const found = await load(ctx, env.documentId);
    if (!found.ok) return found;
    const doc = found.value.doc;
    const n = doc.currentVersion + 1;
    const next = nextVersion(doc, {
      n,
      blobKey: key,
      fileName: version.fileName.replace(/\.pdf$/iu, '') + ' (signed).pdf',
      mediaType: 'application/pdf',
      size: bytes.byteLength,
      pages: (version.pages ?? 0) + 1,
      checksum: sha256(bytes),
      note: 'Signed and sealed',
      uploadedAt: ctx.at,
      uploadedBy: env.senderAccount,
    });
    if (!next.ok) return next;
    // A signed agreement is Confidential, and stays so unless HR lowers it.
    const protectedDoc = protect(next.value, true, 'hr');
    const saved = next.value.confidential || !protectedDoc.ok ? next.value : protectedDoc.value;
    await tx.documents.save(saved);
    await tx.versions.add(doc.id, {
      n,
      blobKey: key,
      fileName: version.fileName.replace(/\.pdf$/iu, '') + ' (signed).pdf',
      mediaType: 'application/pdf',
      size: bytes.byteLength,
      pages: (version.pages ?? 0) + 1,
      checksum: sha256(bytes),
      note: 'Signed and sealed',
      uploadedAt: ctx.at,
      uploadedBy: env.senderAccount,
    });
    await tx.envelopes.save(sealed(env, n));
    await tx.outbox.publish([
      event(
        ctx,
        'documents.envelope.completed',
        { type: 'Envelope', id: env.id },
        {
          envelopeId: env.id,
          documentId: doc.id,
          signedVersion: n,
          subjectPersonId: doc.subjectPersonId,
          subjectRef: env.subjectRef ?? null,
        },
      ),
    ]);
    await record(ctx, 'sealed', doc.id, { envelopeId: env.id, version: n });
    return ok({ version: n });
  });
}

/* ------------------------------------------------- an outside signer (K6) -- */

/** Everything an outside signer's link may do, in the tenant it names. */
async function byLink<T>(
  deps: Deps,
  token: string,
  run: (ctx: Ctx, env: Envelope, signerId: string) => Promise<Result<T>>,
): Promise<Result<T>> {
  const tenant = tenantOfToken(token);
  if (tenant === null) return err(failure('NOT_FOUND', 'This link does not open anything'));
  const tenantId = tenant as TenantId;
  const caller: Caller = {
    tenantId,
    accountId: 'signer',
    personId: null,
    correlationId: deps.newId(),
  };
  const mail: Mail[] = [];
  const done = await deps.uow.run(tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller, mail);
    const found = await tx.envelopes.byToken(hash(token));
    if (found === null) return err(failure('NOT_FOUND', 'This link does not open anything'));
    return run(ctx, found.envelope, found.signerId);
  });
  if (!done.ok) return done;
  const failed = await deliver(deps, mail);
  // The signer is waiting on this one: said, so they can ask again.
  if (failed.includes('signing_code'))
    return err(failure('CODE_NOT_SENT', 'We could not email your code. Try again in a moment.'));
  return done;
}

export function requestCode(
  deps: Deps,
  token: string,
  origin: Origin,
): Promise<Result<{ sentTo: string }>> {
  return byLink(deps, token, async (ctx, env, signerId) => {
    const opened = markOpened(env, signerId, ctx.at);
    if (!opened.ok) return opened;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const next = issueCode(opened.value, signerId, hash(`${env.id}:${signerId}:${code}`), ctx.at);
    if (!next.ok) return next;
    await ctx.tx.envelopes.save(next.value);
    await trail(ctx, env.id, signerId, 'code_sent');
    const signer = next.value.signers.find((s) => s.id === signerId);
    if (signer?.email == null) return err(failure('NO_CODE', 'This signer signs in'));
    ctx.mail.push({
      tenantId: ctx.caller.tenantId,
      email: signer.email,
      url: `${origin.origin.replace(/\/$/u, '')}/sign/${token}`,
      companyName: origin.companyName,
      dedupeKey: `code:${env.id}:${signerId}:${ctx.at}`,
      notice: { kind: 'signing_code', code },
    });
    // Where it went, partly hidden: the page says "•••• 4417"-style.
    const [user, domain] = signer.email.split('@');
    return ok({ sentTo: `${(user ?? '').slice(0, 1)}•••@${domain ?? ''}` });
  });
}

export function verifyCode(
  deps: Deps,
  token: string,
  code: string,
): Promise<Result<{ verified: boolean }>> {
  return byLink(deps, token, async (ctx, env, signerId) => {
    const checked = checkCode(env, signerId, hash(`${env.id}:${signerId}:${code.trim()}`), ctx.at);
    if (!checked.ok) return checked;
    await ctx.tx.envelopes.save(checked.value.envelope);
    if (checked.value.matched)
      await trail(ctx, env.id, signerId, 'verified', { check: 'email_code' });
    return ok({ verified: checked.value.matched });
  });
}

export function signByLink(
  deps: Deps,
  token: string,
  input: SignInput & Origin,
): Promise<Result<Signed>> {
  const tenant = tenantOfToken(token);
  if (tenant === null)
    return Promise.resolve(err(failure('NOT_FOUND', 'This link does not open anything')));
  return withSeal(deps, tenant as TenantId, input, () =>
    byLink(deps, token, async (ctx, env, signerId) => {
      const done = await signIn(ctx, env, signerId, input, input);
      return done.ok ? ok({ envelope: done.value, signerId, link: token }) : done;
    }),
  );
}

export function declineByLink(
  deps: Deps,
  token: string,
  reason: string,
): Promise<Result<{ id: string }>> {
  return byLink(deps, token, (ctx, env, signerId) => declineIn(ctx, env, signerId, reason));
}

async function declineIn(
  ctx: Ctx,
  env: Envelope,
  signerId: string,
  reason: string,
): Promise<Result<{ id: string }>> {
  const next = decline(env, signerId, reason, ctx.at);
  if (!next.ok) return next;
  await ctx.tx.envelopes.save(next.value);
  await trail(ctx, env.id, signerId, 'declined');
  await ctx.tx.outbox.publish([
    event(
      ctx,
      'documents.envelope.declined',
      { type: 'Envelope', id: env.id },
      {
        envelopeId: env.id,
        signerId,
        reason: reason.trim().slice(0, 1000),
      },
    ),
  ]);
  return ok({ id: env.id });
}

/* ------------------------------------------- a member's other answers (K7) -- */

export function declineAsMember(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
  reason: string,
): Promise<Result<{ id: string }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const found = await asMember(ctx, envelopeId);
    if (!found.ok) return found;
    if (found.value.signer === null) return err(failure('NOT_FOUND', 'No such request'));
    return declineIn(ctx, found.value.env, found.value.signer.id, reason);
  });
}

/** A question for the sender: the request waits; the sender sees it on its trail and in the Inbox. */
export function askSender(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
  question: string,
): Promise<Result<{ id: string }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const found = await asMember(ctx, envelopeId);
    if (!found.ok) return found;
    const { env, signer } = found.value;
    if (signer === null || env.status !== 'sent')
      return err(failure('NOT_FOUND', 'No such request'));
    const text = question.trim();
    if (text.length === 0 || text.length > 1000)
      return err(failure('QUESTION', 'Ask in up to 1,000 characters', ['question']));
    await trail(ctx, env.id, signer.id, 'asked', { question: text });
    return ok({ id: env.id });
  });
}

/* ------------------------------------------------- the sender's (K8, K10) -- */

async function asFollower(ctx: Ctx, envelopeId: string): Promise<Result<Envelope>> {
  const env = await ctx.tx.envelopes.get(envelopeId);
  if (env === null || !(await follows(ctx, env)))
    return err(failure('NOT_FOUND', 'No such request'));
  return ok(env);
}

export function voidRequest(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
  reason: string,
): Promise<Result<{ id: string }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const env = await asFollower(ctx, envelopeId);
    if (!env.ok) return env;
    const next = voidEnvelope(env.value, reason, ctx.at);
    if (!next.ok) return next;
    await tx.envelopes.save(next.value);
    await trail(ctx, envelopeId, null, 'voided', { reason: reason.trim().slice(0, 200) });
    await tx.outbox.publish([
      event(
        ctx,
        'documents.envelope.voided',
        { type: 'Envelope', id: envelopeId },
        {
          envelopeId,
          reason: reason.trim().slice(0, 1000),
        },
      ),
    ]);
    return ok({ id: envelopeId });
  });
}

/**
 * A reminder (K8): an email to whoever's turn it is, and nobody else. Five
 * signing one after another, the third's turn: only the third hears. Somebody
 * outside gets a fresh link, which replaces the one they had: their first is
 * kept only as a hash, so it cannot be sent again.
 */
export async function remindSigners(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
  origin: Origin | null = null,
): Promise<Result<{ id: string; reminded: readonly string[] }>> {
  const mail: Mail[] = [];
  const base = origin?.origin.replace(/\/$/u, '') ?? null;
  const done = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller, mail);
    const env = await asFollower(ctx, envelopeId);
    if (!env.ok) return env;
    if (env.value.status !== 'sent')
      return err(failure('CLOSED', `This request is ${env.value.status}`));
    const turn = onTurn(env.value);
    let signers = env.value.signers;
    for (const s of turn) {
      if (base === null || origin === null) break;
      let email = s.email;
      let url = `${base}/documents/envelopes/${envelopeId}`;
      if (s.personId !== null) {
        // oxlint-disable-next-line no-await-in-loop -- a request's few signers, in one transaction
        email = (await tx.members.get(s.personId))?.workEmail ?? null;
      } else {
        const token = newToken(caller.tenantId);
        signers = signers.map((x) => (x.id === s.id ? { ...x, tokenHash: hash(token) } : x));
        url = `${base}/sign/${token}`;
      }
      if (email === null) continue;
      mail.push({
        tenantId: caller.tenantId,
        email,
        url,
        companyName: origin.companyName,
        dedupeKey: `remind:${envelopeId}:${s.id}:${ctx.at}`,
        notice: { kind: 'signature_reminder' },
      });
    }
    if (signers !== env.value.signers) await tx.envelopes.save({ ...env.value, signers });
    await trail(ctx, envelopeId, null, 'reminded', { to: turn.map((s) => s.name) });
    return ok({ id: envelopeId, reminded: turn.map((s) => s.name) });
  });
  if (done.ok) await deliver(deps, mail);
  return done;
}

export function reassignSigner(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
  input: { signerId: string; personId: PersonId },
): Promise<Result<{ id: string }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const env = await asFollower(ctx, envelopeId);
    if (!env.ok) return env;
    const member = await tx.members.get(input.personId);
    if (member === null) return err(failure('NO_SUCH_PERSON', 'Nobody by that id works here'));
    const next = reassign(
      env.value,
      input.signerId,
      { personId: member.personId, email: null, name: member.displayName },
      hash(newToken(caller.tenantId)),
    );
    if (!next.ok) return next;
    await tx.envelopes.save(next.value);
    await trail(ctx, envelopeId, input.signerId, 'reassigned', { to: member.displayName });
    return ok({ id: envelopeId });
  });
}

export function sealAgain(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
  company: string,
): Promise<Result<{ version: number }>> {
  return deps.uow
    .run(caller.tenantId, async (tx) => {
      const ctx = await contextOf(deps, tx, caller);
      return asFollower(ctx, envelopeId);
    })
    .then((env) => (env.ok ? sealEnvelope(deps, caller.tenantId, envelopeId, company) : env));
}

export type { Tx };
