import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, Forbidden, localDate, ok, type Clock, type Result } from '@kithena/domain-kit';

import {
  nextErasure,
  STATUTORY_FLOOR_MONTHS,
  type StatutoryFloor,
} from '../../domain/retention/floors.js';
import { inTenantResult } from '../person/person-access.js';
import type { InTenant } from '../person/ports.js';
import type { anonymiseDue, RetentionAttribute, RetentionStore } from './anonymise.js';
import { addMonths, dueForAnonymisation } from './schedule.js';

/**
 * Automated anonymisation on retention expiry (PEO-075; PRD §8.1, §12).
 *
 * A daily job, per tenant, over leavers whose retention may have run out. Each
 * goes through `anonymiseDue` — the use case HR's by-hand erasure uses — as
 * `system:retention`, `automated`, in a transaction of its own, so one
 * failure or refusal leaves the rest of the batch standing.
 *
 * **Live but inert under an unreviewed floor.** `anonymiseDue` asks `mayErase`,
 * which refuses an automated run relying on a floor counsel has not reviewed:
 * that person is skipped, counted as `waiting`, and asked again next run. Once
 * the floor is reviewed, the next run erases. Today every floor is unreviewed,
 * so only values under a tenant policy with no floor are ever erased.
 *
 * **Idempotent and resumable.** Only held values are cleared, so a re-run
 * finds nothing twice. A run takes at most `batch` candidates, keyset by id,
 * and hands back where it stopped; the caller passes that back next time and
 * starts over from the beginning once a pass comes back short.
 *
 * Nothing here guards a legal hold or an open DSAR: People has neither yet.
 * `anonymiseDue` is where they will go, for the job and HR alike.
 */

const ACTOR = { kind: 'system', process: 'retention' } as const;
/** The listing HR sees looks this far ahead. */
const UPCOMING_MONTHS = 3;

export interface SweepDeps {
  readonly inTenant: InTenant;
  readonly store: RetentionStore;
  readonly anonymise: ReturnType<typeof anonymiseDue>;
  readonly clock: Clock;
  readonly newId: () => string;
  /** At most this many people per run. */
  readonly batch?: number;
}

export interface SweepResult {
  readonly erased: number;
  /** Due, but relying on a floor counsel has not reviewed. */
  readonly waiting: number;
  readonly failed: readonly { readonly personId: string; readonly error: unknown }[];
  /** Pass back as `after` next run; null when this pass reached the end. */
  readonly next: string | null;
}

/** Left at least this many months ago before anything can be due; null when nothing has a retention policy. */
function shortestMonths(attributes: readonly RetentionAttribute[]): number | null {
  const months = attributes.flatMap(({ policy: { retention } }) =>
    retention
      ? [
          Math.max(
            retention.monthsAfterTermination,
            retention.statutoryFloor ? STATUTORY_FLOOR_MONTHS[retention.statutoryFloor] : 0,
          ),
        ]
      : [],
  );
  return months.length === 0 ? null : Math.min(...months);
}

const retained = (attributes: readonly RetentionAttribute[]) =>
  attributes.filter((a) => a.policy.retention !== undefined).map((a) => a.key);

export function sweepRetention(
  deps: SweepDeps,
): (tenantId: string, after: string | null) => Promise<SweepResult> {
  const limit = deps.batch ?? 100;
  return async (tenantId, after) => {
    const candidates = await deps.inTenant(tenantId, async ({ tx }) => {
      const attributes = await deps.store.policies(tx, tenantId);
      const months = shortestMonths(attributes);
      if (months === null) return [];
      return deps.store.candidates(tx, tenantId, {
        today: localDate(deps.clock.instant(), 'UTC'),
        shortestMonths: months,
        keys: retained(attributes),
        after,
        limit,
      });
    });

    let erased = 0;
    let waiting = 0;
    const failed: { personId: string; error: unknown }[] = [];
    for (const { personId } of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one person per transaction is the point
        const result = await inTenantResult(deps.inTenant, tenantId, (tx) =>
          deps.anonymise(tx, {
            tenantId,
            personId,
            actor: ACTOR,
            correlationId: deps.newId(),
            mode: { kind: 'automated' },
          }),
        );
        if (result.ok) {
          if (result.value.cleared.length > 0) erased += 1;
        } else if (result.error.code === 'RETENTION_FLOOR_UNREVIEWED') {
          waiting += 1;
        } else {
          failed.push({ personId, error: result.error });
        }
      } catch (error) {
        failed.push({ personId, error });
      }
    }
    const last = candidates.at(-1);
    return {
      erased,
      waiting,
      failed,
      next: candidates.length < limit || !last ? null : last.personId,
    };
  };
}

export interface UpcomingErasure {
  readonly personId: string;
  /** Null once the name itself has been erased. */
  readonly name: string | null;
  readonly dueOn: string;
  readonly floors: readonly StatutoryFloor[];
  /** Floors counsel has not reviewed: the job waits for them, however overdue. */
  readonly waitingForReview: readonly StatutoryFloor[];
}

/**
 * Who the job will erase next, and when: every leaver with something due
 * within three months or already overdue, earliest first (PEO-075). HR's
 * alone. Read without locks; the job decides again when it runs.
 *
 * `ponytail: the first 200 leavers by id. A tenant with more overdue than that
 * needs paging here.`
 */
export function upcomingErasures(deps: {
  readonly store: RetentionStore;
  readonly clock: Clock;
  readonly reviews?: Parameters<typeof nextErasure>[2];
}): (
  tx: PostgresJsDatabase,
  asking: { readonly tenantId: string; readonly viewer: { readonly roles: ReadonlySet<string> } },
) => Promise<Result<readonly UpcomingErasure[]>> {
  return async (tx, { tenantId, viewer }) => {
    if (!viewer.roles.has('hr')) return err(Forbidden());
    const attributes = await deps.store.policies(tx, tenantId);
    const months = shortestMonths(attributes);
    if (months === null) return ok([]);
    const today = localDate(deps.clock.instant(), 'UTC');
    const horizon = addMonths(today, UPCOMING_MONTHS);
    const candidates = await deps.store.candidates(tx, tenantId, {
      today: horizon,
      shortestMonths: months,
      keys: retained(attributes),
      after: null,
      limit: 200,
    });

    const upcoming: UpcomingErasure[] = [];
    for (const c of candidates) {
      const held = new Set<string>();
      // eslint-disable-next-line no-await-in-loop -- bounded above
      const ids = [c.personId, ...(await deps.store.tombstones(tx, tenantId, c.personId))];
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop -- bounded above
        for (const k of (await deps.store.leaver(tx, tenantId, id, false))?.held ?? []) held.add(k);
      }
      const decisions = dueForAnonymisation(attributes, c.lastWorkingDay, horizon).filter((d) =>
        held.has(d.key),
      );
      const next = nextErasure(decisions, today, deps.reviews);
      if (next) upcoming.push({ personId: c.personId, name: c.name, ...next });
    }
    return ok(upcoming.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn)));
  };
}
