import { ok, type Result } from '@kithena/domain-kit';
import type { InboxItem } from '@kithena/contracts';

import { canOpen, canShare } from '../domain/access/access.js';
import { contextOf, factsOf } from './context.js';
import type { Caller, Deps } from './ports.js';

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
      area: 'Documents',
      due: null,
      dueVerb: 'due' as const,
      status: null,
      outcome: null,
      count: null,
      team: null,
      replies: 0,
      openIn: 'Documents',
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
          title: `Add your ${types.get(r.typeKey)?.name ?? 'document'}`,
          summary: r.message === '' ? null : r.message.slice(0, 400),
          from: asker === undefined ? null : { name: asker.displayName, personId: asker.personId },
          at: r.createdAt,
          due: r.dueOn,
          link: `/documents/people/${caller.personId}`,
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
        title: `${who?.displayName ?? 'Someone'} asked to open ${doc.title.slice(0, 160)}`,
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
