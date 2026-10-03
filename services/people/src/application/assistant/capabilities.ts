import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  ASSISTANT_LIMITS,
  peopleCapabilities,
  PeopleFind,
  type AmbiguousResult,
  type Capability,
  type CapabilityInput,
  type CapabilityOutput,
  type CatalogueField,
  type NotFoundResult,
  type PersonRow,
  type RuntimeCatalogue,
} from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import type { CatalogueField as IntentField } from '../../domain/assistant/intent.js';
import {
  forModel,
  readDirectoryPlan,
  type DirectoryPlan,
  type PlannedField,
} from '../../domain/assistant/selection.js';
import type { Metric } from '../../domain/person/metrics.js';
import {
  refinable,
  REPORTS_TO,
  usableMetrics,
  type Asking,
  type PersonView,
} from '../person/person-access.js';
import type { Condition, Refine } from '../person/ports.js';
import { run } from '../person/service.js';
import { fieldKind, STATUS_OPTIONS } from '../screens/people.js';
import { nameOf, NOBODY, type ScreenDeps, type Tx } from '../screens/record.js';

/**
 * People's capabilities for the assistant (assistant PRD §8, §10.3, §16): the
 * catalogue it offers an asker, and the read-only queries it answers.
 *
 * Every one runs as the asker, through the same use cases as People's own
 * screens — `access.list`, `count`, `read`, `readMany`, the approvals inbox —
 * so who may see what is decided where it always is, and never here. The
 * catalogue is configuration only: field names, option labels, metric names,
 * never a value from anybody's record.
 *
 * `filterFields`, `metricsFor`, `describe`, `personLine` and the `@me`
 * resolution live here because the Slack answer (`ask.ts`) and smart search
 * share them, and `ask.ts` goes once Slack asks the assistant (AST-026).
 */

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The fields this asker may filter everybody by, each saying whether the
 * assistant may use it (`aiEligible`). The directory's search in words names
 * the others to a model for "is empty" alone (`domain/assistant/selection.ts`).
 */
export async function filterFields(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
): Promise<PlannedField[]> {
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return [];
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  const definitions = version.document.attributes;
  const org = await deps.calendars.load(tx, asking.tenantId);
  const fields = definitions.flatMap((d): PlannedField[] => {
    const kind = fieldKind(d.typeConfig.kind);
    if (
      kind === null ||
      d.encrypted ||
      d.deprecatedAt !== null ||
      !visibleTo(d, everyone) ||
      !refinable(
        definitions,
        { conditions: [{ key: d.key, op: 'not_empty', values: [] }] },
        everyone,
      ).ok
    ) {
      return [];
    }
    const options =
      d.typeConfig.kind === 'select'
        ? d.typeConfig.options
            .filter((o) => o.retiredAt === null)
            .map((o) => ({ value: o.value, label: o.label.default }))
        : d.typeConfig.kind === 'location_ref'
          ? [...org.locations.values()]
              .filter((l) => l.archived !== true)
              .map((l) => ({ value: l.id, label: l.name }))
          : d.typeConfig.kind === 'legal_entity_ref'
            ? [...org.entities.values()]
                .filter((e) => e.archived !== true)
                .map((e) => ({ value: e.id, label: e.name }))
            : [];
    return [{ key: d.key, label: d.label.default, kind, options, ai: d.classification.aiEligible }];
  });
  return everyone.isHr
    ? [
        ...fields,
        { key: 'status', label: 'Status', kind: 'status', options: STATUS_OPTIONS, ai: true },
      ]
    : fields;
}

/** What People works out about each person that this person may order and narrow by. */
export async function metricsFor(deps: ScreenDeps, tx: Tx, asking: Asking): Promise<Metric[]> {
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return [];
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  return usableMetrics(
    version.document.attributes.filter((d) => d.deprecatedAt === null),
    everyone,
  );
}

export const personLine = (p: PersonView): { id: string; name: string; title: string | null } => ({
  id: p.id,
  name: nameOf(p.attributes) ?? text(p.attributes['work_email']) ?? 'Unnamed',
  title: text(p.attributes['job_title']),
});

/** A calendar date as people say it: "12 March 2019". */
export function spokenDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * Who the conditions pick out, as a sentence ends: "whose department is Sales
 * and who started after 1 January 2020". "everyone" when there are none.
 */
export function describe(
  conditions: readonly Condition[],
  catalogue: readonly IntentField[],
  match: 'all' | 'any' = 'all',
): string {
  if (conditions.length === 0) return 'across the company';
  return conditions
    .map((c) => {
      const f = catalogue.find((x) => x.key === c.key);
      const label = (f?.label ?? c.key).toLowerCase();
      const values = c.values.map((v) => {
        const option = f?.options.find((o) => o.value === v)?.label;
        return option ?? (f?.kind === 'date' && v !== '' ? spokenDate(v) : v);
      });
      switch (c.op) {
        case 'empty':
          return `with no ${label} yet`;
        case 'not_empty':
          return `with a ${label}`;
        case 'not_in':
          return `whose ${label} is not ${values.join(' or ')}`;
        case 'under':
          return 'in the team below somebody';
        case 'contains':
          return `whose ${label} mentions ${values.join(' or ')}`;
        case 'before':
          return `whose ${label} is before ${values[0] ?? ''}`;
        case 'after':
          return `whose ${label} is after ${values[0] ?? ''}`;
        case 'between':
          return `whose ${label} is between ${values[0] || 'the start'} and ${values[1] || 'today'}`;
        default:
          return `whose ${label} is ${values.join(' or ')}`;
      }
    })
    .join(match === 'any' ? ', or ' : ' and ');
}

/** How the model, or a person, names the asker. */
export const SELF = /^(@me|me|myself|i|my self)$/iu;

/** One person by name, as the asker may find them; null when nobody or several match. */
export async function onePerson(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  name: string,
): Promise<{ person: PersonView | null; several: readonly PersonView[]; self?: 'none' }> {
  // "Me" is whoever asks: resolved here, so the model never needs their name.
  if (SELF.test(name.trim())) {
    const own = await deps.personOf(tx, asking.tenantId, asking.viewer.accountId);
    if (own === null) return { person: null, several: [], self: 'none' };
    const read = await deps.service.access.read(tx, { ...asking, personId: own });
    return { person: read.ok ? read.value : null, several: [] };
  }
  const found = await deps.service.access.list(tx, { ...asking, search: name, limit: 5 });
  const items = found.ok ? found.value.items : [];
  return items.length === 1
    ? { person: items[0] ?? null, several: [] }
    : { person: null, several: items };
}

/* ------------------------------------------------------------ catalogue -- */

type Handler = (
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  input: CapabilityInput,
) => Promise<Result<CapabilityOutput>>;

type PersonId = PersonRow['personId'];

/** One person in a result, as the asker may name them. */
function row(p: PersonView, groups: PersonRow['groups'] = {}): PersonRow {
  const line = personLine(p);
  return {
    personId: line.id as PersonId,
    name: line.name,
    ...(line.title === null ? {} : { title: line.title }),
    groups,
  };
}

/** Somebody named in a question, as the asker may find them: one, several to choose from, or nobody. */
async function named(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  name: string,
): Promise<{ readonly person: PersonView } | AmbiguousResult | NotFoundResult> {
  const { person, several, self } = await onePerson(deps, tx, asking, name);
  if (self === 'none') return { kind: 'not_found', self: true };
  if (person !== null) return { person };
  if (several.length === 0) return { kind: 'not_found', name };
  return {
    kind: 'ambiguous',
    name,
    candidates: several.map((p) => {
      const { groups: _, ...candidate } = row(p);
      return candidate;
    }),
  };
}

const refusedSelection = () =>
  err(failure('BAD_REQUEST', 'People cannot run that selection', ['filters']));

/**
 * `people.find`: smart search's selection, run as the asker (PRD §7.3, §9.5).
 *
 * The filters, order and group are read by smart search's own reader
 * (`readDirectoryPlan`) against the fields and metrics this asker may use; a
 * manager by name is their whole team, found as the asker may search, or
 * `@me`'s. Then the directory's `count` and `list`, narrowed to `personIds`
 * when the assistant joins, authorized exactly as without them.
 */
const find: Handler = async (deps, tx, asking, input) => {
  const fields = await filterFields(deps, tx, asking);
  const metrics = await metricsFor(deps, tx, asking);
  const filters = input.filters ?? [];
  const match = input.match ?? 'all';
  const self = input.name !== undefined && SELF.test(input.name.trim());
  let plan: DirectoryPlan | null = null;
  if (
    filters.length > 0 ||
    input.sort !== undefined ||
    input.groupBy !== undefined ||
    (input.name !== undefined && !self)
  ) {
    plan = readDirectoryPlan(
      {
        conditions: filters,
        match,
        sort: input.sort ?? null,
        groupBy: input.groupBy ?? null,
        manager: input.name === undefined || self ? null : { name: input.name, scope: 'all' },
      },
      forModel(fields),
      metrics,
    );
    if (plan === null) return refusedSelection();
  }
  // A group is counted by its options' names: a field without options has none to give.
  const group = fields.find((f) => f.key === plan?.group);
  if (input.groupBy !== undefined && (group === undefined || group.options.length === 0)) {
    return refusedSelection();
  }

  const conditions: Condition[] = [...(plan?.conditions ?? [])];
  let team: string | null = null;
  if (input.name !== undefined) {
    const found = await named(deps, tx, asking, input.name);
    if (!('person' in found)) return ok(found);
    conditions.push({ key: REPORTS_TO, op: 'under', values: [found.person.id] });
    team = personLine(found.person).name;
  }
  // "Engineering or Sales, in Marco's team" is not one list of conditions.
  if (team !== null && match === 'any' && conditions.length > 2) return refusedSelection();
  const refine: Refine = {
    conditions,
    match: team === null ? match : 'all',
    ...(plan === null || plan.sort === null ? {} : { sort: plan.sort }),
    ...(input.personIds === undefined ? {} : { personIds: input.personIds }),
  };

  const counted = await deps.service.access.count(tx, { ...asking, refine });
  if (!counted.ok) return counted;
  const total = counted.value.all;
  const limit = input.limit ?? 0;
  // Ids only when a later step needs them, and never a truncated list: the
  // assistant reads a total over the limit as too broad to join (§9.3).
  // ponytail: up to 5,000 people read as views to take their ids; an id-only
  // read through the same authorization if a join is ever felt.
  const ids = input.ids === true && total <= ASSISTANT_LIMITS.ids;
  const wanted = Math.max(limit, ids ? ASSISTANT_LIMITS.ids : 0);
  const listed =
    wanted === 0
      ? ok({ items: [] as readonly PersonView[], next: null })
      : await deps.service.access.list(tx, { ...asking, refine, limit: wanted });
  if (!listed.ok) return listed;
  const items = listed.value.items;

  const groupOf = (p: PersonView): PersonRow['groups'] => {
    if (group === undefined) return {};
    const value = group.key === 'status' ? p.status : p.attributes[group.key];
    const label = group.options.find((o) => o.value === value)?.label;
    return label === undefined ? {} : { [group.key]: label };
  };
  const what =
    plan === null || plan.conditions.length === 0 ? null : describe(plan.conditions, fields, match);
  const described =
    [team === null ? null : `in ${team}’s team`, what].filter((x) => x !== null).join(' ') ||
    'across the company';
  return ok({
    kind: 'people',
    rows: items.slice(0, limit).map((p) => row(p, groupOf(p))),
    ...(ids ? { ids: items.map((p) => p.id as PersonId) } : {}),
    total,
    // The directory: every current colleague to anybody, and leavers too to HR.
    scope: 'everyone',
    described: described.slice(0, 240),
    notes: [],
  });
};

/** Each capability People answers, by name. */
const handlers: Readonly<Record<string, Handler>> = {
  [PeopleFind.name]: find,
};

const served = (): readonly Capability[] => peopleCapabilities.filter((c) => c.name in handlers);

/**
 * What People offers this asker (PRD §8.5): `people.find`'s fields are what
 * smart search shows its model (`filterFields` then `forModel`), the metrics
 * they may order by, and the company's not-for-AI keys and words for the
 * assistant's AI gateway. A field not for AI is left out of the fields rather
 * than named for "is empty" as smart search does: the catalogue has no kind
 * for it, and its label is in `denied`, which the gateway refuses to send.
 */
export function catalogue(deps: ScreenDeps, asking: Asking): Promise<Result<RuntimeCatalogue>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const fields = await filterFields(deps, tx, asking);
    const metrics = await metricsFor(deps, tx, asking);
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    return ok({
      module: 'people' as const,
      serves: served().map((c) => ({ name: c.name, version: c.version })),
      fields: {
        [PeopleFind.name]: forModel(fields).flatMap((f) =>
          // `filterFields` gives the catalogue's kinds; `presence` is the one it has no word for.
          f.kind === 'presence'
            ? []
            : [{ ...f, kind: f.kind as CatalogueField['kind'], options: [...f.options] }],
        ),
      },
      metrics: metrics.map((m) => ({ key: m.key, label: m.label })),
      leaveTypes: [],
      denied: (version?.document.attributes ?? [])
        .filter((a) => !a.classification.aiEligible)
        .map((a) => ({
          key: a.key,
          // Every locale, as `loadTenantPolicies` reads them.
          labels: [
            a.label.default,
            ...Object.values(
              (a.label as { translations?: Record<string, string> }).translations ?? {},
            ),
          ],
        })),
    });
  });
}

/**
 * One capability, called as the asker with what the assistant sent. The
 * input is read against the capability's own schema: the module's lock, the
 * one that counts (PRD §9.2).
 */
export async function answer(
  deps: ScreenDeps,
  asking: Asking,
  name: string,
  raw: unknown,
): Promise<Result<CapabilityOutput>> {
  const capability = served().find((c) => c.name === name);
  const handler = handlers[name];
  if (capability === undefined || handler === undefined) {
    return err(failure('NOT_FOUND', `People does not answer ${name}`));
  }
  const input = capability.schemas.input.safeParse(raw);
  if (!input.success) {
    const issue = input.error.issues[0];
    return err(
      failure(
        'BAD_REQUEST',
        issue?.message ?? 'Not an input this capability takes',
        issue?.path.map(String),
      ),
    );
  }
  return run(deps.service, asking.tenantId, (tx) => handler(deps, tx, asking, input.data));
}
