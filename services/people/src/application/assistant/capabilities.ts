import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  peopleCapabilities,
  PeopleFind,
  type Capability,
  type CapabilityInput,
  type CapabilityOutput,
  type CatalogueField,
  type RuntimeCatalogue,
} from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import type { CatalogueField as IntentField } from '../../domain/assistant/intent.js';
import { forModel, type PlannedField } from '../../domain/assistant/selection.js';
import type { Metric } from '../../domain/person/metrics.js';
import { refinable, usableMetrics, type Asking, type PersonView } from '../person/person-access.js';
import type { Condition } from '../person/ports.js';
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

/** Each capability People answers, by name. */
const handlers: Readonly<Record<string, Handler>> = {};

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
