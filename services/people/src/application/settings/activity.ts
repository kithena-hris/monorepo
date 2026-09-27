import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { actors } from '../screens/people.js';
import { avatarsOf } from '../screens/photo.js';
import { NOBODY, type ScreenDeps } from '../screens/record.js';
import type { ActivityArea } from './activity-store.js';

/**
 * The Settings activity log: every change to People's settings, who made it
 * and when, in words. Appended by the router as each settings command
 * succeeds (`http/activity.ts`), read here by whoever may open settings.
 */

export type { ActivityArea, ActivityEntry, ActivityStore } from './activity-store.js';

export const ACTIVITY_PAGE = 50;

export interface ActivityView {
  readonly entries: readonly {
    readonly id: string;
    readonly at: string;
    readonly action: string;
    readonly subject: string | null;
    readonly area: ActivityArea;
    readonly by: string;
    readonly avatarUrl: string | null;
  }[];
  /** The cursor for older entries; null when there are none. */
  readonly next: string | null;
}

/** The log, for a People administrator or HR: the people who open settings. */
export async function activityView(
  deps: ScreenDeps,
  asking: Asking,
  query: { readonly before: string | null; readonly area: ActivityArea | null },
): Promise<Result<ActivityView>> {
  const store = deps.activity;
  if (store === undefined) return err(failure('UNAVAILABLE', 'The activity log is not kept here'));
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isAdmin && !everyone.isHr) {
      return err(failure('FORBIDDEN', 'The settings activity is for People administrators and HR'));
    }
    const rows = await store.page(tx, asking.tenantId, { ...query, limit: ACTIVITY_PAGE + 1 });
    const shown = rows.slice(0, ACTIVITY_PAGE);
    const who = shown.map((r) => ({ kind: 'user' as const, userId: r.actor }));
    const by = await actors(deps, tx, asking, who);
    const people = new Map<string, string>();
    for (const r of shown) {
      if (people.has(r.actor)) continue;
      const personId = await deps.personOf(tx, asking.tenantId, r.actor);
      if (personId !== null) people.set(r.actor, personId);
    }
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [...people.values()]);
    return ok({
      entries: shown.map((r) => ({
        id: r.id,
        at: r.at,
        action: r.action,
        subject: r.subject,
        area: r.area,
        by: by({ kind: 'user', userId: r.actor }),
        avatarUrl: avatars.get(people.get(r.actor) ?? '') ?? null,
      })),
      next: rows.length > ACTIVITY_PAGE ? (shown.at(-1)?.id ?? null) : null,
    });
  });
}
