import { randomBytes } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { asPerson, type Ctx } from './context.js';
import { sha256 } from './intake.js';
import type {
  CalendarEvent,
  CalendarSession,
  Connection,
  ConnectionKind,
  InterviewRecord,
  VideoSession,
} from './ports.js';
import { generalSettings } from './setup.js';

/**
 * A member's own calendar and video (PRD §26.2, REC-135): connected by OAuth,
 * each grant sealed and bound to the member. Scheduling then takes busy times
 * from the calendar and puts the interview on it, with a Zoom link when the
 * member has Zoom, else Meet or Teams; without either, working hours and an
 * `.ics` as before. A provider that does not answer never stops a booking:
 * Recruiting's own record is the truth either way.
 *
 * ponytail: the providers are called inside the booking's transaction; move
 * them to the outbox if one is ever slow enough to hold a lock that matters.
 */

const notOffered = () => err(failure('NO_PROVIDER', 'That cannot be connected here yet'));
const bound = (personId: string) => `connection:${personId}`;
const isCalendar = (kind: ConnectionKind) => kind === 'google' || kind === 'microsoft';
/** Where the tenant app may send the member back to: its own host, or a local one. */
const RETURN =
  /^(?:https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.kithena\.com|http:\/\/localhost(?::\d+)?)\//u;

interface Pending {
  readonly personId: string;
  readonly kind: ConnectionKind;
  readonly returnTo: string;
  readonly expiresAt: string;
}

const provider = (ctx: Ctx, kind: ConnectionKind): Connection | undefined =>
  ctx.deps.connections?.find((c) => c.kind === kind);

/** What the working-hours card shows: what is connected, and what could be. */
export async function myConnections(
  ctx: Ctx,
): Promise<{ connected: readonly ConnectionKind[]; offered: readonly ConnectionKind[] }> {
  const offered = (ctx.deps.connections ?? []).map((c) => c.kind);
  const person = ctx.viewer.personId;
  const links =
    person === null || offered.length === 0 ? [] : await ctx.tx.connections.list(person);
  return { connected: links.map((l) => l.kind), offered };
}

/** The provider's consent page, with a state that names the company and expires in ten minutes. */
export async function connect(
  ctx: Ctx,
  kind: ConnectionKind,
  returnTo: string,
): Promise<Result<{ url: string }>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const chosen = provider(ctx, kind);
  if (chosen === undefined || ctx.deps.sealer === undefined) return notOffered();
  if (!RETURN.test(returnTo)) return err(failure('INVALID', 'Not a page to come back to'));
  const token = randomBytes(24).toString('base64url');
  const pending: Pending = {
    personId: person.value,
    kind,
    returnTo,
    expiresAt: new Date(Date.parse(ctx.at) + 10 * 60_000).toISOString(),
  };
  await ctx.tx.settings.set(`connect-state:${sha256(token)}`, pending);
  // The redirect address is fixed, so the company travels in the state.
  const company = (await generalSettings(ctx)).companySlug;
  return ok({ url: chosen.consentUrl(`${company}.${token}`) });
}

/** The provider sent the member back with a code: redeem it, seal the grant, and say where to go. */
export async function receiveGrant(
  ctx: Ctx,
  state: string,
  code: string | null,
): Promise<Result<{ returnTo: string }>> {
  const key = `connect-state:${sha256(state.slice(state.indexOf('.') + 1))}`;
  const pending = (await ctx.tx.settings.get(key)) as Pending | null;
  if (pending === null || pending.expiresAt < ctx.at)
    return err(failure('NOT_FOUND', 'That link has expired; connect again'));
  await ctx.tx.settings.set(key, null);
  // Declined on the consent page: back where they were, nothing connected.
  if (code === null) return ok({ returnTo: pending.returnTo });
  const chosen = provider(ctx, pending.kind);
  const sealer = ctx.deps.sealer;
  if (chosen === undefined || sealer === undefined) return notOffered();
  const grant = await chosen.redeem(code);
  if (!grant.ok) return grant;
  // One calendar a member: Google replaces Microsoft and the other way round.
  if (isCalendar(pending.kind))
    for (const other of ['google', 'microsoft'] as const)
      if (other !== pending.kind) await ctx.tx.connections.remove(pending.personId, other);
  await ctx.tx.connections.save(
    pending.personId,
    pending.kind,
    sealer.seal(new TextEncoder().encode(grant.value), bound(pending.personId)),
  );
  return ok({ returnTo: pending.returnTo });
}

export async function disconnect(ctx: Ctx, kind: ConnectionKind): Promise<Result<null>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  await ctx.tx.connections.remove(person.value, kind);
  return ok(null);
}

/** A member's calendar or Zoom for this request; null when not connected or it does not open. */
async function sessionOf(
  ctx: Ctx,
  personId: string,
  want: 'calendar',
): Promise<CalendarSession | null>;
async function sessionOf(ctx: Ctx, personId: string, want: 'video'): Promise<VideoSession | null>;
async function sessionOf(
  ctx: Ctx,
  personId: string,
  want: 'calendar' | 'video',
): Promise<CalendarSession | VideoSession | null> {
  const sealer = ctx.deps.sealer;
  if (sealer === undefined || (ctx.deps.connections ?? []).length === 0) return null;
  const link = (await ctx.tx.connections.list(personId)).find(
    (l) => isCalendar(l.kind) === (want === 'calendar'),
  );
  const chosen = link === undefined ? undefined : provider(ctx, link.kind);
  if (link === undefined || chosen === undefined) return null;
  const opened = sealer.open(link.sealed, bound(personId));
  if (opened === null) return null;
  const grant = new TextDecoder().decode(opened);
  const session = await chosen.open(grant);
  if (!session.ok) return null;
  if (session.value.grant !== grant)
    await ctx.tx.connections.save(
      personId,
      link.kind,
      sealer.seal(new TextEncoder().encode(session.value.grant), bound(personId)),
    );
  return session.value;
}

/** Busy times from a member's calendar; none when it is not connected or does not answer. */
export async function calendarBusy(
  ctx: Ctx,
  personId: string,
  from: string,
  to: string,
): Promise<readonly (readonly [string, string])[]> {
  const busy = await (await sessionOf(ctx, personId, 'calendar'))?.busy(from, to);
  return busy?.ok === true ? busy.value : [];
}

interface Placed {
  readonly personId: string;
  readonly eventId: string | null;
  readonly meetingId: string | null;
}

/**
 * Puts a booked interview on the first interviewer's connected calendar, the
 * others invited, and answers its video link: their Zoom when they have it,
 * else the calendar's Meet or Teams. Only when neither a place nor a link was given.
 */
export async function putOnCalendar(
  ctx: Ctx,
  interview: InterviewRecord,
  event: Omit<CalendarEvent, 'attendees' | 'video' | 'location'>,
): Promise<string | null> {
  if ((ctx.deps.connections ?? []).length === 0) return null;
  const wantsVideo = interview.videoUrl === null && interview.place === null;
  for (const organiser of interview.interviewerIds) {
    const zoom = wantsVideo ? await sessionOf(ctx, organiser, 'video') : null;
    const calendar = await sessionOf(ctx, organiser, 'calendar');
    if (zoom === null && calendar === null) continue;
    const meeting = await zoom?.meeting(event);
    const zoomUrl = meeting?.ok === true ? meeting.value.url : null;
    const attendees: string[] = [];
    for (const id of interview.interviewerIds) {
      const email = id === organiser ? null : (await ctx.tx.members.get(id as never))?.workEmail;
      if (email) attendees.push(email);
    }
    const made = await calendar?.create({
      ...event,
      location: zoomUrl ?? interview.videoUrl ?? interview.place,
      attendees,
      video: wantsVideo && zoomUrl === null,
    });
    const placed: Placed = {
      personId: organiser,
      eventId: made?.ok === true ? made.value.eventId : null,
      meetingId: meeting?.ok === true ? meeting.value.meetingId : null,
    };
    if (placed.eventId !== null || placed.meetingId !== null)
      await ctx.tx.settings.set(`calendar-event:${interview.id}`, placed);
    return zoomUrl ?? (made?.ok === true ? made.value.videoUrl : null);
  }
  return null;
}

/** Takes a cancelled or moved interview off the calendar, and ends its Zoom meeting. */
export async function takeOffCalendar(ctx: Ctx, interviewId: string): Promise<void> {
  const key = `calendar-event:${interviewId}`;
  const placed = (await ctx.tx.settings.get(key)) as Placed | null;
  if (placed === null) return;
  if (placed.eventId !== null)
    await (await sessionOf(ctx, placed.personId, 'calendar'))?.cancel(placed.eventId);
  if (placed.meetingId !== null)
    await (await sessionOf(ctx, placed.personId, 'video'))?.end(placed.meetingId);
  await ctx.tx.settings.set(key, null);
}
