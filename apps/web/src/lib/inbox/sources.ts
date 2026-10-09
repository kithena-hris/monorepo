import type { InboxItem } from '@kithena/contracts';

import type { PeopleAnswer } from '../people';
import { countsOf, itemsOf, shape, type Counts, type InboxState, type Shown } from './model';

/**
 * Where the Inbox's items come from (INB-002): one read per module, all at
 * once, as the person signed in. A module joins the Inbox by answering its
 * read in the shared shape (`packages/contracts/src/inbox`) and adding one
 * line here; nothing else in the shell knows what its items are.
 *
 * A module that does not answer leaves its items out and says so
 * (`unanswered`), rather than the Inbox claiming there is nothing to do.
 */

/** Runs one module operation as the person: the cookie's on the web, the bearer's on the phone. */
export type Run = (
  area: 'people' | 'timeoff',
  name: string,
  variables?: Record<string, unknown>,
) => Promise<PeopleAnswer<unknown>>;

interface Source {
  readonly module: string;
  readonly entitlement: string;
  readonly area: 'people' | 'timeoff';
  readonly operation: string;
  /** The operation's root field, as the module answers it. */
  readonly answer: (data: unknown) => unknown;
}

const parsed = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

export const SOURCES: readonly Source[] = [
  {
    module: 'people',
    entitlement: 'module.people',
    area: 'people',
    operation: 'PeopleInbox',
    answer: parsed,
  },
  {
    module: 'timeoff',
    entitlement: 'module.timeoff',
    area: 'timeoff',
    operation: 'TimeOffInbox',
    answer: (data) => data,
  },
];

export interface InboxRead {
  readonly items: readonly Shown[];
  readonly counts: Counts;
  /** The modules asked: the source filter's choices. */
  readonly modules: readonly string[];
  /** Modules that did not answer this time: said, never taken for "nothing to do". */
  readonly unanswered: readonly string[];
  /** Whether a module is asleep and waking (the VM): the page says so and asks again. */
  readonly waking: boolean;
  readonly now: string;
}

/** Every module the company has, read at once, merged and shaped by the person's state. */
export async function readInbox(
  entitlements: readonly string[],
  run: Run,
  state: InboxState,
  now: string,
): Promise<InboxRead & { readonly raw: readonly InboxItem[] }> {
  const sources = SOURCES.filter((s) => entitlements.includes(s.entitlement));
  const answers = await Promise.all(sources.map((s) => run(s.area, s.operation)));
  const unanswered = sources.filter((_, i) => answers[i]?.ok !== true).map((s) => s.module);
  const raw = itemsOf(answers.map((a, i) => (a.ok ? sources[i]?.answer(a.data) : null)));
  const items = shape(raw, state, now);
  return {
    raw,
    items,
    counts: countsOf(items),
    modules: sources.map((s) => s.module),
    unanswered,
    waking: answers.some((a) => !a.ok && a.code === 'UNREACHABLE'),
    now,
  };
}
