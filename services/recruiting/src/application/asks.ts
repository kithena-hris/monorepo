import type { Instant } from '@kithena/contracts';

import type { Ctx } from './context.js';

/**
 * What the team asks of a candidate and waits on (PRD §10.5, §16.4): times
 * proposed for an interview, a piece of information, and the other way, a
 * change to a booked time. Each lands on the candidate's page and in their
 * inbox the moment it is made, and the answer comes back to the team.
 *
 * ponytail: one JSON list per application under `settings`, read and written
 * whole; a table when asks are searched across applications.
 */
/** The agenda a recruiter writes: rich text for the page, plain for an email and a calendar. */
export interface Agenda {
  readonly html: string;
  readonly text: string;
}

export interface Ask {
  readonly id: string;
  readonly applicationId: string;
  readonly kind: 'slots' | 'info' | 'change' | 'availability';
  readonly createdAt: Instant;
  /** Who asked, when the team did; null when the candidate did. */
  readonly by: string | null;
  /** `slots`: the interview in the plan, the times offered, and where. */
  readonly planKey: string | null;
  readonly times: readonly Instant[];
  readonly place: string | null;
  readonly videoUrl: string | null;
  /** `slots`: what the interview is about, written for the invitation and the calendar event. */
  readonly agenda: Agenda | null;
  /** `info`: what is asked, in the candidate's words; `change`: the interview and the reason. */
  readonly label: string;
  readonly detail: string | null;
  readonly interviewId: string | null;
  readonly state: 'open' | 'answered' | 'closed';
  readonly answeredAt: Instant | null;
  /** The time chosen (`slots`), or what the candidate wrote. */
  readonly answer: { readonly time: Instant | null; readonly text: string | null } | null;
}

const key = (applicationId: string): string => `asks:${applicationId}`;

export async function asksOf(ctx: Ctx, applicationId: string): Promise<readonly Ask[]> {
  return ((await ctx.tx.settings.get(key(applicationId))) as Ask[] | null) ?? [];
}

export async function saveAsk(ctx: Ctx, ask: Ask): Promise<Ask> {
  const held = await asksOf(ctx, ask.applicationId);
  const next = held.some((a) => a.id === ask.id)
    ? held.map((a) => (a.id === ask.id ? ask : a))
    : [...held, ask];
  await ctx.tx.settings.set(key(ask.applicationId), next);
  return ask;
}

export function newAsk(
  ctx: Ctx,
  applicationId: string,
  input: Partial<Omit<Ask, 'id' | 'applicationId' | 'createdAt' | 'state'>> &
    Pick<Ask, 'kind' | 'label'>,
): Ask {
  return {
    id: ctx.deps.newId(),
    applicationId,
    createdAt: ctx.at,
    by: ctx.caller.personId,
    planKey: null,
    times: [],
    place: null,
    videoUrl: null,
    agenda: null,
    detail: null,
    interviewId: null,
    state: 'open',
    answeredAt: null,
    answer: null,
    ...input,
  };
}
