import { ok, type Result } from '@kithena/domain-kit';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fullValuesScreen, type FullValuesDeps } from '../export/full-values.js';
import type { Asking, PersonAccess } from '../person/person-access.js';

/**
 * How many decisions wait for this viewer, counted, for the shell's bell and
 * badges: doubted identifiers and suspected duplicates (HR's) and access
 * requests (HR decides them). Null where the viewer has no such queue.
 *
 * The same queues their screens list, so a badge and its screen agree, but
 * without naming anybody on them: the shell drew every page after reading
 * three whole screens for their lengths, and only once the roles had said
 * whose they were.
 */
export interface WaitingView {
  readonly identifiers: number | null;
  readonly duplicates: number | null;
  readonly accessRequests: number | null;
}

export async function waitingView(
  tx: PostgresJsDatabase,
  deps: { readonly access: PersonAccess; readonly fullValues?: FullValuesDeps },
  asking: Asking,
): Promise<Result<WaitingView>> {
  const { roles } = asking.viewer;
  if (!roles.has('hr') && !roles.has('finance')) {
    return ok({ identifiers: null, duplicates: null, accessRequests: null });
  }
  const identifiers = await deps.access.identifierReviews(tx, asking);
  const duplicates = await deps.access.duplicates(tx, asking);
  const full =
    deps.fullValues === undefined ? null : await fullValuesScreen(tx, deps.fullValues, asking);
  return ok({
    identifiers: identifiers.ok ? identifiers.value.length : null,
    duplicates: duplicates.ok ? duplicates.value.length : null,
    // Only a decision waits on somebody who can make it; a request of one's own is not one.
    accessRequests:
      full?.ok === true && full.value.canDecide
        ? full.value.requests.filter((r) => r.state === 'pending').length
        : null,
  });
}
