import {
  Alert,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Badge,
  Button,
  Combobox,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  icons,
  Input,
  PageHeader,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Tooltip,
  TooltipProvider,
  useScreenCommand,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useHeld } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';
import { t } from '../i18n';

/**
 * Scheduled reports (PEO-069; PRD §16.3): HR's list, the form, pause and
 * resume, delete, and the way to each one's history.
 *
 * **Each recipient gets only what they may see.** People builds every run
 * again as each recipient, so two recipients of one schedule can receive
 * different people and different columns. That is said three times, on
 * purpose: under the recipients field, in its tooltip, and in a confirmation
 * that has to be accepted before a new schedule — or a changed audience or
 * recipient list — is saved. Somebody who expects everyone to get the same
 * file is about to be surprised by a manager's shorter one.
 */

export type ReportEvery = 'day' | 'week' | 'month';

export interface ScheduleRow {
  readonly id: string;
  readonly name: string;
  readonly ownerName: string | null;
  readonly paused: boolean;
  readonly segmentId: string | null;
  readonly segmentName: string | null;
  readonly filter: readonly { readonly key: string; readonly value: string }[];
  readonly kind: 'export' | 'summary';
  readonly format: 'xlsx' | 'pdf' | null;
  readonly fields: readonly string[] | null;
  readonly reason: string | null;
  readonly every: ReportEvery;
  readonly weekday: number | null;
  readonly day: number | null;
  readonly hour: number;
  readonly legalEntityId: string | null;
  readonly recipients: readonly { readonly accountId: string; readonly name: string | null }[];
  readonly lastRun: {
    readonly period: string;
    readonly missed: number;
    readonly outcome: string | null;
  } | null;
}

export interface ReportSchedulesState {
  readonly canManage: boolean;
  readonly schedules: readonly ScheduleRow[];
  readonly segments: readonly {
    readonly id: string;
    readonly name: string;
    readonly forExport: boolean;
    readonly forSummary: boolean;
  }[];
  readonly people: readonly {
    readonly accountId: string;
    readonly name: string | null;
    readonly workEmail: string | null;
  }[];
  readonly legalEntities: readonly { readonly id: string; readonly name: string }[];
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly section: string;
  }[];
}

/** What is saved: the shell's `ScheduleDraft`. */
export interface ScheduleDraft {
  readonly name: string;
  readonly segmentId: string | null;
  readonly filter: readonly { readonly key: string; readonly value: string }[];
  readonly kind: 'export' | 'summary';
  readonly format: 'xlsx' | 'pdf';
  readonly fields: readonly string[] | null;
  readonly reason: string | null;
  readonly every: ReportEvery;
  readonly weekday: number;
  readonly day: number;
  readonly hour: number;
  readonly legalEntityId: string | null;
  readonly recipients: readonly string[];
}

export interface ReportSchedulesProps {
  readonly load: Loadable<ReportSchedulesState>;
  readonly onCreate: (draft: ScheduleDraft) => Promise<Outcome>;
  readonly onUpdate: (id: string, draft: ScheduleDraft) => Promise<Outcome>;
  readonly onPause: (id: string) => Promise<Outcome>;
  readonly onResume: (id: string) => Promise<Outcome>;
  readonly onDelete: (id: string) => Promise<Outcome>;
  /**
   * The schedule open in its dialog, held by the host so a link opens it in
   * the server's HTML: `new` for a new one, or a schedule's id to edit it.
   * One this list does not have is closed.
   */
  readonly open?: string | null;
  readonly onOpenChange?: (open: string | null) => void;
}

/** The sentence every place that names recipients says. */
export const EACH_SEES_THEIR_OWN = (): string =>
  t(
    'reports.report-schedules.each_recipient_sees_only_the_people',
    'Each recipient sees only the people and columns they have access to.',
  );

const WEEKDAYS = (): readonly string[] => [
  t('reports.report-schedules.monday', 'Monday'),
  t('reports.report-schedules.tuesday', 'Tuesday'),
  t('reports.report-schedules.wednesday', 'Wednesday'),
  t('reports.report-schedules.thursday', 'Thursday'),
  t('reports.report-schedules.friday', 'Friday'),
  t('reports.report-schedules.saturday', 'Saturday'),
  t('reports.report-schedules.sunday', 'Sunday'),
];
const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** Who gets it, short enough for one line: two names, then how many more. */
export function recipientsText(row: Pick<ScheduleRow, 'recipients'>): string {
  const names = row.recipients.map(
    (r) => r.name ?? t('reports.report-schedules.somebody_who_has_left', 'Somebody who has left'),
  );
  if (names.length <= 2) return names.join(', ');
  return t('reports.report-schedules.and_more', '{{join}} and {{value}} more', {
    join: names.slice(0, 2).join(', '),
    value: String(names.length - 2),
  });
}

export function cadenceText(r: Pick<ScheduleRow, 'every' | 'weekday' | 'day' | 'hour'>): string {
  if (r.every === 'week')
    return t('reports.report-schedules.weekly_on_at', 'Weekly on {{value}} at {{hh}}', {
      value: WEEKDAYS()[(r.weekday ?? 1) - 1] ?? '',
      hh: hh(r.hour),
    });
  if (r.every === 'month')
    return t('reports.report-schedules.monthly_on_day_at', 'Monthly on day {{value}} at {{hh}}', {
      value: String(r.day ?? 1),
      hh: hh(r.hour),
    });
  return t('reports.report-schedules.daily_at', 'Daily at {{hh}}', { hh: hh(r.hour) });
}

const reportText = (r: ScheduleRow): string =>
  r.kind === 'summary'
    ? t('reports.report-schedules.summary', 'Summary')
    : r.format === 'pdf'
      ? t('reports.report-schedules.pdf_roster', 'PDF roster')
      : t('reports.report-schedules.excel_file', 'Excel file');

const audienceText = (r: ScheduleRow): string =>
  r.segmentId !== null
    ? (r.segmentName ??
      t('reports.report-schedules.a_segment_you_cannot_see', 'A segment you cannot see'))
    : r.filter.length > 0
      ? r.filter
          .map((c) =>
            t('reports.report-schedules.text', '{{key}}: {{value}}', {
              key: c.key,
              value: c.value,
            }),
          )
          .join(', ')
      : t('reports.report-schedules.everybody', 'Everybody');

export const RUN_OUTCOME: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  sent: {
    get label(): string {
      return t('reports.report-schedules.sent', 'Sent');
    },
    tone: 'success',
  },
  partial: {
    get label(): string {
      return t('reports.report-schedules.partly_sent', 'Partly sent');
    },
    tone: 'warning',
  },
  failed: {
    get label(): string {
      return t('reports.report-schedules.failed', 'Failed');
    },
    tone: 'danger',
  },
  skipped: {
    get label(): string {
      return t('reports.report-schedules.skipped', 'Skipped');
    },
    tone: 'neutral',
  },
};
const outcomeOf = (outcome: string | null) =>
  outcome === null
    ? {
        label: t('reports.report-schedules.did_not_finish', 'Did not finish'),
        tone: 'neutral' as const,
      }
    : (RUN_OUTCOME[outcome] ?? { label: outcome, tone: 'neutral' as const });

export function ReportSchedules(props: ReportSchedulesProps): JSX.Element {
  return (
    <TooltipProvider>
      <Stack gap={6}>
        <Loaded
          load={props.load}
          what={t('reports.report-schedules.the_scheduled_reports', 'the scheduled reports')}
        >
          {(state) => <Schedules {...props} state={state} />}
        </Loaded>
      </Stack>
    </TooltipProvider>
  );
}

const TITLE = (): string => t('reports.report-schedules.scheduled_reports', 'Scheduled reports');
const ABOUT = (): string =>
  t(
    'reports.report-schedules.a_file_or_the_summary_emailed',
    'A file or the summary, emailed as a link on a cadence. Nobody is sent the data itself.',
  );

/**
 * The one list of schedules: the Schedules button on every Insights tab opens
 * it. Each row's actions are in its menu; a new schedule is a centred dialog.
 */
function Schedules({
  state,
  onCreate,
  onUpdate,
  onPause,
  onResume,
  onDelete,
  open: heldOpen,
  onOpenChange,
}: ReportSchedulesProps & { readonly state: ReportSchedulesState }): JSX.Element {
  const [open, setOpen] = useHeld<string | null>(heldOpen, onOpenChange, null);
  const editingRow = state.schedules.find((r) => r.id === open) ?? null;
  const editing = open === 'new' || editingRow !== null;
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  // C makes a schedule, here as on the button: the shell's key and its palette run it.
  useScreenCommand(
    state.canManage
      ? {
          id: 'create',
          label: t('reports.report-schedules.new_scheduled_report', 'New scheduled report'),
          run: () => {
            setOpen('new');
          },
        }
      : null,
  );

  if (!state.canManage) {
    return (
      <>
        <PageHeader title={TITLE()} description={ABOUT()} />
        <Alert tone="info">
          {t(
            'reports.report-schedules.only_hr_and_people_administrators_schedule',
            'Only HR and People administrators schedule reports.',
          )}
        </Alert>
      </>
    );
  }

  const act = (outcome: Promise<Outcome>): void => {
    setRefused(null);
    void outcome.then((o) => {
      if (!o.ok) setRefused(o.message);
    });
  };
  const history = (row: ScheduleRow): void => {
    window.location.assign(`/people/reports/${row.id}`);
  };

  return (
    <>
      <PageHeader
        title={TITLE()}
        description={ABOUT()}
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            shortcut="create"
            onClick={() => {
              setOpen('new');
            }}
          >
            {t('reports.report-schedules.new_scheduled_report', 'New scheduled report')}
          </Button>
        }
      />
      {refused === null ? null : (
        <Alert tone="danger" title={t('reports.report-schedules.not_changed', 'Not changed')}>
          {refused}
        </Alert>
      )}
      <DataTable<ScheduleRow>
        label={TITLE()}
        rows={state.schedules}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        rowMenuOnCard
        empty={
          <EmptyState
            title={t('reports.report-schedules.no_scheduled_reports', 'No scheduled reports')}
            description={t(
              'reports.report-schedules.schedule_an_excel_file_a_pdf',
              'Schedule an Excel file, a PDF roster or the summary for the people who need it.',
            )}
          />
        }
        columns={[
          {
            id: 'report',
            header: t('reports.report-schedules.report', 'Report'),
            cell: (row) => (
              <span className="flex flex-col">
                <span className="font-semibold">{row.name}</span>
                <span className="text-sm text-fg-muted">
                  {reportText(row)} · {audienceText(row)}
                </span>
              </span>
            ),
          },
          {
            id: 'when',
            header: t('reports.report-schedules.when', 'When'),
            cell: (row) => cadenceText(row),
          },
          {
            id: 'recipients',
            header: t('reports.report-schedules.recipients', 'Recipients'),
            cell: (row) => recipientsText(row),
          },
          {
            id: 'last',
            header: t('reports.report-schedules.last_run', 'Last run'),
            cell: (row) => {
              if (row.lastRun === null)
                return (
                  <span className="text-fg-muted">
                    {t('reports.report-schedules.not_yet', 'Not yet')}
                  </span>
                );
              const last = outcomeOf(row.lastRun.outcome);
              return (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge size="sm" tone={last.tone}>
                    {last.label}
                  </Badge>
                  <span className="text-sm text-fg-muted">{row.lastRun.period}</span>
                </span>
              );
            },
          },
          {
            id: 'status',
            header: t('reports.report-schedules.status', 'Status'),
            cardTrailing: true,
            cell: (row) =>
              row.paused ? (
                <Badge size="sm">{t('reports.report-schedules.paused', 'Paused')}</Badge>
              ) : (
                <Badge size="sm" tone="success">
                  {t('reports.report-schedules.active', 'Active')}
                </Badge>
              ),
          },
        ]}
        rowActions={(row) => [
          {
            id: 'edit',
            label: t('reports.report-schedules.edit', 'Edit'),
            icon: <icons.edit aria-hidden />,
            onSelect: () => {
              setOpen(row.id);
            },
          },
          {
            id: 'pause',
            label: row.paused
              ? t('reports.report-schedules.resume', 'Resume')
              : t('reports.report-schedules.pause', 'Pause'),
            icon: row.paused ? <icons.play aria-hidden /> : <icons.pause aria-hidden />,
            onSelect: () => {
              act(row.paused ? onResume(row.id) : onPause(row.id));
            },
          },
          {
            id: 'history',
            label: t('reports.report-schedules.history', 'History'),
            icon: <icons.history aria-hidden />,
            onSelect: () => {
              history(row);
            },
          },
          {
            id: 'delete',
            label: t('reports.report-schedules.delete', 'Delete'),
            icon: <icons.delete aria-hidden />,
            destructive: true,
            onSelect: () => {
              setDeleting(row);
            },
          },
        ]}
        onRowOpen={history}
      />
      {editing ? (
        <ScheduleForm
          key={open}
          state={state}
          row={editingRow}
          onClose={() => {
            setOpen(null);
          }}
          onSave={(draft) =>
            editingRow === null ? onCreate(draft) : onUpdate(editingRow.id, draft)
          }
        />
      ) : null}
      <DeleteSchedule
        row={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDelete={(id) => {
          act(onDelete(id));
        }}
      />
    </>
  );
}

/** "Delete this schedule?", asked before it goes. */
export function DeleteSchedule({
  row,
  onClose,
  onDelete,
}: {
  readonly row: ScheduleRow | null;
  readonly onClose: () => void;
  readonly onDelete: (id: string) => void;
}): JSX.Element {
  return (
    <AlertDialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>
          {t('reports.report-schedules.delete', 'Delete')} {row?.name}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(
            'reports.report-schedules.nobody_will_receive_it_again_and',
            'Nobody will receive it again, and its run history is deleted with it.',
          )}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button>{t('reports.report-schedules.cancel', 'Cancel')}</Button>
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              if (row !== null) onDelete(row.id);
              onClose();
            }}
          >
            {t('reports.report-schedules.delete', 'Delete')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const draftOf = (row: ScheduleRow | null): ScheduleDraft => ({
  name: row?.name ?? '',
  segmentId: row?.segmentId ?? null,
  filter: row?.filter ?? [],
  kind: row?.kind ?? 'export',
  format: row?.format ?? 'xlsx',
  fields: row?.fields ?? null,
  reason: row?.reason ?? null,
  every: row?.every ?? 'week',
  weekday: row?.weekday ?? 1,
  day: row?.day ?? 1,
  hour: row?.hour ?? 7,
  legalEntityId: row?.legalEntityId ?? null,
  recipients: row?.recipients.map((r) => r.accountId) ?? [],
});

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].toSorted().join() === [...b].toSorted().join();

/** Whether saving needs the recipient confirmation: new, or who gets it or what it covers changed. */
export function needsConfirmation(row: ScheduleRow | null, draft: ScheduleDraft): boolean {
  if (row === null) return true;
  const before = draftOf(row);
  return (
    !same(before.recipients, draft.recipients) ||
    before.segmentId !== draft.segmentId ||
    before.filter.length !== draft.filter.length
  );
}

const EVERYBODY = 'everybody';
const SAVED_FILTER = 'filter';

export function ScheduleForm({
  state,
  row,
  onClose,
  onSave,
}: {
  readonly state: ReportSchedulesState;
  readonly row: ScheduleRow | null;
  readonly onClose: () => void;
  readonly onSave: (draft: ScheduleDraft) => Promise<Outcome>;
}): JSX.Element {
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOf(row));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const set = (patch: Partial<ScheduleDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  const segments = state.segments.filter((s) =>
    draft.kind === 'summary' ? s.forSummary : s.forExport,
  );
  const audience =
    draft.segmentId !== null ? draft.segmentId : draft.filter.length > 0 ? SAVED_FILTER : EVERYBODY;
  const ready = draft.name.trim() !== '' && draft.recipients.length > 0;

  const save = (): void => {
    setBusy(true);
    setRefused(null);
    void onSave({ ...draft, name: draft.name.trim() }).then((outcome) => {
      setBusy(false);
      setConfirming(false);
      if (outcome.ok) onClose();
      else setRefused(outcome.message);
    });
  };

  return (
    <>
      <Dialog
        open={!confirming}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {row === null
                ? t('reports.report-schedules.new_scheduled_report', 'New scheduled report')
                : t('reports.report-schedules.edit_2', 'Edit {{name}}', { name: row.name })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'reports.report-schedules.it_first_goes_out_at_its',
                'It first goes out at its next time, not when it is saved.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              <Field required>
                <FieldLabel>{t('reports.report-schedules.name', 'Name')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={draft.name}
                    maxLength={80}
                    onChange={(e) => {
                      set({ name: e.target.value });
                    }}
                  />
                </FieldControl>
                <FieldDescription>
                  {t(
                    'reports.report-schedules.only_you_and_other_hr_see',
                    'Only you and other HR see it; it is not in the email.',
                  )}
                </FieldDescription>
              </Field>

              <RadioGroup
                aria-label={t('reports.report-schedules.report', 'Report')}
                value={draft.kind === 'summary' ? 'summary' : draft.format}
                onValueChange={(value) => {
                  if (value === 'summary') set({ kind: 'summary', segmentId: null, filter: [] });
                  else set({ kind: 'export', format: value as 'xlsx' | 'pdf' });
                }}
              >
                <RadioCard
                  value="xlsx"
                  description={t(
                    'reports.report-schedules.for_a_person_to_read_and',
                    'For a person to read and edit.',
                  )}
                >
                  {t('reports.report-schedules.excel_file', 'Excel file')}
                </RadioCard>
                <RadioCard
                  value="pdf"
                  description={t('reports.report-schedules.to_print_or_file', 'To print or file.')}
                >
                  {t('reports.report-schedules.pdf_roster', 'PDF roster')}
                </RadioCard>
                <RadioCard
                  value="summary"
                  description={t(
                    'reports.report-schedules.headcount_movement_and_completeness_read_signed',
                    'Headcount, movement and completeness, read signed in.',
                  )}
                >
                  {t('reports.report-schedules.summary', 'Summary')}
                </RadioCard>
              </RadioGroup>

              {draft.kind === 'export' ? (
                <>
                  <Field>
                    <FieldLabel>{t('reports.report-schedules.fields', 'Fields')}</FieldLabel>
                    <FieldControl>
                      <Combobox
                        label={t('reports.report-schedules.fields', 'Fields')}
                        multiple
                        placeholder={t(
                          'reports.report-schedules.every_field_each_recipient_may_read',
                          'Every field each recipient may read',
                        )}
                        options={state.fields.map((f) => ({
                          value: f.key,
                          label: f.label,
                          group: f.section,
                        }))}
                        value={draft.fields ?? []}
                        onChange={(value) => {
                          const keys = Array.isArray(value) ? (value as readonly string[]) : [];
                          set({ fields: keys.length === 0 ? null : keys });
                        }}
                      />
                    </FieldControl>
                    <FieldDescription>
                      {t(
                        'reports.report-schedules.leave_empty_for_every_field_a',
                        'Leave empty for every field. A recipient who cannot read a field gets the file without it.',
                      )}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>{t('reports.report-schedules.reason', 'Reason')}</FieldLabel>
                    <FieldControl>
                      <Input
                        value={draft.reason ?? ''}
                        maxLength={500}
                        onChange={(e) => {
                          set({ reason: e.target.value === '' ? null : e.target.value });
                        }}
                      />
                    </FieldControl>
                    <FieldDescription>
                      {t(
                        'reports.report-schedules.needed_when_pay_or_a_bank',
                        'Needed when pay or a bank account is in the file; kept with every run.',
                      )}
                    </FieldDescription>
                  </Field>
                </>
              ) : null}

              <Field>
                <FieldLabel>{t('reports.report-schedules.about', 'About')}</FieldLabel>
                <Select
                  value={audience}
                  onValueChange={(value) => {
                    if (value === EVERYBODY) set({ segmentId: null, filter: [] });
                    else if (value !== SAVED_FILTER) set({ segmentId: value, filter: [] });
                  }}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    <SelectItem value={EVERYBODY}>
                      {t(
                        'reports.report-schedules.everybody_each_recipient_may_see',
                        'Everybody each recipient may see',
                      )}
                    </SelectItem>
                    {row !== null && row.filter.length > 0 ? (
                      <SelectItem value={SAVED_FILTER}>
                        {t(
                          'reports.report-schedules.the_filter_it_was_saved_with',
                          'The filter it was saved with',
                        )}
                      </SelectItem>
                    ) : null}
                    {segments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="flex flex-wrap gap-4">
                <Field>
                  <FieldLabel>{t('reports.report-schedules.how_often', 'How often')}</FieldLabel>
                  <Select
                    value={draft.every}
                    onValueChange={(value) => {
                      set({ every: value as ReportEvery });
                    }}
                  >
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      <SelectItem value="day">
                        {t('reports.report-schedules.daily', 'Daily')}
                      </SelectItem>
                      <SelectItem value="week">
                        {t('reports.report-schedules.weekly', 'Weekly')}
                      </SelectItem>
                      <SelectItem value="month">
                        {t('reports.report-schedules.monthly', 'Monthly')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {draft.every === 'week' ? (
                  <Field>
                    <FieldLabel>{t('reports.report-schedules.on', 'On')}</FieldLabel>
                    <Select
                      value={String(draft.weekday)}
                      onValueChange={(value) => {
                        set({ weekday: Number(value) });
                      }}
                    >
                      <FieldControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {WEEKDAYS().map((name, i) => (
                          <SelectItem key={name} value={String(i + 1)}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                {draft.every === 'month' ? (
                  <Field>
                    <FieldLabel>
                      {t('reports.report-schedules.day_of_the_month', 'Day of the month')}
                    </FieldLabel>
                    <Select
                      value={String(draft.day)}
                      onValueChange={(value) => {
                        set({ day: Number(value) });
                      }}
                    >
                      <FieldControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => (
                          <SelectItem key={i} value={String(i + 1)}>
                            {String(i + 1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel>{t('reports.report-schedules.at', 'At')}</FieldLabel>
                  <Select
                    value={String(draft.hour)}
                    onValueChange={(value) => {
                      set({ hour: Number(value) });
                    }}
                  >
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>
                          {hh(h)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {state.legalEntities.length === 0 ? null : (
                <Field>
                  <FieldLabel>
                    {t('reports.report-schedules.on_whose_clock', 'On whose clock')}
                  </FieldLabel>
                  <Select
                    value={draft.legalEntityId ?? 'default'}
                    onValueChange={(value) => {
                      set({ legalEntityId: value === 'default' ? null : value });
                    }}
                  >
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      <SelectItem value="default">
                        {t(
                          'reports.report-schedules.the_companys_default_time_zone',
                          'The company’s default time zone',
                        )}
                      </SelectItem>
                      {state.legalEntities.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <Field required>
                <div className="flex items-center gap-1">
                  <FieldLabel>{t('reports.report-schedules.recipients', 'Recipients')}</FieldLabel>
                  <Tooltip content={EACH_SEES_THEIR_OWN()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t(
                        'reports.report-schedules.what_each_recipient_gets',
                        'What each recipient gets',
                      )}
                      startIcon={<icons.help aria-hidden="true" />}
                    />
                  </Tooltip>
                </div>
                <FieldControl>
                  <Combobox
                    label={t('reports.report-schedules.recipients', 'Recipients')}
                    multiple
                    placeholder={t(
                      'reports.report-schedules.pick_up_to_25_people',
                      'Pick up to 25 people',
                    )}
                    options={state.people.map((p) => ({
                      value: p.accountId,
                      label:
                        p.name ??
                        p.workEmail ??
                        t(
                          'reports.report-schedules.somebody_without_a_name_yet',
                          'Somebody without a name yet',
                        ),
                      ...(p.name !== null && p.workEmail !== null
                        ? { description: p.workEmail }
                        : {}),
                    }))}
                    value={draft.recipients}
                    onChange={(value) => {
                      set({
                        recipients: Array.isArray(value)
                          ? (value as readonly string[]).slice(0, 25)
                          : [],
                      });
                    }}
                  />
                </FieldControl>
                <FieldDescription>{EACH_SEES_THEIR_OWN()}</FieldDescription>
              </Field>

              {refused === null ? null : (
                <Alert tone="danger" title={t('reports.report-schedules.not_saved', 'Not saved')}>
                  {refused}
                </Alert>
              )}
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>{t('reports.report-schedules.cancel', 'Cancel')}</Button>
            <Button
              variant="primary"
              disabled={!ready}
              loading={busy}
              loadingLabel={t('reports.report-schedules.saving', 'Saving')}
              onClick={() => {
                if (needsConfirmation(row, draft)) setConfirming(true);
                else save();
              }}
            >
              {t('reports.report-schedules.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                'reports.report-schedules.each_recipient_gets_only_what_they',
                'Each recipient gets only what they may see',
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                'reports.report-schedules.confirm_before_this_schedule_is_saved',
                'Confirm before this schedule is saved.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={3}>
              <p>
                {t(
                  'reports.report-schedules.built_again_for_each_recipient',
                  {
                    one: 'This report is built again for each of its {{count}} recipient, every time it runs, as that person. Each one gets only the people they may list and the columns they may read — so different recipients may receive different people and different columns, and a manager’s file can be much shorter than HR’s.',
                    other:
                      'This report is built again for each of its {{count}} recipients, every time it runs, as that person. Each one gets only the people they may list and the columns they may read — so different recipients may receive different people and different columns, and a manager’s file can be much shorter than HR’s.',
                  },
                  { count: draft.recipients.length },
                )}
              </p>
              <p>
                {t(
                  'reports.report-schedules.people_who_have_left_or_lost',
                  'People who have left or lost access receive nothing. Emails contain a sign-in link, never data.',
                )}
              </p>
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('reports.report-schedules.back', 'Back')}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel={t('reports.report-schedules.saving', 'Saving')}
              onClick={save}
            >
              {t('reports.report-schedules.i_understand_save_it', 'I understand, save it')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
