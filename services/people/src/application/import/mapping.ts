import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition, AttributeDefinitionInput } from '@kithena/contracts';

import { canWrite, type ViewerRelations } from '../../domain/access/field-access.js';
import type { Attribute, SchemaDraft } from '../../domain/schema/draft.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import { PERSON_ID_COLUMN, type ParsedFile } from './parse.js';

/**
 * Map each column to an attribute key (PRD §14.3, §12.4).
 *
 * Exact key, then label, then one System One judgment over the candidates the
 * published schema supplies — auto-mapped at ≥ 0.9, sent to the admin below
 * that. The whole proposal is shown before the dry run, whatever the
 * confidence, and nothing here writes anything.
 *
 * **The advisor is optional.** It is a port; the TypeSafe adapter lives in
 * infrastructure and is null when no key is configured, and every path below
 * works without it — a column the cheap rules cannot place simply goes to the
 * admin, which is where it would have gone at 0.6 confidence anyway.
 *
 * **Authorization is decided here, not at write time** (§14.5): a column
 * mapped to an attribute the importer may not write is `refused` on the
 * mapping screen, rather than silently dropped four hundred rows later.
 */

export const AUTO_MAP_AT = 0.9;

/** What the advisor is told about a candidate. Metadata only, never a value. */
export interface ColumnCandidate {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly sectionKey: string;
}

export interface ColumnJudgment {
  /** Null is `no_match`. */
  readonly key: string | null;
  readonly confidence: number;
}

/**
 * A judgment over column headers.
 *
 * It is handed the header text and the candidate list, and nothing else: no
 * cell, no sample, no "example row". §12.3 is explicit that a value never
 * leaves for a model, and a port that cannot carry one is how that holds.
 * Implementations never throw and never block: on any failure they return
 * fewer answers.
 */
export interface AttributeAdvisor {
  mapColumns(
    headers: readonly string[],
    candidates: readonly ColumnCandidate[],
  ): Promise<ReadonlyMap<string, ColumnJudgment>>;
}

/**
 * Columns the importer knows without the schema.
 *
 * `hire_date` is core identity and belongs to the lifecycle rather than to the
 * registry, so a published schema need not list it. `__person_id` is the
 * export's hidden id (§15.3). The rest are what this module's own reports and
 * exports add, recognised so a round-tripped file is not six "unmatched"
 * columns.
 */
export const SYSTEM_COLUMNS = {
  [PERSON_ID_COLUMN]: 'mapped',
  hire_date: 'mapped',
  effective_from: 'mapped',
  __source_row: 'ignored',
  __reason: 'ignored',
  __missing_required: 'ignored',
} as const;
type SystemColumn = keyof typeof SYSTEM_COLUMNS;
const SYSTEM_LABELS: Readonly<Record<string, SystemColumn>> = {
  'person id': PERSON_ID_COLUMN,
  'hire date': 'hire_date',
  'effective from': 'effective_from',
};
const isSystem = (key: string): key is SystemColumn => Object.hasOwn(SYSTEM_COLUMNS, key);

export type ColumnStatus =
  /** Will be imported into `key`. */
  | 'mapped'
  /** A suggestion below the threshold, or a second column for one key: the admin decides. */
  | 'review'
  /** Not imported, and said so on the dry run and the report. */
  | 'ignored'
  /** Maps to something this importer may not write. */
  | 'refused';

export interface ColumnMapping {
  readonly index: number;
  readonly header: string;
  readonly status: ColumnStatus;
  /** The attribute or system key, when there is one — including a refused or suggested one. */
  readonly key: string | null;
  readonly source: 'key' | 'label' | 'suggested' | 'manual' | 'system' | null;
  readonly confidence: number | null;
  readonly reason: string | null;
}

export interface ProposeInput {
  readonly file: Pick<ParsedFile, 'headers' | 'keys'>;
  readonly version: PublishedVersion;
  /** The importer's tenant-wide relations: HR, finance. */
  readonly relations: ViewerRelations;
  readonly advisor: AttributeAdvisor | null;
}

const normalise = (s: string) =>
  s
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en')
    .replaceAll(/[\s_-]+/gu, ' ');

function labelsOf(d: AttributeDefinition): string[] {
  return [d.label.default, ...Object.values(d.label.translations)].map(normalise);
}

function candidateOf(d: AttributeDefinition): ColumnCandidate {
  return {
    key: d.key,
    label: d.label.default,
    description: d.description?.default ?? null,
    dataType: d.dataType,
    sectionKey: d.sectionKey,
  };
}

export async function proposeMapping(input: ProposeInput): Promise<readonly ColumnMapping[]> {
  const live = input.version.document.attributes.filter((d) => d.deprecatedAt === null);
  const byKey = new Map(live.map((d) => [d.key as string, d]));

  const proposed: (ColumnMapping | null)[] = input.file.headers.map((header, index) => {
    const base = { index, header, confidence: null, reason: null };
    const keyed = input.file.keys?.[index]?.trim() ?? '';
    const bare = header.trim();

    for (const [candidate, source] of [
      [keyed, 'key'],
      [bare, 'key'],
    ] as const) {
      if (candidate === '') continue;
      if (isSystem(candidate)) {
        return { ...base, status: SYSTEM_COLUMNS[candidate], key: candidate, source: 'system' };
      }
      if (byKey.has(candidate)) return { ...base, status: 'mapped', key: candidate, source };
    }

    const wanted = normalise(header);
    const system = SYSTEM_LABELS[wanted];
    if (system) return { ...base, status: 'mapped', key: system, source: 'system' };
    const byLabel = live.find((d) => labelsOf(d).includes(wanted));
    if (byLabel) return { ...base, status: 'mapped', key: byLabel.key, source: 'label' };
    return null;
  });

  const unmatched = proposed.flatMap((p, i) => (p === null ? [input.file.headers[i] ?? ''] : []));
  const taken = new Set(proposed.flatMap((p) => (p?.key ? [p.key] : [])));
  const judgments =
    unmatched.length > 0 && input.advisor
      ? await input.advisor.mapColumns(
          unmatched,
          live.filter((d) => !taken.has(d.key)).map(candidateOf),
        )
      : new Map<string, ColumnJudgment>();

  const seen = new Set<string>();
  return proposed.map((p, index): ColumnMapping => {
    const header = input.file.headers[index] ?? '';
    let mapping: ColumnMapping = p ?? fromJudgment(index, header, judgments.get(header), byKey);

    const key = mapping.key;
    if (mapping.status === 'mapped' && key !== null) {
      if (seen.has(key)) {
        mapping = {
          ...mapping,
          status: 'review',
          reason: `another column already maps to ${key}`,
        };
      }
      seen.add(key);
    }
    return authorise(mapping, byKey, input.relations);
  });
}

function fromJudgment(
  index: number,
  header: string,
  judgment: ColumnJudgment | undefined,
  byKey: ReadonlyMap<string, AttributeDefinition>,
): ColumnMapping {
  const base = { index, header, source: null, confidence: null } as const;
  // An answer naming something that is not a candidate is no answer.
  if (!judgment || judgment.key === null || !byKey.has(judgment.key)) {
    return { ...base, status: 'ignored', key: null, reason: 'no attribute matches this column' };
  }
  if (judgment.confidence >= AUTO_MAP_AT) {
    return {
      ...base,
      status: 'mapped',
      key: judgment.key,
      source: 'suggested',
      confidence: judgment.confidence,
      reason: null,
    };
  }
  return {
    ...base,
    status: 'review',
    key: judgment.key,
    source: 'suggested',
    confidence: judgment.confidence,
    reason: 'a suggestion below the auto-map threshold; confirm or change it',
  };
}

/** Refuse at mapping time what the importer could not write at commit time. */
function authorise(
  mapping: ColumnMapping,
  byKey: ReadonlyMap<string, AttributeDefinition>,
  relations: ViewerRelations,
): ColumnMapping {
  if (mapping.status !== 'mapped' && mapping.status !== 'review') return mapping;
  if (mapping.key === null || isSystem(mapping.key)) {
    // Creating people and setting their lifecycle is HR's (PEO-025's `create`).
    return mapping.key !== null && !relations.isHr
      ? { ...mapping, status: 'refused', reason: 'only HR imports people' }
      : mapping;
  }
  const definition = byKey.get(mapping.key);
  if (!definition || !canWrite(definition, relations).ok) {
    return { ...mapping, status: 'refused', reason: `${mapping.key} is not yours to write` };
  }
  return mapping;
}

/** The admin's decision about one column. */
export type ColumnChoice =
  { readonly kind: 'ignore' } | { readonly kind: 'map'; readonly key: string };

/**
 * Apply the admin's choices and check the result is importable.
 *
 * A hand-picked key is held to the same rules as a proposed one — it must
 * exist, be live, be writable by this importer and not be taken twice — so the
 * mapping screen cannot be used to route a column around `authorise`.
 */
export function resolveMapping(
  proposed: readonly ColumnMapping[],
  choices: Readonly<Record<number, ColumnChoice>>,
  version: PublishedVersion,
  relations: ViewerRelations,
): Result<readonly ColumnMapping[]> {
  const byKey = new Map(
    version.document.attributes
      .filter((d) => d.deprecatedAt === null)
      .map((d) => [d.key as string, d]),
  );

  const resolved = proposed.map((m): ColumnMapping => {
    const choice = choices[m.index];
    if (!choice) return m;
    if (choice.kind === 'ignore')
      return { ...m, status: 'ignored', reason: 'ignored by the importer' };
    const known = isSystem(choice.key) || byKey.has(choice.key);
    const chosen: ColumnMapping = {
      ...m,
      status: 'mapped',
      key: choice.key,
      source: 'manual',
      confidence: null,
      reason: null,
    };
    return known
      ? authorise(chosen, byKey, relations)
      : { ...chosen, status: 'refused', reason: `no attribute called ${choice.key}` };
  });

  const problems = resolved.filter((m) => m.status === 'review' || m.status === 'refused');
  if (problems.length > 0) {
    return err(
      failure(
        'MAPPING_UNRESOLVED',
        `Decide these columns before the dry run: ${problems.map((m) => m.header).join(', ')}`,
        problems.map((m) => m.header),
      ),
    );
  }

  const keys = resolved.flatMap((m) => (m.status === 'mapped' && m.key ? [m.key] : []));
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (twice.length > 0) {
    return err(failure('MAPPING_DUPLICATE', `Two columns map to ${twice.join(', ')}`, twice));
  }
  return ok(resolved);
}

/**
 * Turn an unmatched column into a new attribute, on the draft (§14.3, option 3).
 *
 * The classification is a required argument, not a default. "Medical notes"
 * does not become an `internal` free-text field because somebody was in a
 * hurry importing 400 rows: without a policy there is no attribute, and the
 * draft is left exactly as it was. The new attribute is live once the draft
 * is published through PEO-024's preview, which is also where its impact is
 * shown; the column then maps to it by key.
 */
export function attributeFromColumn(
  draft: SchemaDraft,
  header: string,
  spec: Omit<AttributeDefinitionInput, 'key' | 'label' | 'origin'> &
    Partial<Pick<AttributeDefinitionInput, 'key' | 'label'>>,
): Result<Attribute> {
  const given = spec as Partial<AttributeDefinitionInput>;
  if (!given.classification || !given.classificationSource) {
    return err(
      failure('CLASSIFICATION_REQUIRED', `Classify ${header} before it becomes a field`, [
        'classification',
      ]),
    );
  }
  const key = spec.key ?? keyFromHeader(header);
  return draft.addAttribute({
    ...spec,
    key,
    label: spec.label ?? { default: header.trim() },
    origin: 'tenant',
  });
}

/** "Cost centre (legacy)" → `cost_centre_legacy`. */
export function keyFromHeader(header: string): string {
  const slug = header
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLocaleLowerCase('en')
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');
  return /^[a-z]/u.test(slug) ? slug : `field_${slug}`;
}
