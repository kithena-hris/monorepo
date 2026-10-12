import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DocumentId } from '@kithena/contracts';

import { canOpen } from '../domain/access/access.js';
import {
  audienceOf,
  checkAudience,
  progressOf,
  type Audience,
} from '../domain/acknowledge/campaign.js';
import { contextOf, event, factsOf, hrOnly, load, notFound, record } from './context.js';
import type { Caller, Deps } from './ports.js';

/**
 * Policies and acknowledgements (PRD §11, F2, F3, DOC-048): HR sends a
 * document to an audience; each person's acknowledgement is recorded against
 * the version they read. Whoever joins later is asked too.
 */

export function sendForAcknowledgement(
  deps: Deps,
  caller: Caller,
  input: {
    readonly documentId: DocumentId;
    readonly audience: Audience;
    readonly dueOn: CalendarDate | null;
  },
): Promise<Result<{ id: string }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const found = await load(ctx, input.documentId);
    if (!found.ok || found.value.doc.deletedAt !== null) return err(notFound());
    const audience = checkAudience(input.audience);
    if (!audience.ok) return audience;
    const members = await tx.members.list();
    const asked = audienceOf(audience.value, members);
    if (asked.length === 0) return err(failure('AUDIENCE', 'Nobody works there yet', ['audience']));
    // Everyone asked must be able to open it: a policy is shared with them as it is sent.
    const { doc } = found.value;
    const others = doc.grants.filter((g) => g.grantee.kind !== 'everyone');
    const reach =
      audience.value.kind === 'everyone'
        ? [{ grantee: { kind: 'everyone' as const }, permission: 'view' as const, endsOn: null }]
        : audience.value.kind === 'teams'
          ? audience.value.teamKeys.map((teamKey) => ({
              grantee: { kind: 'team' as const, teamKey },
              permission: 'view' as const,
              endsOn: null,
            }))
          : asked.map((personId) => ({
              grantee: { kind: 'member' as const, personId },
              permission: 'view' as const,
              endsOn: null,
            }));
    const keys = new Set(others.map((g) => JSON.stringify(g.grantee)));
    await tx.documents.save({
      ...doc,
      level: 'shared',
      grants: [...others, ...reach.filter((g) => !keys.has(JSON.stringify(g.grantee)))],
    });
    const id = deps.newId();
    await tx.campaigns.save({
      id,
      documentId: doc.id,
      version: doc.currentVersion,
      audience: audience.value,
      dueOn: input.dueOn,
      sentBy: caller.accountId,
      createdAt: ctx.at,
      closedAt: null,
    });
    await tx.outbox.publish([
      event(
        ctx,
        'documents.acknowledgement.sent',
        { type: 'Campaign', id },
        {
          campaignId: id,
          documentId: doc.id,
          version: doc.currentVersion,
          audience: asked.length,
          dueOn: input.dueOn,
        },
      ),
    ]);
    await record(ctx, 'sent_for_acknowledgement', doc.id, { campaignId: id });
    return ok({ id });
  });
}

export function acknowledge(
  deps: Deps,
  caller: Caller,
  campaignId: string,
): Promise<Result<{ id: string }>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    if (ctx.viewer.personId === null)
      return err(failure('NOT_A_MEMBER', 'Only people who work here acknowledge'));
    const campaign = await tx.campaigns.get(campaignId);
    if (campaign === null || campaign.closedAt !== null)
      return err(failure('NOT_FOUND', 'No such policy to acknowledge'));
    const asked = audienceOf(campaign.audience, await tx.members.list());
    if (!asked.includes(ctx.viewer.personId))
      return err(failure('NOT_ASKED', 'You were not asked to acknowledge this'));
    const found = await load(ctx, campaign.documentId);
    if (!found.ok || !canOpen(factsOf(found.value.doc, found.value.type), ctx.viewer, ctx.today))
      return err(notFound());
    await tx.campaigns.acknowledge(campaignId, ctx.viewer.personId, ctx.at);
    await tx.outbox.publish([
      event(
        ctx,
        'documents.acknowledgement.acknowledged',
        { type: 'Campaign', id: campaignId },
        {
          campaignId,
          documentId: campaign.documentId,
          personId: ctx.viewer.personId,
        },
      ),
    ]);
    return ok({ id: campaignId });
  });
}

/** Who has acknowledged, who is left (F3); HR's. */
export function campaignScreen(
  deps: Deps,
  caller: Caller,
  campaignId: string,
): Promise<
  Result<{
    id: string;
    documentId: string;
    title: string;
    version: number;
    dueOn: string | null;
    sentAt: string;
    done: number;
    of: number;
    left: { personId: string; name: string; teamName: string | null }[];
  }>
> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const campaign = await tx.campaigns.get(campaignId);
    if (campaign === null) return err(failure('NOT_FOUND', 'No such policy campaign'));
    const found = await load(ctx, campaign.documentId);
    if (!found.ok) return found;
    const members = await tx.members.list();
    const asked = audienceOf(campaign.audience, members);
    const done = await tx.campaigns.acknowledged(campaignId);
    const p = progressOf(asked, done);
    const byId = new Map(members.map((m) => [m.personId as string, m]));
    return ok({
      id: campaign.id,
      documentId: campaign.documentId,
      title: found.value.doc.title,
      version: campaign.version,
      dueOn: campaign.dueOn,
      sentAt: campaign.createdAt,
      done: p.done,
      of: p.of,
      left: p.left.map((personId) => ({
        personId,
        name: byId.get(personId)?.displayName ?? 'Someone',
        teamName: byId.get(personId)?.teamName ?? null,
      })),
    });
  });
}
