import {
  Alert,
  Badge,
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from '@reach/ui-native';
import {
  CalendarClock,
  Ellipsis,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useRead, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { scheduleVariables, type ScheduleDraft } from './schedule';
import { t } from '../../i18n';

type Every = 'day' | 'week' | 'month';

export interface ScheduleRow {
  readonly id: string;
  readonly name: string;
  readonly paused: boolean;
  readonly segmentId: string | null;
  readonly segmentName: string | null;
  readonly filter: readonly { readonly key: string; readonly value: string }[];
  readonly kind: 'export' | 'summary';
  readonly format: 'xlsx' | 'pdf' | null;
  readonly fields: readonly string[] | null;
  readonly reason: string | null;
  readonly every: Every;
  readonly weekday: number | null;
  readonly day: number | null;
  readonly hour: number;
  readonly legalEntityId: string | null;
  readonly recipients: readonly { readonly accountId: string; readonly name: string | null }[];
  readonly lastRun: { readonly period: string; readonly outcome: string | null } | null;
}

interface SchedulesState {
  readonly canManage: boolean;
  readonly schedules: readonly ScheduleRow[];
  readonly segments: readonly {
    id: string;
    name: string;
    forExport: boolean;
    forSummary: boolean;
  }[];
  readonly people: readonly { accountId: string; name: string | null; workEmail: string | null }[];
  readonly legalEntities: readonly { id: string; name: string }[];
  readonly fields: readonly { key: string; label: string; section: string }[];
}

const EACH_SEES_THEIR_OWN = t(
  'people.insights.reports.each_recipient_sees_only_the_people',
  'Each recipient sees only the people and columns they have access to.',
);
const WEEKDAYS = () => [
  t('people.insights.reports.monday', 'Monday'),
  t('people.insights.reports.tuesday', 'Tuesday'),
  t('people.insights.reports.wednesday', 'Wednesday'),
  t('people.insights.reports.thursday', 'Thursday'),
  t('people.insights.reports.friday', 'Friday'),
  t('people.insights.reports.saturday', 'Saturday'),
  t('people.insights.reports.sunday', 'Sunday'),
];
const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

export function cadenceText(r: Pick<ScheduleRow, 'every' | 'weekday' | 'day' | 'hour'>): string {
  if (r.every === 'week')
    return t('people.insights.reports.weekly_on_at', 'Weekly on {{value}} at {{hh}}', {
      value: WEEKDAYS()[(r.weekday ?? 1) - 1] ?? 'Monday',
      hh: hh(r.hour),
    });
  if (r.every === 'month')
    return t('people.insights.reports.monthly_on_day_at', 'Monthly on day {{String}} at {{hh}}', {
      String: String(r.day ?? 1),
      hh: hh(r.hour),
    });
  return t('people.insights.reports.daily_at', 'Daily at {{hh}}', { hh: hh(r.hour) });
}

const RUN_OUTCOME = (): Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> => ({
  sent: { label: t('people.insights.reports.sent', 'Sent'), tone: 'success' },
  partial: { label: t('people.insights.reports.partly_sent', 'Partly sent'), tone: 'warning' },
  failed: { label: t('people.insights.reports.failed', 'Failed'), tone: 'danger' },
  skipped: { label: t('people.insights.reports.skipped', 'Skipped'), tone: 'neutral' },
});
const outcomeOf = (outcome: string | null) =>
  outcome === null
    ? {
        label: t('people.insights.reports.did_not_finish', 'Did not finish'),
        tone: 'neutral' as const,
      }
    : (RUN_OUTCOME()[outcome] ?? { label: outcome, tone: 'neutral' as const });

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

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/** New, or who gets it or what it covers changed: the recipient warning is accepted first. */
const needsConfirmation = (row: ScheduleRow | null, draft: ScheduleDraft): boolean => {
  if (row === null) return true;
  const before = draftOf(row);
  return (
    !sameSet(before.recipients, draft.recipients) ||
    before.segmentId !== draft.segmentId ||
    before.filter.length !== draft.filter.length
  );
};

/**
 * Scheduled reports (design G4): HR's list, Edit, Pause, History and Delete
 * in each row's menu, and a new one from the bar's plus.
 */
export function ScheduledReports({
  navigation,
}: PeopleScreen<'ScheduledReports'>): React.JSX.Element {
  const { load, reload } = useRead<SchedulesState>('ReportSchedules');
  const { act } = useAct();
  const [open, setOpen] = useState<ScheduleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const back = {
    label: t('people.insights.reports.insights', 'Insights'),
    onPress: navigation.goBack,
  };
  const done = (made: unknown): void => {
    if (made !== null) reload();
  };

  if (load.status !== 'ready') {
    return (
      <Page title={t('people.insights.reports.scheduled_reports', 'Scheduled reports')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading
            label={t(
              'people.insights.reports.loading_the_scheduled_reports',
              'Loading the scheduled reports',
            )}
          />
        )}
      </Page>
    );
  }
  const state = load.data;
  return (
    <Page
      title={t('people.insights.reports.scheduled_reports', 'Scheduled reports')}
      back={back}
      {...(state.canManage
        ? {
            trailing: (
              <Button
                size="sm"
                variant="primary"
                startIcon={<Icon icon={Plus} />}
                accessibilityLabel={t(
                  'people.insights.reports.new_scheduled_report',
                  'New scheduled report',
                )}
                onPress={() => {
                  setOpen('new');
                }}
              />
            ),
          }
        : {})}
    >
      <Text tone="muted">
        {t(
          'people.insights.reports.a_file_or_the_summary_emailed',
          'A file or the summary, emailed as a link on a cadence. Nobody is sent the data itself.',
        )}
      </Text>
      {!state.canManage ? (
        <Alert tone="info">
          {t(
            'people.insights.reports.only_hr_and_people_administrators_schedule',
            'Only HR and People administrators schedule reports.',
          )}
        </Alert>
      ) : state.schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t('people.insights.reports.no_scheduled_reports', 'No scheduled reports')}
          description={t(
            'people.insights.reports.schedule_an_excel_file_a_pdf',
            'Schedule an Excel file, a PDF roster or the summary for the people who need it.',
          )}
        />
      ) : (
        <List>
          {state.schedules.map((row) => (
            <ListItem
              key={row.id}
              description={`${cadenceText(row)} · ${
                row.paused
                  ? 'Paused'
                  : row.lastRun === null
                    ? t('people.insights.reports.not_run_yet', 'Not run yet')
                    : outcomeOf(row.lastRun.outcome).label
              }`}
              onPress={() => {
                navigation.navigate('ReportHistory', { id: row.id, name: row.name });
              }}
              trailing={
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button
                      size="sm"
                      variant="ghost"
                      startIcon={<Icon icon={Ellipsis} />}
                      accessibilityLabel={t(
                        'people.insights.reports.actions_for',
                        'Actions for {{name}}',
                        { name: row.name },
                      )}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    label={t('people.insights.reports.actions_for', 'Actions for {{name}}', {
                      name: row.name,
                    })}
                  >
                    <DropdownMenuItem
                      icon={Pencil}
                      onSelect={() => {
                        setOpen(row);
                      }}
                    >
                      {t('people.insights.reports.edit', 'Edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={row.paused ? Play : Pause}
                      onSelect={() => {
                        void act(
                          row.paused ? 'ResumeReportSchedule' : 'PauseReportSchedule',
                          { id: row.id },
                          row.paused ? 'Resumed' : 'Paused',
                        ).then(done);
                      }}
                    >
                      {row.paused
                        ? t('people.insights.reports.resume', 'Resume')
                        : t('people.insights.reports.pause', 'Pause')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={History}
                      onSelect={() => {
                        navigation.navigate('ReportHistory', { id: row.id, name: row.name });
                      }}
                    >
                      {t('people.insights.reports.history', 'History')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={Trash2}
                      destructive
                      onSelect={() => {
                        setDeleting(row);
                      }}
                    >
                      {t('people.insights.reports.delete', 'Delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            >
              {row.name}
            </ListItem>
          ))}
        </List>
      )}
      {open === null ? null : (
        <ScheduleForm
          state={state}
          row={open === 'new' ? null : open}
          onClose={() => {
            setOpen(null);
          }}
          onSaved={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
      {deleting === null ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('people.insights.reports.delete_2', 'Delete {{name}}?', { name: deleting.name })}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'people.insights.reports.nobody_will_receive_it_again_and',
                  'Nobody will receive it again, and its run history is deleted with it.',
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setDeleting(null);
                }}
              >
                {t('people.insights.reports.cancel', 'Cancel')}
              </Button>
              <Button
                className="flex-1"
                variant="danger"
                onPress={() => {
                  const id = deleting.id;
                  setDeleting(null);
                  void act('DeleteReportSchedule', { id }, 'Deleted').then(done);
                }}
              >
                {t('people.insights.reports.delete', 'Delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}

/** A schedule's form, then, when the audience or recipients are new, the warning it needs. */
function ScheduleForm({
  state,
  row,
  onClose,
  onSaved,
}: {
  state: SchedulesState;
  row: ScheduleRow | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOf(row));
  const [confirming, setConfirming] = useState(false);
  const set = (patch: Partial<ScheduleDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const segments = state.segments.filter((s) =>
    draft.kind === 'summary' ? s.forSummary : s.forExport,
  );
  const audience = draft.segmentId ?? (draft.filter.length > 0 ? 'filter' : 'everybody');
  const ready = draft.name.trim() !== '' && draft.recipients.length > 0;
  const saving = busy === 'CreateReportSchedule' || busy === 'UpdateReportSchedule';
  const save = (): void => {
    const variables = scheduleVariables({ ...draft, name: draft.name.trim() });
    void (
      row === null
        ? act('CreateReportSchedule', variables, 'Scheduled')
        : act('UpdateReportSchedule', { id: row.id, ...variables }, 'Saved')
    ).then((made) => {
      setConfirming(false);
      if (made !== null) onSaved();
    });
  };
  const select = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    items: readonly (readonly [string, string])[],
  ): React.JSX.Element => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" accessibilityLabel={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  if (confirming) {
    return (
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) setConfirming(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                'people.insights.reports.each_recipient_gets_only_what_they',
                'Each recipient gets only what they may see',
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                'people.insights.reports.confirm_before_this_schedule_is_saved',
                'Confirm before this schedule is saved.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Text>
              {t(
                'people.insights.reports.this_report_is_built_again_for',
                {
                  one: 'This report is built again for each of its {{count}} recipient, every time it runs, as that person. Each one gets only the people they may list and the columns they may read — so different recipients may receive different people and different columns, and a manager’s file can be much shorter than HR’s.',
                  other:
                    'This report is built again for each of its {{count}} recipients, every time it runs, as that person. Each one gets only the people they may list and the columns they may read — so different recipients may receive different people and different columns, and a manager’s file can be much shorter than HR’s.',
                },
                { count: draft.recipients.length },
              )}
            </Text>
            <Text>
              {t(
                'people.insights.reports.people_who_have_left_or_lost',
                'People who have left or lost access receive nothing. Emails contain a sign-in link, never data.',
              )}
            </Text>
          </DialogBody>
          <DialogFooter>
            <Button
              className="flex-1"
              onPress={() => {
                setConfirming(false);
              }}
            >
              {t('people.insights.reports.back', 'Back')}
            </Button>
            <Button className="flex-1" variant="primary" loading={saving} onPress={save}>
              {t('people.insights.reports.save_it', 'Save it')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {row === null
              ? t('people.insights.reports.new_scheduled_report', 'New scheduled report')
              : t('people.insights.reports.edit_2', 'Edit {{name}}', { name: row.name })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'people.insights.reports.it_first_goes_out_at_its',
              'It first goes out at its next time, not when it is saved.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 440 }} contentContainerClassName="gap-4">
            <Field required>
              <FieldLabel>{t('people.insights.reports.name', 'Name')}</FieldLabel>
              <Input
                value={draft.name}
                maxLength={80}
                size="sm"
                onChange={(name) => {
                  set({ name });
                }}
              />
              <FieldDescription>
                {t(
                  'people.insights.reports.only_you_and_other_hr_see',
                  'Only you and other HR see it; it is not in the email.',
                )}
              </FieldDescription>
            </Field>
            <RadioGroup
              accessibilityLabel={t('people.insights.reports.report', 'Report')}
              value={draft.kind === 'summary' ? 'summary' : draft.format}
              onValueChange={(value) => {
                if (value === 'summary') set({ kind: 'summary', segmentId: null, filter: [] });
                else set({ kind: 'export', format: value === 'pdf' ? 'pdf' : 'xlsx' });
              }}
            >
              <RadioCard
                value="xlsx"
                description={t(
                  'people.insights.reports.for_a_person_to_read_and',
                  'For a person to read and edit.',
                )}
              >
                {t('people.insights.reports.excel_file', 'Excel file')}
              </RadioCard>
              <RadioCard
                value="pdf"
                description={t('people.insights.reports.to_print_or_file', 'To print or file.')}
              >
                {t('people.insights.reports.pdf_roster', 'PDF roster')}
              </RadioCard>
              <RadioCard
                value="summary"
                description={t(
                  'people.insights.reports.headcount_movement_and_completeness_read_signed',
                  'Headcount, movement and completeness, read signed in.',
                )}
              >
                {t('people.insights.reports.summary', 'Summary')}
              </RadioCard>
            </RadioGroup>
            {draft.kind === 'export' ? (
              <>
                <Field>
                  <FieldLabel>{t('people.insights.reports.fields', 'Fields')}</FieldLabel>
                  <Combobox
                    label={t('people.insights.reports.fields', 'Fields')}
                    multiple
                    size="sm"
                    placeholder={t(
                      'people.insights.reports.every_field_each_recipient_may_read',
                      'Every field each recipient may read',
                    )}
                    options={state.fields.map((f) => ({ value: f.key, label: f.label }))}
                    value={draft.fields ?? []}
                    onChange={(value) => {
                      const keys = Array.isArray(value) ? (value as readonly string[]) : [];
                      set({ fields: keys.length === 0 ? null : keys });
                    }}
                  />
                  <FieldDescription>
                    {t(
                      'people.insights.reports.leave_empty_for_every_field_a',
                      'Leave empty for every field. A recipient who cannot read a field gets the file without it.',
                    )}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>{t('people.insights.reports.reason', 'Reason')}</FieldLabel>
                  <Input
                    value={draft.reason ?? ''}
                    maxLength={500}
                    size="sm"
                    onChange={(reason) => {
                      set({ reason: reason === '' ? null : reason });
                    }}
                  />
                  <FieldDescription>
                    {t(
                      'people.insights.reports.needed_when_pay_or_a_bank',
                      'Needed when pay or a bank account is in the file; kept with every run.',
                    )}
                  </FieldDescription>
                </Field>
              </>
            ) : null}
            {select(
              'About',
              audience,
              (value) => {
                if (value === 'everybody') set({ segmentId: null, filter: [] });
                else if (value !== 'filter') set({ segmentId: value, filter: [] });
              },
              [
                [
                  'everybody',
                  t(
                    'people.insights.reports.everybody_each_recipient_may_see',
                    'Everybody each recipient may see',
                  ),
                ],
                ...(row !== null && row.filter.length > 0
                  ? [
                      [
                        'filter',
                        t(
                          'people.insights.reports.the_filter_it_was_saved_with',
                          'The filter it was saved with',
                        ),
                      ] as const,
                    ]
                  : []),
                ...segments.map((s) => [s.id, s.name] as const),
              ],
            )}
            {select(
              t('people.insights.reports.how_often', 'How often'),
              draft.every,
              (value) => {
                set({ every: value === 'day' ? 'day' : value === 'month' ? 'month' : 'week' });
              },
              [
                ['day', 'Daily'],
                ['week', 'Weekly'],
                ['month', 'Monthly'],
              ],
            )}
            {draft.every === 'week'
              ? select(
                  'On',
                  String(draft.weekday),
                  (value) => {
                    set({ weekday: Number(value) });
                  },
                  WEEKDAYS().map((name, i) => [String(i + 1), name] as const),
                )
              : null}
            {draft.every === 'month'
              ? select(
                  t('people.insights.reports.day_of_the_month', 'Day of the month'),
                  String(draft.day),
                  (value) => {
                    set({ day: Number(value) });
                  },
                  Array.from({ length: 28 }, (_, i) => [String(i + 1), String(i + 1)] as const),
                )
              : null}
            {select(
              'At',
              String(draft.hour),
              (value) => {
                set({ hour: Number(value) });
              },
              Array.from({ length: 24 }, (_, h) => [String(h), hh(h)] as const),
            )}
            {state.legalEntities.length === 0
              ? null
              : select(
                  t('people.insights.reports.on_whose_clock', 'On whose clock'),
                  draft.legalEntityId ?? 'default',
                  (value) => {
                    set({ legalEntityId: value === 'default' ? null : value });
                  },
                  [
                    [
                      'default',
                      t(
                        'people.insights.reports.the_companys_default_time_zone',
                        'The company’s default time zone',
                      ),
                    ],
                    ...state.legalEntities.map((e) => [e.id, e.name] as const),
                  ],
                )}
            <Field required>
              <FieldLabel>{t('people.insights.reports.recipients', 'Recipients')}</FieldLabel>
              <Combobox
                label={t('people.insights.reports.recipients', 'Recipients')}
                multiple
                size="sm"
                placeholder={t(
                  'people.insights.reports.pick_up_to_25_people',
                  'Pick up to 25 people',
                )}
                options={state.people.map((p) => ({
                  value: p.accountId,
                  label:
                    p.name ??
                    p.workEmail ??
                    t(
                      'people.insights.reports.somebody_without_a_name_yet',
                      'Somebody without a name yet',
                    ),
                  ...(p.name !== null && p.workEmail !== null ? { description: p.workEmail } : {}),
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
              <FieldDescription>{EACH_SEES_THEIR_OWN}</FieldDescription>
            </Field>
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.insights.reports.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={!ready}
            loading={saving}
            onPress={() => {
              if (needsConfirmation(row, draft)) setConfirming(true);
              else save();
            }}
          >
            {t('people.insights.reports.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Run {
  readonly period: string;
  readonly missed: number;
  readonly outcome: string | null;
  readonly recipients: readonly {
    accountId: string | null;
    name: string | null;
    outcome: string;
  }[];
}

/** Why a recipient or a run got nothing, in words. */
const WHY: Record<string, string> = {
  sent: 'sent',
  failed: 'the email failed',
  not_eligible: 'has left, or has no work email',
  FIELD_NOT_FILTERABLE: 'may not filter by this audience',
  NOT_A_VIEWER: 'has nothing to see in the summary',
  EXPORT_REASON_REQUIRED: 'the file needs a reason',
  owner_not_allowed: 'its owner no longer manages People',
  segment_gone: 'its segment was deleted',
};

/** A schedule's runs, newest first, older ones on Show older. */
export function ReportHistory({
  navigation,
  route,
}: PeopleScreen<'ReportHistory'>): React.JSX.Element {
  const signed = useSigned();
  const [runs, setRuns] = useState<readonly Run[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const page = async (before: string | null): Promise<void> => {
    const answer = await ask<{ runs: Run[]; next: string | null }>(signed, 'ReportRuns', {
      id: route.params.id,
      before,
    });
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    setRuns((held) => [...(before === null ? [] : (held ?? [])), ...answer.data.runs]);
    setNext(answer.data.next);
  };
  useEffect(() => {
    void page(null);
  }, [signed, route.params.id]);

  const back = {
    label: t('people.insights.reports.reports', 'Reports'),
    onPress: navigation.goBack,
  };
  if (failed !== null) {
    return (
      <Page title={route.params.name} back={back}>
        <Failed
          message={failed}
          onRetry={() => {
            setFailed(null);
            void page(null);
          }}
        />
      </Page>
    );
  }
  return (
    <Page title={route.params.name} back={back}>
      {runs === null ? (
        <Loading label={t('people.insights.reports.loading_the_runs', 'Loading the runs')} />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={History}
          title={t('people.insights.reports.not_run_yet', 'Not run yet')}
          description={t(
            'people.insights.reports.it_first_goes_out_at_its_2',
            'It first goes out at its next time after it was saved.',
          )}
        />
      ) : (
        <>
          <Text variant="footnote" tone="muted">
            {t(
              'people.insights.reports.each_run_newest_first_a_run',
              'Each run, newest first. A run after the backend slept covers the periods it missed; only the latest is sent.',
            )}
          </Text>
          <List>
            {runs.map((run) => {
              const outcome = outcomeOf(run.outcome);
              return (
                <ListItem
                  key={run.period}
                  description={[
                    run.missed > 0
                      ? t(
                          'people.insights.reports.covers_earlier_periods',
                          {
                            one: 'Covers {{count}} earlier period',
                            other: 'Covers {{count}} earlier periods',
                          },
                          { count: run.missed },
                        )
                      : null,
                    ...run.recipients.map((r) =>
                      r.accountId === null
                        ? (WHY[r.outcome] ?? r.outcome)
                        : `${r.name ?? t('people.insights.reports.somebody_who_has_left', 'Somebody who has left')}: ${WHY[r.outcome] ?? r.outcome}`,
                    ),
                  ]
                    .filter((x) => x !== null)
                    .join('\n')}
                  trailing={
                    <Badge size="sm" tone={outcome.tone}>
                      {outcome.label}
                    </Badge>
                  }
                >
                  {run.period}
                </ListItem>
              );
            })}
          </List>
          {next === null ? null : (
            <Button
              loading={more}
              onPress={() => {
                setMore(true);
                void page(next).then(() => {
                  setMore(false);
                });
              }}
            >
              {t('people.insights.reports.show_older', 'Show older')}
            </Button>
          )}
        </>
      )}
    </Page>
  );
}
