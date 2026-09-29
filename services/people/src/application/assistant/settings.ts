import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import * as z from 'zod';

import { COUNTRY_PACKS } from '../../country-packs/packs.js';
import { applyPack } from '../../country-packs/packs.js';
import {
  personIn,
  planChanges,
  readChange,
  readPlan,
  sectionKeyIn,
  patched,
  specOf,
  type Change,
  type FieldSpec,
  type Plan,
  type PlanBudget,
  type PlannedChange,
  type SettingsSnapshot,
} from '../../domain/assistant/settings-plan.js';
import {
  planningContext,
  settingsPrompt,
  SETTINGS_INSTRUCTION,
  type PromptScope,
} from '../../domain/assistant/settings-prompt.js';
import { keyFrom, SchemaDraft, type Attribute, type Section } from '../../domain/schema/draft.js';
import type { Asking } from '../person/ports.js';
import type { RelationsResolver } from '../person/ports.js';
import { run, type PeopleService } from '../person/service.js';
import { fieldChange, type FieldInput, type SchemaScreenDeps } from '../screens/schema.js';
import type { AssistantPort } from './assistant-port.js';

/**
 * Settings set up in words (docs/ai-settings.md): a request becomes a plan,
 * the administrator reviews it, and applying it runs the settings commands
 * the screens run.
 *
 * **The model never writes.** It is shown the request and the settings — the
 * sections and fields, legal entities and locations; never a person and never
 * a value — through the AI gateway, and answers with tool calls describing
 * changes. People reads those strictly (`domain/assistant/settings-plan.ts`),
 * and checks each field change against a copy of the draft, so the review
 * shows what the draft would refuse before anybody presses apply.
 *
 * **Applying** is the administrator's, and it is the settings commands, one
 * by one, in the same order the plan shows: the same routes the screens call,
 * so each one checks who may, checks the domain's rules again, and is written
 * to the activity log — as done with the AI assistant, with the plan's
 * summary as the reason. The request itself is never logged: it may name
 * somebody. Employee fields land in the draft, and publishing stays the
 * administrator's own step, with its preview.
 */

type Tx = PostgresJsDatabase;

export interface SettingsAssistantDeps {
  readonly service: PeopleService;
  readonly relations: RelationsResolver;
  readonly clock: Clock;
  /** The model, behind the AI gateway. Absent: nothing is configured, and the flow says so. */
  readonly settingsPlanner?: AssistantPort;
  readonly planBudget: PlanBudget;
  /** The settings as they are, and the whole draft (archived rows too) to check changes against. */
  readonly readSettings: (tx: Tx, asking: Asking) => Promise<SettingsRead>;
}

export interface SettingsRead {
  readonly snapshot: SettingsSnapshot;
  readonly draft: {
    readonly sections: readonly Section[];
    readonly attributes: readonly Attribute[];
  };
}

/** The longest request read: a copied company's settings fit, an essay does not. */
export const REQUEST_LIMIT = 60_000;

const NOT_ADMIN = failure('FORBIDDEN', 'Only a People administrator sets up the settings');

async function asAdmin<T>(
  deps: SettingsAssistantDeps,
  asking: Asking,
  then: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<T>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    return everyone.isAdmin ? then(tx) : err(NOT_ADMIN);
  });
}

const NOBODY = '00000000-0000-0000-0000-000000000000';

/** What the model answered: tool calls, as the transport hands them over. */
const Calls = z.object({
  calls: z.array(z.object({ name: z.string().max(64), input: z.unknown() })).max(400),
});

/* ------------------------------------------------------------ propose -- */

export async function proposeSettings(
  deps: SettingsAssistantDeps,
  asking: Asking,
  request: string,
): Promise<Result<Plan>> {
  const planner = deps.settingsPlanner;
  if (planner === undefined) {
    return err(
      failure('UNAVAILABLE', 'Setting up with AI is not available here: no model is configured'),
    );
  }
  const words = request.trim();
  if (words === '')
    return err(failure('REQUEST_EMPTY', 'Say what you would like set up', ['request']));
  if (words.length > REQUEST_LIMIT) {
    return err(
      failure('REQUEST_TOO_LONG', 'That request is too long to plan in one go: split it', [
        'request',
      ]),
    );
  }

  const read = await asAdmin(deps, asking, async (tx) => {
    const spent = deps.planBudget.take(asking.tenantId, deps.clock.instant());
    if (!spent.ok) {
      const minutes = Math.ceil(spent.retryAfterSeconds / 60);
      return err(
        failure(
          'RATE_LIMITED',
          `Your company has asked for ${String(deps.planBudget.limit)} plans in the last hour. Try again in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`,
        ),
      );
    }
    await planner.loadPolicies(tx, asking.tenantId);
    return ok(await deps.readSettings(tx, asking));
  });
  if (!read.ok) return read;

  const answered = await planner.complete(asking.tenantId, {
    instruction: SETTINGS_INSTRUCTION,
    context: planningContext(read.value.snapshot, words),
    about: 'configuration',
  });
  if (!answered.ok) {
    return err(
      answered.error.code === 'AI_VALUE_SHAPED'
        ? failure(
            'REQUEST_HOLDS_VALUE',
            `${answered.error.message.split('.')[0] ?? 'It holds a value'}. Describe the settings, not anybody’s details, and try again.`,
            ['request'],
          )
        : failure('ASSISTANT_REFUSED', 'The request could not be sent to the assistant', [
            'request',
          ]),
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.value);
  } catch {
    parsed = null;
  }
  const calls = Calls.safeParse(parsed);
  if (!calls.success) {
    return err(
      failure('ASSISTANT_UNREADABLE', 'The assistant’s answer could not be read. Try again.'),
    );
  }
  const plan = readPlan(calls.data.calls, read.value.snapshot);
  return ok({ ...plan, changes: checked(plan.changes, read.value, deps.clock) });
}

/* -------------------------------------------------------------- check -- */

/**
 * Each field change tried against a copy of the draft, in order, as the
 * settings commands will make it: what the draft refuses becomes the change's
 * problem, in the draft's own words, before anybody applies anything.
 */
export function checked(
  changes: readonly PlannedChange[],
  read: SettingsRead,
  clock: Clock,
): PlannedChange[] {
  const draft = SchemaDraft.rehydrate(read.draft.sections, read.draft.attributes);
  const attributes: Attribute[] = [...read.draft.attributes];
  const sections = (): Map<string, string> =>
    new Map(draft.liveSections().map((s) => [s.key, s.label.default]));
  return changes.map((planned) => {
    if (planned.problem !== null) return planned;
    const tried = ((): Result<unknown> => {
      const c = planned.change;
      switch (c.kind) {
        case 'add_country_pack':
          return applyPack(draft, COUNTRY_PACKS[c.country]);
        case 'add_section':
          return draft.addSection({
            key: c.key ?? keyFrom(c.label),
            label: { default: c.label, translations: {} },
            order: draft.liveSections().length,
            defaultVisibility: ['self', 'hr'],
            origin: 'tenant',
          });
        case 'rename_section':
          return draft.renameSection(
            sectionKeyIn(c.sectionKey, sections()) ?? c.sectionKey,
            c.label,
          );
        case 'remove_section':
          return draft.archiveSection(
            sectionKeyIn(c.sectionKey, sections()) ?? c.sectionKey,
            clock,
          );
        case 'add_field':
        case 'edit_field': {
          const input = fieldInputOf(c, draft, sections());
          if (!input.ok) return input;
          const saved = fieldChange(
            draft,
            attributes,
            input.value,
            c.kind === 'edit_field' ? c.key : null,
          );
          if (saved.ok && c.kind === 'add_field') attributes.push(saved.value);
          return saved;
        }
        case 'remove_field':
          return draft.archiveAttribute(c.key, clock);
        default:
          return ok(undefined);
      }
    })();
    return tried.ok ? planned : { ...planned, problem: tried.error.message };
  });
}

/** The field editor's input for an added or changed field, as the save route takes it. */
export function fieldInputOf(
  change: Extract<Change, { kind: 'add_field' | 'edit_field' }>,
  draft: Pick<SchemaDraft, 'attribute'>,
  sections: ReadonlyMap<string, string>,
): Result<FieldInput> {
  const current = change.kind === 'edit_field' ? draft.attribute(change.key) : undefined;
  if (change.kind === 'edit_field' && current === undefined) {
    return err(failure('ATTRIBUTE_UNKNOWN', `There is no field called ${change.key}`, ['key']));
  }
  const spec: FieldSpec =
    change.kind === 'add_field'
      ? change.field
      : patched(specOf(current as Attribute), change.changes);
  const sectionKey = sectionKeyIn(spec.sectionKey, sections);
  if (sectionKey === null) {
    return err(
      failure('SECTION_UNKNOWN', `There is no section called ${spec.sectionKey}`, ['sectionKey']),
    );
  }
  const reclassified =
    current === undefined ||
    spec.classification !== current.classification.classification ||
    spec.piiKind !== current.classification.piiKind;
  return ok({
    key: change.kind === 'edit_field' ? change.key : (spec.key ?? ''),
    sectionKey,
    label: spec.label,
    description: spec.description ?? null,
    dataType: spec.dataType,
    options: spec.options ?? [],
    requiredness: spec.requiredness,
    requiredWhen: spec.requiredWhen ?? null,
    ownership: spec.ownership,
    collectAt: spec.collectAt,
    visibility: spec.visibility,
    visibilityRules: spec.visibilityRules ?? [],
    classification: spec.classification,
    piiKind: spec.piiKind,
    // A model proposed it and a person accepted it: the audit's own word for that.
    classificationSource: reclassified ? 'suggested' : current.classificationSource,
    requiresApproval: current?.requiresApproval ?? null,
    encrypted: spec.encrypted ?? current?.encrypted ?? null,
    aiEligible: spec.aiEligible ?? null,
    country: spec.country ?? null,
    scheme: spec.scheme ?? null,
  });
}

/* -------------------------------------------------------------- apply -- */

/** One settings command: a route the screens already use, and what to send it. */
export interface SettingsCommand {
  readonly method: 'POST' | 'PUT' | 'PATCH';
  readonly path: string;
  readonly body: unknown;
}

/** Runs one command as the administrator applying the plan; the id of what it made, when it made one. */
export type SettingsDispatch = (
  command: SettingsCommand,
  index: number,
) => Promise<Result<{ readonly id?: string } | undefined>>;

export const ApplyInput = z.strictObject({
  summary: z.string().trim().min(1).max(300),
  /** The changes the administrator kept, edited or not. */
  changes: z
    .array(z.looseObject({ id: z.string().max(20) }))
    .min(1)
    .max(400),
  /** The flagged ones among them, ticked on purpose. */
  confirmed: z.array(z.string().max(20)).max(400),
});
export type ApplyInput = z.infer<typeof ApplyInput>;

export interface AppliedChange {
  readonly id: string;
  readonly title: string;
  readonly subject: string;
  readonly ok: boolean;
  /** Why it was not applied. */
  readonly message: string | null;
}

export interface ApplyResult {
  readonly applied: number;
  readonly failed: number;
  readonly changes: readonly AppliedChange[];
  /** An employee-field change landed in the draft: publishing is the administrator's next step. */
  readonly publish: boolean;
}

const ENC = encodeURIComponent;

/**
 * The command a planned change is applied with. `created` holds the legal
 * entities made earlier in the same apply, by lower-cased name, so a location
 * or numbering may name one the plan adds.
 */
export function commandFor(
  planned: PlannedChange,
  read: SettingsRead,
  created: ReadonlyMap<string, string>,
  summary: string,
): Result<SettingsCommand> {
  const s = read.snapshot;
  const sections = new Map(s.sections.map((x) => [x.key, x.label]));
  const sectionOf = (named: string): string => sectionKeyIn(named, sections) ?? keyFrom(named);
  const entityId = (named: string): Result<string> => {
    const key = named.trim().toLocaleLowerCase('en');
    const id =
      s.organisation.entities.find(
        (e) => e.id === named || e.name.trim().toLocaleLowerCase('en') === key,
      )?.id ?? created.get(key);
    return id === undefined
      ? err(
          failure(
            'ENTITY_UNKNOWN',
            `The legal entity ${named} was not added, so this could not be`,
          ),
        )
      : ok(id);
  };
  const c = planned.change;
  switch (c.kind) {
    case 'add_country_pack':
      return ok({ method: 'POST', path: '/v1/schema/draft/packs', body: { country: c.country } });
    case 'add_section':
      return ok({
        method: 'POST',
        path: '/v1/schema/draft/sections',
        body: { label: c.label, ...(c.key === undefined ? {} : { key: c.key }) },
      });
    case 'rename_section':
      return ok({
        method: 'PATCH',
        path: `/v1/schema/draft/sections/${ENC(sectionOf(c.sectionKey))}`,
        body: { label: c.label },
      });
    case 'remove_section':
      return ok({
        method: 'POST',
        path: `/v1/schema/draft/sections/${ENC(sectionOf(c.sectionKey))}/archive`,
        body: {},
      });
    case 'reorder_sections':
      return ok({
        method: 'PUT',
        path: '/v1/schema/draft/sections/order',
        body: { order: c.order.map(sectionOf) },
      });
    case 'add_field':
    case 'edit_field': {
      const draft = SchemaDraft.rehydrate(read.draft.sections, read.draft.attributes);
      const live = new Map<string, string>(
        draft.liveSections().map((x) => [x.key, x.label.default]),
      );
      // A section this apply added is not in the draft that was read.
      const named = c.kind === 'add_field' ? c.field.sectionKey : null;
      if (named !== null && sectionKeyIn(named, live) === null) live.set(keyFrom(named), named);
      const input = fieldInputOf(c, draft, live);
      if (!input.ok) return input;
      return ok({
        method: 'POST',
        path: '/v1/schema/draft/attributes',
        body: { input: input.value, editing: c.kind === 'edit_field' ? c.key : null },
      });
    }
    case 'remove_field':
      return ok({
        method: 'POST',
        path: `/v1/schema/draft/attributes/${ENC(c.key)}/archive`,
        body: {},
      });
    case 'reorder_fields':
      return ok({
        method: 'PUT',
        path: `/v1/schema/draft/sections/${ENC(sectionOf(c.sectionKey))}/order`,
        body: { order: c.order },
      });
    case 'add_legal_entity':
      return ok({
        method: 'POST',
        path: '/v1/legal-entities',
        body: { name: c.name, country: c.country, timeZone: c.timeZone },
      });
    case 'edit_legal_entity': {
      const id = entityId(c.legalEntity);
      if (!id.ok) return id;
      return ok({
        method: 'PATCH',
        path: `/v1/legal-entities/${id.value}`,
        body: {
          ...(c.name === undefined ? {} : { name: c.name }),
          ...(c.timeZone === undefined ? {} : { timeZone: c.timeZone }),
        },
      });
    }
    case 'set_numbering': {
      const id = entityId(c.legalEntity);
      if (!id.ok) return id;
      return ok({
        method: 'PUT',
        path: `/v1/legal-entities/${id.value}/numbering`,
        body: { prefix: c.prefix, digits: c.digits, start: c.start },
      });
    }
    case 'add_location': {
      const id = entityId(c.legalEntity);
      if (!id.ok) return id;
      return ok({
        method: 'POST',
        path: '/v1/locations',
        body: { legalEntityId: id.value, name: c.name, country: c.country, timeZone: c.timeZone },
      });
    }
    case 'edit_location': {
      const found = s.organisation.locations.find(
        (l) =>
          l.id === c.location ||
          l.name.toLocaleLowerCase('en') === c.location.trim().toLocaleLowerCase('en'),
      );
      if (found === undefined)
        return err(failure('LOCATION_UNKNOWN', `There is no work location called ${c.location}`));
      return ok({ method: 'PATCH', path: `/v1/locations/${found.id}`, body: { name: c.name } });
    }
    case 'set_default_time_zone':
      return ok({ method: 'PATCH', path: '/v1/settings', body: { defaultTimeZone: c.timeZone } });
    case 'set_cohort_minimum':
      return ok({ method: 'PATCH', path: '/v1/settings', body: { cohortMinimum: c.minimum } });
    case 'grant_role':
    case 'revoke_role': {
      const who = personIn(c.person, s.people);
      if (typeof who === 'string') return err(failure('PERSON_UNKNOWN', who));
      return ok({
        method: 'POST',
        path: c.kind === 'grant_role' ? '/v1/roles/grants' : '/v1/roles/revocations',
        body: {
          accountId: who.accountId,
          role: c.role,
          reason: `With the AI assistant: ${summary}`.slice(0, 500),
        },
      });
    }
  }
}

/**
 * Apply the changes an administrator kept. Read and checked again first — an
 * edited plan is untrusted like a proposed one, and the settings may have
 * moved since it was proposed — and refused whole if a flagged change was not
 * ticked on purpose. Then each command in order; one refused does not stop
 * the rest, and the answer says which were applied and why any were not.
 */
export async function applySettings(
  deps: SettingsAssistantDeps,
  asking: Asking,
  input: ApplyInput,
  dispatch: SettingsDispatch,
): Promise<Result<ApplyResult>> {
  const changes: (Change & { id: string })[] = [];
  for (const raw of input.changes) {
    const { id, ...rest } = raw;
    const change = readChange(rest);
    if (change === null) {
      return err(
        failure('CHANGE_INVALID', `Change ${id} is not one People can apply`, ['changes']),
      );
    }
    changes.push({ ...change, id });
  }
  const read = await asAdmin(deps, asking, async (tx) => ok(await deps.readSettings(tx, asking)));
  if (!read.ok) return read;

  const planned = checked(planChanges(changes, read.value.snapshot), read.value, deps.clock);
  const unconfirmed = planned.filter((p) => p.confirm !== null && !input.confirmed.includes(p.id));
  if (unconfirmed.length > 0) {
    return err(
      failure(
        'CONFIRMATION_REQUIRED',
        `Confirm ${unconfirmed.map((p) => `“${p.subject}”`).join(', ')} on purpose before applying`,
        ['confirmed'],
      ),
    );
  }

  const created = new Map<string, string>();
  const results: AppliedChange[] = [];
  for (const [index, p] of planned.entries()) {
    const said = { id: p.id, title: p.title, subject: p.subject };
    if (p.problem !== null) {
      results.push({ ...said, ok: false, message: p.problem });
      continue;
    }
    const command = commandFor(p, read.value, created, input.summary);
    if (!command.ok) {
      results.push({ ...said, ok: false, message: command.error.message });
      continue;
    }
    // One at a time, in order: a location names the entity made before it.

    const done = await dispatch(command.value, index);
    if (done.ok && p.change.kind === 'add_legal_entity' && done.value?.id !== undefined) {
      created.set(p.change.name.trim().toLocaleLowerCase('en'), done.value.id);
    }
    results.push({ ...said, ok: done.ok, message: done.ok ? null : done.error.message });
  }
  const applied = results.filter((r) => r.ok);
  return ok({
    applied: applied.length,
    failed: results.length - applied.length,
    changes: results,
    publish: planned.some(
      (p) => (p.area === 'fields' || p.area === 'packs') && applied.some((r) => r.id === p.id),
    ),
  });
}

/* ------------------------------------------------------------ reading -- */

/**
 * The settings, read in the caller's transaction: the draft and what is
 * published, the organisation, and who holds which role. What fails to read
 * is left out rather than guessed — a company with no org store has no
 * entities to name.
 */
export function readSettingsFrom(deps: SchemaScreenDeps): SettingsAssistantDeps['readSettings'] {
  return async (tx, asking) => {
    const tenantId = asking.tenantId;
    const [draft, published] = await Promise.all([
      deps.schema.loadDraft(tx, tenantId),
      deps.schema.currentVersion(tx, tenantId),
    ]);
    const byOrder = <T extends { readonly order: number }>(a: T, b: T): number => a.order - b.order;
    const sections = draft.sections.filter((s) => s.archivedAt === null).toSorted(byOrder);
    const fields = sections.flatMap((s) =>
      draft.attributes
        .filter((a) => a.sectionKey === s.key && a.deprecatedAt === null)
        .toSorted(byOrder),
    );
    const org = deps.service.org;
    const [settings, entities, locations, numberings] = org
      ? await Promise.all([
          org.settings(tx, asking),
          org.legalEntities(tx, asking),
          org.locations(tx, asking),
          org.numberings(tx, asking),
        ])
      : [null, null, null, null];
    const schemes = numberings?.ok ? numberings.value : [];
    const roles = deps.service.roles ? await deps.service.roles.list(tx, asking) : null;
    const held = new Map((roles?.ok ? roles.value.holders : []).map((h) => [h.accountId, h.roles]));
    return {
      draft,
      snapshot: {
        sections: sections.map((s) => ({ key: s.key, label: s.label.default, origin: s.origin })),
        fields,
        published:
          published === null
            ? null
            : {
                version: published.version,
                fieldKeys: published.document.attributes.map((a) => a.key),
              },
        organisation: {
          defaultTimeZone: settings?.ok ? settings.value.defaultTimeZone : 'UTC',
          cohortMinimum: settings?.ok ? settings.value.cohortMinimum : 10,
          entities: (entities?.ok ? entities.value : [])
            .filter((e) => !e.archived)
            .map((e) => {
              const n = schemes.find((x) => x.legalEntityId === e.id);
              return {
                id: e.id,
                name: e.name,
                country: e.country,
                timeZone: e.timeZone,
                numbering:
                  n === undefined
                    ? null
                    : { prefix: n.prefix, digits: n.digits, next: n.nextValue },
              };
            }),
          locations: (locations?.ok ? locations.value : [])
            .filter((l) => !l.archived)
            .map((l) => ({
              id: l.id,
              name: l.name,
              country: l.country,
              legalEntityId: l.legalEntityId,
              timeZone: l.timeZone,
            })),
        },
        people: (roles?.ok ? roles.value.candidates : []).map((c) => ({
          accountId: c.accountId,
          name: c.name,
          roles: held.get(c.accountId) ?? [],
        })),
        viewerAccountId: asking.viewer.accountId,
      },
    };
  };
}

/* ----------------------------------------------------- copy as prompt -- */

/** A setting, an area or everything, written out as a request (`settingsPrompt`). */
export async function settingsPromptOf(
  deps: SettingsAssistantDeps,
  asking: Asking,
  scope: PromptScope,
): Promise<Result<string>> {
  return asAdmin(deps, asking, async (tx) => {
    const { snapshot } = await deps.readSettings(tx, asking);
    const text = settingsPrompt(snapshot, scope);
    return text === null ? err(failure('NOT_FOUND', 'There is no such setting to copy')) : ok(text);
  });
}
