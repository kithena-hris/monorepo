import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

import { canWrite } from '../../domain/access/field-access.js';
import { LIFECYCLE_KEYS } from '../person/core.js';
import { inTenantResult, type Asking } from '../person/person-access.js';
import { run, type PeopleService } from '../person/service.js';
import { DIRECTORY_PAGE } from './people.js';
import type { FormValue, IdentifierFindingView, RecordSection } from './model.js';
import {
  formChanges,
  nameOf,
  NOBODY,
  recordSections,
  tenantToday,
  toForm,
  warnings,
  type ScreenDeps,
  type Tx,
} from './record.js';

/**
 * Bulk edit (PRD §8.4, PEO-071): the same values for a set of people, from
 * one `effectiveFrom` chosen for the batch.
 *
 * Nothing here decides what a write may do. Each person is one
 * `PersonAccess.update` — the single write path every form, the grid and an
 * import take — so field-level write authorization, custom visibility rules,
 * validation, uniqueness, the identifier checks and HR's review gate, the
 * lifecycle refusal and the completeness re-judge all apply exactly as they
 * would to that person alone. What bulk edit adds is the batch around it:
 *
 * - **Atomic per person.** Each person's write runs in its own savepoint, so a
 *   refusal rolls back that person alone and the others stand.
 * - **The preview is the commit, rolled back.** The same writes, in the same
 *   order, in one transaction that is then thrown away: a value one person in
 *   the batch claims first is refused for the next in the preview exactly as
 *   it would be on commit, with the same reason.
 * - **Bounded.** At most `BULK_PAGE` people a request, one after another; the
 *   screen sends a larger selection a page at a time.
 *
 * HR's alone, as the completeness grid is. Every committed change is an
 * ordinary `profile_updated` with the actor and the request's correlation id
 * on its envelope: that is the audit, as it is for a single save.
 */

/** People per request: a directory page, which is what a selection comes from. */
export const BULK_PAGE = DIRECTORY_PAGE;

export interface BulkEdit {
  readonly personIds: readonly string[];
  /** Form values, as a section save takes them: the same for everybody. */
  readonly values: Readonly<Record<string, unknown>>;
  /** When the change takes effect, once for the batch. A field kept without dates changes on the day. */
  readonly effectiveFrom: string;
  /**
   * Write values that require approval straight through (PEO-077), recorded
   * on each person's event. HR's alone, as bulk edit is.
   */
  readonly applySensitiveWithoutApproval?: boolean | undefined;
}

export interface BulkChange {
  readonly key: string;
  readonly label: string;
  /** False for a field kept without dates: it changes on the day, whatever `effectiveFrom` says. */
  readonly dated: boolean;
  /** As of `effectiveFrom`, as this viewer may read it. */
  readonly before: FormValue;
  readonly after: FormValue;
}

export interface BulkRow {
  readonly personId: string;
  readonly name: string;
  /**
   * `unchanged`: every value already stood as of `effectiveFrom`, so nothing
   * is written. `held`: every value it would change waits for approval.
   */
  readonly outcome: 'changed' | 'unchanged' | 'refused' | 'held';
  readonly changes: readonly BulkChange[];
  /** Labels of the fields sent to HR for approval rather than written (PEO-077). */
  readonly held: readonly string[];
  /** Why nothing was written for this person: the single write path's own answer. */
  readonly refusal: {
    readonly code: string;
    readonly message: string;
    readonly keys: readonly string[];
  } | null;
  /** National identifiers our checks doubt (PEO-125): saved all the same, and queued for HR. */
  readonly findings: readonly IdentifierFindingView[];
}

export interface BulkResult {
  /** False for a preview: nothing was kept. */
  readonly committed: boolean;
  readonly rows: readonly BulkRow[];
}

export interface BulkEditView {
  /** The people chosen, by name, as this viewer may read them. */
  readonly people: readonly { readonly id: string; readonly name: string }[];
  /** The fields HR may set in bulk: writable, and not a lifecycle date. */
  readonly sections: readonly RecordSection[];
  /** The default `effectiveFrom`: today on the tenant's calendar. */
  readonly today: string;
  /** People per request. */
  readonly limit: number;
}

/** Types with no control a batch can fill in: a file is attached per person. */
const NO_CONTROL = new Set(['document_ref', 'image']);

const tooMany = () =>
  err(
    failure('BAD_REQUEST', `At most ${String(BULK_PAGE)} people a request; send the rest next`, [
      'personIds',
    ]),
  );

async function hrOnly(deps: ScreenDeps, tx: Tx, asking: Asking) {
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  return everyone.isHr ? ok(everyone) : err(failure('FORBIDDEN', 'Bulk edit is HR’s'));
}

/** The bulk edit screen: who is chosen, and what may be set on them. */
export async function bulkEditView(
  deps: ScreenDeps,
  asking: Asking,
  personIds: readonly string[],
): Promise<Result<BulkEditView>> {
  const ids = [...new Set(personIds)];
  if (ids.length > BULK_PAGE) return tooMany();
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await hrOnly(deps, tx, asking);
    if (!everyone.ok) return everyone;
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const people: { id: string; name: string }[] = [];
    for (const personId of ids) {
      const read = await deps.service.access.read(tx, { ...asking, personId });
      if (read.ok) people.push({ id: personId, name: nameOf(read.value.attributes) ?? 'Unnamed' });
    }
    return ok({
      people,
      sections: recordSections(
        version,
        everyone.value,
        (d) =>
          canWrite(d, everyone.value).ok &&
          !LIFECYCLE_KEYS.has(d.key) &&
          !NO_CONTROL.has(d.dataType),
        new Set(),
      ),
      today: await tenantToday(deps, tx, asking.tenantId),
      limit: BULK_PAGE,
    });
  });
}

/**
 * Preview or commit one page of a bulk edit. A preview writes everything and
 * keeps nothing; a commit keeps what each person's write kept.
 */
export async function bulkEdit(
  deps: ScreenDeps,
  asking: Asking,
  edit: BulkEdit,
  mode: 'preview' | 'commit',
): Promise<Result<BulkResult>> {
  const ids = [...new Set(edit.personIds)];
  if (ids.length > BULK_PAGE) return tooMany();
  const apply = (tx: Tx) => rows(deps, tx, asking, ids, edit);
  if (mode === 'commit') {
    const done = await run(deps.service, asking.tenantId, apply);
    return done.ok ? ok({ committed: true, rows: done.value }) : done;
  }
  const seen = await rolledBack(deps.service, asking.tenantId, apply);
  return seen.ok ? ok({ committed: false, rows: seen.value }) : seen;
}

async function rows(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  ids: readonly string[],
  edit: BulkEdit,
): Promise<Result<BulkRow[]>> {
  const everyone = await hrOnly(deps, tx, asking);
  if (!everyone.ok) return everyone;
  const form = await formChanges(deps, tx, asking.tenantId, edit.values);
  if (!form.ok) return form;
  const { changes, byKey } = form.value;
  if (Object.keys(changes).length === 0) {
    return err(failure('BAD_REQUEST', 'Choose at least one value to set', ['values']));
  }
  const asOf = { ...asking, asOf: edit.effectiveFrom };
  // One savepoint per person: a refusal rolls back that person alone.
  const savepoint = <R>(_tenant: string, fn: (scope: { tx: Tx }) => Promise<R>) =>
    tx.transaction((sp) => fn({ tx: sp }));

  const out: BulkRow[] = [];
  for (const personId of ids) {
    const before = await deps.service.access.read(tx, { ...asOf, personId });
    if (!before.ok) {
      out.push(refusedRow(personId, 'Unknown person', before.error));
      continue;
    }
    const name = nameOf(before.value.attributes) ?? 'Unnamed';
    const was = (key: string) => toForm(before.value.attributes[key]);
    // What already stands as of the date is not written again: no event for nothing.
    const differs = Object.fromEntries(
      Object.entries(changes).filter(([k, v]) => !same(was(k), toForm(v))),
    );
    if (Object.keys(differs).length === 0) {
      out.push({
        personId,
        name,
        outcome: 'unchanged',
        changes: [],
        held: [],
        refusal: null,
        findings: [],
      });
      continue;
    }
    const written = await inTenantResult(savepoint, asking.tenantId, async (sp) => {
      const saved = await deps.service.access.update(sp, {
        ...asking,
        personId,
        changes: differs,
        effectiveFrom: edit.effectiveFrom,
        ...(edit.applySensitiveWithoutApproval === true
          ? { applySensitiveWithoutApproval: true }
          : {}),
      });
      if (!saved.ok) return saved;
      const after = await deps.service.access.read(sp, { ...asOf, personId });
      return after.ok ? ok({ saved: saved.value, after: after.value }) : after;
    });
    if (!written.ok) {
      out.push(refusedRow(personId, name, written.error));
      continue;
    }
    const held = new Set((written.value.saved.held ?? []).map((h) => h.attributeKey));
    const applied = Object.keys(differs).filter((key) => !held.has(key));
    out.push({
      personId,
      name,
      outcome: applied.length === 0 ? 'held' : 'changed',
      held: [...held].map((key) => byKey.get(key)?.label.default ?? key),
      changes: applied.map((key) => ({
        key,
        label: byKey.get(key)?.label.default ?? key,
        dated: byKey.get(key)?.effectiveDated === true,
        before: was(key),
        after: toForm(written.value.after.attributes[key]),
      })),
      refusal: null,
      findings: warnings(byKey, written.value.saved.findings ?? []),
    });
  }
  return ok(out);
}

/**
 * Bulk hire: people added without a start date, hired from one (a date per
 * person where HR set one). The batch around `PersonAccess.hireExisting`,
 * exactly as bulk edit is the batch around `update`: HR only, a savepoint per
 * person so one refused leaves the others hired, and the preview the same
 * hires rolled back. Nobody is placed here: somebody with no legal entity is
 * refused with why, and placed on their profile first.
 *
 * The answer is a bulk edit's: a hired row is `changed`, its start date and
 * the status it lands on (active once the date has begun on their calendar,
 * pre-hire until then) as the two changes; a skipped row is `refused`, with
 * the reason `hireExisting` gave.
 */
export interface BulkHire {
  readonly hires: readonly { readonly personId: string; readonly hireDate: string }[];
}

const STATUS_WORD: Readonly<Record<string, string>> = {
  provisional: 'Not started',
  pre_hire: 'Starting soon',
  active: 'Active',
};

export async function bulkHire(
  deps: ScreenDeps,
  asking: Asking,
  batch: BulkHire,
  mode: 'preview' | 'commit',
): Promise<Result<BulkResult>> {
  const hires = [...new Map(batch.hires.map((h) => [h.personId, h])).values()];
  if (hires.length > BULK_PAGE) return tooMany();
  const apply = async (tx: Tx): Promise<Result<BulkRow[]>> => {
    const everyone = await hrOnly(deps, tx, asking);
    if (!everyone.ok) return everyone;
    const savepoint = <R>(_tenant: string, fn: (scope: { tx: Tx }) => Promise<R>) =>
      tx.transaction((sp) => fn({ tx: sp }));
    const out: BulkRow[] = [];
    for (const { personId, hireDate } of hires) {
      const before = await deps.service.access.read(tx, { ...asking, personId });
      if (!before.ok) {
        out.push(refusedRow(personId, 'Unknown person', before.error));
        continue;
      }
      const name = nameOf(before.value.attributes) ?? 'Unnamed';
      const hired = await inTenantResult(savepoint, asking.tenantId, (sp) =>
        deps.service.access.hireExisting(sp, { ...asking, personId, hireDate }),
      );
      if (!hired.ok) {
        out.push(refusedRow(personId, name, hired.error));
        continue;
      }
      const status = hired.value.status ?? 'pre_hire';
      out.push({
        personId,
        name,
        outcome: 'changed',
        changes: [
          { key: 'hire_date', label: 'Start date', dated: true, before: null, after: hireDate },
          {
            key: 'status',
            label: 'Status',
            dated: true,
            before: STATUS_WORD['provisional'] ?? null,
            after: STATUS_WORD[status] ?? status,
          },
        ],
        held: [],
        refusal: null,
        findings: [],
      });
    }
    return ok(out);
  };
  if (mode === 'commit') {
    const done = await run(deps.service, asking.tenantId, apply);
    return done.ok ? ok({ committed: true, rows: done.value }) : done;
  }
  const seen = await rolledBack(deps.service, asking.tenantId, apply);
  return seen.ok ? ok({ committed: false, rows: seen.value }) : seen;
}

const same = (a: FormValue, b: FormValue): boolean => JSON.stringify(a) === JSON.stringify(b);

const refusedRow = (personId: string, name: string, error: DomainFailure): BulkRow => ({
  personId,
  name,
  outcome: 'refused',
  changes: [],
  held: [],
  refusal: { code: error.code, message: error.message, keys: error.path ?? [] },
  findings: [],
});

/** A use case in its own tenant transaction, thrown away whatever it answers. */
async function rolledBack<T>(
  service: PeopleService,
  tenantId: string,
  fn: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<T>> {
  let answer: Result<T> | undefined;
  try {
    await service.inTenant(tenantId, async ({ tx }) => {
      answer = await fn(tx);
      throw ROLLBACK;
    });
  } catch (cause) {
    if (cause !== ROLLBACK) throw cause;
  }
  return answer ?? err(failure('UNAVAILABLE', 'The preview did not run'));
}

const ROLLBACK = new Error('preview: roll back');
