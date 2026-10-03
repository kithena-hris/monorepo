import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  Card,
  DataTable,
  IconList,
  IconListItem,
  Stat,
  KeyValues,
  List,
  ListItem,
  PageSection,
  icons,
  type DataColumn,
} from '@reach/ui';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { TypeIcon } from '../settings/access';
import type { DataType } from '../settings/model';
import type { ForExisting } from './new-fields';
import type { PlacesHere, WorkplaceValue } from './work-locations';

/**
 * The import's last two steps (design AI11, AI12; MA9 on a phone): the plan,
 * in plain words, approved once; then what it did and the fields it made.
 *
 * Written by People from HR's choices and a dry run against the version the
 * new fields would make. Nothing has happened until "Approve and run".
 */

export type PlanStepKind =
  | 'setup'
  | 'places'
  | 'fields'
  | 'people'
  | 'lifecycle'
  | 'ids'
  | 'refs'
  | 'ask'
  | 'hr'
  | 'new'
  | 'default'
  | 'leave'
  | 'skip';

export interface PlannedField {
  readonly key: string;
  readonly column: number;
  readonly label: string;
  readonly dataType: DataType;
  readonly section: string;
  readonly newSection: boolean;
  readonly forExisting: ForExisting;
  readonly missing: number;
}

export interface BlockedRow {
  readonly row: number;
  /** Who the row is, as the file names them; the work email when it has no name. */
  readonly name?: string | null;
  readonly person: string | null;
  readonly problem: string;
  /** "D18 — empty", "F47 — “31/02/2025”". */
  readonly cell: string;
}

/** A manager or work location the file names that is nowhere here: the row imports without it. */
export interface LeftEmptyRow {
  readonly row: number;
  /** Who the row is, as the file names them; the work email when it has no name. */
  readonly name?: string | null;
  /** "M14 — “01a0…”". */
  readonly cell: string;
  readonly label: string;
  readonly reason: string;
}

export interface CellFinding {
  readonly row: number;
  readonly name?: string | null;
  readonly cell: string;
  readonly label: string;
  readonly level: string;
  readonly message: string;
}

export interface PlanReview {
  readonly file: { readonly name: string; readonly rows: number; readonly sheet: string | null };
  readonly dryRun: {
    readonly counts: Readonly<
      Record<'create' | 'update' | 'unchanged' | 'blocked' | 'duplicate', number>
    >;
    readonly incomplete?: {
      readonly count: number;
      readonly byField: readonly { readonly label: string; readonly count: number }[];
    };
    readonly blocked?: readonly BlockedRow[];
    readonly findings?: readonly CellFinding[];
    readonly sensitive?: { readonly fields: readonly string[]; readonly values: number };
    /** The first twenty, and how many in all. */
    readonly leftEmpty?: readonly LeftEmptyRow[];
    readonly leftEmptyCount?: number;
    /** Each work location value of the file, and what may be chosen for it. */
    readonly workplaces?: readonly WorkplaceValue[];
    readonly here?: PlacesHere;
  };
  readonly blockedUrl?: string | null;
}

export interface ImportPlanView {
  readonly steps: readonly {
    readonly kind: PlanStepKind;
    readonly title: string;
    readonly detail: string;
  }[];
  readonly short: string;
  readonly fields: readonly PlannedField[];
  readonly version: number;
  /**
   * The version the plan was made against, null with nothing published:
   * handed back on approval, which People refuses once it was published again.
   */
  readonly basedOn?: number | null;
  readonly setup: { readonly country: string | null; readonly countryName: string | null } | null;
  readonly blocked: string | null;
  /** Fields the settings would refuse, by column and by the file's header. */
  readonly problems: readonly {
    readonly column: number;
    readonly header: string;
    readonly message: string;
  }[];
  readonly review: PlanReview;
  readonly asked: number;
  readonly forHr: number;
}

export interface ImportDoneView {
  readonly step: 'done';
  readonly file: { readonly name: string; readonly rows: number };
  readonly created: number;
  readonly updated: number;
  readonly blocked: number;
  readonly reportUrl?: string;
  readonly forReview?: number;
  readonly held?: number;
  readonly appliedWithoutApproval?: boolean;
  readonly leftEmpty?: readonly LeftEmptyRow[];
  readonly leftEmptyCount?: number;
  readonly fields?: readonly PlannedField[];
  readonly version?: number;
  readonly asked?: number;
  readonly forHr?: number;
  readonly finishedAt?: string;
  readonly tookMs?: number;
  /** Where every column of the file went: existing fields, new ones, Kithena's ids, nowhere. */
  readonly columns?: {
    readonly existing: number;
    readonly created: number;
    readonly kithena: number;
    readonly leftOut: number;
  };
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

const STEP_LOOK: Record<
  PlanStepKind,
  { readonly icon: ReactNode; readonly tone: 'accent' | 'success' | 'info' | 'warning' | 'neutral' }
> = {
  setup: { icon: <icons.settings />, tone: 'accent' },
  places: { icon: <icons.location />, tone: 'accent' },
  fields: { icon: <icons.add />, tone: 'accent' },
  people: { icon: <icons.people />, tone: 'success' },
  lifecycle: { icon: <icons.offboard />, tone: 'neutral' },
  ids: { icon: <icons.identifier />, tone: 'neutral' },
  refs: { icon: <icons.link />, tone: 'warning' },
  ask: { icon: <icons.notifications />, tone: 'info' },
  hr: { icon: <icons.table />, tone: 'warning' },
  new: { icon: <icons.hire />, tone: 'info' },
  default: { icon: <icons.edit />, tone: 'neutral' },
  leave: { icon: <icons.pending />, tone: 'neutral' },
  skip: { icon: <icons.blocked />, tone: 'neutral' },
};

/** The plan's steps, each with what it means (design AI11's card). */
export function PlanSteps({
  plan,
  onSeeRows,
  seeingRows,
}: {
  readonly plan: ImportPlanView;
  readonly onSeeRows?: () => void;
  readonly seeingRows?: boolean;
}): JSX.Element {
  // What "See rows" opens: the skipped rows, and the cells left empty for HR.
  const blocked =
    plan.review.dryRun.counts.blocked +
    plan.review.dryRun.counts.duplicate +
    (plan.review.dryRun.leftEmptyCount ?? 0);
  return (
    <IconList divided>
      {plan.steps.map((s) => (
        <IconListItem
          key={`${s.kind}:${s.title}`}
          icon={STEP_LOOK[s.kind].icon}
          tone={STEP_LOOK[s.kind].tone}
          description={s.detail}
          action={
            s.kind === 'people' && blocked > 0 && onSeeRows !== undefined ? (
              <Button size="xs" variant="ghost" aria-expanded={seeingRows} onClick={onSeeRows}>
                {seeingRows === true ? 'Hide rows' : 'See rows'}
              </Button>
            ) : undefined
          }
        >
          {s.title}
        </IconListItem>
      ))}
    </IconList>
  );
}

/** Who a listed row is: first, so under a finger it is the card's title. */
const whoOf = (r: { readonly row: number; readonly name?: string | null }): string =>
  r.name ?? `Row ${String(r.row)}`;

const LEFT_EMPTY_COLUMNS: DataColumn<LeftEmptyRow>[] = [
  { id: 'name', header: 'Name', cell: whoOf },
  { id: 'row', header: 'Row', numeric: true, cell: (r) => r.row },
  { id: 'cell', header: 'Cell', cell: (r) => <span className="font-mono text-xs">{r.cell}</span> },
  { id: 'label', header: 'Field', cell: (r) => r.label },
  { id: 'reason', header: 'Why it’s left empty', cell: (r) => r.reason },
];

/** References left empty for HR, each where it is and why. */
function LeftEmpty({
  rows,
  count,
}: {
  readonly rows: readonly LeftEmptyRow[];
  readonly count: number;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-md font-semibold">Left empty for HR</h2>
      <p className="text-sm text-fg-muted">
        {count > rows.length ? `The first ${String(rows.length)} of ${String(count)}. ` : ''}
        These rows import without the value. Set each on the person’s profile.
      </p>
      <DataTable
        label="Left empty for HR"
        rows={rows}
        columns={LEFT_EMPTY_COLUMNS}
        rowId={(r) => `${String(r.row)}/${r.cell}`}
      />
    </div>
  );
}

/** Why the plan cannot be approved as it stands, each with its fix where there is one. */
export interface NotYet {
  readonly message: string;
  /** A field the settings refuse: leaving its column out is the one-click fix. */
  readonly column?: number;
  readonly header?: string;
}

/** Everything that keeps "Approve and run" off; empty when it can run. */
export function notYetOf(plan: ImportPlanView): NotYet[] {
  if (plan.blocked !== null) return [{ message: plan.blocked }];
  if (plan.problems.length > 0) {
    return plan.problems.map((p) => ({
      message: `${p.header}: ${p.message}`,
      column: p.column,
      header: p.header,
    }));
  }
  const { counts } = plan.review.dryRun;
  return counts.create + counts.update === 0 && plan.fields.length === 0 && plan.setup === null
    ? [{ message: 'No row of the file has a name or a work email, so there is nobody to import.' }]
    : [];
}

/**
 * Why "Approve and run" is off, next to it: the button names this by
 * `aria-describedby`, and as an alert it is announced when it appears.
 */
export function WhyNotYet({
  id,
  reasons,
  onLeaveOut,
}: {
  readonly id: string;
  readonly reasons: readonly NotYet[];
  readonly onLeaveOut?: (column: number) => void;
}): JSX.Element | null {
  if (reasons.length === 0) return null;
  return (
    <Alert id={id} tone="warning" title="Not yet">
      <ul className="flex flex-col gap-2">
        {reasons.map((r) => (
          <li key={r.message} className="flex flex-wrap items-center gap-2">
            <span>{r.message}</span>
            {r.column === undefined || onLeaveOut === undefined ? null : (
              <Button
                size="xs"
                onClick={() => {
                  onLeaveOut(r.column as number);
                }}
              >
                Leave {r.header} out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

export interface PlanStepProps {
  readonly plan: ImportPlanView;
  readonly busy: boolean;
  readonly refused: string | null;
  /** Where the refusal points: the import already running. */
  readonly refusedLink?: string | null;
  readonly onApprove: () => void;
  readonly onChange: () => void;
  /** Leave a refused field's column out and work the plan out again. */
  readonly onLeaveOut: (column: number) => void;
  readonly onDownloadBlocked: (url: string) => void;
}

/** "Here's everything that will happen" (design AI11). */
export function PlanStep({
  plan,
  busy,
  refused,
  refusedLink = null,
  onApprove,
  onChange,
  onLeaveOut,
  onDownloadBlocked,
}: PlanStepProps): JSX.Element {
  const [seeingRows, setSeeingRows] = useState(false);
  const whyId = useId();
  const { counts } = plan.review.dryRun;
  const blocked = plan.review.dryRun.blocked ?? [];
  const findings = plan.review.dryRun.findings ?? [];
  const leftEmpty = plan.review.dryRun.leftEmpty ?? [];
  const blockedUrl = plan.review.blockedUrl ?? null;
  const notYet = notYetOf(plan);

  const blockedColumns: DataColumn<BlockedRow>[] = [
    { id: 'name', header: 'Name', cell: whoOf },
    { id: 'row', header: 'Row', numeric: true, cell: (r) => r.row },
    {
      id: 'cell',
      header: 'Cell',
      cell: (r) => <span className="font-mono text-xs">{r.cell}</span>,
    },
    { id: 'problem', header: 'Why it’s skipped', cell: (r) => r.problem },
  ];
  const findingColumns: DataColumn<CellFinding>[] = [
    { id: 'name', header: 'Name', cell: whoOf },
    { id: 'row', header: 'Row', numeric: true, cell: (r) => r.row },
    {
      id: 'cell',
      header: 'Cell',
      cell: (r) => <span className="font-mono text-xs">{r.cell}</span>,
    },
    { id: 'label', header: 'Field', cell: (r) => r.label },
    { id: 'message', header: 'What the checks found', cell: (r) => r.message },
  ];

  return (
    <div className="grid items-start gap-4 @4xl/page:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <AssistantCard
          level={2}
          title="Here’s everything that will happen"
          note="Written from your choices. Nothing has happened yet."
        >
          <PlanSteps
            plan={plan}
            seeingRows={seeingRows}
            onSeeRows={() => {
              setSeeingRows((s) => !s);
            }}
          />
        </AssistantCard>
        {seeingRows && blocked.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-md font-semibold">Skipped rows</h2>
              {blockedUrl === null ? null : (
                <Button
                  size="sm"
                  startIcon={<icons.download aria-hidden />}
                  onClick={() => {
                    onDownloadBlocked(blockedUrl);
                  }}
                >
                  Download all {counts.blocked + counts.duplicate} as CSV
                </Button>
              )}
            </div>
            <p className="text-sm text-fg-muted">
              Each has no name and no work email, or is somebody already in the file. Nothing else
              is skipped.
            </p>
            <DataTable
              label="Skipped rows"
              rows={blocked}
              columns={blockedColumns}
              rowId={(r) => `${String(r.row)}/${r.cell}`}
            />
          </div>
        ) : null}
        {seeingRows && leftEmpty.length > 0 ? (
          <LeftEmpty
            rows={leftEmpty}
            count={plan.review.dryRun.leftEmptyCount ?? leftEmpty.length}
          />
        ) : null}
        {findings.length > 0 ? (
          <div className="flex flex-col gap-3">
            <Alert
              tone="warning"
              title={`Our checks suggest ${plural(findings.length, 'identifier', 'identifiers')} may be wrong`}
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
      </div>
      <div className="flex flex-col gap-3.5">
        <PageSection surface title="Approve">
          <div className="flex flex-col gap-3">
            <KeyValues
              items={[
                { label: 'File', value: plan.review.file.name },
                { label: 'Rows', value: plan.review.file.rows.toLocaleString('en-GB') },
                { label: 'New fields', value: plan.fields.length },
                { label: 'People asked', value: plan.asked.toLocaleString('en-GB') },
              ]}
            />
            <WhyNotYet id={whyId} reasons={notYet} onLeaveOut={onLeaveOut} />
            {refused === null ? null : (
              <Alert
                tone="danger"
                title="That did not go through"
                action={
                  refusedLink === null ? undefined : (
                    <Button asChild size="sm">
                      <a href={refusedLink}>See the import</a>
                    </Button>
                  )
                }
              >
                {refused}
              </Alert>
            )}
            <Button
              variant="primary"
              className="w-full"
              startIcon={<icons.confirm aria-hidden />}
              disabled={notYet.length > 0}
              aria-describedby={notYet.length > 0 ? whyId : undefined}
              loading={busy}
              loadingLabel="Starting the import"
              onClick={onApprove}
            >
              Approve and run
            </Button>
            <Button variant="ghost" className="w-full" onClick={onChange}>
              Change something
            </Button>
          </div>
        </PageSection>
        <p className="inline-flex items-center gap-1.5 text-xs text-fg-subtle [&_svg]:size-3.5">
          <icons.permission aria-hidden />
          Approved by you, run by Kithena, logged in Activity
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- AI12 -- */

const clockOf = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** "12 columns → existing fields, 90 new fields, 0 left out": every column accounted for. */
export function columnsLine(c: NonNullable<ImportDoneView['columns']>): string {
  const ids =
    c.kithena === 0
      ? ''
      : ` · ${plural(c.kithena, 'id column', 'id columns')}: Kithena creates this`;
  return `${plural(c.existing, 'column', 'columns')} → existing fields, ${plural(c.created, 'new field', 'new fields')}, ${c.leftOut.toLocaleString('en-GB')} left out${ids}`;
}

/** "Imported 369 people and created 3 fields" (design AI12). */
export function DoneStep({ done }: { readonly done: ImportDoneView }): JSX.Element {
  const fields = done.fields ?? [];
  const imported = done.created + done.updated;
  const took =
    done.tookMs === undefined
      ? null
      : `took ${String(Math.max(1, Math.round(done.tookMs / 1000)))} s`;
  return (
    <div className="grid items-start gap-4 @4xl/page:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card padded className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden
            className="grid size-13 shrink-0 place-items-center rounded-full bg-success-subtle text-success-fg [&_svg]:size-6.5"
          >
            <icons.success />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-display text-xl font-bold">
              Imported {plural(imported, 'person', 'people')}
              {fields.length > 0 ? ` and created ${plural(fields.length, 'field', 'fields')}` : ''}
            </h2>
            {done.columns === undefined ? null : (
              <p className="text-sm">{columnsLine(done.columns)}</p>
            )}
            {done.finishedAt === undefined ? null : (
              <p className="text-sm text-fg-muted">
                Finished {clockOf(done.finishedAt)}
                {took === null ? '' : ` · ${took}`}
              </p>
            )}
          </div>
        </div>
        <div
          role="group"
          aria-label="What the import did"
          className="grid grid-cols-4 gap-2.5 touch:grid-cols-2"
        >
          {(
            [
              ['Created', done.created],
              ['Updated', done.updated],
              ['Asked', done.asked ?? 0],
              ['For HR', done.forHr ?? 0],
            ] as const
          ).map(([label, n]) => (
            <Stat key={label} inset label={label} value={n.toLocaleString('en-GB')} />
          ))}
        </div>
        {done.blocked > 0 ? (
          <Alert
            tone="info"
            title={`${plural(done.blocked, 'row was', 'rows were')} skipped`}
            action={
              done.reportUrl === undefined ? undefined : (
                <Button asChild size="sm">
                  <a href={done.reportUrl}>Download them</a>
                </Button>
              )
            }
          >
            Each had no name and no work email, or repeated somebody. The file says which.
          </Alert>
        ) : null}
        {(done.forReview ?? 0) > 0 ? (
          <Alert tone="info">
            {plural(
              done.forReview ?? 0,
              'national identifier our checks doubt went',
              'national identifiers our checks doubt went',
            )}{' '}
            to HR’s review.
          </Alert>
        ) : null}
        {(done.leftEmptyCount ?? 0) > 0 ? (
          <LeftEmpty rows={done.leftEmpty ?? []} count={done.leftEmptyCount ?? 0} />
        ) : null}
        {(done.held ?? 0) > 0 ? (
          <Alert tone="info">
            {plural(done.held ?? 0, 'sensitive value waits', 'sensitive values wait')} for HR’s
            approval and {done.held === 1 ? 'is' : 'are'} not applied until then.
          </Alert>
        ) : null}
        {done.created > 0 ? (
          <Alert tone="info" title="Nobody has been invited yet">
            Nobody is invited by an import, and nobody who has left ever is. Invite each from their
            record when you’re ready.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="ms-auto">
            <Button asChild variant="secondary" endIcon={<icons.forward aria-hidden />}>
              <a href="/people/directory/list">
                {done.created > 0
                  ? `Open the ${done.created.toLocaleString('en-GB')} in Directory`
                  : 'Open the Directory'}
              </a>
            </Button>
          </span>
        </div>
      </Card>
      {fields.length === 0 ? null : (
        <PageSection
          surface
          title="Now in Employee fields"
          actions={
            <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
              <a href="/settings/people/fields">Open Settings</a>
            </Button>
          }
        >
          <List>
            {fields.map((f) => (
              <ListItem
                key={f.key}
                icon={<TypeIcon dataType={f.dataType} />}
                description={`${f.section} · published in version ${String(done.version ?? 1)}`}
                trailing={
                  <Button asChild size="xs" variant="ghost">
                    <a
                      href={`/settings/people/fields?q=${encodeURIComponent(f.label)}`}
                      aria-label={`Edit ${f.label}`}
                    >
                      Edit
                    </a>
                  </Button>
                }
              >
                <span className="inline-flex items-center gap-2">
                  {f.label}
                  <Badge tone="assistant" size="sm">
                    From import
                  </Badge>
                </span>
              </ListItem>
            ))}
          </List>
        </PageSection>
      )}
    </div>
  );
}
