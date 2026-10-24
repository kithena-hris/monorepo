import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AppBarBack,
  AssistantCard,
  Badge,
  Button,
  type DataColumn,
  DataTable,
  FileUploader,
  icons,
  List,
  ListItem,
  locale,
  PageHeader,
  PageSection,
  PINNED_BAR,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stack,
  Stepper,
  type UploadItem,
  useCoarsePointer,
} from '@reach/ui';
import { useEffect, useId, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import {
  DoneStep,
  PlanStep,
  WhyNotYet,
  notYetOf,
  type ImportDoneView,
  type ImportPlanView,
  type NotYet,
} from './import-plan';
import { ImportBusy, ImportRunning, isRunning, type ImportRunStatus } from './import-run';
import {
  WorkLocationsStep,
  placesReady,
  placesSummary,
  type PlaceChoices,
  type PlacesHere,
  type WorkplaceValue,
} from './work-locations';
import {
  ExistingChoices,
  ExistingStep,
  FileFactsCard,
  WithoutValue,
  NewFieldsStep,
  proposalsOf,
  type Answer,
  type ColumnProposal,
  type NewFieldsView,
} from './new-fields';
import { t } from '../i18n';

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
  /**
   * Employment type or work model, People's own: the values its list gains
   * from the file, by label, when an administrator's import adds them.
   */
  readonly adds?: readonly string[] | null;
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
  | ImportDoneView
  /**
   * An approved import, as People runs it (`?run=`): Importing, then what it
   * did, or why it stopped. `waking`: the server is waking, and the page catches up.
   */
  | { readonly step: 'run'; readonly run: ImportRunStatus; readonly waking?: boolean };

/** What approving answers: the run started, or why not and, where there is one, where to look. */
export type Started =
  { readonly ok: true } | { readonly ok: false; readonly message: string; readonly link?: string };

/**
 * The import's three steps after the upload, in the address (`?step=`):
 * upload and map, decide what's new, approve and run.
 */
export type FlowStep = 'map' | 'decide' | 'review';

/** PRD §14.5: 100 MB per file. The server holds it to that; this saves the wait. */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

type Mapping = Readonly<Record<number, string | null>>;

/** A file kept elsewhere, as the host lists it. */
export interface KeptFile {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

export interface ImportFlowProps {
  readonly load: Loadable<ImportStage>;
  /**
   * Upload the file — straight to storage, never through the app's server —
   * reporting how much has gone, 0 to 100, as it goes; then check it.
   */
  readonly onUpload: (file: File, progress: (percent: number) => void) => Promise<Outcome>;
  /**
   * Files the host keeps elsewhere that can be imported without a download,
   * worded by the host ("Already in Documents"); picking one is an upload.
   * Absent: the file picker only.
   */
  readonly kept?: {
    readonly label: string;
    readonly load: () => Promise<readonly KeptFile[]>;
    readonly onPick: (id: string) => Promise<Outcome>;
  };
  /** Fields proposed for the columns that match none. Nothing is written. */
  readonly propose: (mapping: Mapping) => Promise<Answer<NewFieldsView>>;
  /** Everything the import will do, from these choices, over a dry run. Nothing is written. */
  readonly plan: (
    mapping: Mapping,
    proposals: readonly ColumnProposal[],
    /** Each work location value of the file, as chosen right after the mapping. */
    places?: PlaceChoices,
  ) => Promise<Answer<ImportPlanView>>;
  /**
   * Approve and run: setup if nothing is published, the new fields, their
   * defaults, the import. The administrator approving the plan is the
   * approval its sensitive values need: none waits for a second one.
   */
  readonly run: (
    mapping: Mapping,
    proposals: readonly ColumnProposal[],
    options: {
      readonly places?: PlaceChoices;
      /** The version the plan was made against, as the plan said it. */
      readonly basedOn?: number | null;
    },
  ) => Promise<Started>;
  /** The company's import running now: no other file is taken until it is over. */
  readonly running?: ImportRunStatus | null;
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
  /** A People administrator: sets up the file's work locations. HR reads the suggestions. */
  readonly admin?: boolean;
  /** The step in the address, so Back and a reload keep the place. */
  readonly step?: string | null;
  readonly onStepChange?: (step: FlowStep | null) => void;
  /** The field the address names, on the people-without-a-value step. */
  readonly field?: string | null;
  readonly onFieldChange?: (key: string | null) => void;
}

const STEPS = [
  { id: 'map', label: t('import.import-flow.upload_and_map', 'Upload and map') },
  { id: 'decide', label: t('import.import-flow.decide_whats_new', 'Decide what’s new') },
  { id: 'plan', label: t('import.import-flow.approve_and_run', 'Approve and run') },
] as const;

const IGNORE = '__ignore';

/**
 * Importing people from a spreadsheet (PRD §14; design AI9 to AI12, MA8, MA9).
 *
 * Three steps. Upload and map: the file, then where each column goes.
 * Decide what's new: the file's work locations, the columns that become new
 * fields and who fills them for the people without a value, three blocks that
 * skip themselves when empty. Approve and run: one plan, in sentences, from a
 * dry run. Nothing is written until HR approves it. A company with nothing
 * published imports the same way: the plan sets it up.
 */
export function ImportFlow(props: ImportFlowProps): JSX.Element {
  const coarse = useCoarsePointer();
  // One element for every stage, so the header and the stepper stay mounted
  // from the upload to the end: only what is under them changes.
  return (
    <Loaded load={props.load} what={t('import.import-flow.the_import', 'the import')}>
      {(stage) => <Steps {...props} stage={stage} coarse={coarse} />}
    </Loaded>
  );
}

/** Before a file is read: nothing to map yet. */
const NO_FILE: Extract<ImportStage, { step: 'map' }> = {
  step: 'map',
  file: { name: '', rows: 0, sheet: null },
  columns: [],
  fields: [],
};

function Header({
  current,
  description = t(
    'import.import-flow.nothing_is_written_until_you_approve',
    'Nothing is written until you approve the plan.',
  ),
  actions,
  phoneBar,
}: {
  readonly current: number;
  readonly description?: string;
  readonly actions?: ReactNode;
  /**
   * Under a finger, on the new fields and the plan (MA8, MA9): the phone's
   * bar is the import's own, back to its last step and that step's name as
   * the title, with no large title or stepper under it.
   */
  readonly phoneBar?: { readonly title: string; readonly onBack: () => void } | null;
}): JSX.Element {
  const bar = phoneBar ?? null;
  return (
    <>
      <PageHeader
        title={
          bar === null ? (
            t('import.import-flow.import', 'Import')
          ) : (
            <span className="sr-only">{t('import.import-flow.import', 'Import')}</span>
          )
        }
        {...(bar === null
          ? { description }
          : {
              breadcrumb: (
                <nav
                  aria-label={t('import.import-flow.back', 'Back')}
                  className="-mt-1 grid min-h-12 grid-cols-[6rem_minmax(0,1fr)_6rem] items-center gap-2"
                >
                  <AppBarBack className="justify-self-start" onClick={bar.onBack}>
                    {t('import.import-flow.import', 'Import')}
                  </AppBarBack>
                  <span className="truncate text-center text-md font-semibold">{bar.title}</span>
                  <span />
                </nav>
              ),
            })}
        {...(actions === null || actions === undefined ? {} : { actions })}
      />
      <div className={bar === null ? 'max-w-245' : 'hidden'}>
        <Stepper
          label={t('import.import-flow.importing_people', 'Importing people')}
          steps={STEPS}
          current={current}
        />
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
      label={t(
        'import.import-flow.drop_a_spreadsheet_or_choose_one',
        'Drop a spreadsheet, or choose one',
      )}
      hint={t(
        'import.import-flow.csv_or_excel_up_to_50',
        'CSV or Excel, up to 50,000 rows or 100 MB. A file exported from here imports back without mapping.',
      )}
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

/** The host's own files, each imported in place: nobody downloads and re-uploads personal data. */
function Kept({
  kept,
}: {
  readonly kept: NonNullable<ImportFlowProps['kept']>;
}): JSX.Element | null {
  const [files, setFiles] = useState<readonly KeptFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void kept.load().then((list) => {
      if (live) setFiles(list);
    });
    return () => {
      live = false;
    };
  }, [kept]);
  if (files === null || files.length === 0) return null;
  return (
    <PageSection title={kept.label}>
      <Stack gap={3}>
        <List>
          {files.map((f) => (
            <ListItem
              key={f.id}
              icon={<icons.spreadsheet aria-hidden />}
              description={f.detail}
              trailing={
                <Button
                  size="sm"
                  loading={busy === f.id}
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy(f.id);
                    setError(null);
                    void kept.onPick(f.id).then((outcome) => {
                      setBusy(null);
                      if (!outcome.ok) setError(outcome.message);
                    });
                  }}
                >
                  {t('import.import-flow.import', 'Import')}
                </Button>
              }
            >
              {f.name}
            </ListItem>
          ))}
        </List>
        {error === null ? null : <Alert tone="danger">{error}</Alert>}
      </Stack>
    </PageSection>
  );
}

function confidence(column: ProposedColumn): JSX.Element | string {
  if (column.status === 'refused')
    return (
      <Badge tone="danger" size="sm">
        {t('import.import-flow.refused', 'Refused')}
      </Badge>
    );
  if (column.source === 'system')
    return column.reason === null ? t('import.import-flow.exact', 'Exact') : '—';
  if (column.source === 'key' || column.source === 'label')
    return t('import.import-flow.exact', 'Exact');
  if (column.source === 'alias') return t('import.import-flow.usual_name', 'Usual name');
  if (column.source === 'manual') return t('import.import-flow.you_chose', 'You chose');
  if (column.confidence === null) return '—';
  return column.status === 'review' ? (
    <Badge tone="warning" size="sm">
      {column.confidence.toFixed(2)}
      {t('import.import-flow.check_this', ', check this')}
    </Badge>
  ) : (
    column.confidence.toFixed(2)
  );
}

/** Every step: upload and map, decide what's new, the plan; then the run. */
function Steps({
  stage: given,
  coarse,
  ...props
}: ImportFlowProps & {
  readonly stage: ImportStage;
  readonly coarse: boolean;
}): JSX.Element {
  const stage = given.step === 'map' ? given : NO_FILE;
  // Only what the admin changed; the proposal stands for everything else.
  const [choices, setChoices] = useState<Mapping>({});
  const [view, setView] = useState<NewFieldsView | null>(null);
  const [proposals, setProposals] = useState<readonly ColumnProposal[]>([]);
  const [plan, setPlan] = useState<ImportPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Where the last refusal points: the import already running.
  const [refusedLink, setRefusedLink] = useState<string | null>(null);
  const [card, setCard] = useState(0);
  // The file's work locations (right after Map columns), and what is chosen for each.
  const [places, setPlaces] = useState<{
    readonly workplaces: readonly WorkplaceValue[];
    readonly here: PlacesHere;
  } | null>(null);
  const [placeChoices, setPlaceChoices] = useState<PlaceChoices>({});
  // On a phone, the work locations were looked at and Next pressed: the new fields follow.
  const [placesSeen, setPlacesSeen] = useState(false);
  // Another file read: nothing chosen for the last one carries over.
  const [file, setFile] = useState(stage);
  if (given.step === 'map' && file !== stage) {
    setFile(stage);
    setChoices({});
    setPlaces(null);
    setPlaceChoices({});
    setPlacesSeen(false);
    setView(null);
    setProposals([]);
    setPlan(null);
    setRefused(null);
    setCard(0);
  }
  // Without a shell to keep it in the address (a test), the step is kept here.
  const [ownStep, setOwnStep] = useState<FlowStep>('map');

  const asked = props.onStepChange === undefined ? ownStep : (props.step ?? 'map');
  const hasPlaces = places !== null && places.workplaces.length > 0;
  // A step whose data this page no longer holds (a reload) opens the mapping.
  const step: FlowStep =
    asked === 'decide' && (view !== null || hasPlaces)
      ? 'decide'
      : asked === 'review' && plan !== null
        ? 'review'
        : 'map';
  const goTo = (to: FlowStep): void => {
    setRefused(null);
    if (props.onStepChange === undefined) setOwnStep(to);
    else props.onStepChange(to);
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
  const mapsPlaces = Object.values(mapping).includes('location_id');
  // What the plan and the run are given: an administrator's choices only.
  const placesArg = props.admin === true && hasPlaces ? placeChoices : undefined;
  const missingOf = (p: ColumnProposal): number =>
    view?.proposals.find((x) => x.column === p.column)?.counts.missing ?? 0;
  // The fields kept whose people without a value need a decision.
  const deciding = kept.filter((p) => missingOf(p) > 0);

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

  const toPlan = (list: readonly ColumnProposal[], then: FlowStep | null = 'review') =>
    attempt(async () => {
      const answer = await props.plan(mapping, list, placesArg);
      if (!answer.ok) return answer.message;
      setPlan(answer.data);
      if (then !== null) goTo(then);
      return null;
    });

  /*
   * From the mapping, everything that is new in the file at once: its work
   * locations (read by a dry run) and the columns that match no field
   * (proposed as fields). Each is a block of Decide what's new; a file with
   * nothing new skips the step and goes straight to the plan.
   */
  const next = (): void => {
    void attempt(async () => {
      let workplaces = places?.workplaces ?? [];
      if (mapsPlaces && places === null) {
        const answer = await props.plan(mapping, []);
        if (!answer.ok) return answer.message;
        workplaces = answer.data.review.dryRun.workplaces ?? [];
        const here = answer.data.review.dryRun.here ?? { locations: [], entities: [] };
        setPlaces({ workplaces, here });
        setPlaceChoices(Object.fromEntries(workplaces.map((w) => [w.key, w.proposed])));
      }
      let list = proposals;
      if (unplaced && view === null) {
        const proposed = await props.propose(mapping);
        if (!proposed.ok) return proposed.message;
        list = proposalsOf(proposed.data);
        setView(proposed.data);
        setProposals(list);
        setCard(0);
      }
      if (workplaces.length > 0 || list.length > 0) {
        goTo('decide');
        return null;
      }
      const answer = await props.plan(mapping, [], placesArg);
      if (!answer.ok) return answer.message;
      setPlan(answer.data);
      goTo('review');
      return null;
    });
  };

  const approve = (): void => {
    setRefusedLink(null);
    void attempt(async () => {
      const ran = await props.run(mapping, proposals, {
        ...(placesArg === undefined ? {} : { places: placesArg }),
        ...(plan?.basedOn === undefined ? {} : { basedOn: plan.basedOn }),
      });
      if (ran.ok) return null;
      setRefusedLink(ran.link ?? null);
      return ran.message;
    });
  };

  // A field the settings refuse, left out in one click: the plan is worked out again here.
  const leaveOut = (column: number): void => {
    const list = proposals.map((p) => (p.column === column ? { ...p, include: false } : p));
    setProposals(list);
    void toPlan(list, null);
  };

  // On a phone, who fills each new field and the plan are one screen (MA9):
  // the plan is worked out again after each choice there.
  const phonePlanDue =
    coarse &&
    given.step === 'map' &&
    step === 'review' &&
    deciding.length > 0 &&
    plan === null &&
    !busy &&
    refused === null;
  useEffect(() => {
    if (phonePlanDue) void toPlan(proposals, null);
    // Due again only when a choice cleared the plan.
  }, [phonePlanDue]);

  const whyId = useId();
  // On a phone, why Approve is off: the plan's own reasons, or that it could not be worked out.
  const phoneNotYet: NotYet[] =
    plan !== null
      ? notYetOf(plan)
      : !busy && refused !== null
        ? [
            {
              message: t(
                'import.import-flow.the_plan_could_not_be_worked_out',
                'The plan could not be worked out, so there is nothing to approve yet.',
              ),
            },
          ]
        : [];

  // People's own choice field, still where the file goes: what its list gains.
  const addsNote = (c: ProposedColumn): string | null =>
    c.adds == null || c.adds.length === 0 || chosen(c) !== c.key
      ? null
      : t('import.import-flow.adds_to_the_list', 'Adds {{join}} to the list', {
          join: c.adds.join(', '),
        });

  const columns: DataColumn<ProposedColumn>[] = [
    {
      id: 'header',
      header: t('import.import-flow.in_your_file', 'In your file'),
      cell: (c) => c.header,
    },
    {
      id: 'target',
      header: t('import.import-flow.goes_to', 'Goes to'),
      cell: (c) =>
        // Refused, or an id or employee number: Kithena creates those, so
        // the column is shown and can't be picked.
        c.status === 'refused' || (c.source === 'system' && c.reason !== null) ? (
          <span className="text-sm text-fg-muted">
            {c.reason ??
              t('import.import-flow.you_may_not_write_this_field', 'You may not write this field.')}
          </span>
        ) : (
          <Stack gap={1}>
            <Select
              value={chosen(c) ?? IGNORE}
              onValueChange={(value) => {
                setChoices((x) => ({ ...x, [c.index]: value === IGNORE ? null : value }));
                setView(null);
                setProposals([]);
                setPlan(null);
                setPlaces(null);
              }}
            >
              <SelectTrigger
                aria-label={t('import.import-flow.goes_to', '{{header}} goes to', {
                  header: c.header,
                })}
                aria-describedby={
                  addsNote(c) === null ? undefined : `${whyId}-adds-${String(c.index)}`
                }
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={IGNORE}>
                  {c.status === 'ignored' && c.source === null
                    ? t('import.import-flow.a_new_field_or_ignored', 'A new field, or ignored')
                    : t('import.import-flow.ignored', 'Ignored')}
                </SelectItem>
                {c.key !== null && !labelOf.has(c.key) && c.source === 'system' ? (
                  <SelectItem value={c.key}>{c.key.replaceAll('_', ' ')}</SelectItem>
                ) : null}
                {stage.fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.sensitive === true
                      ? t(
                          'import.import-flow.label_sensitive',
                          '{{label}} (sensitive: changes wait for approval)',
                          { label: f.label },
                        )
                      : f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {addsNote(c) === null ? null : (
              <span id={`${whyId}-adds-${String(c.index)}`} className="text-sm text-fg-muted">
                {addsNote(c)}
              </span>
            )}
          </Stack>
        ),
    },
    {
      id: 'confidence',
      header: t('import.import-flow.confidence', 'Confidence'),
      cell: confidence,
    },
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
      <Alert
        tone="danger"
        title={t('import.import-flow.that_did_not_go_through', 'That did not go through')}
        action={
          refusedLink === null ? undefined : (
            <Button asChild size="sm">
              <a href={refusedLink}>{t('import.import-flow.see_the_import', 'See the import')}</a>
            </Button>
          )
        }
      >
        {refused}
      </Alert>
    );

  const placesDone = places === null || placesReady(places.workplaces, placeChoices);
  // Which work locations still need something before Next: named, so HR knows where to look.
  const placesMissing =
    places === null ? [] : places.workplaces.filter((w) => !placesReady([w], placeChoices));
  const placesHint =
    placesMissing.length === 0 ? null : (
      <p id={`${whyId}-places`} role="status" className="text-sm text-warning-fg">
        {t('import.import-flow.give', 'Give')} {placesMissing.map((w) => `“${w.value}”`).join(', ')}{' '}
        {t(
          'import.import-flow.a_name_a_country_and_a',
          'a name, a country and a time zone, or leave',
        )}{' '}
        {placesMissing.length === 1 ? 'it' : 'them'} {t('import.import-flow.empty', 'empty.')}
      </p>
    );

  // Leaving: the import is dropped, and nothing was written.
  const cancel =
    props.onDone === undefined ? null : (
      <Button variant="ghost" size="sm" onClick={props.onDone}>
        {t('import.import-flow.cancel_import', 'Cancel import')}
      </Button>
    );
  const backButton = (onClick: () => void): JSX.Element => (
    <Button onClick={onClick}>{t('import.import-flow.back', 'Back')}</Button>
  );
  const toDecide = (
    <Button
      variant="primary"
      endIcon={<icons.forward aria-hidden />}
      disabled={undecided.length > 0}
      aria-describedby={undecided.length > 0 ? `${whyId}-map` : undefined}
      loading={busy}
      loadingLabel={
        mapsPlaces || unplaced
          ? t('import.import-flow.reading_whats_new', 'Reading what’s new')
          : t('import.import-flow.checking_every_row', 'Checking every row')
      }
      onClick={next}
    >
      {coarse
        ? t('import.import-flow.next', 'Next')
        : t('import.import-flow.next_decide_whats_new', 'Next: decide what’s new')}
    </Button>
  );
  const toReview = (
    <Button
      variant="primary"
      endIcon={<icons.forward aria-hidden />}
      disabled={!placesDone}
      aria-describedby={placesMissing.length === 0 ? undefined : `${whyId}-places`}
      loading={busy}
      loadingLabel={t('import.import-flow.checking_every_row', 'Checking every row')}
      onClick={() => {
        void toPlan(proposals);
      }}
    >
      {t('import.import-flow.next_review_the_plan', 'Next: review the plan')}
    </Button>
  );

  if (given.step !== 'map') {
    const run = given.step === 'run' ? given.run : null;
    const done =
      given.step === 'done'
        ? given
        : run?.result == null
          ? null
          : { ...run.result, step: 'done' as const };
    const busyId = `${whyId}-busy`;
    const running = props.running != null && isRunning(props.running) ? props.running : null;
    return (
      <Stack gap={5}>
        <Header
          current={given.step === 'upload' ? 0 : STEPS.length}
          {...(run === null
            ? {}
            : {
                description: isRunning(run)
                  ? t(
                      'import.import-flow.approved_kithena_is_importing_the_file',
                      'Approved. Kithena is importing the file.',
                    )
                  : run.status === 'failed'
                    ? t(
                        'import.import-flow.the_import_stopped_before_it_finished',
                        'The import stopped before it finished.',
                      )
                    : t('import.import-flow.approved_and_imported', 'Approved and imported.'),
              })}
          actions={
            done !== null && props.onDone !== undefined ? (
              <Button variant="secondary" onClick={props.onDone}>
                {t('import.import-flow.done', 'Done')}
              </Button>
            ) : given.step === 'upload' ? (
              cancel
            ) : null
          }
        />
        {given.step === 'upload' ? (
          running !== null ? (
            <div className="flex flex-col gap-3">
              <Alert
                tone="info"
                title={t('import.import-flow.an_import_is_running', 'An import is running')}
              >
                {t(
                  'import.import-flow.only_one_import_runs_at_a',
                  'Only one import runs at a time. This file can be imported once it has finished.',
                )}
              </Alert>
              <ImportBusy id={busyId} run={running} />
            </div>
          ) : props.setup === undefined ? (
            <>
              <Upload onUpload={props.onUpload} />
              {props.kept === undefined ? null : <Kept kept={props.kept} />}
            </>
          ) : (
            <Alert
              tone="info"
              title={t(
                'import.import-flow.an_administrator_imports_the_first_file',
                'An administrator imports the first file',
              )}
            >
              {t(
                'import.import-flow.nothing_is_set_up_yet_a',
                'Nothing is set up yet. A People administrator imports the first file: approving its plan sets up the employee record, with the fields the law requires and the new ones your file brings. Then HR imports here.',
              )}
            </Alert>
          )
        ) : done !== null ? (
          <DoneStep done={done} />
        ) : run !== null && isRunning(run) ? (
          <ImportRunning run={run} waking={given.step === 'run' && given.waking === true} />
        ) : run !== null && run.status === 'failed' ? (
          <Alert
            tone="danger"
            title={t('import.import-flow.import_failed', 'Import failed')}
            className="max-w-180"
            action={
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="/people/import">{t('import.import-flow.start_again', 'Start again')}</a>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <a href="/people/import-export">
                    {t('import.import-flow.import_export', 'Import & export')}
                  </a>
                </Button>
              </div>
            }
          >
            {run.failure ??
              t(
                'import.import-flow.the_import_stopped_before_it_finished',
                'The import stopped before it finished.',
              )}
          </Alert>
        ) : (
          // Imported longer ago than its report is kept: what it did, in a line.
          <Alert
            tone="success"
            title={t('import.import-flow.imported', 'Imported')}
            className="max-w-180"
            action={
              <Button asChild size="sm">
                <a href="/people/import-export">
                  {t('import.import-flow.import_export', 'Import & export')}
                </a>
              </Button>
            }
          >
            {t('import.import-flow.imported', 'Imported')}{' '}
            {(run?.people.done ?? 0).toLocaleString(locale())}{' '}
            {run?.people.done === 1 ? 'person' : 'people'}
            {t(
              'import.import-flow.its_full_report_is_kept_for',
              '. Its full report is kept for a week after it finishes.',
            )}
          </Alert>
        )}
      </Stack>
    );
  }

  const current = step === 'map' ? 0 : step === 'decide' ? 1 : 2;
  // Under a finger the file's work locations come first, then the new fields
  // as a carousel (MA8), once the work locations are settled.
  const phoneCards =
    coarse &&
    step === 'decide' &&
    view !== null &&
    proposals.length > 0 &&
    (!hasPlaces || (placesSeen && placesDone));
  // Who fills each new field shares the plan's screen on a phone (MA9); with
  // nothing to decide there, the plan is drawn whole, as at a desk.
  const phonePlan = coarse && step === 'review' && deciding.length > 0;

  return (
    <Stack gap={5}>
      <Header
        current={current}
        actions={
          step === 'review' && !coarse ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                goTo(view === null && !hasPlaces ? 'map' : 'decide');
              }}
            >
              {t('import.import-flow.change_something', 'Change something')}
            </Button>
          ) : coarse ? null : (
            cancel
          )
        }
        phoneBar={
          phoneCards && proposals.length > 0
            ? {
                title: t('import.import-flow.new_fields_of', 'New fields · {{min}} of {{length}}', {
                  min: String(Math.min(card + 1, proposals.length)),
                  length: String(proposals.length),
                }),
                onBack: () => {
                  goTo('map');
                },
              }
            : coarse && step === 'review'
              ? {
                  title: t('import.import-flow.review_plan', 'Review plan'),
                  onBack: () => {
                    goTo(view === null && !hasPlaces ? 'map' : 'decide');
                  },
                }
              : null
        }
      />

      {step === 'map' ? (
        <div className="grid items-start gap-5 @4xl/page:grid-cols-[minmax(0,1fr)_21.25rem]">
          {(() => {
            // The drop zone, once a file is in, is this line.
            const mappingBody = (
              <Stack gap={3}>
                <p className="text-sm text-fg-muted">
                  {stage.file.name} · {stage.file.rows.toLocaleString(locale())}{' '}
                  {t('import.import-flow.rows', 'rows')}
                  {stage.file.sheet === null ? '' : ` · sheet “${stage.file.sheet}”`} · {mapped}{' '}
                  {t('import.import-flow.of_columns_mapped', 'of {{length}} columns mapped', {
                    length: stage.columns.length,
                  })}
                </p>
                <DataTable
                  label={t('import.import-flow.columns', 'Columns')}
                  rows={stage.columns}
                  columns={columns}
                  rowId={(c) => String(c.index)}
                />
              </Stack>
            );
            // Under a finger the rows are cards already: no card around them.
            return coarse ? (
              mappingBody
            ) : (
              <PageSection
                surface
                title={t('import.import-flow.columns', 'Columns')}
                className="min-w-0"
              >
                {mappingBody}
              </PageSection>
            );
          })()}
          <Stack gap={4}>
            {undecided.length > 0 ? (
              <Alert
                id={`${whyId}-map`}
                tone="warning"
                title={t(
                  'import.import-flow.a_decision',
                  {
                    one: '{{count}} column needs a decision',
                    other: '{{count}} columns need a decision',
                  },
                  { count: undecided.length },
                )}
              >
                {undecided.map((c) => c.header).join(', ')}
                {t(
                  'import.import-flow.a_column_is_never_dropped_quietly',
                  '. A column is never dropped quietly.',
                )}
              </Alert>
            ) : null}
            <AssistantCard
              level={2}
              title={t('import.import-flow.how_columns_were_matched', 'How columns were matched')}
              note={t(
                'import.import-flow.rows_match_people_already_here_by',
                'Rows match people already here by work email only.',
              )}
              className="touch:hidden"
            >
              <p className="text-sm text-fg-muted">
                {t(
                  'import.import-flow.exact_names_and_usual_aliases_first',
                  'Exact names and usual aliases first. For the rest, Kithena read only the headers and your fields, never a cell, and mapped anything at 0.9 or above. Columns that match nothing are proposed as new fields next.',
                )}
              </p>
            </AssistantCard>
            {refusedAlert}
            <div
              {...(coarse ? PINNED_BAR : {})}
              className={
                coarse
                  ? 'sticky bottom-0 z-10 grid grid-cols-2 gap-2 bg-canvas py-2 *:min-w-0'
                  : 'flex items-center justify-between gap-2'
              }
            >
              {backButton(props.onBack)}
              {toDecide}
            </div>
          </Stack>
        </div>
      ) : null}

      {step === 'decide' && !coarse ? (
        <div className="grid items-start gap-5 @4xl/page:grid-cols-[minmax(0,1fr)_18.75rem]">
          <Stack gap={4} className="min-w-0">
            {refusedAlert}
            {places !== null && hasPlaces ? (
              <Accordion type="multiple" defaultValue={placesDone ? [] : ['places']}>
                <AccordionItem value="places">
                  <AccordionTrigger
                    level={2}
                    description={placesSummary(places.workplaces, placeChoices)}
                    meta={
                      placesDone ? (
                        <Badge size="sm" tone="success">
                          {t('import.import-flow.decided', 'Decided')}
                        </Badge>
                      ) : (
                        <Badge size="sm" tone="warning">
                          {placesMissing.length} {t('import.import-flow.to_decide', 'to decide')}
                        </Badge>
                      )
                    }
                  >
                    {t('import.import-flow.work_locations', 'Work locations')}
                  </AccordionTrigger>
                  <AccordionContent>
                    <WorkLocationsStep
                      workplaces={places.workplaces}
                      here={places.here}
                      choices={placeChoices}
                      readOnly={props.admin !== true}
                      coarse={false}
                      onChange={(key, choice) => {
                        setPlaceChoices((x) => ({ ...x, [key]: choice }));
                        setPlan(null);
                      }}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
            {view !== null && proposals.length > 0 ? (
              <Accordion type="multiple" defaultValue={['fields']}>
                <AccordionItem value="fields">
                  <AccordionTrigger
                    level={2}
                    description={t(
                      'import.import-flow.columns_arent_fields_yet_heres_what',
                      {
                        one: '{{count}} column isn’t a field yet. Here’s what I’d create.',
                        other: '{{count}} columns aren’t fields yet. Here’s what I’d create.',
                      },
                      { count: proposals.length },
                    )}
                    meta={
                      <Badge size="sm">
                        {kept.length}{' '}
                        {t('import.import-flow.of_kept', 'of {{length}} kept', {
                          length: proposals.length,
                        })}
                      </Badge>
                    }
                  >
                    {t('import.import-flow.new_fields', 'New fields')}
                  </AccordionTrigger>
                  <AccordionContent>
                    <NewFieldsStep
                      view={view}
                      proposals={proposals}
                      facts={facts}
                      onChange={change}
                      coarse={false}
                      index={card}
                      onIndexChange={setCard}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
            {view !== null && deciding.length > 0 ? (
              <Accordion type="multiple" defaultValue={['without']}>
                <AccordionItem value="without">
                  <AccordionTrigger
                    level={2}
                    description={t(
                      'import.import-flow.for_people_the_file_doesnt_reach',
                      'For people the file doesn’t reach, their own details are asked of them and employment details go to HR.',
                    )}
                    meta={
                      <Badge size="sm">
                        {deciding.length} {deciding.length === 1 ? 'field' : 'fields'}
                      </Badge>
                    }
                  >
                    {t('import.import-flow.people_without_a_value', 'People without a value')}
                  </AccordionTrigger>
                  <AccordionContent>
                    <ExistingStep
                      view={view}
                      kept={kept}
                      selected={props.field ?? null}
                      onSelect={(key) => {
                        props.onFieldChange?.(key);
                      }}
                      onChange={change}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
            {placesHint}
            <div className="flex items-center justify-between gap-2">
              {backButton(() => {
                goTo('map');
              })}
              {toReview}
            </div>
          </Stack>
          <FileFactsCard view={view} proposals={proposals} facts={facts} />
        </div>
      ) : null}

      {step === 'decide' && coarse && !phoneCards && places !== null && hasPlaces ? (
        <>
          {refusedAlert}
          <WorkLocationsStep
            workplaces={places.workplaces}
            here={places.here}
            choices={placeChoices}
            readOnly={props.admin !== true}
            coarse
            onChange={(key, choice) => {
              setPlaceChoices((x) => ({ ...x, [key]: choice }));
              setPlan(null);
            }}
          />
          {/* In thumb reach, pinned above the tab bar as MA8's buttons are. */}
          <div {...PINNED_BAR} className="sticky bottom-24 z-10 flex flex-col gap-2 bg-canvas py-2">
            {placesHint}
            {view !== null && proposals.length > 0 ? (
              <Button
                variant="primary"
                endIcon={<icons.forward aria-hidden />}
                disabled={!placesDone}
                aria-describedby={placesMissing.length === 0 ? undefined : `${whyId}-places`}
                onClick={() => {
                  setPlacesSeen(true);
                }}
              >
                {t('import.import-flow.next_new_fields', 'Next: new fields')}
              </Button>
            ) : (
              toReview
            )}
          </div>
        </>
      ) : null}

      {phoneCards ? (
        <>
          {refusedAlert}
          {proposals.length > 0 ? (
            <NewFieldsStep
              view={view}
              proposals={proposals}
              facts={facts}
              onChange={change}
              coarse
              index={card}
              onIndexChange={setCard}
            />
          ) : null}
          {/* MA8: Skip and Create in thumb reach, one card at a time, pinned above
              the tab bar as approvals' footer is; the assistant's button rises over it. */}
          <div
            {...PINNED_BAR}
            className="sticky bottom-24 z-10 grid grid-cols-2 gap-2 bg-canvas py-2"
          >
            {(() => {
              const p = proposals[card];
              const advance = (list: readonly ColumnProposal[]): void => {
                if (card + 1 < proposals.length) setCard(card + 1);
                else void toPlan(list);
              };
              const set = (include: boolean): readonly ColumnProposal[] =>
                proposals.map((x) => (x.column === p?.column ? { ...x, include } : x));
              if (p === undefined || !view.canCreate) {
                return (
                  <Button
                    variant="primary"
                    className="col-span-2"
                    loading={busy}
                    loadingLabel={t('import.import-flow.checking_every_row', 'Checking every row')}
                    onClick={() => {
                      advance(proposals);
                    }}
                  >
                    {t('import.import-flow.next', 'Next')}
                  </Button>
                );
              }
              return (
                <>
                  <Button
                    onClick={() => {
                      change(p.column, { include: false });
                      advance(set(false));
                    }}
                  >
                    {t('import.import-flow.skip', 'Skip')}
                  </Button>
                  <Button
                    variant="primary"
                    loading={busy}
                    loadingLabel={t('import.import-flow.checking_every_row', 'Checking every row')}
                    onClick={() => {
                      change(p.column, { include: true });
                      advance(set(true));
                    }}
                  >
                    {t('import.import-flow.create_field', 'Create field')}
                  </Button>
                </>
              );
            })()}
          </div>
        </>
      ) : null}

      {step === 'review' && plan !== null && !phonePlan ? (
        <PlanStep
          plan={plan}
          busy={busy}
          refused={refused}
          refusedLink={refusedLink}
          onApprove={approve}
          onChange={() => {
            goTo(view === null && !hasPlaces ? 'map' : 'decide');
          }}
          onLeaveOut={leaveOut}
          onDownloadBlocked={props.onDownloadBlocked}
        />
      ) : null}

      {phonePlan ? (
        <>
          <PhonePlan view={view} kept={kept} plan={plan} refused={refusedAlert} onChange={change} />
          <div {...PINNED_BAR} className="sticky bottom-24 z-10 flex flex-col gap-2 bg-canvas py-2">
            <WhyNotYet id={whyId} reasons={phoneNotYet} onLeaveOut={leaveOut} />
            {plan === null && !busy && refused !== null ? (
              <Button
                className="w-full"
                onClick={() => {
                  void toPlan(proposals, null);
                }}
              >
                {t('import.import-flow.work_out_the_plan_again', 'Work out the plan again')}
              </Button>
            ) : null}
            <Button
              variant="primary"
              className="w-full"
              startIcon={<icons.confirm aria-hidden />}
              disabled={plan === null || phoneNotYet.length > 0}
              aria-describedby={phoneNotYet.length > 0 ? whyId : undefined}
              loading={busy}
              loadingLabel={
                plan === null
                  ? t('import.import-flow.working_out_the_plan', 'Working out the plan')
                  : t('import.import-flow.starting_the_import', 'Starting the import')
              }
              onClick={approve}
            >
              {t('import.import-flow.approve_and_run', 'Approve and run')}
            </Button>
          </div>
        </>
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
  refused,
  onChange,
}: {
  readonly view: NewFieldsView | null;
  readonly kept: readonly ColumnProposal[];
  readonly plan: ImportPlanView | null;
  readonly refused: ReactNode;
  readonly onChange: (column: number, patch: Partial<ColumnProposal>) => void;
}): JSX.Element {
  const missingOf = (p: ColumnProposal): number =>
    view?.proposals.find((x) => x.column === p.column)?.counts.missing ?? 0;
  const deciding = view === null ? [] : kept.filter((p) => missingOf(p) > 0);
  return (
    <div className="flex flex-col gap-3">
      {deciding.map((p) => (
        <section
          key={p.column}
          aria-labelledby={`without-${p.key}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`without-${p.key}`} className="font-display text-xl font-bold">
            {missingOf(p).toLocaleString(locale())}{' '}
            {missingOf(p) === 1
              ? t('import.import-flow.person_has', 'person has')
              : t('import.import-flow.people_have', 'people have')}{' '}
            {t('import.import-flow.no', 'no')} {p.field.label}
          </h2>
          <ExistingChoices
            proposal={p}
            missing={missingOf(p)}
            recommended={
              view?.proposals.find((x) => x.column === p.column)?.forExisting.kind ?? null
            }
            readOnly={view?.canCreate !== true}
            compact
            onChange={(forExisting) => {
              onChange(p.column, { forExisting });
            }}
          />
          <WithoutValue
            label={p.field.label}
            names={view?.proposals.find((x) => x.column === p.column)?.counts.without ?? []}
            missing={missingOf(p)}
            here={view?.proposals.find((x) => x.column === p.column)?.counts.existingWithout ?? 0}
          />
        </section>
      ))}
      {refused}
      <AssistantCard level={2} title={t('import.import-flow.the_plan', 'The plan')}>
        {plan === null ? (
          <Spinner
            size="sm"
            label={t('import.import-flow.working_out_the_plan', 'Working out the plan')}
          />
        ) : (
          <>
            <p className="text-base">{plan.short}</p>
            {plan.blocked === null ? null : (
              <p className="text-sm text-warning-fg">{plan.blocked}</p>
            )}
          </>
        )}
      </AssistantCard>
    </div>
  );
}
