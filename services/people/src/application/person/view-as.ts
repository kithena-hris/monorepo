import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { effectiveRoles } from '../../domain/access/roles.js';
import {
  mayViewAs,
  specialCategoryVisible,
  type ViewAsTarget,
} from '../../domain/access/view-as.js';
import { run, type PeopleService } from './service.js';
import type { Asking, RelationsResolver, Viewer } from './ports.js';

/**
 * Viewing as an employee, from their profile (decided 2026-09-29).
 *
 * People decides whether the asker may — it holds the roles — and what the
 * employee's view would show; identity makes the session, which it records
 * and announces in the same transaction. Nothing is written here: the start
 * is identity's to record, and People learns of it from its event, like the
 * activity log.
 */

/**
 * One time an administrator viewed the app as somebody, once it was over: what
 * their inbox tells them. Never the reason.
 */
export interface ViewedAs {
  readonly id: string;
  /** The administrator's name; null where People has no record of them. */
  readonly by: string | null;
  readonly at: string;
  readonly endedAt: string;
  readonly specialCategory: boolean;
}

/** Identity's side: start the session, answer with a handoff code. */
export interface ViewAsIdentity {
  start(input: {
    readonly tenantId: string;
    readonly adminAccountId: string;
    readonly subjectAccountId: string;
    readonly reason: string;
    readonly specialCategory: boolean;
  }): Promise<Result<{ readonly code: string; readonly expiresAt: string }>>;
}

export interface ViewAsDeps {
  readonly service: PeopleService;
  readonly relations: RelationsResolver;
  /** The account a person signs in as, and whether their access still holds. */
  readonly accountOf: (
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
  ) => Promise<{ readonly accountId: string | null; readonly active: boolean } | null>;
  /** Absent without `IDENTITY_URL`: nobody can be viewed as. */
  readonly identity?: ViewAsIdentity;
}

const asker = (viewer: Viewer) => ({
  accountId: viewer.accountId,
  // Granted: an administrator's effective roles hold HR and finance, never
  // `people_admin` by any other road. Support's session roles are refused
  // as support.
  administrator: viewer.roles.has('people_admin'),
  support: viewer.support !== undefined,
  viewing: viewer.viewing !== undefined,
});

/** Who they are, as `mayViewAs` needs them. Fail closed: no role store, an administrator. */
async function targetOf(
  deps: ViewAsDeps,
  tx: PostgresJsDatabase,
  tenantId: string,
  personId: string,
): Promise<(ViewAsTarget & { readonly roles: readonly string[] }) | null> {
  const found = await deps.accountOf(tx, tenantId, personId);
  if (found === null) return null;
  const roles =
    found.accountId === null || deps.service.roles === undefined
      ? null
      : (await deps.service.roles.of(tx, tenantId, found.accountId)).roles;
  return {
    accountId: found.accountId,
    active: found.active,
    administrator: roles === null || roles.includes('people_admin'),
    roles: roles ?? [],
  };
}

/** Whether "View as {name}" is offered on this person's profile. Reads nothing for anybody else. */
export async function offersViewAs(
  deps: ViewAsDeps,
  tx: PostgresJsDatabase,
  asking: Asking,
  personId: string,
): Promise<boolean> {
  if (deps.identity === undefined) return false;
  const who = asker(asking.viewer);
  if (!who.administrator || who.support || who.viewing) return false;
  const target = await targetOf(deps, tx, asking.tenantId, personId);
  return target !== null && mayViewAs(who, target).ok;
}

const REASON_MAX = 500;

export async function startViewingAs(
  deps: ViewAsDeps,
  asking: Asking,
  personId: string,
  rawReason: string,
): Promise<Result<{ readonly code: string; readonly expiresAt: string }>> {
  const reason = rawReason.trim();
  if (reason === '' || reason.length > REASON_MAX) {
    return err(
      failure(
        'REASON_REQUIRED',
        'Say why, in up to 500 characters: it is kept in the activity log',
        ['reason'],
      ),
    );
  }
  const decided = await run(deps.service, asking.tenantId, async (tx) => {
    const target = await targetOf(deps, tx, asking.tenantId, personId);
    if (target === null) return err(failure('NOT_FOUND', 'No such person'));
    const allowed = mayViewAs(asker(asking.viewer), target);
    if (!allowed.ok) return allowed;
    const subject = target.accountId ?? '';

    // What the employee sees of themselves, and could see of anybody else.
    const theirs: Viewer = { accountId: subject, roles: effectiveRoles(target.roles) };
    const own = await deps.relations.relations(tx, asking.tenantId, theirs, personId);
    const reach = await deps.relations.reach?.(tx, asking.tenantId, theirs);
    // Without a way to ask, assume they manage somebody: over-saying that
    // special-category data was visible is the safe way to be wrong.
    const manages = reach === undefined || reach.direct.size > 0 || reach.chain.size > 0;
    const read = await deps.service.access.read(tx, {
      tenantId: asking.tenantId,
      viewer: theirs,
      correlationId: asking.correlationId,
      personId,
    });
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    const special = specialCategoryVisible(
      version?.document.attributes ?? [],
      read.ok ? read.value.attributes : {},
      own,
      {
        isSelf: false,
        isManager: manages,
        isInManagerChain: manages,
        isHr: own.isHr,
        isFinance: own.isFinance,
        isAdmin: own.isAdmin,
      },
    );
    return ok({ subject, special });
  });
  if (!decided.ok) return decided;
  if (deps.identity === undefined) {
    return err(failure('UNAVAILABLE', 'Viewing as somebody is not configured here'));
  }
  return deps.identity.start({
    tenantId: asking.tenantId,
    adminAccountId: asking.viewer.accountId,
    subjectAccountId: decided.value.subject,
    reason,
    specialCategory: decided.value.special,
  });
}
