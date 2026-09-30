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
  summaryOf,
  takenKeys,
  withKeys,
  withModel,
  type ColumnCounts,
  type ColumnSeen,
  type PlanBudget,
} from '../../domain/import/new-fields.js';
import { keyFrom, SchemaDraft, type Attribute, type Section } from '../../domain/schema/draft.js';
import type { Asking } from '../person/ports.js';
import { run } from '../person/service.js';
import { userActor } from '../person/ports.js';
import type { NewFieldsFile } from '../screens/operations.js';
import { fieldChange, type FieldInput, type SchemaScreenDeps } from '../screens/schema.js';
import type { AssistantPort } from './assistant-port.js';

/**
 * New information in an imported file (docs/ai-settings.md): the columns
 * that match no field, proposed as fields, reviewed by HR, and added — with
 * what happens for the people already here — in one administrator's OK.
 *
 * Existing fields and sections are never touched: a column the mapper or HR
 * placed is not here, and applying only adds. The model is shown each
 * column's header and the shape of its values, never a value, and the names
 * of the company's sections and fields; People's own rules propose when there
 * is no model, when the company's budget is spent, and for anything the model
 * left out. Choices and a default's value come from the file, here, and are
 * shown on the review only.
 *
 * Applying is one transaction: the sections and fields go into the draft, the
 * draft is published, and the values for people already here are written.
 * Anything refused refuses the lot, so a cancelled or failed apply leaves
 * the settings as they were. It is refused while the draft holds other
 * unpublished changes, because publishing would publish those too.
 *
 * Creating fields is a People administrator's (administrators hold HR's
 * rights too). HR without it sees the whole proposal and is told an
 * administrator has to add the fields; the import goes on without them.
 */

type Tx = PostgresJsDatabase;

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
  /** Whether a model proposed, or People's own rules did. */
  readonly byModel: boolean;
  readonly summary: string;
}

const NOBODY = '00000000-0000-0000-0000-000000000000';
const Calls = z.object({
  calls: z.array(z.object({ name: z.string().max(64), input: z.unknown() })).max(400),
});

const ONLY_ADMIN =
  'Only a People administrator can add fields. Ask one to run this import, or import without these columns.';

/** The file's columns, their counts and the settings around them. */
async function gather(deps: NewFieldsDeps, asking: Asking, step: ImportStepInput) {
  const file = await deps.importFile(asking, step);
  if (!file.ok) return file;
  const read = await run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr) return err(failure('FORBIDDEN', 'Only HR imports people'));
    const [draft, published, people] = await Promise.all([
      deps.schema.loadDraft(tx, asking.tenantId),
      deps.schema.currentVersion(tx, asking.tenantId),
      deps.service.access.count(tx, asking),
    ]);
    return ok({
      isAdmin: everyone.isAdmin,
      draft,
      published,
      existing: people.ok ? people.value.all : 0,
    });
  });
  if (!read.ok) return read;
  const { draft, published } = read.value;
  const liveSections = draft.sections
    .filter((s) => s.archivedAt === null)
    .toSorted((a, b) => a.order - b.order);
  const sections = liveSections.map((s) => ({ key: s.key, label: s.label.default }));
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
  const counts = new Map<number, ColumnCounts>(
    seen.map((s) => {
      const withValue = reached.filter((r) => (r.cells[s.column] ?? '').trim() !== '');
      const existingWith = new Set(
        withValue.flatMap((r) => (r.personId === null ? [] : [r.personId])),
      ).size;
      return [
        s.column,
        {
          fromFile: withValue.length,
          existingWithout: Math.max(0, read.value.existing - existingWith),
        },
      ];
    }),
  );
  const peopleWithValues = reached.filter((r) =>
    seen.some((s) => (r.cells[s.column] ?? '').trim() !== ''),
  ).length;
  const pending = pendingIn(
    draft.attributes,
    published?.document.attributes.map((a) => a.key) ?? null,
  );
  return ok({
    ...read.value,
    file: file.value,
    sections,
    seen,
    counts,
    peopleWithValues,
    blocked: !read.value.isAdmin
      ? ONLY_ADMIN
      : pending > 0
        ? `The employee fields have ${String(pending)} unpublished ${pending === 1 ? 'change' : 'changes'}. Publish or undo ${pending === 1 ? 'it' : 'them'} first, so this import publishes only its own fields.`
        : null,
  });
}

/** Draft fields not in the published version: what a publish would carry besides this import's. */
function pendingIn(attributes: readonly Attribute[], published: readonly string[] | null): number {
  const live = attributes.filter((a) => a.deprecatedAt === null);
  if (published === null) return live.length;
  const known = new Set(published);
  return (
    live.filter((a) => !known.has(a.key)).length +
    attributes.filter((a) => a.deprecatedAt !== null && known.has(a.key)).length
  );
}

function view(
  g: Extract<Awaited<ReturnType<typeof gather>>, { ok: true }>['value'],
  proposals: readonly ColumnProposal[],
  byModel: boolean,
): NewFieldsView {
  return {
    canCreate: g.isAdmin,
    blocked: g.blocked,
    proposals: proposals.map((p) => ({
      ...p,
      counts: g.counts.get(p.column) ?? { fromFile: 0, existingWithout: 0 },
      sensitive: sensitivity(p.field),
    })),
    sections: g.sections,
    existingPeople: g.existing,
    byModel,
    summary: summaryOf(proposals, g.counts, g.peopleWithValues, g.sections),
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
  const taken = takenKeys(g.draft.attributes);
  const local = g.seen.map((s) => localProposal(s, g.sections));
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
  const answered = await planner.complete(asking.tenantId, {
    instruction: NEW_FIELDS_INSTRUCTION,
    context: newFieldsContext(
      g.seen,
      g.sections.map((s) => ({
        ...s,
        fields: g.draft.attributes
          .filter((a) => a.sectionKey === s.key && a.deprecatedAt === null)
          .map((a) => a.label.default),
      })),
    ),
    about: 'configuration',
  });
  let calls: { name: string; input: unknown }[] | null = null;
  if (answered.ok) {
    try {
      const parsed = Calls.safeParse(JSON.parse(answered.value));
      calls = parsed.success ? parsed.data.calls : null;
    } catch {
      calls = null;
    }
  }
  if (calls === null) return ok(view(g, withKeys(local, taken), false));
  const merged = withModel(local, calls, g.sections, g.seen);
  return ok(view(g, withKeys(merged.proposals, taken), true));
}

/* ------------------------------------------------------------- review -- */

export const ReviewInput = ImportStepInput.extend({
  proposals: z.array(ColumnProposal).max(200),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

/**
 * The proposals as HR left them, checked against the draft exactly as
 * applying will, with the review in words. Nothing is written.
 */
export async function reviewNewFields(
  deps: NewFieldsDeps,
  asking: Asking,
  input: ReviewInput,
): Promise<
  Result<
    NewFieldsView & {
      readonly problems: readonly { readonly column: number; readonly message: string }[];
    }
  >
> {
  const gathered = await gather(deps, asking, input);
  if (!gathered.ok) return gathered;
  const g = gathered.value;
  const kept = keptOf(input.proposals, g.seen);
  if (!kept.ok) return kept;
  const built = draftWithNewFields(g.draft, kept.value);
  return ok({ ...view(g, input.proposals, false), problems: built.problems });
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

/* -------------------------------------------------------------- apply -- */

export const ApplyInput = ReviewInput.extend({
  /** The review's words, for the activity log: the plan, never the file. */
  summary: z.string().trim().min(1).max(1000),
});
export type ApplyInput = z.infer<typeof ApplyInput>;

export interface NewFieldsApplied {
  readonly version: number;
  /** Column index → the new field's key: the mapping to continue the import with. */
  readonly mapped: Readonly<Record<string, string>>;
  readonly defaults: number;
}

/**
 * Add the kept fields, publish, and write the defaults, in one transaction.
 * Refused whole, before anything is stored, if the draft refuses any field.
 */
export async function applyNewFields(
  deps: NewFieldsDeps,
  asking: Asking,
  input: ApplyInput,
): Promise<Result<NewFieldsApplied>> {
  const gathered = await gather(deps, asking, input);
  if (!gathered.ok) return gathered;
  const g = gathered.value;
  if (g.blocked !== null) {
    return err(failure(g.isAdmin ? 'DRAFT_HAS_CHANGES' : 'FORBIDDEN', g.blocked));
  }
  const kept = keptOf(input.proposals, g.seen);
  if (!kept.ok) return kept;
  if (kept.value.length === 0)
    return err(failure('VALUE_INVALID', 'Choose at least one column to add', ['proposals']));
  const built = draftWithNewFields(g.draft, kept.value);
  const [problem] = built.problems;
  if (problem !== undefined) {
    const header = kept.value.find((p) => p.column === problem.column)?.header ?? 'A column';
    return err(
      failure('DEFINITION_INVALID', `${header}: ${problem.message}. Nothing was added.`, [
        'proposals',
      ]),
    );
  }
  const today = deps.clock.instant().slice(0, 10);
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isAdmin) return err(failure('FORBIDDEN', ONLY_ADMIN));
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
    let defaults = 0;
    for (const p of kept.value) {
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
      defaults += wrote.value;
    }
    return ok({
      version: published.value.version.version,
      mapped: Object.fromEntries(kept.value.map((p) => [String(p.column), p.key])),
      defaults,
    });
  });
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
