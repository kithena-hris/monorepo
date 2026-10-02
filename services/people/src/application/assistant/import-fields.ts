import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import * as z from 'zod';

import { shapeOf } from '../../domain/import/column-shape.js';
import { NEW_FIELDS_INSTRUCTION, newFieldsContext } from '../../domain/import/new-fields-prompt.js';
import {
  asDefinition,
  ColumnProposal,
  localProposal,
  sensitivity,
  takenKeys,
  withKeys,
  withModel,
  type ColumnCounts,
  type ColumnSeen,
  type PlanBudget,
} from '../../domain/import/new-fields.js';
import { planOf, type PlanStep } from '../../domain/import/plan.js';
import { keyFrom, SchemaDraft, type Attribute, type Section } from '../../domain/schema/draft.js';
import { publish, type PublishedVersion } from '../../domain/schema/publish.js';
import type { Asking } from '../person/ports.js';
import { run } from '../person/service.js';
import { userActor } from '../person/ports.js';
import type { ImportStageView, NewFieldsFile } from '../screens/operations.js';
import { fieldChange, type FieldInput, type SchemaScreenDeps } from '../screens/schema.js';
import { seedSetup, setupDraft } from '../screens/setup-draft.js';
import type { AssistantPort } from './assistant-port.js';

/**
 * The import, from its new columns to the approved plan (docs/ai-settings.md;
 * design AI9 to AI12).
 *
 * Columns that match no field are proposed as fields (the model from headers
 * and value shapes, People's own rules without it); HR decides what happens
 * for the people without a value; then one plan says everything the import
 * will do, from a dry run against the version those fields would make, and
 * nothing is written until a People administrator approves it. Approving
 * creates the fields, publishes them, writes any defaults and imports, in
 * that order.
 *
 * **A company with nothing published imports too.** The file is read against
 * what setup would publish (its legal entity's country pack, every section
 * on), and approving the plan sets the company up and publishes the pack and
 * the new fields as version 1 together. HR without administrator rights
 * cannot set a company up or add fields: they see the proposal read-only and
 * import without those columns, once something is published.
 *
 * Existing fields and sections are never touched.
 */

type Tx = PostgresJsDatabase;

type ImportReview = Extract<ImportStageView, { step: 'review' }>;
type ImportDone = Extract<ImportStageView, { step: 'done' }>;

export interface NewFieldsDeps extends SchemaScreenDeps {
  /** The model, behind the AI gateway; absent, People's own proposal. */
  readonly fieldPlanner?: AssistantPort;
  readonly planBudget: PlanBudget;
  /** The file, read and classified with the mapping so far (`newFieldsFile`). */
  readonly importFile: (asking: Asking, step: ImportStepInput) => Promise<Result<NewFieldsFile>>;
  /** One value for many people, in this transaction (`writeSameValue`). */
  readonly writeSame: (
    tx: Tx,
    asking: Asking,
    personIds: readonly string[],
    values: Readonly<Record<string, unknown>>,
    effectiveFrom: string,
  ) => Promise<Result<number>>;
  /** The dry run against a version not published yet (`dryRunImport`). Writes nothing. */
  readonly importReview: (
    asking: Asking,
    step: ImportStepInput,
    version: PublishedVersion,
  ) => Promise<Result<ImportReview>>;
  /** The import itself, once its fields are published (`commitImportView`). */
  readonly importCommit: (
    asking: Asking,
    step: ImportStepInput & { readonly applySensitiveWithoutApproval?: boolean },
  ) => Promise<Result<ImportDone>>;
}

export const ImportStepInput = z.strictObject({
  uploadId: z.uuid(),
  mapping: z.record(z.string(), z.string().nullable()).optional(),
});
export type ImportStepInput = z.infer<typeof ImportStepInput>;

export interface NewFieldsView {
  /** A People administrator may add them; HR without it reads only. */
  readonly canCreate: boolean;
  /** Why this cannot be applied as it stands; null when it can. */
  readonly blocked: string | null;
  readonly proposals: readonly (ColumnProposal & {
    readonly counts: ColumnCounts;
    /** Sensitive data, flagged for a second look; null for ordinary data. */
    readonly sensitive: string | null;
  })[];
  readonly sections: readonly { readonly key: string; readonly label: string }[];
  /** People already here, whom the file may or may not reach. */
  readonly existingPeople: number;
  /** Everybody once the file is in: people here now, and the rows that create someone. */
  readonly totalPeople: number;
  /** Whether a model proposed, or People's own rules did. */
  readonly byModel: boolean;
  /** The version the fields publish as when the plan is approved. */
  readonly version: number;
  /** Nothing is published: approving sets the company up with this country's pack. */
  readonly setup: { readonly country: string | null; readonly countryName: string | null } | null;
}

const NOBODY = '00000000-0000-0000-0000-000000000000';
/** Columns per model request: a dozen proposals is a few thousand tokens of answer. */
const CHUNK = 12;

const ONLY_ADMIN =
  'Only a People administrator can add fields. Ask one to run this import, or import without these columns.';

/** The file's columns, their counts and the settings around them. Nothing is written. */
async function gather(deps: NewFieldsDeps, asking: Asking, step: ImportStepInput) {
  const file = await deps.importFile(asking, step);
  if (!file.ok) return file;
  const read = await run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr) return err(failure('FORBIDDEN', 'Only HR imports people'));
    const [stored, published, people] = await Promise.all([
      deps.schema.loadDraft(tx, asking.tenantId),
      deps.schema.currentVersion(tx, asking.tenantId),
      deps.service.access.count(tx, asking),
    ]);
    // Where new people are numbered (PEO-101), and each entity's country and zone.
    const org = deps.service.org;
    const entities = org ? await org.legalEntities(tx, asking) : ok([]);
    const schemes = org ? await org.numberings(tx, asking) : ok([]);
    // Nothing published: the file was read against what setup would publish.
    const setup = published === null ? await setupDraft(deps, tx, asking) : null;
    if (setup !== null && !setup.ok) return setup;
    return ok({
      isAdmin: everyone.isAdmin,
      stored,
      planning: setup === null ? stored : setup.value,
      published,
      setup:
        setup === null
          ? null
          : { country: setup.value.country, countryName: setup.value.countryName },
      existing: people.ok ? people.value.all : 0,
      entities: entities.ok ? entities.value : [],
      numbered: new Set((schemes.ok ? schemes.value : []).map((n) => n.legalEntityId)),
    });
  });
  if (!read.ok) return read;
  const { planning, published, stored, existing } = read.value;
  const sections = planning.sections
    .filter((s) => s.archivedAt === null)
    .toSorted((a, b) => a.order - b.order)
    .map((s) => ({ key: s.key, label: s.label.default }));
  const seen: ColumnSeen[] = file.value.unmatched.map((c) => {
    const values = c.cells.map((v) => v.trim()).filter((v) => v !== '');
    const distinct = [...new Set(values)];
    return {
      column: c.index,
      header: c.header,
      local: shapeOf(c.cells),
      single: distinct.length === 1 && values.length > 1 ? (distinct[0] ?? null) : null,
    };
  });
  const reached = file.value.rows.filter(
    (r) => r.outcome === 'create' || r.outcome === 'update' || r.outcome === 'unchanged',
  );
  const total = existing + reached.filter((r) => r.outcome === 'create').length;
  const counts = new Map<number, ColumnCounts>(
    seen.map((s) => {
      const withValue = reached.filter((r) => (r.cells[s.column] ?? '').trim() !== '');
      const existingWith = new Set(
        withValue.flatMap((r) => (r.personId === null ? [] : [r.personId])),
      ).size;
      return [
        s.column,
        {
          have: withValue.length,
          missing: Math.max(0, total - withValue.length),
          existingWithout: Math.max(0, existing - existingWith),
          without: reached
            .filter((r) => (r.cells[s.column] ?? '').trim() === '' && r.name !== null)
            .slice(0, 20)
            .map((r) => r.name as string),
        },
      ];
    }),
  );
  const pending =
    published === null
      ? 0
      : pendingIn(
          stored.attributes,
          published.document.attributes.map((a) => a.key),
        );
  return ok({
    ...read.value,
    file: file.value,
    sections,
    seen,
    counts,
    total,
    version: (published?.version ?? 0) + 1,
    blocked: !read.value.isAdmin
      ? ONLY_ADMIN
      : pending > 0
        ? `The employee fields have ${String(pending)} unpublished ${pending === 1 ? 'change' : 'changes'}. Publish or undo ${pending === 1 ? 'it' : 'them'} first, so this import publishes only its own fields.`
        : null,
  });
}
type Gathered = Extract<Awaited<ReturnType<typeof gather>>, { ok: true }>['value'];

/** Draft fields not in the published version: what a publish would carry besides this import's. */
function pendingIn(attributes: readonly Attribute[], published: readonly string[]): number {
  const live = attributes.filter((a) => a.deprecatedAt === null);
  const known = new Set(published);
  return (
    live.filter((a) => !known.has(a.key)).length +
    attributes.filter((a) => a.deprecatedAt !== null && known.has(a.key)).length
  );
}

function view(g: Gathered, proposals: readonly ColumnProposal[], byModel: boolean): NewFieldsView {
  return {
    canCreate: g.isAdmin,
    blocked: g.blocked,
    proposals: proposals.map((p) => ({
      ...p,
      counts: g.counts.get(p.column) ?? { have: 0, missing: 0, existingWithout: 0, without: [] },
      sensitive: sensitivity(p.field),
    })),
    sections: g.sections,
    existingPeople: g.existing,
    totalPeople: g.total,
    byModel,
    version: g.version,
    setup: g.setup,
  };
}

/* ------------------------------------------------------------ propose -- */

export async function proposeNewFields(
  deps: NewFieldsDeps,
  asking: Asking,
  step: ImportStepInput,
): Promise<Result<NewFieldsView>> {
  const gathered = await gather(deps, asking, step);
  if (!gathered.ok) return gathered;
  const g = gathered.value;
  const taken = takenKeys(g.planning.attributes);
  const existing = g.planning.attributes
    .filter((a) => a.deprecatedAt === null)
    .map((a) => ({ key: a.key, label: a.label.default }));
  const local = g.seen.map((s) => localProposal(s, g.sections, existing));
  const planner = deps.fieldPlanner;
  if (g.seen.length === 0 || !g.isAdmin || planner === undefined) {
    return ok(view(g, withKeys(local, taken), false));
  }
  if (!deps.planBudget.take(asking.tenantId, deps.clock.instant()).ok) {
    return ok(view(g, withKeys(local, taken), false));
  }
  const loaded = await run(deps.service, asking.tenantId, async (tx) => {
    await planner.loadPolicies(tx, asking.tenantId);
    return ok(null);
  });
  if (!loaded.ok) return loaded;
  // Headers, shapes, and the names of sections and fields. Never a cell.
  // A wide file goes in chunks, side by side, so each answer stays small and
  // the whole well inside the shell's two-minute write.
  const sections = g.sections.map((s) => ({
    ...s,
    fields: g.planning.attributes
      .filter((a) => a.sectionKey === s.key && a.deprecatedAt === null)
      .map((a) => a.label.default),
  }));
  const chunks: ColumnSeen[][] = [];
  for (let at = 0; at < g.seen.length; at += CHUNK) chunks.push(g.seen.slice(at, at + CHUNK));
  const answers = await Promise.all(
    chunks.map(async (chunk): Promise<unknown> => {
      try {
        const answered = await planner.complete(asking.tenantId, {
          instruction: NEW_FIELDS_INSTRUCTION,
          context: newFieldsContext(chunk, sections),
          about: 'configuration',
        });
        return answered.ok ? (JSON.parse(answered.value) as unknown) : null;
      } catch {
        // No answer, or not JSON: People's own proposal stands for these columns.
        return null;
      }
    }),
  );
  const heard = answers.filter((a) => a !== null);
  if (heard.length === 0) return ok(view(g, withKeys(local, taken), false));
  const merged = withModel(local, heard, g.sections, g.seen);
  return ok(view(g, withKeys(merged.proposals, taken), true));
}

/* --------------------------------------------------------------- plan -- */

export const PlanInput = ImportStepInput.extend({
  proposals: z.array(ColumnProposal).max(200).default([]),
});
export type PlanInput = z.input<typeof PlanInput>;

/** A field the plan creates, as the plan and the done screen name it. */
export interface PlannedField {
  readonly key: string;
  readonly column: number;
  readonly label: string;
  readonly dataType: string;
  readonly section: string;
  readonly newSection: boolean;
  readonly forExisting: ColumnProposal['forExisting'];
  readonly missing: number;
}

export interface ImportPlanView {
  /** Everything that will happen, in order (design AI11). */
  readonly steps: readonly PlanStep[];
  /** The same in one sentence (design MA9), and the activity log's words. */
  readonly short: string;
  readonly fields: readonly PlannedField[];
  /** The version the fields publish as; the current one when there are none. */
  readonly version: number;
  readonly setup: NewFieldsView['setup'];
  /** Why it cannot be approved as it stands; null when it can. */
  readonly blocked: string | null;
  /** Fields the settings would refuse, by column. */
  readonly problems: readonly { readonly column: number; readonly message: string }[];
  /** The dry run against the plan's version: counts, blocked rows, sensitive values. */
  readonly review: ImportReview;
  /** The mapping the import runs with: the file's, and each new column to its new field. */
  readonly mapping: Readonly<Record<string, string | null>>;
  /** People asked for a value, and values HR fills in, once it has run. */
  readonly asked: number;
  readonly forHr: number;
}

/** Only the file's own unmatched columns, and each once. */
function keptOf(
  proposals: readonly ColumnProposal[],
  seen: readonly ColumnSeen[],
): Result<ColumnProposal[]> {
  const columns = new Set(seen.map((s) => s.column));
  const once = new Set<number>();
  for (const p of proposals) {
    if (!columns.has(p.column) || once.has(p.column)) {
      return err(
        failure('VALUE_INVALID', `Column ${p.header} is not a new column of this file`, [
          'proposals',
        ]),
      );
    }
    once.add(p.column);
  }
  return ok(proposals.filter((p) => p.include));
}

/** The draft with the new sections and fields in it, or what it refused. Nothing stored. */
export function draftWithNewFields(
  current: { readonly sections: readonly Section[]; readonly attributes: readonly Attribute[] },
  kept: readonly ColumnProposal[],
): {
  readonly sections: Section[];
  readonly attributes: Attribute[];
  readonly problems: { column: number; message: string }[];
} {
  const draft = SchemaDraft.rehydrate(current.sections, current.attributes);
  const attributes: Attribute[] = [...current.attributes];
  const sections: Section[] = [];
  const added: Attribute[] = [];
  const problems: { column: number; message: string }[] = [];
  const newKeys = new Map<string, string>();
  for (const p of kept) {
    let sectionKey: string;
    if ('sectionKey' in p.placement) {
      sectionKey = p.placement.sectionKey;
    } else {
      const label = p.placement.newSection;
      const known = newKeys.get(label.toLowerCase());
      if (known !== undefined) {
        sectionKey = known;
      } else {
        let key = keyFrom(label);
        for (let n = 2; draft.section(key) !== undefined; n += 1)
          key = `${keyFrom(label)}_${String(n)}`;
        const section = draft.addSection({
          key,
          label: { default: label, translations: {} },
          order: draft.liveSections().length,
          defaultVisibility: ['self', 'hr'],
          origin: 'tenant',
        });
        if (!section.ok) {
          problems.push({ column: p.column, message: section.error.message });
          continue;
        }
        sections.push(section.value);
        newKeys.set(label.toLowerCase(), key);
        sectionKey = key;
      }
    }
    const rules = asDefinition(p);
    const input: FieldInput = {
      key: p.key,
      sectionKey,
      label: p.field.label,
      description: p.field.description ?? null,
      dataType: p.field.dataType,
      options: p.field.options ?? [],
      requiredness: rules.requiredness.mode,
      requiredWhen: null,
      ownership: rules.ownership,
      collectAt: 'anytime',
      visibility: rules.visibility,
      visibilityRules: [],
      classification: p.field.classification,
      piiKind: p.field.piiKind,
      // A model proposed it and a person accepted it: the audit's own word for that.
      classificationSource: 'suggested',
      requiresApproval: null,
      encrypted: p.field.encrypted,
      country: p.field.country ?? null,
      aiEligible: p.field.aiEligible,
      ...(rules.requiredness.mode === 'always' ? { appliesTo: rules.requiredness.appliesTo } : {}),
    };
    const saved = fieldChange(draft, attributes, input, null);
    if (!saved.ok) {
      problems.push({ column: p.column, message: saved.error.message });
      continue;
    }
    attributes.push(saved.value);
    added.push(saved.value);
  }
  return { sections, attributes: added, problems };
}

/** Each kept proposal as the plan names it. */
function plannedFields(
  g: Gathered,
  kept: readonly ColumnProposal[],
  built: ReturnType<typeof draftWithNewFields>,
): PlannedField[] {
  const sectionLabel = new Map([
    ...g.sections.map((s) => [s.key, s.label] as const),
    ...built.sections.map((s) => [s.key, s.label.default] as const),
  ]);
  const fresh = new Set(built.sections.map((s) => s.key));
  return kept.flatMap((p) => {
    const a = built.attributes.find((x) => x.key === p.key);
    if (a === undefined) return [];
    return [
      {
        key: p.key,
        column: p.column,
        label: p.field.label,
        dataType: p.field.dataType,
        section: sectionLabel.get(a.sectionKey) ?? a.sectionKey,
        newSection: fresh.has(a.sectionKey),
        forExisting: p.forExisting,
        missing: g.counts.get(p.column)?.missing ?? 0,
      },
    ];
  });
}

/**
 * The plan: the version the kept fields would make (with setup's pack for a
 * company with nothing published), the dry run against it, and everything
 * that will happen, in words. Nothing is written.
 */
async function planned(
  deps: NewFieldsDeps,
  asking: Asking,
  input: z.output<typeof PlanInput>,
): Promise<
  Result<{
    g: Gathered;
    kept: ColumnProposal[];
    built: ReturnType<typeof draftWithNewFields>;
    view: ImportPlanView;
    /** Work locations this run adds, and entities it starts numbering: an administrator's run only. */
    places: readonly { readonly name: string; readonly legalEntityId: string }[];
    numbering: readonly string[];
  }>
> {
  const gathered = await gather(deps, asking, input);
  if (!gathered.ok) return gathered;
  const g = gathered.value;
  const chosen = keptOf(input.proposals, g.seen);
  if (!chosen.ok) return chosen;
  // HR without administrator rights adds no fields: those columns are left out.
  const kept = g.isAdmin ? chosen.value : [];
  const built = draftWithNewFields(g.planning, kept);
  const needsVersion = g.published === null || kept.length > 0;
  const next = needsVersion
    ? publish(
        SchemaDraft.rehydrate(
          [...g.planning.sections, ...built.sections],
          [...g.planning.attributes, ...built.attributes],
        ),
        g.published,
        { clock: deps.clock, actor: asking.viewer.accountId },
      )
    : g.published === null
      ? err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'))
      : ok(g.published);
  if (!next.ok) return next;
  const fields = plannedFields(g, kept, built);
  const mapping = {
    ...input.mapping,
    ...Object.fromEntries(fields.map((f) => [String(f.column), f.key])),
  };
  const review = await deps.importReview(asking, { uploadId: input.uploadId, mapping }, next.value);
  if (!review.ok) return review;
  const keptColumns = new Set(fields.map((f) => f.column));
  const leftOut = g.seen.filter((s) => !keptColumns.has(s.column)).map((s) => s.header);
  const dry = review.value.dryRun;
  // An administrator's run adds the work locations the file names and starts
  // numbering where new people land without a scheme: Kithena numbers them.
  const canSet = g.isAdmin && deps.service.org !== undefined;
  const plan = planOf({
    setup: g.setup === null ? null : { countryName: g.setup.countryName },
    version: next.value.version,
    fields,
    rows: dry.counts,
    leftOut,
    identifiers: {
      inFile: g.file.identifiers,
      numbered: canSet || dry.createdIn.every((e) => g.numbered.has(e)),
    },
    newLocations: { names: dry.newLocations.map((l) => l.name), added: canSet },
    leftEmpty: {
      count: dry.leftEmptyCount,
      labels: [...new Set(dry.leftEmpty.map((l) => l.label))],
    },
  });
  const sum = (kind: string) =>
    fields.filter((f) => f.forExisting.kind === kind).reduce((n, f) => n + f.missing, 0);
  return ok({
    g,
    kept,
    built,
    view: {
      steps: plan.steps,
      short: plan.short,
      fields,
      version: next.value.version,
      setup: g.setup,
      blocked: kept.length > 0 || g.published === null ? (g.isAdmin ? g.blocked : null) : null,
      problems: built.problems,
      review: review.value,
      mapping,
      asked: sum('ask'),
      forHr: sum('hr'),
    },
    places: canSet ? dry.newLocations : [],
    numbering: canSet ? dry.createdIn.filter((e) => !g.numbered.has(e)) : [],
  });
}

/** Everything the import will do, from HR's choices. Nothing is written. */
export async function planImport(
  deps: NewFieldsDeps,
  asking: Asking,
  input: z.output<typeof PlanInput>,
): Promise<Result<ImportPlanView>> {
  const got = await planned(deps, asking, input);
  return got.ok ? ok(got.value.view) : got;
}

/* ---------------------------------------------------------------- run -- */

export const RunInput = PlanInput.extend({
  /** HR's "apply sensitive values without approval" (PEO-077). */
  applySensitiveWithoutApproval: z.boolean().optional(),
});
export type RunInput = z.input<typeof RunInput>;

export type ImportRunView = ImportDone & {
  /** The fields this import created, published as `version`. */
  readonly fields: readonly PlannedField[];
  readonly version: number;
  readonly asked: number;
  readonly forHr: number;
  /** When it finished, and how long it took, from the approval. */
  readonly finishedAt: string;
  readonly tookMs: number;
};

/**
 * Approve and run: set the company up if nothing is published, create the
 * kept fields, publish, write the defaults (one transaction, refused whole if
 * anything is refused), then import with every new column mapped to its new
 * field. The plan is worked out again here, never taken from the client.
 */
export async function runImport(
  deps: NewFieldsDeps,
  asking: Asking,
  input: z.output<typeof RunInput>,
): Promise<Result<ImportRunView>> {
  const started = Date.parse(deps.clock.instant());
  const got = await planned(deps, asking, input);
  if (!got.ok) return got;
  const { g, kept, view: plan, places, numbering } = got.value;
  if (plan.blocked !== null) {
    return err(failure(g.isAdmin ? 'DRAFT_HAS_CHANGES' : 'FORBIDDEN', plan.blocked));
  }
  const [problem] = plan.problems;
  if (problem !== undefined) {
    const header = kept.find((p) => p.column === problem.column)?.header ?? 'A column';
    return err(
      failure('DEFINITION_INVALID', `${header}: ${problem.message}. Nothing was added.`, [
        'proposals',
      ]),
    );
  }
  const publishing = g.published === null || kept.length > 0;
  if (publishing || places.length > 0 || numbering.length > 0) {
    const today = deps.clock.instant().slice(0, 10);
    const added = await run(deps.service, asking.tenantId, async (tx) => {
      const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
      if (!everyone.isAdmin) return err(failure('FORBIDDEN', ONLY_ADMIN));
      const settled = await settle(deps, tx, asking, g, places, numbering);
      if (!settled.ok) return settled;
      if (!publishing) return ok(null);
      if (g.published === null) {
        // Setup's own seeding, then this import's fields on top: one publish.
        const seeded = await seedSetup(tx, asking.tenantId, g.setup?.country ?? null, 'all');
        if (!seeded.ok) return seeded;
      }
      const draft = await deps.schema.loadDraft(tx, asking.tenantId);
      const built = draftWithNewFields(draft, kept);
      const [refused] = built.problems;
      if (refused !== undefined) return err(failure('DEFINITION_INVALID', refused.message));
      for (const s of built.sections) await deps.draft.saveSection(tx, asking.tenantId, s);
      for (const a of built.attributes) await deps.draft.saveAttribute(tx, asking.tenantId, a);
      const version = ((await deps.schema.currentVersion(tx, asking.tenantId))?.version ?? 0) + 1;
      const published = await deps.publisher.publish(tx, {
        tenantId: asking.tenantId,
        actor: userActor(asking.viewer),
        publishedBy: asking.viewer.accountId,
        correlationId: asking.correlationId,
        artifactUrl: deps.artifactUrl(version),
      });
      if (!published.ok) return published;
      // People already here whom the file gives no value, for each default.
      for (const p of kept) {
        if (p.forExisting.kind !== 'default') continue;
        const given = new Set(
          g.file.rows
            .filter((r) => r.personId !== null && (r.cells[p.column] ?? '').trim() !== '')
            .map((r) => r.personId as string),
        );
        const everybody = await everyoneIn(deps, tx, asking);
        if (!everybody.ok) return everybody;
        const missing = everybody.value.filter((id) => !given.has(id));
        const value =
          p.field.dataType === 'select' || p.field.dataType === 'multi_select'
            ? keyFrom(p.forExisting.value)
            : p.forExisting.value;
        const wrote = await deps.writeSame(tx, asking, missing, { [p.key]: value }, today);
        if (!wrote.ok) return wrote;
      }
      return ok(published.value.version.version);
    });
    if (!added.ok) return added;
  }
  const done = await deps.importCommit(asking, {
    uploadId: input.uploadId,
    mapping: plan.mapping,
    ...(input.applySensitiveWithoutApproval === true
      ? { applySensitiveWithoutApproval: true }
      : {}),
  });
  if (!done.ok) {
    if (!publishing) return done;
    // The fields are in; the import is not. Saying so is the honest answer,
    // and running it again finds the columns mapped to the new fields.
    return err({
      ...done.error,
      message: `The fields are published as version ${String(plan.version)}, but the import did not go through: ${done.error.message} Run it again: the new columns now go to the new fields.`,
    });
  }
  const finishedAt = deps.clock.instant();
  return ok({
    ...done.value,
    fields: plan.fields,
    version: plan.version,
    asked: plan.asked,
    forHr: plan.forHr,
    finishedAt,
    tookMs: Math.max(0, Date.parse(finishedAt) - started),
  });
}

/**
 * What the company needs before the rows go in, in the run's transaction:
 * the work locations the file names that are not here yet, each in the
 * legal entity of the first row naming it on that entity's zone, and
 * numbering for each entity new people join without a scheme — the entity's
 * country as the prefix, five digits, from 1 (`US-00001`). Both through the
 * settings' own use cases, so they are checked, evented and audited as if an
 * administrator had made them there.
 */
async function settle(
  deps: NewFieldsDeps,
  tx: Tx,
  asking: Asking,
  g: Gathered,
  places: readonly { readonly name: string; readonly legalEntityId: string }[],
  numbering: readonly string[],
): Promise<Result<null>> {
  const org = deps.service.org;
  if (org === undefined) return ok(null);
  const entityOf = new Map(g.entities.map((e) => [e.id, e]));
  for (const place of places) {
    const entity = entityOf.get(place.legalEntityId);
    if (entity === undefined) continue;
    const created = await org.createLocation(tx, {
      ...asking,
      legalEntityId: entity.id,
      name: place.name,
      country: entity.country,
      timeZone: entity.timeZone,
    });
    if (!created.ok) {
      return err({
        ...created.error,
        message: `The work location “${place.name}” could not be added: ${created.error.message}. Nothing was imported.`,
      });
    }
  }
  for (const id of numbering) {
    const entity = entityOf.get(id);
    if (entity === undefined) continue;
    const started = await org.setNumbering(tx, {
      ...asking,
      legalEntityId: id,
      prefix: `${entity.country}-`,
      digits: 5,
      start: 1,
    });
    if (!started.ok) {
      return err({
        ...started.error,
        message: `Employee numbering could not be started for ${entity.name}: ${started.error.message}. Nothing was imported.`,
      });
    }
  }
  return ok(null);
}

/** Every person HR may list, page by page. */
async function everyoneIn(deps: NewFieldsDeps, tx: Tx, asking: Asking): Promise<Result<string[]>> {
  const ids: string[] = [];
  let after: string | null = null;
  do {
    const page = await deps.service.access.list(tx, { ...asking, after, limit: 200 });
    if (!page.ok) return page;
    ids.push(...page.value.items.map((p) => p.id));
    after = page.value.next;
  } while (after !== null);
  return ok(ids);
}
