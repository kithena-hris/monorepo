import 'server-only';
import { cache } from 'react';

import { documents, onboarding, people, performance, recruiting, timeOff } from '../people';
import { readPreference, writePreference } from '../preferences';
import { currentPerson } from '../session';
import { prune, stateOf, type InboxState } from './model';
import { peekOf, type InboxPeek } from './peek';
import { readInbox, type Run } from './sources';

/**
 * The Inbox for the person signed in on the web: their modules read through
 * the router with their session (`lib/people.ts`), and their state from
 * identity (`inbox` preference). Once per request, however many parts of the
 * page ask: the layout's bell, the sidebar and the page itself.
 */

/** Each module's read, by its area: a module missing here never answers the Inbox. */
const RUNS = {
  people,
  timeoff: timeOff,
  documents,
  recruiting,
  onboarding,
  performance,
} as unknown as Readonly<
  Record<Parameters<Run>[0], (name: string, variables: Record<string, unknown>) => ReturnType<Run>>
>;

export const webRun: Run = (area, name, variables = {}) => RUNS[area](name, variables);

export const inboxState = cache(async (): Promise<InboxState> =>
  stateOf(await readPreference('inbox')),
);

export const inboxNow = cache(async () => {
  const [person, state] = await Promise.all([currentPerson(), inboxState()]);
  const read = await readInbox(person?.entitlements ?? [], webRun, state, new Date().toISOString());
  return { ...read, zone: person?.timeZone ?? 'UTC' };
});

/**
 * Change the person's state and keep it, pruned to what is still shown.
 * Identity refuses it while an administrator views as them (read-only).
 */
export async function changeState(
  change: (state: InboxState) => InboxState,
): Promise<'saved' | 'view_only' | 'failed'> {
  const [state, read] = await Promise.all([inboxState(), inboxNow()]);
  const next = prune(change(state), read.raw);
  return writePreference('inbox', next);
}

/** The chrome's part of the Inbox, for the layout to pass on as a promise. */
export async function inboxPeek(): Promise<InboxPeek> {
  return peekOf(await inboxNow());
}
