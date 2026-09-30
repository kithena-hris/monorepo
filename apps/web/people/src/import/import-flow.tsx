import {
  Alert,
  Card,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  FileUploader,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  ImportSummary,
  Stepper,
  type DataColumn,
  type UploadItem,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import {
  NewInformation,
  type Answer,
  type ColumnProposal as NewColumn,
  type NewFieldsView,
  type Reviewed,
} from './new-information';

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
  /**
   * National identifiers our checks doubt (PEO-125): they import, and go to
   * HR's review. Named by cell, never by value.
   */
  readonly findings?: readonly CellFinding[];
  /**
   * Mapped fields a change to which waits for HR's approval (PEO-077), and how
   * many values the rows carry for them.
   */
  readonly sensitive?: { readonly fields: readonly string[]; readonly values: number };
}

export interface CellFinding {
  readonly row: number;
  /** "E14". */
  readonly cell: string;
  readonly label: string;
  /** attention or mismatch. */
  readonly level: string;
  readonly message: string;
}

export type ImportStage =
  | { readonly step: 'upload' }
  | {
      readonly step: 'map';
      readonly file: ImportFile;
      readonly columns: readonly ProposedColumn[];
      /**
       * What a column may be mapped to: the fields this importer may write.
       * `sensitive`: a change to it waits for HR's approval (PEO-077).
       */
      readonly fields: readonly {
        readonly key: string;
        readonly label: string;
        readonly sensitive?: boolean;
      }[];
    }
  | { readonly step: 'review'; readonly file: ImportFile; readonly dryRun: DryRunView }
  | {
      readonly step: 'done';
      readonly file: ImportFile;
      readonly created: number;
      readonly updated: number;
      readonly blocked: number;
      /** Doubted identifiers that imported and went to HR's review (PEO-125). */
      readonly forReview?: number;
      /** Values waiting for HR's approval rather than written (PEO-077). */
      readonly held?: number;
      /** HR chose to apply sensitive values without approval. */
      readonly appliedWithoutApproval?: boolean;
    };

/** PRD §14.5: 100 MB per file. The server holds it to that; this saves the wait. */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export interface ImportFlowProps {
  readonly load: Loadable<ImportStage>;
  /**
   * Upload the file — straight to storage, never through the app's server —
   * reporting how much has gone, 0 to 100, as it goes; then check it.
   */
  readonly onUpload: (file: File, progress: (percent: number) => void) => Promise<Outcome>;
  /** Column index → attribute key, or null to ignore it. */
  readonly onMap: (mapping: Readonly<Record<number, string | null>>) => Promise<Outcome>;
  /**
   * Import. `applyWithoutApproval`: write values that need HR's approval
   * straight through, recorded as such on each row's event (PEO-077); only
   * HR may, and People refuses anybody else.
   */
  readonly onCommit: (options: { readonly applyWithoutApproval: boolean }) => Promise<Outcome>;
  /** The blocked rows as a file that imports once fixed: original cells plus `__reason`. */
  readonly onDownloadBlocked: () => void;
  readonly onBack: () => void;
  /**
   * Nothing is published yet, so there is nothing to import against: setup
   * comes first, because the legal entity and its country pack decide which
   * fields the law requires. `href` is setup, for an administrator; null for
   * HR without administrator rights, who is told who sets it up.
   */
  readonly setup?: { readonly href: string | null };
  /**
   * New information in the file (docs/ai-settings.md): fields proposed for
   * the columns that match none, reviewed, and added before the dry run.
   * Absent, those columns are simply not imported.
   */
  readonly newFields?: {
    readonly propose: (mapping: Mapping) => Promise<Answer<NewFieldsView>>;
    readonly review: (mapping: Mapping, proposals: readonly NewColumn[]) => Promise<Answer<Reviewed>>;
    readonly apply: (mapping: Mapping, proposals: readonly NewColumn[], summary: string) => Promise<Outcome>;
  };
}

type Mapping = Readonly<Record<number, string | null>>;

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
            {stage.step === 'upload' ? (
              props.setup === undefined ? (
                <Upload onUpload={props.onUpload} />
              ) : (
                <SetupFirst href={props.setup.href} />
              )
            ) : null}
            {stage.step === 'map' ? <Mapping stage={stage} {...props} /> : null}
            {stage.step === 'review' ? <Review stage={stage} {...props} /> : null}
            {stage.step === 'done' ? (
              <Card padded className="flex max-w-3xl flex-col gap-4">
                <ImportSummary
                  label="What the import did"
                  tiles={[
                    { id: 'created', label: 'Created', count: stage.created, tone: 'success' },
                    { id: 'updated', label: 'Updated', count: stage.updated, tone: 'info' },
                    { id: 'skipped', label: 'Skipped', count: stage.blocked, tone: 'neutral' },
                  ]}
                />
                <Alert tone="success" title={`${stage.file.name} is imported`}>
                  {stage.created} created, {stage.updated} updated
                  {stage.blocked > 0
                    ? `, ${String(stage.blocked)} left out and in the blocked file`
                    : ''}
                  .
                  {(stage.forReview ?? 0) > 0
                    ? ` ${String(stage.forReview)} national identifiers our checks doubt went to HR's review.`
                    : ''}
                  {(stage.held ?? 0) > 0
                    ? ` ${String(stage.held)} sensitive ${stage.held === 1 ? 'value waits' : 'values wait'} for HR's approval and ${stage.held === 1 ? 'is' : 'are'} not applied until then.`
                    : ''}
                  {stage.appliedWithoutApproval === true
                    ? ' Sensitive values were applied without approval, and each change records that you chose to.'
                    : ''}
                </Alert>
                {stage.created > 0 ? (
                  <Alert tone="info" title="Nobody has been invited yet">
                    New people are pre-hire or provisional. Invite each from their record when
                    you’re ready.
                  </Alert>
                ) : null}
              </Card>
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

function SetupFirst({ href }: { readonly href: string | null }): JSX.Element {
  return (
    <Alert
      tone="info"
      title="Set up the employee record first"
      action={
        href === null ? undefined : (
          <Button asChild variant="primary" size="sm">
            <a href={href}>Set up the employee record</a>
          </Button>
        )
      }
    >
      The legal entity and its country pack decide which fields the law requires, so a file is
      imported against them. Once they are published the import carries on here, and the columns in
      your file that match no field become new fields for you to review.
      {href === null ? ' A People administrator sets it up; ask one, then import here.' : ''}
    </Alert>
  );
}

function Upload({ onUpload }: { readonly onUpload: ImportFlowProps['onUpload'] }): JSX.Element {
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const change = (id: string, patch: Partial<UploadItem>): void => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };
  const send = (item: UploadItem): void => {
    change(item.id, { status: 'uploading', progress: 0 });
    void onUpload(item.file, (percent) => {
      change(item.id, { progress: percent });
    }).then((outcome) => {
      // Success moves the flow on to the mapping, and this list goes with it.
      if (!outcome.ok) change(item.id, { status: 'error', error: outcome.message });
    });
  };
  return (
    <FileUploader
      label="Drop a spreadsheet, or choose one"
      hint="CSV or Excel, up to 50,000 rows or 100 MB. A file exported from here imports back without mapping."
      accept={['.csv', '.tsv', '.xlsx']}
      maxSize={MAX_IMPORT_BYTES}
      maxFiles={1}
      multiple={false}
      value={items}
      onChange={(next) => {
        setItems(next);
        const added = next.find((i) => i.status === 'pending');
        if (added !== undefined) send(added);
      }}
      onRetry={send}
    />
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
  newFields,
}: ImportFlowProps & { readonly stage: Extract<ImportStage, { step: 'map' }> }): JSX.Element {
  // Only what the admin changed; the proposal stands for everything else.
  const [choices, setChoices] = useState<Readonly<Record<number, string | null>>>({});
  const [busy, refused, attempt] = useAttempt();
  // New information in the file: proposed once, when the mapping is done.
  const [newInfo, setNewInfo] = useState<{ view: NewFieldsView; mapping: Mapping } | null>(null);
  const [withoutNew, setWithoutNew] = useState(false);
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
                  {f.sensitive === true
                    ? `${f.label} (sensitive: changes wait for approval)`
                    : f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
    },
    { id: 'confidence', header: 'Confidence', cell: confidence },
  ];

  if (newInfo !== null && newFields !== undefined) {
    const { view, mapping } = newInfo;
    return (
      <NewInformation
        view={view}
        onReview={(proposals) => newFields.review(mapping, proposals)}
        onApply={async (proposals, summary) => {
          const added = await newFields.apply(mapping, proposals, summary);
          if (!added.ok) return added;
          // The new columns now map to their new fields; on to the dry run.
          const mapped = Object.fromEntries(
            proposals.filter((p) => p.include).map((p) => [p.column, p.key]),
          );
          return onMap({ ...mapping, ...mapped });
        }}
        onSkip={() => {
          void attempt(() => onMap(mapping));
        }}
        onBack={() => {
          setNewInfo(null);
        }}
      />
    );
  }

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
            const unplaced = stage.columns.some(
              (c) => c.status === 'ignored' && c.source === null && chosen(c) === null,
            );
            if (newFields === undefined || !unplaced || withoutNew) {
              void attempt(() => onMap(mapping));
              return;
            }
            void attempt(async () => {
              const proposed = await newFields.propose(mapping);
              if (!proposed.ok) {
                // The import still goes on: without them, on the next press.
                setWithoutNew(true);
                return { ok: false, message: `${proposed.message} Press again to import without the new columns.` };
              }
              if (proposed.data.proposals.length === 0) return onMap(mapping);
              setNewInfo({ view: proposed.data, mapping });
              return { ok: true };
            });
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
  const [applyWithoutApproval, setApplyWithoutApproval] = useState(false);
  const { counts, incomplete, blocked, ignoredColumns } = stage.dryRun;
  const findings = stage.dryRun.findings ?? [];
  const sensitive = stage.dryRun.sensitive ?? { fields: [], values: 0 };
  const importing = counts.create + counts.update;

  const findingColumns: DataColumn<CellFinding>[] = [
    { id: 'row', header: 'Row', numeric: true, cell: (r) => r.row },
    {
      id: 'cell',
      header: 'Cell',
      cell: (r) => <span className="font-mono text-xs">{r.cell}</span>,
    },
    { id: 'label', header: 'Field', cell: (r) => r.label },
    {
      id: 'message',
      header: 'What the checks found',
      cell: (r) => (
        <span className="flex flex-col gap-1">
          <span>
            <Badge tone={r.level === 'mismatch' ? 'danger' : 'warning'} size="sm">
              {r.level === 'mismatch' ? 'Does not compute' : 'Needs attention'}
            </Badge>
          </span>
          {r.message}
        </span>
      ),
    },
  ];

  const blockedColumns: DataColumn<BlockedRow>[] = [
    { id: 'row', header: 'Row', numeric: true, cell: (r) => r.row },
    { id: 'person', header: 'Person', cell: (r) => r.person ?? '(no name)' },
    {
      id: 'cell',
      header: 'Cell',
      cell: (r) => (
        <span className="rounded-xs bg-danger-subtle px-2 py-0.5 font-mono text-xs text-danger-fg">
          {r.cell}
        </span>
      ),
    },
    { id: 'problem', header: 'Why it’s blocked', cell: (r) => r.problem },
  ];

  return (
    <Stack gap={5}>
      {/* How the dry run sorted the rows (R7): the blocked ones are what needs you. */}
      <ImportSummary
        label="Rows by outcome"
        tiles={[
          { id: 'create', label: 'Create', count: counts.create, tone: 'success' },
          { id: 'update', label: 'Update', count: counts.update, tone: 'info' },
          { id: 'unchanged', label: 'Unchanged', count: counts.unchanged, tone: 'neutral' },
          { id: 'blocked', label: 'Blocked', count: counts.blocked, tone: 'danger' },
          { id: 'duplicate', label: 'Duplicate', count: counts.duplicate, tone: 'warning' },
        ]}
        selected={counts.blocked + counts.duplicate > 0 ? 'blocked' : null}
      />

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

      {sensitive.values > 0 ? (
        <div className="flex flex-col gap-3">
          <Alert
            tone="info"
            title={`${String(sensitive.values)} sensitive ${sensitive.values === 1 ? 'value' : 'values'} will wait for approval`}
          >
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge tone="sensitive" size="sm">
                Sensitive
              </Badge>
              {sensitive.fields.join(', ')}
            </span>{' '}
            {applyWithoutApproval
              ? 'will be applied now, without approval.'
              : 'are not applied when the rows import: each goes to a second HR member, who has seven days to approve it.'}
          </Alert>
          <Field orientation="horizontal">
            <FieldLabel>Apply sensitive values without approval</FieldLabel>
            <FieldControl>
              <Checkbox
                checked={applyWithoutApproval}
                onCheckedChange={(checked) => {
                  setApplyWithoutApproval(checked === true);
                }}
              />
            </FieldControl>
            <FieldDescription>
              HR only. Each change records that you applied it without approval.
            </FieldDescription>
          </Field>
        </div>
      ) : null}

      {findings.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Alert
            tone="warning"
            title={`Our checks suggest ${String(findings.length)} ${findings.length === 1 ? 'identifier' : 'identifiers'} may be wrong`}
          >
            These rows will import, and HR will review each value. If a value is wrong, fix it in
            the file first.
          </Alert>
          <DataTable
            label="Identifiers to check"
            rows={findings}
            columns={findingColumns}
            rowId={(r) => `${r.cell}/${r.message}`}
          />
        </div>
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
            void attempt(() => onCommit({ applyWithoutApproval }));
          }}
        >
          Import {importing} rows
        </Button>
      </div>
    </Stack>
  );
}
