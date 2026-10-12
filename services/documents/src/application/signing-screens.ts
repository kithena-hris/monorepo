import { err, failure, ok, type Result } from '@kithena/domain-kit';
import * as z from 'zod';

import type { Envelope } from '../domain/signature/envelope.js';
import { contextOf, load, type Ctx } from './context.js';
import type { Caller, Deps, EnvelopeEvent } from './ports.js';
import { tenantOfToken } from './signatures.js';
import { createHash } from 'node:crypto';
import type { TenantId } from '@kithena/contracts';

/**
 * The signing screens' reads (K4–K10, MX1–MX6): a request as its signer sees
 * it, as its sender follows it, and every open one in a list. An outside
 * signer reaches the same view through their link.
 */

const Title = (title: string) => ({ title });

export const SignerView = z
  .object({
    id: z.string(),
    order: z.int(),
    name: z.string(),
    /** Shown to the sender only. */
    email: z.string().nullable(),
    check: z.enum(['login', 'email_code']),
    status: z.enum(['waiting', 'sent', 'opened', 'verified', 'signed', 'declined']),
    signedAt: z.string().nullable(),
    allowDelegate: z.boolean(),
  })
  .meta(Title('DocumentsSigner'));

export const FieldView = z
  .object({
    id: z.string(),
    signerId: z.string(),
    kind: z.enum(['signature', 'initials', 'date', 'name', 'title', 'checkbox', 'text']),
    page: z.int(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    required: z.boolean(),
    label: z.string().nullable(),
    value: z.string().nullable(),
  })
  .meta(Title('DocumentsField'));

export const EnvelopeView = z
  .object({
    id: z.string(),
    documentId: z.string(),
    title: z.string(),
    version: z.int(),
    pages: z.int(),
    status: z.enum(['sent', 'completed', 'declined', 'voided']),
    message: z.string(),
    dueOn: z.string().nullable(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
    signedVersion: z.int().nullable(),
    sender: z.string(),
    signers: z.array(SignerView),
    fields: z.array(FieldView),
    /** The signer this viewer is, when they sign it. */
    me: z.object({ signerId: z.string(), status: z.string(), turn: z.boolean() }).nullable(),
    /** Whether this viewer follows it: its sender, HR, or whoever controls the document. */
    follows: z.boolean(),
    trail: z.array(
      z.object({
        who: z.string(),
        action: z.string(),
        at: z.string(),
        note: z.string().nullable(),
      }),
    ),
    voidReason: z.string().nullable(),
  })
  .meta(Title('DocumentsEnvelope'));
export type EnvelopeView = z.infer<typeof EnvelopeView>;

export const EnvelopeRow = z
  .object({
    id: z.string(),
    documentId: z.string(),
    title: z.string(),
    status: z.enum(['sent', 'completed', 'declined', 'voided']),
    signed: z.int(),
    of: z.int(),
    waitingOn: z.string().nullable(),
    dueOn: z.string().nullable(),
    createdAt: z.string(),
    needsYou: z.boolean(),
  })
  .meta(Title('DocumentsEnvelopeRow'));

export const EnvelopesView = z
  .object({ rows: z.array(EnvelopeRow) })
  .meta(Title('DocumentsEnvelopes'));

function viewOf(
  env: Envelope,
  title: string,
  pages: number,
  sender: string,
  trail: readonly EnvelopeEvent[],
  me: string | null,
  follows: boolean,
): EnvelopeView {
  const mine = env.signers.find((s) => s.id === me);
  const name = (signerId: string | null) =>
    env.signers.find((s) => s.id === signerId)?.name ?? sender;
  return {
    id: env.id,
    documentId: env.documentId,
    title,
    version: env.version,
    pages,
    status: env.status,
    message: env.message,
    dueOn: env.dueOn,
    createdAt: env.createdAt,
    completedAt: env.completedAt,
    signedVersion: env.signedVersion,
    sender,
    signers: env.signers.map((s) => ({
      id: s.id,
      order: s.order,
      name: s.name,
      email: follows ? s.email : null,
      check: s.check,
      status: s.status,
      signedAt: s.signedAt,
      allowDelegate: s.allowDelegate,
    })),
    // Another signer's typed values are theirs until the file is sealed.
    fields: env.fields.map((f) => ({
      id: f.id,
      signerId: f.signerId,
      kind: f.kind,
      page: f.page,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      required: f.required,
      label: f.label,
      value: follows || f.signerId === me ? (f.value ?? null) : null,
    })),
    me:
      mine === undefined
        ? null
        : {
            signerId: mine.id,
            status: mine.status,
            turn:
              env.status === 'sent' &&
              mine.status !== 'waiting' &&
              mine.status !== 'signed' &&
              mine.status !== 'declined',
          },
    follows,
    trail: follows
      ? trail.map((t) => ({
          who: name(t.signerId),
          action: t.action,
          at: t.at,
          note:
            typeof t.detail['question'] === 'string'
              ? t.detail['question']
              : typeof t.detail['to'] === 'string'
                ? `to ${t.detail['to']}`
                : null,
        }))
      : [],
    voidReason: env.voidReason,
  };
}

async function described(
  ctx: Ctx,
  env: Envelope,
  me: string | null,
  follows: boolean,
): Promise<EnvelopeView> {
  const [found, version, members, trail] = await Promise.all([
    load(ctx, env.documentId),
    ctx.tx.versions.get(env.documentId, env.version),
    ctx.tx.members.list(),
    ctx.tx.envelopes.trail(env.id),
  ]);
  const sender = members.find((m) => m.accountId === env.senderAccount)?.displayName ?? 'HR';
  return viewOf(
    env,
    found.ok ? found.value.doc.title : 'A document',
    version?.pages ?? 1,
    sender,
    trail,
    me,
    follows,
  );
}

async function followsIt(ctx: Ctx, env: Envelope): Promise<boolean> {
  if (env.senderAccount === ctx.caller.accountId || ctx.viewer.hr) return true;
  const found = await load(ctx, env.documentId);
  if (!found.ok) return false;
  return found.value.doc.ownerAccount === ctx.caller.accountId;
}

export function envelopeScreen(
  deps: Deps,
  caller: Caller,
  envelopeId: string,
): Promise<Result<EnvelopeView>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const env = await tx.envelopes.get(envelopeId);
    if (env === null) return err(failure('NOT_FOUND', 'No such request'));
    const me =
      env.signers.find((s) => s.personId !== null && s.personId === ctx.viewer.personId)?.id ??
      null;
    const follows = await followsIt(ctx, env);
    if (me === null && !follows) return err(failure('NOT_FOUND', 'No such request'));
    return ok(await described(ctx, env, me, follows));
  });
}

/** K10: every request this person follows, open first, and those waiting for them. */
export function envelopesScreen(
  deps: Deps,
  caller: Caller,
): Promise<Result<z.infer<typeof EnvelopesView>>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const open = await tx.envelopes.open();
    const mine =
      ctx.viewer.personId === null ? [] : await tx.envelopes.forPerson(ctx.viewer.personId);
    const seen = new Map<string, Envelope>();
    for (const e of [...open, ...mine]) seen.set(e.id, e);
    const rows = [];
    for (const env of seen.values()) {
      const me = env.signers.find((s) => s.personId !== null && s.personId === ctx.viewer.personId);
      const follows = await followsIt(ctx, env);
      if (me === undefined && !follows) continue;
      const found = await load(ctx, env.documentId);
      const signed = env.signers.filter((s) => s.status === 'signed').length;
      const waiting = env.signers.find(
        (s) => s.status !== 'signed' && s.status !== 'waiting' && s.status !== 'declined',
      );
      rows.push({
        id: env.id,
        documentId: env.documentId,
        title: found.ok ? found.value.doc.title : 'A document',
        status: env.status,
        signed,
        of: env.signers.length,
        waitingOn: env.status === 'sent' ? (waiting?.name ?? null) : null,
        dueOn: env.dueOn,
        createdAt: env.createdAt,
        needsYou:
          me !== undefined &&
          env.status === 'sent' &&
          me.status !== 'waiting' &&
          me.status !== 'signed' &&
          me.status !== 'declined',
      });
    }
    rows.sort(
      (a, b) =>
        Number(b.needsYou) - Number(a.needsYou) ||
        (a.status === 'sent' ? -1 : 1) - (b.status === 'sent' ? -1 : 1) ||
        b.createdAt.localeCompare(a.createdAt),
    );
    return ok({ rows });
  });
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** K4 for somebody outside: the request their link opens, as its signer. */
export function linkScreen(deps: Deps, token: string): Promise<Result<EnvelopeView>> {
  const tenant = tenantOfToken(token);
  if (tenant === null)
    return Promise.resolve(err(failure('NOT_FOUND', 'This link does not open anything')));
  const tenantId = tenant as TenantId;
  const caller: Caller = {
    tenantId,
    accountId: 'signer',
    personId: null,
    correlationId: deps.newId(),
  };
  return deps.uow.run(tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const found = await tx.envelopes.byToken(hash(token));
    if (found === null) return err(failure('NOT_FOUND', 'This link does not open anything'));
    return ok(await described(ctx, found.envelope, found.signerId, false));
  });
}

/** The version being signed, for its signer or its followers, as a link that lasts minutes. */
export function envelopeFile(
  deps: Deps,
  caller: Caller | { token: string },
  envelopeId: string | null,
): Promise<Result<{ bytes: Uint8Array; fileName: string; mediaType: string }>> {
  const byToken = 'token' in caller;
  const tenant = byToken ? tenantOfToken(caller.token) : caller.tenantId;
  if (tenant === null)
    return Promise.resolve(err(failure('NOT_FOUND', 'This link does not open anything')));
  const as: Caller = byToken
    ? {
        tenantId: tenant as TenantId,
        accountId: 'signer',
        personId: null,
        correlationId: deps.newId(),
      }
    : caller;
  return deps.uow
    .run(as.tenantId, async (tx) => {
      const ctx = await contextOf(deps, tx, as);
      let env: Envelope | null;
      if (byToken) env = (await tx.envelopes.byToken(hash(caller.token)))?.envelope ?? null;
      else {
        env = envelopeId === null ? null : await tx.envelopes.get(envelopeId);
        const me =
          env?.signers.some((s) => s.personId !== null && s.personId === ctx.viewer.personId) ===
          true;
        if (env !== null && !me && !(await followsIt(ctx, env))) env = null;
      }
      if (env === null) return err(failure('NOT_FOUND', 'No such request'));
      const version = await tx.versions.get(env.documentId, env.signedVersion ?? env.version);
      return version === null ? err(failure('NOT_FOUND', 'No such version')) : ok(version);
    })
    .then(async (v) => {
      if (!v.ok) return v;
      const bytes = await deps.blobs.get(v.value.blobKey);
      return bytes === null
        ? err(failure('GONE', 'This file is no longer stored'))
        : ok({ bytes, fileName: v.value.fileName, mediaType: v.value.mediaType });
    });
}
