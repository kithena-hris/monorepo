import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { ScreenDeps, Tx } from '../screens/record.js';

/**
 * Team tasks (H1, Z3): a task for a role rather than a person. People has one
 * kind today, an integration failing: a webhook endpoint disabled after its
 * failures, or a delivery that has failed three times and is still retrying.
 * It goes to every People administrator; one takes it, and it stops counting
 * for the others, who can still take it over with a note.
 */

/** A delivery failing this many times in a row makes it everyone's task. */
export const FAILURES_FOR_A_TASK = 3;

export interface FailingIntegration {
  readonly endpointId: string;
  readonly url: string;
  /** When it started failing: the oldest delivery still failing, or when it was disabled. */
  readonly since: string;
  readonly attempts: number;
  readonly lastResponse: number | null;
  readonly disabled: boolean;
  /** Why it was disabled, in People's words. */
  readonly problem: string | null;
  /** Deliveries waiting on it. */
  readonly waiting: number;
}

export interface Claim {
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export interface TeamTaskStore {
  failing(tx: Tx, tenantId: string, failures: number): Promise<readonly FailingIntegration[]>;
  claims(tx: Tx, tenantId: string, itemIds: readonly string[]): Promise<ReadonlyMap<string, Claim>>;
  /** Take it, or take it over: the newest one taking it holds it. */
  claim(tx: Tx, tenantId: string, itemId: string, claim: Claim): Promise<void>;
}

/** Only People's own team tasks may be taken here. */
const TEAM_ITEM = /^people:integration:[0-9a-f-]{36}$/u;

/** "Take it" and "Take it over" (H1, Z3): a People administrator, with a note when taking over. */
export async function takeTeamTask(
  deps: ScreenDeps,
  asking: Asking,
  itemId: string,
  note: string | null,
): Promise<Result<Claim>> {
  const store = deps.teamTasks;
  if (store === undefined) return err(failure('UNAVAILABLE', 'Team tasks are not available here'));
  if (!TEAM_ITEM.test(itemId)) return err(failure('NOT_FOUND', 'No such task'));
  if (!asking.viewer.roles.has('people_admin')) {
    return err(failure('FORBIDDEN', 'Only People administrators take this'));
  }
  const words = (note ?? '').trim();
  const claim: Claim = {
    by: asking.viewer.accountId,
    at: deps.clock.instant(),
    note: words === '' ? null : words.slice(0, 2000),
  };
  return run(deps.service, asking.tenantId, async (tx) => {
    await store.claim(tx, asking.tenantId, itemId, claim);
    return ok(claim);
  });
}
