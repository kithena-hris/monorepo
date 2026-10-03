import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { requestable, REQUEST_AGAIN_AFTER_MS } from '../../domain/person/detail-request.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { ScreenDeps, Tx } from './record.js';

export type { DetailRequest, DetailRequestStore } from './record.js';

/**
 * "Ask them for it": HR or a manager asks somebody for an empty detail of
 * theirs, from the button beside it on their profile, or everybody a search
 * found missing it at once ("Remind all", from the directory).
 *
 * Recorded, one row per person and field in `people.detail_request`, so the
 * profile can say it was asked for and the person sees what they were asked
 * for; then the person is emailed, after the commit, through the reminder's
 * notice. Pressing it again within a day records it and sends nothing, so a
 * button pressed twice is not two emails.
 */

export type Recorded = {
  readonly personId: string;
  readonly fresh: readonly string[];
  readonly email: string | null;
};

/** One person's request, recorded as the viewer may make it; refused as it is refused. */
export async function recordOne(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  personId: string,
  keys: readonly string[],
  now: Date,
): Promise<Result<Recorded>> {
  const requests = deps.requests;
  if (requests === undefined) {
    return err(failure('UNAVAILABLE', 'Asking for details is not available here'));
  }
  // Somebody the viewer may not read is not found, as everywhere else.
  const read = await deps.service.access.read(tx, { ...asking, personId });
  if (!read.ok) return read;
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
  const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, personId);
  const allowed = requestable(version.document.attributes, keys, relations);
  if (!allowed.ok) return allowed;
  const email = read.value.attributes['work_email'];
  const fresh = await requests.store.record(tx, {
    tenantId: asking.tenantId,
    personId,
    keys,
    requestedBy: asking.viewer.accountId,
    requestedAt: now.toISOString(),
    resendBefore: new Date(now.getTime() - REQUEST_AGAIN_AFTER_MS).toISOString(),
  });
  return ok({ personId, fresh, email: typeof email === 'string' ? email : null });
}

/** The emails, after the commit, ten at a time: a lost email loses the nudge, never the request. */
export async function emailAll(
  deps: ScreenDeps,
  tenantId: string,
  company: Awaited<ReturnType<NonNullable<NonNullable<ScreenDeps['requests']>['company']>>>,
  recorded: readonly Recorded[],
  now: Date,
): Promise<number> {
  const mailer = deps.requests?.mailer;
  if (mailer === undefined || company === null) return 0;
  const due = recorded.filter((r) => r.email !== null && r.fresh.length > 0);
  let sent = 0;
  for (let i = 0; i < due.length; i += 10) {
    const results = await Promise.allSettled(
      due.slice(i, i + 10).map((r) =>
        mailer.send(tenantId, company, {
          personId: r.personId,
          workEmail: r.email ?? '',
          keys: r.fresh,
          remindedAt: now,
        }),
      ),
    );
    sent += results.filter((x) => x.status === 'fulfilled').length;
  }
  return sent;
}

export async function requestDetails(
  deps: ScreenDeps,
  asking: Asking,
  personId: string,
  keys: readonly string[],
): Promise<Result<{ readonly asked: readonly string[]; readonly emailed: boolean }>> {
  const unique = [...new Set(keys)];
  const now = deps.clock.now();
  const recorded = await run(deps.service, asking.tenantId, async (tx) => {
    const one = await recordOne(deps, tx, asking, personId, unique, now);
    if (!one.ok) return one;
    const company =
      one.value.fresh.length === 0 || deps.requests?.company === undefined
        ? null
        : await deps.requests.company(tx, asking.tenantId);
    return ok({ one: one.value, company });
  });
  if (!recorded.ok) return recorded;
  const sent = await emailAll(
    deps,
    asking.tenantId,
    recorded.value.company,
    [recorded.value.one],
    now,
  );
  return ok({ asked: unique, emailed: sent > 0 });
}

/**
 * What an import asks of people, once it is in: one request per person,
 * listing every asked field they have no value for, never one per field.
 * The fields are new, so somebody the file does not reach has none of them.
 * Only a field they fill in themselves is asked; nobody who has left is
 * asked anything. Recorded in the import's transaction and never emailed:
 * an import is no email blast. They find it on their profile, or in
 * onboarding before they start, and the weekly reminder nudges. Answers how
 * many people were asked.
 */
export async function requestFromImport(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  asked: readonly { readonly key: string; readonly column: number }[],
  rows: readonly {
    readonly personId: string;
    readonly cells: readonly string[];
    readonly left: boolean;
  }[],
): Promise<Result<number>> {
  const store = deps.requests?.store;
  if (store === undefined || asked.length === 0) return ok(0);
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  const theirs = new Set(
    (version?.document.attributes ?? [])
      .filter((d) => d.deprecatedAt === null && d.ownership.includes('employee'))
      .map((d) => d.key as string),
  );
  const fields = asked.filter((f) => theirs.has(f.key));
  if (fields.length === 0) return ok(0);
  const inFile = new Map(
    rows.map((r) => [
      r.personId,
      r.left ? [] : fields.filter((f) => (r.cells[f.column] ?? '').trim() === '').map((f) => f.key),
    ]),
  );
  const now = deps.clock.now();
  let people = 0;
  let after: string | null = null;
  do {
    // eslint-disable-next-line no-await-in-loop -- a page at a time, in the import's transaction
    const page = await deps.service.access.list(tx, { ...asking, after, limit: 200 });
    if (!page.ok) return page;
    for (const p of page.value.items) {
      if (p.status === 'terminated') continue;
      const keys = inFile.get(p.id) ?? fields.map((f) => f.key);
      if (keys.length === 0) continue;
      // eslint-disable-next-line no-await-in-loop -- one statement per person
      await store.record(tx, {
        tenantId: asking.tenantId,
        personId: p.id,
        keys,
        requestedBy: asking.viewer.accountId,
        requestedAt: now.toISOString(),
        resendBefore: new Date(now.getTime() - REQUEST_AGAIN_AFTER_MS).toISOString(),
      });
      people += 1;
    }
    after = page.value.next;
  } while (after !== null);
  return ok(people);
}

/**
 * Ask each of these people for the same details: "Remind all" over what a
 * search found. One transaction records every request; somebody the viewer
 * may not ask (not theirs, or a detail they do not fill in themselves) is
 * skipped and counted rather than refusing the rest.
 */
export async function requestDetailsOfMany(
  deps: ScreenDeps,
  asking: Asking,
  personIds: readonly string[],
  keys: readonly string[],
): Promise<Result<{ readonly asked: number; readonly emailed: number; readonly skipped: number }>> {
  if (deps.requests === undefined) {
    return err(failure('UNAVAILABLE', 'Asking for details is not available here'));
  }
  const unique = [...new Set(keys)];
  const now = deps.clock.now();
  const recorded = await run(deps.service, asking.tenantId, async (tx) => {
    const done: Recorded[] = [];
    let skipped = 0;
    for (const personId of new Set(personIds)) {
      const one = await recordOne(deps, tx, asking, personId, unique, now);
      if (one.ok) done.push(one.value);
      else skipped += 1;
    }
    const company =
      done.length === 0 || deps.requests?.company === undefined
        ? null
        : await deps.requests.company(tx, asking.tenantId);
    return ok({ done, skipped, company });
  });
  if (!recorded.ok) return recorded;
  const { done, skipped, company } = recorded.value;
  const emailed = await emailAll(deps, asking.tenantId, company, done, now);
  return ok({ asked: done.length, emailed, skipped });
}
