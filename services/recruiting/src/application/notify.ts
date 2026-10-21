import { ok, type Result } from '@kithena/domain-kit';

import { asPerson, type Ctx } from './context.js';

/**
 * Whether a member is emailed when a candidate acts (gives times, asks for a
 * change, answers a question). On until they switch it off: someone waiting
 * on a candidate's times should hear the moment they come, and the Inbox
 * task is there either way.
 *
 * ponytail: one setting per person in Recruiting; identity's notification
 * choices once Recruiting raises Inbox notices through messaging.
 */

const key = (personId: string): string => `notify-email:${personId}`;

export async function emailsOn(ctx: Ctx, personId: string): Promise<boolean> {
  return (await ctx.tx.settings.get(key(personId))) !== false;
}

export async function myNotifications(ctx: Ctx): Promise<Result<{ email: boolean }>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  return ok({ email: await emailsOn(ctx, person.value) });
}

export async function setMyNotifications(
  ctx: Ctx,
  email: boolean,
): Promise<Result<{ email: boolean }>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  await ctx.tx.settings.set(key(person.value), email);
  return ok({ email });
}

/** Email the members named who asked to hear, once each; the rest see it in their Inbox. */
export async function tellMembers(
  ctx: Ctx,
  personIds: readonly (string | null)[],
  subject: string,
  text: string,
  dedupe: string,
): Promise<void> {
  const sent = new Set<string>();
  for (const id of new Set(personIds)) {
    if (id === null || !(await emailsOn(ctx, id))) continue;
    const email = (await ctx.tx.members.get(id as never))?.workEmail;
    if (!email || sent.has(email)) continue;
    sent.add(email);
    ctx.mail.push({ to: email, subject, text, dedupeKey: `${dedupe}:${email}` });
  }
}
