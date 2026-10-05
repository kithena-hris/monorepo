import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { holdersOf } from '../../domain/access/roles.js';
import {
  ALL_CHECKS,
  COLLEAGUES_MINUTES,
  evidenceOf,
  payReach,
  rowSummary,
} from '../../domain/approval/unusual.js';
import { flagChange, looking, readableBy, type Looking } from './approval-flags.js';
import type { FlaggedWhere, PendingChange, PendingChangeDeps } from './pending-changes.js';
import type { Asking } from './ports.js';

/**
 * Review's Flagged over every change waiting (design AI7): what each change's
 * checks find is kept on it (`takeEvidence`, when it is asked for and hourly
 * after), and each decider's count and list are read from that with their own
 * switches, marks and reads applied (`flaggedWhere`), rather than every check
 * run on every change for every look.
 */

type Tx = PostgresJsDatabase;

const NOBODY = '00000000-0000-0000-0000-000000000000';

/**
 * What a change's checks find with nobody deciding (`evidenceOf`): every
 * check on, no marks, pay read, no colleagues. Kept on the change, so the
 * Flagged tab counts and pages over every change waiting.
 *
 * Sealed pay is opened as a decider's look opens it (`SealedPay`, audited)
 * and dropped; only the check's code and a raise's percentage are kept, as a
 * "Not unusual" mark already keeps one.
 */
export async function takeEvidence(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'clock' | 'flags' | 'reader' | 'schemas' | 'store'>,
  change: PendingChange,
): Promise<void> {
  const version = await deps.schemas.current(tx, change.tenantId);
  const look: Looking = {
    enabled: ALL_CHECKS,
    managerPay: true,
    marks: [],
    definitions: version?.document.attributes ?? [],
    managerOfDecider: null,
    bandReadable: true,
  };
  const found = await flagChange(tx, deps, look, {
    change,
    readable: true,
    requesterName: '',
  });
  await deps.store.setEvidence(tx, change.tenantId, change.approval.id, evidenceOf(found));
}

/** How many changes the hourly pass takes again at a time. */
const RETAKE_PAGE = 200;

/**
 * Take every waiting change's evidence again: what it is compared with moves
 * (the team's raises, the band, an address changed since). Hourly, per tenant;
 * newest first, a page at a time. Returns how many were taken.
 */
export async function retakeEvidence(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'clock' | 'flags' | 'reader' | 'schemas' | 'store'>,
  tenantId: string,
): Promise<number> {
  let place: { at: string; id: string } | null = null;
  let taken = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- a page at a time, in one transaction
    const page = await deps.store.open(tx, tenantId, {
      limit: RETAKE_PAGE,
      newest: { after: place },
    });
    for (const change of page) {
      // eslint-disable-next-line no-await-in-loop -- each reads what surrounds it
      await takeEvidence(tx, deps, change);
      taken += 1;
    }
    const last = page.at(-1);
    if (page.length < RETAKE_PAGE || last === undefined) return taken;
    place = { at: last.approval.requestedAt, id: last.approval.id };
  }
}

/**
 * The Flagged tab's filter for this decider now (`FlaggedWhere`): their
 * company's switches and marks, and the pay fields they may read — on
 * anybody, or, while the company counts it (`MANAGER_PAY`), on the people
 * their reporting line reaches, which the store follows in its query. The
 * detail pane reads pay by the same rule (`readableBy`).
 */
export async function flaggedWhere(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'clock' | 'flags' | 'reader' | 'schemas' | 'relations'>,
  asking: Asking,
): Promise<{ readonly where: FlaggedWhere; readonly look: Looking }> {
  const look = await looking(tx, deps, asking);
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  return {
    look,
    where: {
      enabled: [...look.enabled],
      pay: payReach(look.definitions, everyone, look.managerPay),
      decider: asking.viewer.accountId,
      marks: look.marks,
      at: deps.clock.instant(),
    },
  };
}

/**
 * The changes waiting for this viewer's decision that the checks flag, over
 * every one: those whose kept evidence flags them for this decider, counted by
 * the store, and those asked for within the hour that only close colleagues
 * flags, run now. Beside the count, the newest one's reasons in a line.
 */
export async function flaggedCount(
  tx: Tx,
  deps: Pick<
    PendingChangeDeps,
    'clock' | 'flags' | 'reader' | 'schemas' | 'relations' | 'store' | 'roles'
  >,
  asking: Asking,
): Promise<{ readonly count: number; readonly latest: string | null }> {
  const version = await deps.schemas.current(tx, asking.tenantId);
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  if (!version || !everyone.isHr) return { count: 0, latest: null };
  const me = asking.viewer.accountId;
  const { where, look } = await flaggedWhere(tx, deps, asking);
  const base = { at: where.at, keys: version.document.attributes.map((d) => d.key as string) };
  const kept = await deps.store.count(tx, asking.tenantId, {
    ...base,
    notInvolving: me,
    flagged: where,
  });
  // `mayApproveAlone`, as `inboxCounts` decides it: theirs, nobody else to approve.
  const hr = deps.roles ? holdersOf(await deps.roles.holdings(tx, asking.tenantId), 'hr') : [];
  const others = hr.filter((a) => a !== me);
  const alone = !hr.includes(me)
    ? 0
    : others.length === 0
      ? await deps.store.count(tx, asking.tenantId, { ...base, requestedBy: me, flagged: where })
      : others.length === 1 && others[0] !== undefined
        ? await deps.store.count(tx, asking.tenantId, {
            ...base,
            requestedBy: me,
            subjectAccount: others[0],
            flagged: where,
          })
        : 0;
  // Close colleagues: asked for within the hour, which only the decider can say.
  const since = new Date(Date.parse(where.at) - COLLEAGUES_MINUTES * 60_000).toISOString();
  const recent = await deps.store.open(tx, asking.tenantId, {
    limit: COLLEAGUES_SHOWN,
    newest: { after: null },
    since,
  });
  const keptIds = new Set(
    (
      await deps.store.open(tx, asking.tenantId, {
        limit: COLLEAGUES_SHOWN,
        newest: { after: null },
        since,
        flagged: where,
      })
    ).map((c) => c.approval.id),
  );
  let colleagues = 0;
  let latest: string | null = null;
  for (const change of recent) {
    // `canDecide`: HR, neither the requester nor the person it is about.
    if (change.approval.requestedBy === me) continue;
    // eslint-disable-next-line no-await-in-loop -- one look per change asked for within the hour
    const person = await deps.reader.record(tx, asking.tenantId, change.personId);
    if (person === null || person.snapshot.identityAccountId === me) continue;
    // eslint-disable-next-line no-await-in-loop -- one look per change asked for within the hour
    const found = await flagChange(tx, deps, look, {
      change,
      readable: await readableBy(tx, deps, asking, change, look),
      requesterName: 'the requester',
    });
    if (found.reasons.length === 0) continue;
    latest ??= rowSummary(found.reasons);
    if (!keptIds.has(change.approval.id)) colleagues += 1;
  }
  if (latest === null) {
    // The newest the kept evidence flags, its reasons as this decider sees them.
    const [newest] = await deps.store.open(tx, asking.tenantId, {
      limit: 1,
      newest: { after: null },
      flagged: where,
    });
    if (newest !== undefined) {
      const found = await flagChange(tx, deps, look, {
        change: newest,
        readable: await readableBy(tx, deps, asking, newest, look),
        requesterName: 'the requester',
      });
      latest = rowSummary(found.reasons);
    }
  }
  return { count: kept + alone + colleagues, latest };
}

/** How many changes asked for within the hour close colleagues is run on. */
const COLLEAGUES_SHOWN = 500;
