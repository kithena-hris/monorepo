import {
  Alert,
  AutoGrid,
  Badge,
  Button,
  DataTable,
  Dropzone,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Stat,
  Stepper,
  type DataColumn,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';

export interface ImportFile {
  readonly name: string;
  readonly rows: number;
  readonly sheet: string | null;
}

/** One column of the file, and what the importer proposes for it (§14.3). */
export interface ProposedColumn {
  readonly index: number;
  readonly header: string;
  /** `review` is a suggestion below the threshold: the admin decides. */
  readonly status: 'mapped' | 'review' | 'ignored' | 'refused';
  readonly key: string | null;
  readonly source: 'key' | 'label' | 'suggested' | 'manual' | 'system' | null;
  readonly confidence: number | null;
  /** Why it is refused, in words. */
  readonly reason: string | null;
}

export interface BlockedRow {
  readonly row: number;
  readonly person: string | null;
  readonly problem: string;
  /** "D18 — empty", "F47 — “31/02/2025”". */
  readonly cell: string;
}

export interface DryRunView {
  readonly counts: Readonly<
    Record<'create' | 'update' | 'unchanged' | 'blocked' | 'duplicate', number>
  >;
  /** Of the rows that will import, how many leave a gap, and which. */
  readonly incomplete: {
    readonly count: number;
    readonly byField: readonly { readonly label: string; readonly count: number }[];
  };
  /** Never silent (§14.3): every column that will not be imported. */
  readonly ignoredColumns: readonly string[];
  /** The first rows of the blocked list, each with the offending cell. */
  readonly blocked: readonly BlockedRow[];
}

export type ImportStage =
  | { readonly step: 'upload' }
  | {
      readonly step: 'map';
      readonly file: ImportFile;
      readonly columns: readonly ProposedColumn[];
      /** What a column may be mapped to: the fields this importer may write. */
      readonly fields: readonly { readonly key: string; readonly label: string }[];
    }
  | { readonly step: 'review'; readonly file: ImportFile; readonly dryRun: DryRunView }
  | {
      readonly step: 'done';
      readonly file: ImportFile;
      readonly created: number;
      readonly updated: number;
      readonly blocked: number;
    };

export interface ImportFlowProps {
  readonly load: Loadable<ImportStage>;
  readonly onUpload: (file: File) => Promise<Outcome>;
  /** Column index → attribute key, or null to ignore it. */
  readonly onMap: (mapping: Readonly<Record<number, string | null>>) => Promise<Outcome>;
  readonly onCommit: () => Promise<Outcome>;
  /** The blocked rows as a file that imports once fixed: original cells plus `__reason`. */
  readonly onDownloadBlocked: () => void;
  readonly onBack: () => void;
}

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Import' },
] as const;

const IGNORE = '__ignore';

/**
 * Importing people from a spreadsheet (PRD §14, design screen 10).
 *
 * Upload, map, then the dry run — which is the product, not a formality:
 * every row is classified before anything is written, and three outcomes are
 * deliberately different. A missing work email blocks a row; a missing cost
 * centre imports it as incomplete; an invalid date blocks it, because wrong is
 * not the same as absent. The blocked rows download as a file that imports
 * once fixed, and maps itself the way the original did.
 */
export function ImportFlow(props: ImportFlowProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Import people"
        description="Nothing is written until you accept the review."
      />
      <Loaded load={props.load} what="the import">
        {(stage) => (
          <Stack gap={6}>
            <Stepper
              label="Importing people"
              steps={STEPS}
              current={STEPS.findIndex((s) => s.id === stage.step)}
            />
            {stage.step === 'upload' ? <Upload onUpload={props.onUpload} /> : null}
            {stage.step === 'map' ? <Mapping stage={stage} {...props} /> : null}
            {stage.step === 'review' ? <Review stage={stage} {...props} /> : null}
            {stage.step === 'done' ? (
              <Alert tone="success" title={`${stage.file.name} is imported`}>
                {stage.created} created, {stage.updated} updated
                {stage.blocked > 0
                  ? `, ${String(stage.blocked)} left out and in the blocked file`
                  : ''}
                .
              </Alert>
            ) : null}
          </Stack>
        )}
      </Loaded>
    </Stack>
  );
}

function useAttempt(): [boolean, string | null, (run: () => Promise<Outcome>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const attempt = async (run: () => Promise<Outcome>): Promise<void> => {
    setBusy(true);
    setRefused(null);
    const outcome = await run();
    setBusy(false);
    if (!outcome.ok) setRefused(outcome.message);
  };
  return [busy, refused, attempt];
}

function Refused({ message }: { readonly message: string | null }): JSX.Element | null {
  return message === null ? null : (
    <Alert tone="danger" title="That did not go through">
      {message}
    </Alert>
  );
}

function Upload({ onUpload }: { readonly onUpload: ImportFlowProps['onUpload'] }): JSX.Element {
  const [busy, refused, attempt] = useAttempt();
  return (
    <Stack gap={4}>
      <Dropzone
        label="Drop a spreadsheet, or choose one"
        hint="CSV or Excel, up to 50,000 rows. A file exported from here imports back without mapping."
        accept=".csv,.tsv,.xlsx"
        disabled={busy}
        onFiles={(files) => {
          const [file] = files;
          if (file !== undefined) void attempt(() => onUpload(file));
        }}
      />
      <Refused message={refused} />
    </Stack>
  );
}

function confidence(column: ProposedColumn): JSX.Element | string {
  if (column.status === 'refused')
    return (
      <Badge tone="danger" size="sm">
        Refused
      </Badge>
    );
  if (column.source === 'key' || column.source === 'label' || column.source === 'system')
    return 'Exact';
  if (column.source === 'manual') return 'You chose';
  if (column.confidence === null) return '—';
  return column.status === 'review' ? (
    <Badge tone="warning" size="sm">
      {column.confidence.toFixed(2)}, check this
    </Badge>
  ) : (
    column.confidence.toFixed(2)
  );
}

function Mapping({
  stage,
  onMap,
  onBack,
}: ImportFlowProps & { readonly stage: Extract<ImportStage, { step: 'map' }> }): JSX.Element {
  // Only what the admin changed; the proposal stands for everything else.
  const [choices, setChoices] = useState<Readonly<Record<number, string | null>>>({});
  const [busy, refused, attempt] = useAttempt();
  const labelOf = new Map(stage.fields.map((f) => [f.key, f.label]));

  const chosen = (c: ProposedColumn): string | null =>
    c.index in choices ? (choices[c.index] ?? null) : c.status === 'mapped' ? c.key : null;
  const undecided = stage.columns.filter((c) => c.status === 'review' && !(c.index in choices));
  const mapped = stage.columns.filter((c) => chosen(c) !== null).length;

  const columns: DataColumn<ProposedColumn>[] = [
    { id: 'header', header: 'In your file', cell: (c) => c.header },
    {
      id: 'target',
      header: 'Goes to',
      cell: (c) =>
        c.status === 'refused' ? (
          <span className="text-sm text-fg-muted">
            {c.reason ?? 'You may not write this field.'}
          </span>
        ) : (
          <Select
            value={chosen(c) ?? IGNORE}
            onValueChange={(value) => {
              setChoices((x) => ({ ...x, [c.index]: value === IGNORE ? null : value }));
            }}
          >
            <SelectTrigger aria-label={`${c.header} goes to`} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={IGNORE}>Ignored</SelectItem>
              {c.key !== null && !labelOf.has(c.key) && c.source === 'system' ? (
                <SelectItem value={c.key}>{c.key}</SelectItem>
              ) : null}
              {stage.fields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
    },
    { id: 'confidence', header: 'Confidence', cell: confidence },
  ];

  return (
    <Stack gap={4}>
      <p className="text-sm">
        {stage.file.name} · {stage.file.rows} rows
        {stage.file.sheet === null ? '' : ` · sheet “${stage.file.sheet}”`} · {mapped} of{' '}
        {stage.columns.length} columns mapped
      </p>
      {undecided.length > 0 ? (
        <Alert tone="warning">
          {undecided.length} {undecided.length === 1 ? 'column needs' : 'columns need'} a decision:{' '}
          {undecided.map((c) => c.header).join(', ')}. A column is never dropped quietly.
        </Alert>
      ) : null}
      <DataTable
        label="Columns"
        rows={stage.columns}
        columns={columns}
        rowId={(c) => String(c.index)}
      />
      <Refused message={refused} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={onBack}>Back</Button>
        <Button
          variant="primary"
          disabled={undecided.length > 0}
          loading={busy}
          loadingLabel="Checking every row"
          onClick={() => {
            const mapping = Object.fromEntries(stage.columns.map((c) => [c.index, chosen(c)]));
            void attempt(() => onMap(mapping));
          }}
        >
          Review before importing
        </Button>
      </div>
    </Stack>
  );
}

function Review({
  stage,
  onCommit,
  onDownloadBlocked,
  onBack,
}: ImportFlowProps & { readonly stage: Extract<ImportStage, { step: 'review' }> }): JSX.Element {
  const [busy, refused, attempt] = useAttempt();
  const { counts, incomplete, blocked, ignoredColumns } = stage.dryRun;
  const importing = counts.create + counts.update;

  const blockedColumns: DataColumn<BlockedRow>[] = [
    { id: 'row', header: 'Row', numeric: true, cell: (r) => r.row },
    { id: 'person', header: 'Person', cell: (r) => r.person ?? '(no name)' },
    { id: 'problem', header: 'Problem', cell: (r) => r.problem },
    {
      id: 'cell',
      header: 'Cell',
      cell: (r) => <span className="font-mono text-xs">{r.cell}</span>,
    },
  ];

  return (
    <Stack gap={5}>
      <AutoGrid minItemWidth="8rem" gap={3}>
        <Stat label="Create" value={counts.create} />
        <Stat label="Update" value={counts.update} />
        <Stat label="Unchanged" value={counts.unchanged} />
        <Stat label="Blocked" value={counts.blocked} />
        <Stat label="Duplicate" value={counts.duplicate} />
      </AutoGrid>

      {incomplete.count > 0 ? (
        <Alert
          tone="warning"
          title={`${String(importing)} rows will import, and ${String(incomplete.count)} of them will be incomplete`}
        >
          {incomplete.byField.map((f) => `${String(f.count)} have no ${f.label}`).join(', ')}.
          Missing is not a reason to refuse a row: they will show as incomplete and raise a task.
        </Alert>
      ) : null}
      {ignoredColumns.length > 0 ? (
        <Alert tone="info">Not imported: {ignoredColumns.join(', ')}.</Alert>
      ) : null}

      {counts.blocked + counts.duplicate > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="blocked-rows" className="text-md font-semibold">
              Blocked rows
            </h2>
            <Button size="sm" onClick={onDownloadBlocked}>
              Download all {counts.blocked + counts.duplicate} as CSV
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            Fix the cells in the file and upload it again. It maps itself the way this one did.
          </p>
          <DataTable
            label="Blocked rows"
            rows={blocked}
            columns={blockedColumns}
            rowId={(r) => String(r.row)}
          />
        </div>
      ) : null}

      <Refused message={refused} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={onBack}>Back to mapping</Button>
        <Button
          variant="primary"
          disabled={importing === 0}
          loading={busy}
          loadingLabel="Importing"
          onClick={() => {
            void attempt(onCommit);
          }}
        >
          Import {importing} rows
        </Button>
      </div>
    </Stack>
  );
}
