import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { actors, SUPPORT } from '../screens/people.js';
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
    /** What it was done to, in words: a field's name, never its key. */
    readonly subject: string | null;
    /** What it did, in one plain sentence; null on older entries. */
    readonly detail: string | null;
    readonly area: ActivityArea;
    /** "You", or who did it. */
    readonly by: string;
    /** Their name, whoever they are: for the avatar's initials. */
    readonly name: string;
    readonly avatarUrl: string | null;
    /**
     * `person` when the account belongs to somebody in People, whose photo
     * or initials stand for them; `support` for Kithena support signed in
     * from the back office; `system` for anything else (an automated setup),
     * which has no face to show. Neither of the last two has a face.
     */
    readonly kind: 'person' | 'system' | 'support';
    /** Why Kithena support was signed in, as the operator said; null otherwise. */
    readonly reason: string | null;
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
    const bySupport = (r: (typeof shown)[number]) => r.onBehalfOf != null;
    const who = shown
      .filter((r) => !bySupport(r))
      .map((r) => ({ kind: 'user' as const, userId: r.actor }));
    const by = await actors(deps, tx, asking, who);
    // Named as anybody else would see them, "You" included, for the avatar.
    const named = await actors(
      deps,
      tx,
      { ...asking, viewer: { ...asking.viewer, accountId: NOBODY } },
      who,
    );
    // A field or section named by its key, as the command that changed it
    // was: read back as its name today.
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    const names = new Map<string, string>([
      ...(version?.document.sections ?? []).map((x) => [x.key as string, x.label.default] as const),
      ...(version?.document.attributes ?? []).map(
        (a) => [a.key as string, a.label.default] as const,
      ),
    ]);
    const people = new Map<string, string>();
    for (const r of shown) {
      if (bySupport(r) || people.has(r.actor)) continue;
      const personId = await deps.personOf(tx, asking.tenantId, r.actor);
      if (personId !== null) people.set(r.actor, personId);
    }
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [...people.values()]);
    return ok({
      entries: shown.map((r) => ({
        id: r.id,
        at: r.at,
        action: r.action,
        subject: r.subject === null ? null : (names.get(r.subject) ?? r.subject),
        detail: r.detail,
        area: r.area,
        reason: bySupport(r) ? (r.reason ?? null) : null,
        ...(bySupport(r)
          ? { by: SUPPORT, name: SUPPORT, avatarUrl: null, kind: 'support' as const }
          : people.has(r.actor)
            ? {
                by: by({ kind: 'user', userId: r.actor }),
                name: named({ kind: 'user', userId: r.actor }),
                avatarUrl: avatars.get(people.get(r.actor) ?? '') ?? null,
                kind: 'person' as const,
              }
            : { by: 'System', name: 'System', avatarUrl: null, kind: 'system' as const }),
      })),
      next: rows.length > ACTIVITY_PAGE ? (shown.at(-1)?.id ?? null) : null,
    });
  });
}
