import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  DataTable,
  FileUploader,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stack,
  Stepper,
  icons,
  useCoarsePointer,
  type DataColumn,
  type UploadItem,
} from '@reach/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { DoneStep, PlanStep, type ImportDoneView, type ImportPlanView } from './import-plan';
import {
  ExistingChoices,
  ExistingStep,
  NewFieldsStep,
  isSpecial,
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

/** The steps after the mapping that live in the address (`?step=`). */
export type FlowStep = 'map' | 'fields' | 'existing' | 'plan';

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
   * Approve and run: setup if nothing is published, the new fields, their
   * defaults, the import. `applyWithoutApproval` is HR's "apply sensitive
   * values without approval" (PEO-077).
   */
  readonly run: (
    mapping: Mapping,
    proposals: readonly ColumnProposal[],
    options: { readonly applyWithoutApproval: boolean },
  ) => Promise<Outcome>;
  /** The blocked rows as a file that imports once fixed: a signed link. */
  readonly onDownloadBlocked: (url: string) => void;
  /** From the mapping back to the upload. */
  readonly onBack: () => void;
  /** Finished: back to Import & export. */
  readonly onDone?: () => void;
  /**
   * Nothing is published and the viewer cannot set it up: the first import is
   * a People administrator's. `href` is unused, kept for the shell's shape.
   */
  readonly setup?: { readonly href: string | null };
  /** The step in the address, so Back and a reload keep the place. */
  readonly step?: string | null;
  readonly onStepChange?: (step: FlowStep | null) => void;
  /** The field the address names, on the people-without-a-value step. */
  readonly field?: string | null;
  readonly onFieldChange?: (key: string | null) => void;
}

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'fields', label: 'New fields' },
  { id: 'plan', label: 'Review plan' },
  { id: 'done', label: 'Import' },
] as const;

const IGNORE = '__ignore';

/**
 * Importing people from a spreadsheet (PRD §14; design AI9 to AI12, MA8, MA9).
 *
 * Upload, map, then the columns that match no field become proposed fields,
 * HR says what happens for the people without a value, and one plan says
 * everything the import will do, from a dry run. Nothing is written until HR
 * approves it. A company with nothing published imports the same way: the
 * plan sets it up.
 */
export function ImportFlow(props: ImportFlowProps): JSX.Element {
  const coarse = useCoarsePointer();
  return (
    <Loaded load={props.load} what="the import">
      {(stage) =>
        stage.step === 'map' ? (
          <AfterUpload {...props} stage={stage} coarse={coarse} />
        ) : (
          <Stack gap={5}>
            <Header
              current={stage.step === 'upload' ? 0 : 4}
              actions={
                stage.step === 'done' && props.onDone !== undefined ? (
                  <Button variant="primary" onClick={props.onDone}>
                    Done
                  </Button>
                ) : null
              }
            />
            {stage.step === 'upload' ? (
              props.setup === undefined ? (
                <Upload onUpload={props.onUpload} />
              ) : (
                <Alert tone="info" title="An administrator imports the first file">
                  Nothing is set up yet. A People administrator imports the first file: approving
                  its plan sets up the employee record, with the fields the law requires and the
                  new ones your file brings. Then HR imports here.
                </Alert>
              )
            ) : (
              <DoneStep done={stage} />
            )}
          </Stack>
        )
      }
    </Loaded>
  );
}

function Header({
  current,
  actions,
}: {
  readonly current: number;
  readonly actions?: ReactNode;
}): JSX.Element {
  return (
    <>
      <PageHeader
        title="Import"
        description="Nothing is written until you approve the plan."
        {...(actions === null || actions === undefined ? {} : { actions })}
      />
      <div className="max-w-245">
        <Stepper label="Importing people" steps={STEPS} current={current} />
      </div>
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

/** Everything after the upload: map, new fields, people without a value, the plan. */
function AfterUpload({
  stage,
  coarse,
  ...props
}: ImportFlowProps & {
  readonly stage: Extract<ImportStage, { step: 'map' }>;
  readonly coarse: boolean;
}): JSX.Element {
  // Only what the admin changed; the proposal stands for everything else.
  const [choices, setChoices] = useState<Mapping>({});
  const [view, setView] = useState<NewFieldsView | null>(null);
  const [proposals, setProposals] = useState<readonly ColumnProposal[]>([]);
  const [plan, setPlan] = useState<ImportPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [applyWithoutApproval, setApplyWithoutApproval] = useState(false);
  const [card, setCard] = useState(0);
  // Without a shell to keep it in the address (a test), the step is kept here.
  const [ownStep, setOwnStep] = useState<FlowStep>('map');

  const asked = props.onStepChange === undefined ? ownStep : (props.step ?? 'map');
  // A step whose data this page no longer holds (a reload) opens the mapping.
  const step: FlowStep =
    (asked === 'fields' || asked === 'existing') && view !== null
      ? asked
      : asked === 'plan' && plan !== null
        ? 'plan'
        : 'map';
  const goTo = (to: FlowStep): void => {
    setRefused(null);
    if (props.onStepChange === undefined) setOwnStep(to);
    else props.onStepChange(to === 'map' ? null : to);
  };

  const labelOf = new Map(stage.fields.map((f) => [f.key, f.label]));
  const chosen = (c: ProposedColumn): string | null =>
    c.index in choices ? (choices[c.index] ?? null) : c.status === 'mapped' ? c.key : null;
  const undecided = stage.columns.filter((c) => c.status === 'review' && !(c.index in choices));
  const mapped = stage.columns.filter((c) => chosen(c) !== null).length;
  const mapping: Mapping = Object.fromEntries(stage.columns.map((c) => [c.index, chosen(c)]));
  const unplaced = stage.columns.some(
    (c) => c.status === 'ignored' && c.source === null && chosen(c) === null,
  );
  const kept = proposals.filter((p) => p.include);

  const change = (column: number, patch: Partial<ColumnProposal>): void => {
    setProposals((list) => list.map((p) => (p.column === column ? { ...p, ...patch } : p)));
    // Any change makes the plan a plan of something else.
    setPlan(null);
  };

  const attempt = async (act: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setRefused(null);
    const message = await act();
    setBusy(false);
    setRefused(message);
  };

  const toPlan = (list: readonly ColumnProposal[], then: FlowStep | null = 'plan') =>
    attempt(async () => {
      const answer = await props.plan(mapping, list);
      if (!answer.ok) return answer.message;
      setPlan(answer.data);
      if (then !== null) goTo(then);
      return null;
    });

  const next = (): void => {
    if (!unplaced) {
      void toPlan([]);
      return;
    }
    void attempt(async () => {
      const proposed = await props.propose(mapping);
      if (!proposed.ok) return proposed.message;
      const list = proposalsOf(proposed.data);
      setView(proposed.data);
      setProposals(list);
      setCard(0);
      if (list.length === 0) {
        const answer = await props.plan(mapping, []);
        if (!answer.ok) return answer.message;
        setPlan(answer.data);
        goTo('plan');
        return null;
      }
      goTo('fields');
      return null;
    });
  };

  const approve = (): void => {
    void attempt(async () => {
      const ran = await props.run(mapping, proposals, { applyWithoutApproval });
      return ran.ok ? null : ran.message;
    });
  };

  // On a phone the people without a value and the plan are one screen (MA9):
  // the plan is worked out as the screen opens and again after each choice.
  const phonePlanDue = coarse && step === 'existing' && plan === null && !busy && refused === null;
  useEffect(() => {
    if (phonePlanDue) void toPlan(proposals, null);
    // Due again only when a choice cleared the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phonePlanDue]);

  const columns: DataColumn<ProposedColumn>[] = [
    { id: 'header', header: 'In your file', cell: (c) => c.header },
    {
      id: 'target',
      header: 'Goes to',
      cell: (c) =>
        c.status === 'refused' ? (
          <span className="text-sm text-fg-muted">{c.reason ?? 'You may not write this field.'}</span>
        ) : (
          <Select
            value={chosen(c) ?? IGNORE}
            onValueChange={(value) => {
              setChoices((x) => ({ ...x, [c.index]: value === IGNORE ? null : value }));
              setView(null);
              setPlan(null);
            }}
          >
            <SelectTrigger aria-label={`${c.header} goes to`} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={IGNORE}>
                {c.status === 'ignored' && c.source === null ? 'A new field, or ignored' : 'Ignored'}
              </SelectItem>
              {c.key !== null && !labelOf.has(c.key) && c.source === 'system' ? (
                <SelectItem value={c.key}>{c.key.replaceAll('_', ' ')}</SelectItem>
              ) : null}
              {stage.fields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.sensitive === true ? `${f.label} (sensitive: changes wait for approval)` : f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
    },
    { id: 'confidence', header: 'Confidence', cell: confidence },
  ];

  const facts = {
    rows: stage.file.rows,
    columns: stage.columns.length,
    mapped,
    ignored: stage.columns
      .filter((c) => chosen(c) === null && !(c.status === 'ignored' && c.source === null))
      .map((c) => c.header)
      .filter((h) => !h.startsWith('__')),
  };

  const refusedAlert =
    refused === null ? null : (
      <Alert tone="danger" title="That did not go through">
        {refused}
      </Alert>
    );

  // The header's buttons: where to go from here (design AI9 to AI11).
  const back = (to: FlowStep | 'upload'): JSX.Element => (
    <Button
      onClick={() => {
        if (to === 'upload') props.onBack();
        else goTo(to);
      }}
    >
      Back
    </Button>
  );
  const nextLabel = unplaced ? 'Next: new fields' : 'Next: review the plan';
  const actions: Record<FlowStep, ReactNode> = {
    map: (
      <>
        {back('upload')}
        <Button
          variant="primary"
          endIcon={<icons.forward aria-hidden />}
          disabled={undecided.length > 0}
          loading={busy}
          loadingLabel={unplaced ? 'Reading the new columns' : 'Checking every row'}
          onClick={next}
        >
          {nextLabel}
        </Button>
      </>
    ),
    fields: (
      <>
        {back('map')}
        <Button
          variant="primary"
          endIcon={<icons.forward aria-hidden />}
          loading={busy}
          loadingLabel="Checking every row"
          onClick={() => {
            if (kept.length === 0) void toPlan(proposals);
            else goTo('existing');
          }}
        >
          {kept.length === 0 ? 'Next: review the plan' : 'Next: what about existing people?'}
        </Button>
      </>
    ),
    existing: (
      <>
        {back('fields')}
        <Button
          variant="primary"
          endIcon={<icons.forward aria-hidden />}
          loading={busy}
          loadingLabel="Checking every row"
          onClick={() => {
            void toPlan(proposals);
          }}
        >
          Next: review the plan
        </Button>
      </>
    ),
    plan: back(view === null ? 'map' : kept.length === 0 ? 'fields' : 'existing'),
  };
  const current = step === 'map' ? 1 : step === 'plan' ? 3 : 2;

  return (
    <Stack gap={5}>
      <Header current={current} actions={coarse && step !== 'map' ? null : actions[step]} />
      {coarse && (step === 'fields' || step === 'existing') ? (
        <p className="-mt-2 text-sm text-fg-muted">
          {step === 'fields'
            ? `New fields · ${String(Math.min(card + 1, proposals.length))} of ${String(proposals.length)}`
            : 'Review plan'}
        </p>
      ) : null}

      {step === 'map' ? (
        <Stack gap={4}>
          <p className="text-sm">
            {stage.file.name} · {stage.file.rows} rows
            {stage.file.sheet === null ? '' : ` · sheet “${stage.file.sheet}”`} · {mapped} of{' '}
            {stage.columns.length} columns mapped
          </p>
          {undecided.length > 0 ? (
            <Alert tone="warning">
              {undecided.length} {undecided.length === 1 ? 'column needs' : 'columns need'} a
              decision: {undecided.map((c) => c.header).join(', ')}. A column is never dropped
              quietly.
            </Alert>
          ) : null}
          {unplaced ? (
            <Alert tone="info">
              Columns that match no field are proposed as new fields next. Nothing is created until
              you approve the plan.
            </Alert>
          ) : null}
          {refusedAlert}
          <DataTable
            label="Columns"
            rows={stage.columns}
            columns={columns}
            rowId={(c) => String(c.index)}
          />
        </Stack>
      ) : null}

      {step === 'fields' && view !== null ? (
        <>
          {refusedAlert}
          <NewFieldsStep
            view={view}
            proposals={proposals}
            facts={facts}
            onChange={change}
            coarse={coarse}
            index={card}
            onIndexChange={setCard}
          />
        </>
      ) : null}

      {step === 'existing' && view !== null && !coarse ? (
        <>
          {refusedAlert}
          <ExistingStep
            view={view}
            kept={kept}
            selected={props.field ?? null}
            onSelect={(key) => {
              props.onFieldChange?.(key);
            }}
            onChange={change}
          />
        </>
      ) : null}

      {step === 'existing' && view !== null && coarse ? (
        <PhonePlan
          view={view}
          kept={kept}
          plan={plan}
          busy={busy}
          refused={refusedAlert}
          onChange={change}
        />
      ) : null}

      {step === 'plan' && plan !== null ? (
        <PlanStep
          plan={plan}
          applyWithoutApproval={applyWithoutApproval}
          onApplyWithoutApprovalChange={setApplyWithoutApproval}
          busy={busy}
          refused={refused}
          onApprove={approve}
          onChange={() => {
            goTo(view === null ? 'map' : 'fields');
          }}
          onDownloadBlocked={props.onDownloadBlocked}
        />
      ) : null}

      {coarse && step === 'fields' && view !== null ? (
        // MA8: Skip and Create in thumb reach, one card at a time; above the tab
        // bar and the assistant's button (`touch:bottom-24`, 3.5rem tall).
        <div className="sticky bottom-40 z-10 grid grid-cols-2 gap-2">
          {(() => {
            const p = proposals[card];
            const advance = (): void => {
              if (card + 1 < proposals.length) setCard(card + 1);
              else goTo('existing');
            };
            if (p === undefined || !view.canCreate) {
              return (
                <Button variant="primary" className="col-span-2" onClick={advance}>
                  Next
                </Button>
              );
            }
            return (
              <>
                <Button
                  onClick={() => {
                    change(p.column, { include: false });
                    advance();
                  }}
                >
                  Skip
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    change(p.column, { include: true });
                    advance();
                  }}
                >
                  {isSpecial(p) ? 'Import anyway' : 'Create field'}
                </Button>
              </>
            );
          })()}
        </div>
      ) : null}

      {coarse && step === 'existing' ? (
        <div className="sticky bottom-40 z-10">
          <Button
            variant="primary"
            className="w-full"
            startIcon={<icons.confirm aria-hidden />}
            disabled={plan === null || plan.blocked !== null || plan.problems.length > 0}
            loading={busy}
            loadingLabel={plan === null ? 'Working out the plan' : 'Running the import'}
            onClick={approve}
          >
            Approve and run
          </Button>
        </div>
      ) : null}
    </Stack>
  );
}

/**
 * The phone's last screen (MA9): for each new field, what happens for the
 * people without a value, then the plan in one sentence.
 */
function PhonePlan({
  view,
  kept,
  plan,
  busy,
  refused,
  onChange,
}: {
  readonly view: NewFieldsView;
  readonly kept: readonly ColumnProposal[];
  readonly plan: ImportPlanView | null;
  readonly busy: boolean;
  readonly refused: ReactNode;
  readonly onChange: (column: number, patch: Partial<ColumnProposal>) => void;
}): JSX.Element {
  const missingOf = (p: ColumnProposal): number =>
    view.proposals.find((x) => x.column === p.column)?.counts.missing ?? 0;
  const deciding = kept.filter((p) => missingOf(p) > 0);
  return (
    <div className="flex flex-col gap-3">
      {deciding.map((p) => (
        <section key={p.column} aria-labelledby={`without-${p.key}`} className="flex flex-col gap-3">
          <h2 id={`without-${p.key}`} className="font-display text-xl font-bold">
            {missingOf(p).toLocaleString('en-GB')} {missingOf(p) === 1 ? 'person has' : 'people have'}{' '}
            no {p.field.label}
          </h2>
          <ExistingChoices
            proposal={p}
            missing={missingOf(p)}
            recommended={view.proposals.find((x) => x.column === p.column)?.forExisting.kind ?? null}
            readOnly={!view.canCreate}
            compact
            onChange={(forExisting) => {
              onChange(p.column, { forExisting });
            }}
          />
        </section>
      ))}
      {refused}
      <AssistantCard level={2} title="The plan">
        {plan === null ? (
          busy ? (
            <div role="status" className="flex flex-col gap-2">
              <span className="sr-only">Working out the plan</span>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : null
        ) : (
          <>
            <p className="text-base">{plan.short}</p>
            {plan.blocked === null ? null : <p className="text-sm text-warning-fg">{plan.blocked}</p>}
          </>
        )}
      </AssistantCard>
    </div>
  );
}
