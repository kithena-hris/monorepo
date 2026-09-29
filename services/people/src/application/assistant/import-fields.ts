import { err, failure, ok, type Result } from '@kithena/domain-kit';
import * as z from 'zod';

import {
  planChanges,
  readChange,
  type Change,
  type FieldSpec,
  type PlannedChange,
  type SettingsSnapshot,
} from '../../domain/assistant/settings-plan.js';
import { SETTINGS_INSTRUCTION, planningContext } from '../../domain/assistant/settings-prompt.js';
import { defaultFieldFor, shapeOf, type ColumnShape } from '../../domain/import/column-shape.js';
import { keyFrom } from '../../domain/schema/draft.js';
import type { Asking } from '../person/ports.js';
import { run } from '../person/service.js';
import { checked, type SettingsAssistantDeps } from './settings.js';

/**
 * Fields for an import's columns that match none (docs/ai-settings.md, "From
 * an import").
 *
 * Existing fields are never touched: a column the mapper placed — by key,
 * label or judgment — is not here. For each column that matches nothing,
 * People works out the shape of its values locally ("dates, dd/mm/yyyy", "4
 * distinct short values") and a protective default field; with a model
 * configured, the model is shown the headers and those shapes — **never a
 * value** — and proposes the fields with the same tools, and the same plan,
 * as setting up in words. A short list's choices come from the file, here,
 * and are shown only on the review screen.
 *
 * The proposal is a plan like any other: reviewed, edited, applied through
 * the same commands and logged the same way. Only a People administrator (or
 * support) may add fields; HR sees the list and is told an administrator has
 * to, and the import goes on without those columns.
 */

export interface ImportColumn {
  readonly index: number;
  readonly header: string;
  readonly shape: string;
}

export interface ImportFieldsProposal {
  /** An administrator may add the fields; HR reads the list only. */
  readonly canCreate: boolean;
  readonly reason: string | null;
  readonly summary: string;
  readonly columns: readonly ImportColumn[];
  /** Sections to add, then one field per column; each field says its column. */
  readonly changes: readonly PlannedChange[];
  /** The live sections a field may go in. */
  readonly sections: readonly { readonly key: string; readonly label: string }[];
  /** Whether a model proposed them, or People's own defaults did. */
  readonly byModel: boolean;
  /** Other unpublished changes in the draft, which publishing would publish too. */
  readonly otherDraftChanges: number;
}

export interface ImportFieldsDeps extends SettingsAssistantDeps {
  readonly unmatched: (
    asking: Asking,
    uploadId: string,
  ) => Promise<
    Result<
      readonly {
        readonly index: number;
        readonly header: string;
        readonly cells: readonly string[];
      }[]
    >
  >;
}

const NOBODY = '00000000-0000-0000-0000-000000000000';

export const IMPORT_REQUEST =
  'A spreadsheet of employees is being imported. Its columns listed under "columns" match no field. Propose one field for each column worth keeping, with add_field and its column index, in an existing section that fits or in a new one; skip a column that holds nothing an HR system should keep. Nothing may be required. Work only from each header and the shape of its values.';

const Calls = z.object({
  calls: z.array(z.object({ name: z.string().max(64), input: z.unknown() })).max(400),
});

/** A section for a local default: one whose name fits its kind of data, else a new "Imported fields". */
function sectionFor(field: Omit<FieldSpec, 'sectionKey'>, snapshot: SettingsSnapshot): string {
  const fits: Record<string, RegExp> = {
    financial: /bank|pay|compens|financ|salar|tax/u,
    contact: /emergency|contact|personal/u,
    identity: /ident|personal/u,
    health: /health|safety/u,
  };
  const re = fits[field.piiKind];
  const found =
    re === undefined
      ? undefined
      : snapshot.sections.find((s) => re.test(`${s.key} ${s.label.toLowerCase()}`));
  return found?.key ?? 'imported_fields';
}

function localCalls(
  columns: readonly (ImportColumn & { readonly local: ColumnShape })[],
  snapshot: SettingsSnapshot,
): Change[] {
  const fields = columns.map((c) => {
    const field = defaultFieldFor(c.header, c.local);
    return {
      kind: 'add_field' as const,
      column: c.index,
      field: { ...field, sectionKey: sectionFor(field, snapshot) },
    };
  });
  const needsNew =
    fields.some((f) => f.field.sectionKey === 'imported_fields') &&
    !snapshot.sections.some((s) => s.key === 'imported_fields');
  return [
    ...(needsNew
      ? [{ kind: 'add_section' as const, label: 'Imported fields', key: 'imported_fields' }]
      : []),
    ...fields,
  ];
}

/**
 * Keep the model's proposal to what it may say: one field per listed column,
 * nothing required, a key always written out, a short list's choices from the
 * file. A column the model skipped is left out; a change that is not a
 * section or a column's field is dropped.
 */
function fromModel(
  calls: readonly { name: string; input: unknown }[],
  columns: readonly (ImportColumn & { readonly local: ColumnShape })[],
): Change[] {
  const byIndex = new Map(columns.map((c) => [c.index, c]));
  const seen = new Set<number>();
  return calls.flatMap((call): Change[] => {
    const change = readChange({ ...(call.input as object), kind: call.name });
    if (change?.kind === 'add_section') return [change];
    if (change?.kind !== 'add_field' || change.column === undefined) return [];
    const column = byIndex.get(change.column);
    if (column === undefined || seen.has(change.column)) return [];
    seen.add(change.column);
    const options = column.local.options.length > 0 ? { options: [...column.local.options] } : {};
    return [
      {
        ...change,
        field: {
          ...change.field,
          requiredness: 'never',
          ...(change.field.dataType === 'select' || change.field.dataType === 'multi_select'
            ? options
            : {}),
          ...(change.field.dataType === 'bank_account' && column.local.country !== null
            ? { country: column.local.country }
            : {}),
        },
      },
    ];
  });
}

export async function proposeImportFields(
  deps: ImportFieldsDeps,
  asking: Asking,
  uploadId: string,
): Promise<Result<ImportFieldsProposal>> {
  const unmatched = await deps.unmatched(asking, uploadId);
  if (!unmatched.ok) return unmatched;
  const columns = unmatched.value.map((c) => {
    const local = shapeOf(c.cells);
    return { index: c.index, header: c.header, shape: local.shape, local };
  });
  const read = await run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    return ok({ isAdmin: everyone.isAdmin, settings: await deps.readSettings(tx, asking) });
  });
  if (!read.ok) return read;
  const { snapshot } = read.value.settings;
  const view = (
    changes: readonly Change[],
    byModel: boolean,
    summary: string,
  ): ImportFieldsProposal => {
    const withKeys = changes.map((c) =>
      c.kind === 'add_field'
        ? { ...c, field: { ...c.field, key: c.field.key ?? keyFrom(c.field.label) } }
        : c,
    );
    const planned = checked(planChanges(withKeys, snapshot), read.value.settings, deps.clock);
    return {
      canCreate: read.value.isAdmin,
      reason: read.value.isAdmin
        ? null
        : 'Only a People administrator can add fields. The import goes on without these columns; ask an administrator to add them.',
      summary,
      columns: columns.map(({ index, header, shape }) => ({ index, header, shape })),
      changes: planned,
      sections: snapshot.sections.map((s) => ({ key: s.key, label: s.label })),
      byModel,
      otherDraftChanges: pendingIn(snapshot),
    };
  };
  const summary = `Fields for ${String(columns.length)} imported ${columns.length === 1 ? 'column' : 'columns'}.`;
  if (columns.length === 0) return ok(view([], false, summary));
  const local = localCalls(columns, snapshot);
  const planner = deps.settingsPlanner;
  if (!read.value.isAdmin || planner === undefined) return ok(view(local, false, summary));

  const spent = deps.planBudget.take(asking.tenantId, deps.clock.instant());
  if (!spent.ok) return ok(view(local, false, summary));
  const loaded = await run(deps.service, asking.tenantId, async (tx) => {
    await planner.loadPolicies(tx, asking.tenantId);
    return ok(null);
  });
  if (!loaded.ok) return loaded;
  // Headers and shapes. Never a cell.
  const answered = await planner.complete(asking.tenantId, {
    instruction: SETTINGS_INSTRUCTION,
    context: {
      ...planningContext(snapshot, IMPORT_REQUEST),
      columns: columns.map(({ index, header, shape }) => ({ index, header, shape })),
    },
    about: 'configuration',
  });
  if (!answered.ok) {
    return answered.error.code === 'AI_VALUE_SHAPED'
      ? ok(view(local, false, summary))
      : err(failure('ASSISTANT_REFUSED', 'The columns could not be sent to the assistant'));
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(answered.value);
  } catch {
    // Read as no answer, below.
  }
  const calls = Calls.safeParse(parsed);
  if (!calls.success) return ok(view(local, false, summary));
  const proposed = fromModel(calls.data.calls, columns);
  const done = calls.data.calls.find((c) => c.name === 'finish_plan')?.input as
    { summary?: unknown } | undefined;
  return ok(
    view(proposed, true, typeof done?.summary === 'string' ? done.summary.slice(0, 300) : summary),
  );
}

/** Draft fields that differ from what is published: added ones, as the snapshot can tell. */
function pendingIn(snapshot: SettingsSnapshot): number {
  if (snapshot.published === null) return snapshot.fields.length;
  const published = new Set(snapshot.published.fieldKeys);
  return snapshot.fields.filter((f) => !published.has(f.key)).length;
}
