import * as z from 'zod';

import { asFreeText, asIdentity, asInternal, asPublic, policy } from '../classification.js';
import { defineEvent, type EventDefinition } from '../event.js';

/**
 * One line of a module's activity, for the company's one activity log
 * (`platform/audit`, `docs/audit.md`): every module raises
 * `<module>.activity.recorded` with this payload, in the same transaction as
 * the act where it can, and the log keeps it with the module's name, so each
 * module's own Activity log is the company's log filtered to it.
 *
 * Words and ids, never a value: what was done, to what, by name at the time,
 * and the reason the actor gave. A record's contents stay in the module, under
 * its own access rules.
 */

/** Where in a module an act falls, as the log's filters group it. */
export const ACTIVITY_AREAS = ['settings', 'records', 'access', 'ai', 'integrations'] as const;
export const ActivityArea = z.enum(ACTIVITY_AREAS).register(policy, asPublic());
export type ActivityArea = z.infer<typeof ActivityArea>;

export const ModuleActivity = z.object({
  area: ActivityArea,
  /** "Launched a cycle": one plain sentence, the module's own. */
  action: z.string().min(1).max(200).register(policy, asInternal()),
  /** One more sentence: the fields changed, by name, never their values. */
  detail: z.string().max(500).nullable().register(policy, asInternal()),
  /** What it was done to: `cycle`, `review`, `document`, `job` … */
  subjectKind: z
    .string()
    .regex(/^[a-z][a-z_]{0,39}$/u)
    .nullable()
    .register(policy, asPublic()),
  subjectId: z.string().max(64).nullable().register(policy, asPublic()),
  /** Its name at the time, which can name a person ("Peer review · Ada Lovelace"). */
  subjectLabel: z.string().max(300).nullable().register(policy, asIdentity()),
  /** What the actor gave as the reason, when the act takes one. */
  reason: z.string().max(500).nullable().register(policy, asFreeText()),
  /** Refused attempts are lines of the log too. */
  outcome: z.enum(['done', 'refused']).register(policy, asPublic()),
  /** The surface it came from: "Web", "Phone", "API", "Slack", "Ask Kithena", "Kithena". */
  via: z.string().min(1).max(40).register(policy, asPublic()),
  /** Proposed by AI and confirmed by the person. */
  ai: z.boolean().register(policy, asPublic()),
});
export type ModuleActivity = z.infer<typeof ModuleActivity>;

/** `<module>.activity.recorded`, on the module's own topic. */
export const activityRecorded = <M extends string>(
  module: M,
): EventDefinition<`${M}.activity.recorded`, typeof ModuleActivity> =>
  defineEvent(`${module}.activity.recorded`, 1, ModuleActivity);

/**
 * A write as the activity log words it, for a module whose acts are its REST
 * routes (Time Off, Recruiting, Onboarding): the route's own summary without
 * its screen code ("R4: the hiring team" reads "The hiring team"), and what it
 * touched by the path's `{id}` (`/jobs/{id}/team` is a `job`). Settings routes
 * fall under settings, everything else under records.
 */
export function routeActivity(
  route: { readonly path: string; readonly summary: string },
  params: Readonly<Record<string, unknown>>,
): ModuleActivity {
  const said = route.summary.replace(/^[A-Z]+\d+[a-z]?: /u, '').trim();
  const id = typeof params['id'] === 'string' ? params['id'].slice(0, 64) : null;
  const noun = /\/([a-z][a-z-]*)\/\{id\}/u.exec(route.path)?.[1];
  const kind =
    id === null || noun === undefined
      ? null
      : noun.replace(/ies$/u, 'y').replace(/s$/u, '').replaceAll('-', '_').slice(0, 40);
  return {
    area: route.path.includes('/settings') ? 'settings' : 'records',
    action: `${said.charAt(0).toUpperCase()}${said.slice(1)}`.slice(0, 200) || 'Made a change',
    detail: null,
    subjectKind: kind,
    subjectId: kind === null ? null : id,
    subjectLabel: null,
    reason: null,
    outcome: 'done',
    via: 'App',
    ai: false,
  };
}
