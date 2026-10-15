import { randomBytes } from 'node:crypto';
import { err, ok, type Result } from '@kithena/domain-kit';

import { notFound, type Ctx } from './context.js';
import type { Deps, UnitOfWork } from './ports.js';

type Tx = Parameters<Parameters<UnitOfWork['run']>[1]>[0];

/**
 * Two-way email (PRD §12.7): each candidate's thread has its own reply-to,
 * `<company>.<token>@<inbound domain>`, so a reply lands on that thread and
 * no other. The token is random and kept per tenant; null when replies are
 * not configured or the address would be too long, and the company's own
 * reply address is used instead.
 */
export async function replyAddress(
  deps: Pick<Deps, 'inbound'>,
  tx: Tx,
  company: string,
  candidateId: string,
): Promise<string | null> {
  if (deps.inbound === undefined || company === '') return null;
  let token = (await tx.settings.get(`reply:${candidateId}`)) as string | null;
  if (token === null) {
    token = randomBytes(10).toString('hex');
    await tx.settings.set(`reply:${candidateId}`, token);
    await tx.settings.set(`reply_token:${token}`, candidateId);
  }
  const local = `${company}.${token}`;
  return local.length > 64 ? null : `${local}@${deps.inbound.domain}`;
}

/** A reply, handed on by messaging; only from the address the thread was sent to. */
export async function receiveReply(
  ctx: Ctx,
  reply: {
    readonly token: string;
    readonly from: string;
    readonly subject: string;
    readonly text: string;
  },
): Promise<Result<true>> {
  const candidateId = (await ctx.tx.settings.get(`reply_token:${reply.token}`)) as string | null;
  const candidate = candidateId === null ? null : await ctx.tx.candidates.get(candidateId);
  if (
    candidate === null ||
    candidate.anonymisedAt !== null ||
    candidate.email.toLowerCase() !== reply.from.toLowerCase()
  )
    return err(notFound('thread'));
  await ctx.tx.messages.add({
    id: ctx.deps.newId(),
    candidateId: candidate.id,
    applicationId: null,
    direction: 'in',
    subject: reply.subject,
    body: reply.text,
    fromPerson: null,
    templateId: null,
    sendAt: ctx.at,
    sentAt: ctx.at,
    readAt: null,
    createdAt: ctx.at,
  });
  return ok(true);
}
