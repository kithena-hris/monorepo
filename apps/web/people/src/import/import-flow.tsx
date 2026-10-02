import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  DataTable,
  FileUploader,
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageFooter,
  ModalPageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stack,
  icons,
  type DataColumn,
  type UploadItem,
} from '@reach/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import {
  DoneStep,
  PlanDetails,
  SensitiveChoice,
  cannotRun,
  type ImportDoneView,
  type ImportPlanView,
} from './import-plan';
import {
  MissingChoice,
  isSpecial,
  ProposedFieldCard,
  newSectionsOf,
  proposalsOf,
  type Answer,
  type ColumnProposal,
  type NewFieldsView,
} from './new-fields';

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
  readonly source: 'key' | 'label' | 'alias' | 'suggested' | 'manual' | 'system' | null;
  readonly confidence: number | null;
  /** Why it is refused, in words. */
  readonly reason: string | null;
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
  | ImportDoneView;

/** PRD §14.5: 100 MB per file. The server holds it to that; this saves the wait. */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

type Mapping = Readonly<Record<number, string | null>>;

export interface ImportFlowProps {
  readonly load: Loadable<ImportStage>;
  /**
   * Upload the file — straight to storage, never through the app's server —
   * reporting how much has gone, 0 to 100, as it goes; then check it.
   */
  readonly onUpload: (file: File, progress: (percent: number) => void) => Promise<Outcome>;
  /** Fields proposed for the columns that match none. Nothing is written. */
  readonly propose: (mapping: Mapping) => Promise<Answer<NewFieldsView>>;
  /** Everything the import will do, from these choices, over a dry run. Nothing is written. */
  readonly plan: (
    mapping: Mapping,
    proposals: readonly ColumnProposal[],
  ) => Promise<Answer<ImportPlanView>>;
  /**
   * Import: setup if nothing is published, the new fields, their defaults,
   * the rows. `applyWithoutApproval` is HR's "apply sensitive values without
   * approval" (PEO-077).
   */
  readonly run: (
    mapping: Mapping,
    proposals: readonly ColumnProposal[],
    options: { readonly applyWithoutApproval: boolean },
  ) => Promise<Outcome>;
  /** The skipped rows as a file: a signed link. */
  readonly onDownloadBlocked: (url: string) => void;
  /** From the review back to the upload. */
  readonly onBack: () => void;
  /** Finished: the modal closes. */
  readonly onDone?: () => void;
  /**
   * Nothing is published and the viewer cannot set it up: the first import is
   * a People administrator's. `href` is unused, kept for the shell's shape.
   */
  readonly setup?: { readonly href: string | null };
}

const IGNORE = '__ignore';

/**
 * Importing people from a spreadsheet, in a modal over the page it was
 * opened from (PRD §14; design AI9 to AI12): upload, one review, import, done.
 *
 * The review is the whole decision on one screen. What will happen comes
 * first, worked out again from a dry run after every change; under it the
 * columns, the new fields the unmatched ones become, and for each what
 * happens for the people without a value, each changed where it stands.
 * Nothing is written until Import. A company with nothing published imports
 * the same way: the plan sets it up.
 *
 * The shell keeps the modal in the address (`?import=…&step=…`), so Back
 * steps back or closes it and a reload opens it again.
 */
export function ImportModal({
  flow,
  onClose,
}: {
  /** The import, while the address says one is open. */
  readonly flow: ImportFlowProps | null;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <ModalPage
      open={flow !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalPageContent size="column">{flow === null ? null : <ImportFlow {...flow} />}</ModalPageContent>
    </ModalPage>
  );
}

/** The modal's content: its header, the step, and the step's actions. */
export function ImportFlow(props: ImportFlowProps): JSX.Element {
  if (props.load.status !== 'ready') {
    // Reading the upload back (a reload), or it could not be: titled either way.
    return (
      <Frame description="Reading your file">
        <Loaded load={props.load} what="the import">
          {() => null}
        </Loaded>
      </Frame>
    );
  }
  const stage = props.load.data;
  if (stage.step === 'map') return <Review {...props} stage={stage} />;
  if (stage.step === 'upload') {
    return (
      <Frame description="CSV or Excel. Nothing is written until you import.">
        {props.setup === undefined ? (
          <Upload onUpload={props.onUpload} />
        ) : (
          <Alert tone="info" title="An administrator imports the first file">
            Nothing is set up yet. A People administrator imports the first file: importing it sets
            up the employee record, with the fields the law requires and the new ones your file
            brings. Then HR imports here.
          </Alert>
        )}
      </Frame>
    );
  }
  return (
    <Frame
      description="Done"
      footer={
        props.onDone === undefined ? null : (
          <Button variant="primary" onClick={props.onDone}>
            Done
          </Button>
        )
      }
    >
      <DoneStep done={stage} />
    </Frame>
  );
}

function Frame({
  description,
  footer = null,
  children,
}: {
  readonly description: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <>
      <ModalPageHeader title="Import people" description={description} />
      <ModalPageBody className="p-5 touch:p-4">{children}</ModalPageBody>
      {footer === null ? null : <ModalPageFooter>{footer}</ModalPageFooter>}
    </>
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
      // Success moves the flow on to the review, and this list goes with it.
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
  if (column.source === 'system') return column.reason ?? 'Exact';
  if (column.source === 'key' || column.source === 'label') return 'Exact';
  if (column.source === 'alias') return 'Usual name';
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

/** The one review: the plan, the columns, the new fields and their people without a value. */
function Review({
  stage,
  ...props
}: ImportFlowProps & { readonly stage: Extract<ImportStage, { step: 'map' }> }): JSX.Element {
  // Only what HR changed; the proposal stands for everything else.
  const [choices, setChoices] = useState<Mapping>({});
  const [view, setView] = useState<NewFieldsView | null>(null);
  const [proposals, setProposals] = useState<readonly ColumnProposal[]>([]);
  // The mapping the proposals were made for: the plan waits for them.
  const [proposedFor, setProposedFor] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlanView | null>(null);
  const [running, setRunning] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [applyWithoutApproval, setApplyWithoutApproval] = useState(false);

  const labelOf = new Map(stage.fields.map((f) => [f.key, f.label]));
  const chosen = (c: ProposedColumn): string | null =>
    c.index in choices ? (choices[c.index] ?? null) : c.status === 'mapped' ? c.key : null;
  const undecided = stage.columns.filter((c) => c.status === 'review' && !(c.index in choices));
  const mapped = stage.columns.filter((c) => chosen(c) !== null).length;
  const mapping: Mapping = Object.fromEntries(stage.columns.map((c) => [c.index, chosen(c)]));
  const unplaced = stage.columns.some(
    (c) => c.status === 'ignored' && c.source === null && chosen(c) === null,
  );
  const mappingKey = JSON.stringify(mapping);
  const proposalsKey = JSON.stringify(proposals);

  // The columns that match no field, proposed as fields: again whenever the mapping changes.
  useEffect(() => {
    let live = true;
    setPlan(null);
    setRefused(null);
    if (!unplaced) {
      setView(null);
      setProposals([]);
      setProposedFor(mappingKey);
      return undefined;
    }
    void props.propose(mapping).then((proposed) => {
      if (!live) return;
      if (!proposed.ok) {
        setRefused(proposed.message);
        return;
      }
      setView(proposed.data);
      setProposals(proposalsOf(proposed.data));
      setProposedFor(mappingKey);
    });
    return () => {
      live = false;
    };
  }, [mappingKey]);

  // What will happen, from a dry run: again after every choice.
  useEffect(() => {
    if (proposedFor !== mappingKey) return undefined;
    let live = true;
    setPlan(null);
    void props.plan(mapping, proposals).then((answer) => {
      if (!live) return;
      if (answer.ok) setPlan(answer.data);
      else setRefused(answer.message);
    });
    return () => {
      live = false;
    };
  }, [proposedFor, mappingKey, proposalsKey]);

  const change = (column: number, patch: Partial<ColumnProposal>): void => {
    setProposals((list) => list.map((p) => (p.column === column ? { ...p, ...patch } : p)));
  };

  const run = (): void => {
    setRunning(true);
    setRefused(null);
    void props.run(mapping, proposals, { applyWithoutApproval }).then((ran) => {
      setRunning(false);
      if (!ran.ok) setRefused(ran.message);
    });
  };

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
              <SelectItem value={IGNORE}>
                {c.status === 'ignored' && c.source === null
                  ? 'A new field, or ignored'
                  : 'Ignored'}
              </SelectItem>
              {c.key !== null && !labelOf.has(c.key) && c.source === 'system' ? (
                <SelectItem value={c.key}>{c.key.replaceAll('_', ' ')}</SelectItem>
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
    { id: 'confidence', header: 'Match', cell: confidence },
  ];

  // What "Accept all" switches on: everything but what is held back.
  const acceptable = proposals.filter((p) => !p.include && !isSpecial(p));
  const missingOf = (p: ColumnProposal): number =>
    view?.proposals.find((x) => x.column === p.column)?.counts.missing ?? 0;
  const cannot =
    undecided.length > 0
      ? `${undecided.map((c) => c.header).join(', ')} ${undecided.length === 1 ? 'needs' : 'need'} a field, or Ignored.`
      : plan === null
        ? null
        : cannotRun(plan);

  return (
    <>
      <ModalPageHeader
        title="Import people"
        description={`${stage.file.name} · ${stage.file.rows.toLocaleString('en-GB')} rows · ${String(mapped)} of ${String(stage.columns.length)} columns mapped`}
      />
      <ModalPageBody className="p-5 touch:p-4">
        <Stack gap={5}>
          {refused === null ? null : (
            <Alert tone="danger" title="That did not go through">
              {refused}
            </Alert>
          )}
          {plan === null ? (
            <div role="status" className="flex flex-col gap-2">
              <span className="sr-only">Working out what will happen</span>
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : (
            <PlanDetails plan={plan} onDownloadBlocked={props.onDownloadBlocked} />
          )}

          <PageSection title="Columns" description="Each column, and the field it goes to.">
            {undecided.length > 0 ? (
              <Alert tone="warning">
                {undecided.length} {undecided.length === 1 ? 'column needs' : 'columns need'} a
                decision: {undecided.map((c) => c.header).join(', ')}. A column is never dropped
                quietly.
              </Alert>
            ) : null}
            <DataTable
              label="Columns"
              rows={stage.columns}
              columns={columns}
              rowId={(c) => String(c.index)}
            />
          </PageSection>

          {view === null || proposals.length === 0 ? null : (
            <section aria-label="New fields" className="flex flex-col gap-3">
              <AssistantCard
                level={2}
                title={
                  proposals.length === 1
                    ? '1 column isn’t a field yet. Here’s what I’d create.'
                    : `${String(proposals.length)} columns aren’t fields yet. Here’s what I’d create.`
                }
                action={
                  !view.canCreate || acceptable.length === 0 ? undefined : (
                    <Button
                      size="sm"
                      startIcon={<icons.confirm aria-hidden />}
                      onClick={() => {
                        for (const p of acceptable) change(p.column, { include: true });
                      }}
                    >
                      Accept all {acceptable.length}
                    </Button>
                  )
                }
                {...(view.byModel
                  ? {}
                  : { note: 'Proposed by Kithena’s own rules: the assistant didn’t answer this time.' })}
              >
                <p className="text-sm text-fg-muted">
                  I read every value in each column to choose the type, the options and who should
                  see it. Switch off any you don’t want, or edit them. Nothing is created until you
                  import.
                </p>
              </AssistantCard>
              {view.blocked === null ? null : (
                <Alert
                  tone={view.canCreate ? 'warning' : 'info'}
                  title={view.canCreate ? 'Not yet' : 'An administrator adds fields'}
                >
                  {view.blocked}
                </Alert>
              )}
              <div className="flex flex-col gap-3">
                {proposals.map((p) => {
                  const shown = view.proposals.find((x) => x.column === p.column);
                  const missing = missingOf(p);
                  return (
                    <div key={p.column} className="flex flex-col gap-2">
                      <ProposedFieldCard
                        proposal={p}
                        sensitive={shown?.sensitive ?? null}
                        counts={shown?.counts}
                        rows={stage.file.rows}
                        sections={view.sections}
                        newSections={newSectionsOf(proposals)}
                        readOnly={!view.canCreate}
                        onChange={(patch) => {
                          change(p.column, patch);
                        }}
                      />
                      {p.include && missing > 0 ? (
                        <MissingChoice
                          proposal={p}
                          missing={missing}
                          recommended={shown?.forExisting.kind ?? null}
                          readOnly={!view.canCreate}
                          onChange={(forExisting) => {
                            change(p.column, { forExisting });
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {plan === null ? null : (
            <SensitiveChoice
              plan={plan}
              checked={applyWithoutApproval}
              onCheckedChange={setApplyWithoutApproval}
            />
          )}
          {cannot === null ? null : (
            <Alert tone="warning" title="Not yet">
              {cannot}
            </Alert>
          )}
        </Stack>
      </ModalPageBody>
      <ModalPageFooter>
        <Button onClick={props.onBack}>Choose another file</Button>
        <Button
          variant="primary"
          startIcon={<icons.confirm aria-hidden />}
          disabled={plan === null || cannot !== null}
          loading={running}
          loadingLabel="Importing"
          onClick={run}
        >
          {plan === null ? 'Import' : `Import ${importing(plan)}`}
        </Button>
      </ModalPageFooter>
    </>
  );
}

/** "31 people", for the button: what pressing it imports. */
function importing(plan: ImportPlanView): string {
  const { create, update } = plan.review.dryRun.counts;
  const n = create + update;
  return `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`;
}
