import { err, failure, ok, type Result } from '@kithena/domain-kit';

import {
  approvalState,
  chainFor,
  decide,
  edit,
  mayDecide,
  resolveSteps,
  submit,
  validRequisition,
  type ApprovalChain,
  type ChainFacts,
  type Reporting,
  type Requisition,
} from '../domain/requisition/requisition.js';
import { asPerson, event, forbidden, notFound, publish, type Ctx } from './context.js';
import type { Approval } from './ports.js';

/**
 * Requisitions and their approvals (PRD §7, REC-045). Any member may draft a
 * requisition for their team; a hiring manager or an administrator submits
 * it; each approver of the step waiting gets an Inbox task.
 */

export async function reportingOf(ctx: Ctx): Promise<Reporting> {
  const members = await ctx.tx.members.list();
  const admins = await ctx.tx.admins.list();
  const finance = ((await ctx.tx.settings.get('finance_people')) as string[] | null) ?? [];
  const adminPeople = members
    .filter((m) => m.accountId !== null && admins.includes(m.accountId))
    .map((m) => m.personId as string);
  return {
    managerOf: (personId) => members.find((m) => m.personId === personId)?.managerPersonId ?? null,
    holdersOf: (role) => (role === 'finance' ? finance : adminPeople),
  };
}

const factsOf = (r: Requisition): ChainFacts => ({
  budgetToMinor: r.budget?.to.amountMinor ?? null,
  reason: r.reason,
  legalEntityId: r.legalEntityId,
  outsideBand: false,
  aboveBudget: false,
  grade: null,
});

const mayEdit = (ctx: Ctx, r: Requisition): boolean =>
  ctx.viewer.admin || (ctx.viewer.personId !== null && r.hiringManagerId === ctx.viewer.personId);

export async function saveRequisition(ctx: Ctx, input: Requisition): Promise<Result<Requisition>> {
  const person = asPerson(ctx);
  if (!person.ok && !ctx.viewer.admin) return person;
  const held = await ctx.tx.requisitions.get(input.id);
  if (held === null) {
    const draft: Requisition = {
      ...input,
      state: 'draft',
      filled: 0,
      approved: null,
      hiringManagerId: input.hiringManagerId ?? ctx.viewer.personId,
    };
    const valid = validRequisition(draft);
    if (!valid.ok) return valid;
    await ctx.tx.requisitions.save(draft);
    return ok(draft);
  }
  if (!mayEdit(ctx, held)) return err(forbidden());
  const changed = edit(held, {
    ...input,
    state: held.state,
    filled: held.filled,
    approved: held.approved,
  });
  if (!changed.ok) return changed;
  await ctx.tx.requisitions.save(changed.value.requisition);
  if (changed.value.changes.length > 0)
    await openApproval(ctx, changed.value.requisition, changed.value.changes);
  return ok(changed.value.requisition);
}

async function openApproval(
  ctx: Ctx,
  r: Requisition,
  changes: Approval['changes'],
): Promise<Result<Requisition>> {
  const chains = (await ctx.tx.chains.list()) as ApprovalChain[];
  const chain = chainFor(chains, 'requisition', factsOf(r));
  const previous = await ctx.tx.approvals.open('requisition', r.id);
  if (previous !== null) await ctx.tx.approvals.save({ ...previous, outcome: 'superseded' });
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.requisition.submitted',
      { type: 'Requisition', id: r.id },
      {
        requisitionId: r.id,
        openings: r.openings,
        orgUnitId: r.orgUnitId,
        legalEntityId: r.legalEntityId,
        budgetFrom: r.budget?.from ?? null,
        budgetTo: r.budget?.to ?? null,
      },
    ),
  );
  if (chain === null) {
    // No chain applies: approved as it is sent (PRD §7.2).
    const decided = decide(r, 'approved');
    if (!decided.ok) return decided;
    await ctx.tx.requisitions.save(decided.value);
    await publish(
      ctx,
      event(
        ctx,
        'recruiting.requisition.decided',
        { type: 'Requisition', id: r.id },
        {
          requisitionId: r.id,
          decision: 'approved',
          by: ctx.caller.personId ?? ctx.caller.accountId,
        },
      ),
    );
    return ok(decided.value);
  }
  const steps = resolveSteps(chain, r.hiringManagerId, await reportingOf(ctx));
  if (!steps.ok) return steps;
  await ctx.tx.approvals.save({
    id: ctx.deps.newId(),
    subject: { kind: 'requisition', id: r.id, version: 1 },
    chainId: chain.id,
    steps: steps.value,
    decisions: [],
    outcome: 'pending',
    changes,
    createdAt: ctx.at,
  });
  return ok(r);
}

export async function submitRequisition(ctx: Ctx, id: string): Promise<Result<Requisition>> {
  const held = await ctx.tx.requisitions.get(id);
  if (held === null) return err(notFound('requisition'));
  if (!mayEdit(ctx, held)) return err(forbidden());
  const submitted = submit(held);
  if (!submitted.ok) return submitted;
  await ctx.tx.requisitions.save(submitted.value);
  return openApproval(ctx, submitted.value, []);
}

export async function decideRequisition(
  ctx: Ctx,
  id: string,
  decision: 'approved' | 'rejected',
  comment: string | null,
): Promise<Result<Requisition>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const held = await ctx.tx.requisitions.get(id);
  const approval = await ctx.tx.approvals.open('requisition', id);
  if (held === null || approval === null) return err(notFound('approval'));
  if (!mayDecide(approval.steps, approval.decisions, person.value))
    return err(forbidden('This approval is not waiting on you'));
  if (decision === 'rejected' && (comment ?? '').trim() === '')
    return err(failure('REASON_REQUIRED', 'Say why you are rejecting it'));
  const step = approvalState(approval.steps, approval.decisions).step;
  const decisions = [...approval.decisions, { step, by: person.value, decision }];
  const outcome = approvalState(approval.steps, decisions).outcome;
  await ctx.tx.approvals.save({ ...approval, decisions, outcome });
  if (outcome === 'pending') return ok(held);
  const decided = decide(held, outcome);
  if (!decided.ok) return decided;
  await ctx.tx.requisitions.save(decided.value);
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.requisition.decided',
      { type: 'Requisition', id },
      { requisitionId: id, decision: outcome, by: person.value },
    ),
  );
  return ok(decided.value);
}

export async function cancelRequisition(ctx: Ctx, id: string): Promise<Result<Requisition>> {
  const held = await ctx.tx.requisitions.get(id);
  if (held === null) return err(notFound('requisition'));
  if (!mayEdit(ctx, held)) return err(forbidden());
  if (held.state === 'filled' || held.state === 'cancelled')
    return err(failure('CLOSED', `Already ${held.state}`));
  const cancelled: Requisition = { ...held, state: 'cancelled' };
  await ctx.tx.requisitions.save(cancelled);
  const approval = await ctx.tx.approvals.open('requisition', id);
  if (approval !== null) await ctx.tx.approvals.save({ ...approval, outcome: 'superseded' });
  return ok(cancelled);
}

/** The requisitions a viewer may see: an administrator all; others their own. */
export async function listRequisitions(ctx: Ctx): Promise<readonly Requisition[]> {
  const all = await ctx.tx.requisitions.list();
  if (ctx.viewer.admin) return all;
  const waiting = new Set(
    (await ctx.tx.approvals.waitingOn(ctx.viewer.personId ?? ''))
      .filter((a) => a.subject.kind === 'requisition')
      .map((a) => a.subject.id),
  );
  return all.filter((r) => r.hiringManagerId === ctx.viewer.personId || waiting.has(r.id));
}
