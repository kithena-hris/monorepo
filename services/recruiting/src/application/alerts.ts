import { randomBytes } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { normalEmail } from '../domain/candidate/duplicates.js';
import { addDays } from '../domain/dates.js';
import type { Ctx } from './context.js';
import { publicJob, sha256 } from './intake.js';
import { generalSettings } from './setup.js';

/**
 * J11, job alerts (PRD §10, "Email me jobs like this"): a search saved
 * against an address, sent only after the address confirms it (double
 * opt-in), as a daily or weekly digest, with an unsubscribe link in every
 * email. One company's jobs: a company's careers page and its job pages.
 *
 * ponytail: every alert of a company is one settings value, read whole. A
 * table when a company has thousands of subscribers; alerts across companies,
 * from the search page, need a store outside a tenant's rows.
 */

export interface JobAlert {
  readonly id: string;
  readonly email: string;
  readonly query: string;
  readonly frequency: 'daily' | 'weekly';
  /** The confirmation link's token, hashed; it is used once. */
  readonly confirmHash: string;
  /**
   * The unsubscribe link's token, kept as is so every digest carries the same
   * working link. It can end this alert and do nothing else.
   */
  readonly stopToken: string;
  readonly confirmedAt: string | null;
  readonly lastSentOn: string | null;
  readonly createdAt: string;
}

const KEY = 'job_alerts';
const PER_ADDRESS = 5;
const PER_COMPANY = 5_000;

async function alerts(ctx: Ctx): Promise<JobAlert[]> {
  return [...(((await ctx.tx.settings.get(KEY)) as JobAlert[] | null) ?? [])];
}

const link = async (ctx: Ctx, action: 'confirm' | 'stop', token: string) =>
  `${ctx.deps.jobsOrigin}/alerts/${(await generalSettings(ctx)).companySlug}#${action}.${token}`;

/** The same answer whether or not anything was saved, so an address cannot be probed. */
export async function subscribeAlert(
  ctx: Ctx,
  input: { readonly email: string; readonly query: string; readonly frequency: 'daily' | 'weekly' },
): Promise<Result<{ sent: true }>> {
  const list = await alerts(ctx);
  const mine = list.filter((a) => normalEmail(a.email) === normalEmail(input.email));
  if (mine.length >= PER_ADDRESS || list.length >= PER_COMPANY) return ok({ sent: true });
  const token = randomBytes(24).toString('base64url');
  const alert: JobAlert = {
    id: ctx.deps.newId(),
    email: input.email,
    query: input.query.trim().slice(0, 120),
    frequency: input.frequency,
    confirmHash: sha256(token),
    stopToken: randomBytes(24).toString('base64url'),
    confirmedAt: null,
    lastSentOn: null,
    createdAt: ctx.at,
  };
  await ctx.tx.settings.set(KEY, [...list, alert]);
  const company = (await generalSettings(ctx)).companyName;
  ctx.mail.push({
    to: input.email,
    subject: `Confirm your job alert for ${company}`,
    text: `Hello,\n\nSomeone asked for ${alert.frequency} emails about ${alert.query === '' ? 'new jobs' : `jobs matching “${alert.query}”`} at ${company}. To start them, confirm here:\n${await link(ctx, 'confirm', token)}\n\nIf it was not you, ignore this email and nothing is sent.`,
    dedupeKey: `alert-confirm:${alert.id}`,
  });
  return ok({ sent: true });
}

export async function confirmAlert(ctx: Ctx, token: string): Promise<Result<true>> {
  const list = await alerts(ctx);
  const index = list.findIndex((a) => a.confirmHash === sha256(token));
  const alert = list[index];
  if (alert === undefined) return err(failure('NOT_FOUND', 'This link has expired'));
  if (alert.confirmedAt === null) {
    list[index] = { ...alert, confirmedAt: ctx.at, lastSentOn: ctx.today };
    await ctx.tx.settings.set(KEY, list);
  }
  return ok(true);
}

/** One click, no sign-in: the link in every email ends the alert. */
export async function stopAlert(ctx: Ctx, token: string): Promise<Result<true>> {
  const list = await alerts(ctx);
  const kept = list.filter((a) => a.stopToken !== token);
  if (kept.length !== list.length) await ctx.tx.settings.set(KEY, kept);
  return ok(true);
}

/**
 * The daily job's part: each confirmed alert that is due gets the public jobs
 * opened since it was last sent, if any match.
 */
export async function sendAlertDigests(ctx: Ctx): Promise<number> {
  const list = await alerts(ctx);
  if (list.length === 0) return 0;
  const company = (await generalSettings(ctx)).companyName;
  const jobs = [];
  for (const job of await ctx.tx.jobs.list())
    if (job.openedAt !== null && (await publicJob(ctx, job.slug)) !== null) jobs.push(job);
  let sent = 0;
  const next: JobAlert[] = [];
  for (const alert of list) {
    const due =
      alert.confirmedAt !== null &&
      (alert.lastSentOn === null ||
        addDays(alert.lastSentOn as typeof ctx.today, alert.frequency === 'daily' ? 1 : 7) <=
          ctx.today);
    if (!due) {
      next.push(alert);
      continue;
    }
    const since = alert.lastSentOn ?? alert.createdAt.slice(0, 10);
    const words = alert.query.toLowerCase().split(/\s+/u).filter(Boolean);
    const matches = jobs.filter(
      (j) =>
        (j.openedAt ?? '').slice(0, 10) >= since &&
        words.every((w) => j.title.toLowerCase().includes(w)),
    );
    if (matches.length === 0) {
      next.push(alert);
      continue;
    }
    const settings = await generalSettings(ctx);
    ctx.mail.push({
      to: alert.email,
      subject: `${String(matches.length)} new job${matches.length === 1 ? '' : 's'} at ${company}`,
      text: `${matches
        .map((j) => `${j.title}\n${ctx.deps.jobsOrigin}/${settings.companySlug}/${j.slug}`)
        .join(
          '\n\n',
        )}\n\nYou get this because you asked for it. To stop, one click:\n${await link(ctx, 'stop', alert.stopToken)}`,
      dedupeKey: `alert:${alert.id}:${ctx.today}`,
    });
    next.push({ ...alert, lastSentOn: ctx.today });
    sent += 1;
  }
  await ctx.tx.settings.set(KEY, next);
  return sent;
}
