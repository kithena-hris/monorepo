import { ok, type Result } from '@kithena/domain-kit';
import type { InboxItem } from '@kithena/contracts';

import { audienceOf } from '../domain/acknowledge/campaign.js';
import { canOpen, canShare } from '../domain/access/access.js';
import { contextOf, factsOf } from './context.js';
import type { Caller, Deps } from './ports.js';
import { t } from './reader-words.js';

/**
 * Documents in the Inbox (DOC-025, Inbox decision 1): no copy of anything,
 * read from Documents' own rows. A document HR asked this person for is a
 * task until their upload answers it; somebody asking to open a document this
 * person controls is a task until they decide.
 */
export async function documentsInbox(
  deps: Deps,
  caller: Caller,
): Promise<Result<{ items: InboxItem[] }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const items: InboxItem[] = [];
    const types = new Map((await tx.types.list()).map((t) => [t.key as string, t]));
    const members = await tx.members.list();
    const byAccount = new Map(
      members.flatMap((m) => (m.accountId === null ? [] : [[m.accountId, m] as const])),
    );
    const base = {
      module: 'documents',
      area: t('inbox.inbox.documents', 'Documents'),
      due: null,
      dueVerb: 'due' as const,
      status: null,
      outcome: null,
      count: null,
      team: null,
      replies: 0,
      openIn: t('inbox.inbox.documents', 'Documents'),
      detail: null,
    };

    if (caller.personId !== null) {
      for (const r of await tx.docRequests.forPerson(caller.personId)) {
        if (r.status !== 'open') continue;
        const asker = byAccount.get(r.createdBy);
        items.push({
          ...base,
          id: `documents:request:${r.id}`,
          lane: 'task',
          kind: 'documents.request',
          icon: 'upload',
          tone: 'accent',
          title: t('inbox.inbox.add_your', 'Add your {{name}}', {
            name: types.get(r.typeKey)?.name ?? t('inbox.inbox.document', 'document'),
          }),
          summary: r.message === '' ? null : r.message.slice(0, 400),
          from: asker === undefined ? null : { name: asker.displayName, personId: asker.personId },
          at: r.createdAt,
          due: r.dueOn,
          link: `/documents/people/${caller.personId}`,
          message: null,
        });
      }
    }

    if (caller.personId !== null) {
      for (const env of await tx.envelopes.forPerson(caller.personId)) {
        const me = env.signers.find((x) => x.personId === caller.personId);
        if (
          env.status !== 'sent' ||
          me === undefined ||
          ['waiting', 'signed', 'declined'].includes(me.status)
        )
          continue;
        const doc = await tx.documents.get(env.documentId);
        const sender = byAccount.get(env.senderAccount);
        items.push({
          ...base,
          id: `documents:sign:${env.id}`,
          lane: 'task',
          kind: 'documents.sign',
          icon: 'edit',
          tone: 'accent',
          title: t('inbox.inbox.sign', 'Sign {{value}}', {
            value: (doc?.title ?? t('inbox.inbox.a_document', 'a document')).slice(0, 200),
          }),
          summary: (() => {
            // Who signed before this person: their turn came because of them.
            const signed = env.signers.filter((x) => x.status === 'signed').map((x) => x.name);
            const turn =
              signed.length === 0
                ? null
                : t('inbox.inbox.signed_your_turn', '{{names}} signed. Your turn to sign.', {
                    names: signed.join(', '),
                  });
            return [turn, env.message === '' ? null : env.message]
              .filter((x) => x !== null)
              .join(' ')
              .slice(0, 400) || null;
          })(),
          from:
            sender === undefined ? null : { name: sender.displayName, personId: sender.personId },
          at: env.createdAt,
          due: env.dueOn,
          link: `/documents/envelopes/${env.id}`,
          message: null,
        });
      }
      const members = await tx.members.list();
      const acked = await tx.campaigns.mine(caller.personId);
      for (const c of await tx.campaigns.list()) {
        if (c.closedAt !== null || acked.has(c.id)) continue;
        if (!audienceOf(c.audience, members).includes(caller.personId)) continue;
        const doc = await tx.documents.get(c.documentId);
        if (doc === null || doc.deletedAt !== null) continue;
        items.push({
          ...base,
          id: `documents:acknowledge:${c.id}`,
          lane: 'task',
          kind: 'documents.acknowledge',
          icon: 'document',
          tone: 'info',
          title: t('inbox.inbox.read_and_acknowledge', 'Read and acknowledge {{value}}', {
            value: doc.title.slice(0, 200),
          }),
          summary: null,
          from: byAccount.has(c.sentBy)
            ? {
                name: byAccount.get(c.sentBy)?.displayName ?? null,
                personId: byAccount.get(c.sentBy)?.personId ?? null,
              }
            : null,
          at: c.createdAt,
          due: c.dueOn,
          link: `/documents/d/${doc.id}`,
          message: null,
        });
      }
    }
    for (const r of await tx.accessRequests.open()) {
      const doc = await tx.documents.get(r.documentId);
      if (doc === null || doc.deletedAt !== null) continue;
      const type = doc.typeKey === null ? null : (types.get(doc.typeKey) ?? null);
      const facts = factsOf(doc, type);
      if (!canOpen(facts, ctx.viewer, ctx.today) || !canShare(facts, ctx.viewer).ok) continue;
      const who = byAccount.get(r.requesterAccount);
      items.push({
        ...base,
        id: `documents:access:${r.id}`,
        lane: 'task',
        kind: 'documents.access',
        icon: 'locked',
        tone: 'warning',
        title: t('inbox.inbox.asked_to_open', '{{displayName}} asked to open {{value}}', {
          displayName: who?.displayName ?? t('inbox.inbox.someone', 'Someone'),
          value: doc.title.slice(0, 160),
        }),
        summary: r.reason.slice(0, 400),
        from: who === undefined ? null : { name: who.displayName, personId: who.personId },
        at: r.createdAt,
        link: `/documents/d/${doc.id}`,
        message: null,
      });
    }
    return ok({ items });
  });
}
