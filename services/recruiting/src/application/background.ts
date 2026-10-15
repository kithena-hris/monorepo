import type { TenantId } from '@kithena/contracts';

import { addDays } from '../domain/dates.js';
import { expireOffer } from '../domain/offer/offer.js';
import { contextOf, deliver, type Ctx, type Outgoing } from './context.js';
import { portalLink } from './intake.js';
import { sweepRetention } from './privacy.js';
import { replyAddress } from './replies.js';
import type { Deps } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * What runs on a clock (PRD §12.7, §13.2, §16.4, §24.2, REC-049 to REC-051,
 * REC-056): the thread's queued emails, expired offers, pool consents asking
 * for renewal, interview reminders and the retention sweep. Each tenant in
 * its own transaction, as the system.
 *
 * ponytail: timers in one process (`main.ts`); a BullMQ repeatable job each
 * when Recruiting runs twice.
 */

async function asSystem<T>(
  deps: Deps,
  tenantId: TenantId,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<{ value: T; mail: Outgoing[] }> {
  const mail: Outgoing[] = [];
  const value = await deps.uow.run(tenantId, async (tx) =>
    fn(
      await contextOf(
        deps,
        tx,
        { tenantId, accountId: 'system', personId: null, correlationId: deps.newId() },
        mail,
      ),
    ),
  );
  return { value, mail };
}

/** Send the thread's emails that are due; a failed one stays queued and is tried again. */
export async function sendDueMessages(deps: Deps): Promise<number> {
  if (deps.mailer === undefined) return 0;
  let sent = 0;
  for (const { tenantId } of await deps.uow.tenants()) {
    const due = await deps.uow.run(tenantId, async (tx) => {
      const messages = await tx.messages.due(deps.clock.instant());
      const settings = await generalSettings({ tx } as Ctx);
      const out = [];
      for (const m of messages) {
        const candidate = await tx.candidates.get(m.candidateId);
        if (candidate !== null && candidate.anonymisedAt === null)
          out.push({
            m,
            to: candidate.email,
            replyTo: await replyAddress(deps, tx, settings.companySlug, candidate.id),
          });
      }
      return { out, replyTo: settings.replyAddress };
    });
    for (const { m, to, replyTo } of due.out) {
      try {
        await deps.mailer.send({
          tenantId,
          to,
          subject: m.subject,
          text: m.body,
          replyTo: replyTo ?? due.replyTo,
          dedupeKey: `message:${m.id}`,
        });
        await deps.uow.run(tenantId, (tx) => tx.messages.markSent(m.id, deps.clock.instant()));
        sent += 1;
      } catch {
        // Kept unsent; the next run tries again.
      }
    }
  }
  return sent;
}

/** Daily: expire offers past their date, ask pool members to renew, remind tomorrow's candidates, sweep retention. */
export async function daily(
  deps: Deps,
): Promise<{ readonly expired: number; readonly renewals: number; readonly anonymised: number }> {
  let expired = 0;
  let renewals = 0;
  let anonymised = 0;
  for (const { tenantId } of await deps.uow.tenants()) {
    const run = await asSystem(deps, tenantId, async (ctx) => {
      for (const offer of await ctx.tx.offers.list()) {
        const next = expireOffer(offer, ctx.today);
        if (next !== offer) {
          await ctx.tx.offers.save(next);
          expired += 1;
        }
      }
      // Thirty days before a pool consent ends, the candidate is asked to renew (PRD §13.2).
      const settings = await generalSettings(ctx);
      const pools = await ctx.tx.pools.list();
      const seen = new Set<string>();
      for (const pool of pools) {
        for (const member of await ctx.tx.pools.members(pool.id)) {
          if (seen.has(member.candidateId)) continue;
          seen.add(member.candidateId);
          const consent = (await ctx.tx.consents.of(member.candidateId)).find(
            (c) => c.purpose === 'talent_pool' && c.withdrawnAt === null && c.expiresOn !== null,
          );
          const candidate = await ctx.tx.candidates.get(member.candidateId);
          if (consent?.expiresOn == null || candidate === null) continue;
          if (consent.expiresOn < ctx.today) {
            for (const m of await ctx.tx.pools.of(member.candidateId))
              await ctx.tx.pools.remove(m.poolId, member.candidateId);
          } else if (addDays(consent.expiresOn, -30) === ctx.today) {
            ctx.mail.push({
              to: candidate.email,
              subject: `Stay in ${settings.companyName}’s talent pool?`,
              text: `Hello ${candidate.name},\n\nYou agreed that ${settings.companyName} may keep your details for future roles until ${consent.expiresOn}. To stay, renew on your page; otherwise we remove you then:\n${await portalLink(ctx, candidate.id)}`,
              dedupeKey: `pool-renew:${candidate.id}:${consent.expiresOn}`,
            });
            renewals += 1;
          }
        }
      }
      // The day before, each candidate is reminded of their interview (PRD §16.4).
      const tomorrow = addDays(ctx.today, 1);
      for (const interview of await ctx.tx.interviews.startingBetween(
        `${tomorrow}T00:00:00.000Z` as never,
        `${addDays(tomorrow, 1)}T00:00:00.000Z` as never,
      )) {
        const app = await ctx.tx.applications.get(interview.applicationId);
        const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
        if (candidate === null) continue;
        ctx.mail.push({
          to: candidate.email,
          subject: `Tomorrow: ${interview.title} with ${settings.companyName}`,
          text: `Hello ${candidate.name},\n\nA reminder of your ${interview.title} tomorrow at ${interview.startsAt.slice(11, 16)} UTC${interview.videoUrl === null ? (interview.place === null ? '' : `, at ${interview.place}`) : `: ${interview.videoUrl}`}.\n\nTo reschedule, use your page:\n${await portalLink(ctx, candidate.id)}`,
          dedupeKey: `interview-reminder:${interview.id}`,
        });
      }
      return (await sweepRetention(ctx)).anonymised;
    });
    anonymised += run.value;
    await deliver(deps, tenantId, run.mail);
  }
  return { expired, renewals, anonymised };
}
