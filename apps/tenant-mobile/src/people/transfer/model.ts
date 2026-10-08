/**
 * Import's shapes, as the web's `people/src/import/*` reads them. People sends
 * most of these as JSON text: the file's mapping, the fields it proposes, the
 * plan from a dry run, and the run that follows.
 */

export interface ImportFile {
  readonly name: string;
  readonly rows: number;
  readonly sheet: string | null;
}

export interface ProposedColumn {
  readonly index: number;
  readonly header: string;
  readonly status: 'mapped' | 'review' | 'ignored' | 'refused';
  readonly key: string | null;
  readonly source: string | null;
  readonly confidence: number | null;
  readonly reason: string | null;
  readonly adds: readonly string[] | null;
}

export interface MapStage {
  readonly __typename: 'ImportMapStage';
  readonly step: string;
  readonly file: ImportFile;
  readonly columns: readonly ProposedColumn[];
  readonly fields: readonly { key: string; label: string; sensitive: boolean | null }[];
}

export type ForExisting =
  | { readonly kind: 'ask' }
  | { readonly kind: 'hr' }
  | { readonly kind: 'new' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'default'; readonly value: string };

export interface ColumnProposal {
  readonly column: number;
  readonly header: string;
  readonly shape: string;
  readonly include: boolean;
  readonly key: string;
  readonly field: {
    readonly label: string;
    readonly dataType: string;
    readonly classification: string;
    readonly [more: string]: unknown;
  };
  readonly placement: { readonly sectionKey: string } | { readonly newSection: string };
  readonly why: string;
  readonly forExisting: ForExisting;
  readonly forExistingWhy: string;
  readonly confidence: 'high' | 'medium';
  readonly counts?: { have: number; missing: number; existingWithout: number };
  readonly sensitive?: string | null;
}

export interface NewFieldsView {
  readonly canCreate: boolean;
  readonly blocked: string | null;
  readonly proposals: readonly ColumnProposal[];
  readonly sections: readonly { key: string; label: string }[];
  readonly existingPeople: number;
  readonly totalPeople: number;
  readonly version: number;
}

export type PlaceChoice =
  | { readonly kind: 'map'; readonly locationId: string }
  | {
      readonly kind: 'add';
      readonly name: string;
      readonly country: string;
      readonly timeZone: string;
      readonly legalEntityId?: string;
    }
  | { readonly kind: 'leave' };

export interface Workplace {
  readonly key: string;
  readonly value: string;
  readonly rows: number;
  readonly found: { id: string; name: string } | null;
  readonly suggestion: { id: string; name: string } | null;
  readonly proposed: PlaceChoice;
  readonly note: string | null;
}

export interface PlanView {
  readonly steps: readonly { kind: string; title: string; detail: string }[];
  readonly short: string;
  readonly version: number;
  readonly basedOn: number | null;
  readonly blocked: string | null;
  readonly problems: readonly { column: number; header: string; message: string }[];
  readonly review: {
    readonly file: ImportFile;
    readonly dryRun: {
      readonly counts: Readonly<
        Record<'create' | 'update' | 'unchanged' | 'blocked' | 'duplicate', number>
      >;
      readonly blocked?: readonly {
        row: number;
        name?: string | null;
        problem: string;
        cell: string;
      }[];
      readonly sensitive?: { fields: readonly string[]; values: number };
      readonly workplaces?: readonly Workplace[];
      readonly here?: {
        readonly locations: readonly { id: string; name: string }[];
        readonly entities: readonly {
          id: string;
          name: string;
          country: string;
          timeZone: string;
        }[];
      };
    };
    readonly blockedUrl?: string | null;
  };
  readonly asked: number;
  readonly forHr: number;
}

export interface DoneView {
  readonly file?: { name: string; rows: number };
  readonly created: number;
  readonly updated: number;
  readonly blocked: number;
  readonly reportUrl?: string;
  readonly forReview?: number;
  readonly held?: number;
  readonly asked?: number;
  readonly forHr?: number;
  readonly fields?: readonly { label: string }[];
  readonly finishedAt?: string;
  readonly tookMs?: number;
}

export interface RunStatus {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed';
  readonly label: string;
  readonly step: string;
  readonly people: { readonly done: number; readonly total: number | null };
  readonly fileName: string | null;
  readonly result: DoneView | null;
  readonly failure: string | null;
}

export const isRunning = (run: RunStatus): boolean =>
  run.status === 'queued' || run.status === 'running';

/** Who fills a new field in for the people already here, in words a chip says. */
export const FOR_EXISTING: readonly { kind: ForExisting['kind']; label: string }[] = [
  { kind: 'ask', label: 'Ask them' },
  { kind: 'new', label: 'Only new joiners' },
  { kind: 'hr', label: 'HR fills it in' },
  { kind: 'leave', label: 'Leave it empty' },
];

/** The mapping People's import reads: every column index to a field key, or null to leave it. */
export type Mapping = Readonly<Record<number, string | null>>;

export const mappingOf = (columns: readonly ProposedColumn[]): Mapping =>
  Object.fromEntries(
    columns.map((c) => [c.index, c.status === 'mapped' || c.status === 'review' ? c.key : null]),
  );
