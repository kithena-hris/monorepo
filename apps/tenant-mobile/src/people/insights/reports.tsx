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

type Every = 'day' | 'week' | 'month';

interface ScheduleRow {
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

const EACH_SEES_THEIR_OWN = 'Each recipient sees only the people and columns they have access to.';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

function cadenceText(r: Pick<ScheduleRow, 'every' | 'weekday' | 'day' | 'hour'>): string {
  if (r.every === 'week')
    return `Weekly on ${WEEKDAYS[(r.weekday ?? 1) - 1] ?? 'Monday'} at ${hh(r.hour)}`;
  if (r.every === 'month') return `Monthly on day ${String(r.day ?? 1)} at ${hh(r.hour)}`;
  return `Daily at ${hh(r.hour)}`;
}

const RUN_OUTCOME: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  sent: { label: 'Sent', tone: 'success' },
  partial: { label: 'Partly sent', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};
const outcomeOf = (outcome: string | null) =>
  outcome === null
    ? { label: 'Did not finish', tone: 'neutral' as const }
    : (RUN_OUTCOME[outcome] ?? { label: outcome, tone: 'neutral' as const });

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
  const back = { label: 'Insights', onPress: navigation.goBack };
  const done = (made: unknown): void => {
    if (made !== null) reload();
  };

  if (load.status !== 'ready') {
    return (
      <Page title="Scheduled reports" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the scheduled reports" />
        )}
      </Page>
    );
  }
  const state = load.data;
  return (
    <Page
      title="Scheduled reports"
      back={back}
      {...(state.canManage
        ? {
            trailing: (
              <Button
                size="sm"
                variant="primary"
                startIcon={<Icon icon={Plus} />}
                accessibilityLabel="New scheduled report"
                onPress={() => {
                  setOpen('new');
                }}
              />
            ),
          }
        : {})}
    >
      <Text tone="muted">
        A file or the summary, emailed as a link on a cadence. Nobody is sent the data itself.
      </Text>
      {!state.canManage ? (
        <Alert tone="info">Only HR and People administrators schedule reports.</Alert>
      ) : state.schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled reports"
          description="Schedule an Excel file, a PDF roster or the summary for the people who need it."
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
                    ? 'Not run yet'
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
                      accessibilityLabel={`Actions for ${row.name}`}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent label={`Actions for ${row.name}`}>
                    <DropdownMenuItem
                      icon={Pencil}
                      onSelect={() => {
                        setOpen(row);
                      }}
                    >
                      Edit
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
                      {row.paused ? 'Resume' : 'Pause'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={History}
                      onSelect={() => {
                        navigation.navigate('ReportHistory', { id: row.id, name: row.name });
                      }}
                    >
                      History
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={Trash2}
                      destructive
                      onSelect={() => {
                        setDeleting(row);
                      }}
                    >
                      Delete
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
              <DialogTitle>{`Delete ${deleting.name}?`}</DialogTitle>
              <DialogDescription>
                Nobody will receive it again, and its run history is deleted with it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setDeleting(null);
                }}
              >
                Cancel
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
                Delete
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
            <DialogTitle>Each recipient gets only what they may see</DialogTitle>
            <DialogDescription>Confirm before this schedule is saved.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Text>
              {`This report is built again for each of its ${String(draft.recipients.length)} ${
                draft.recipients.length === 1 ? 'recipient' : 'recipients'
              }, every time it runs, as that person. Each one gets only the people they may list and the columns they may read — so different recipients may receive different people and different columns, and a manager’s file can be much shorter than HR’s.`}
            </Text>
            <Text>
              People who have left or lost access receive nothing. Emails contain a sign-in link,
              never data.
            </Text>
          </DialogBody>
          <DialogFooter>
            <Button
              className="flex-1"
              onPress={() => {
                setConfirming(false);
              }}
            >
              Back
            </Button>
            <Button className="flex-1" variant="primary" loading={saving} onPress={save}>
              Save it
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
          <DialogTitle>{row === null ? 'New scheduled report' : `Edit ${row.name}`}</DialogTitle>
          <DialogDescription>
            It first goes out at its next time, not when it is saved.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 440 }} contentContainerClassName="gap-4">
            <Field required>
              <FieldLabel>Name</FieldLabel>
              <Input
                value={draft.name}
                maxLength={80}
                size="sm"
                onChange={(name) => {
                  set({ name });
                }}
              />
              <FieldDescription>
                Only you and other HR see it; it is not in the email.
              </FieldDescription>
            </Field>
            <RadioGroup
              accessibilityLabel="Report"
              value={draft.kind === 'summary' ? 'summary' : draft.format}
              onValueChange={(value) => {
                if (value === 'summary') set({ kind: 'summary', segmentId: null, filter: [] });
                else set({ kind: 'export', format: value === 'pdf' ? 'pdf' : 'xlsx' });
              }}
            >
              <RadioCard value="xlsx" description="For a person to read and edit.">
                Excel file
              </RadioCard>
              <RadioCard value="pdf" description="To print or file.">
                PDF roster
              </RadioCard>
              <RadioCard
                value="summary"
                description="Headcount, movement and completeness, read signed in."
              >
                Summary
              </RadioCard>
            </RadioGroup>
            {draft.kind === 'export' ? (
              <>
                <Field>
                  <FieldLabel>Fields</FieldLabel>
                  <Combobox
                    label="Fields"
                    multiple
                    size="sm"
                    placeholder="Every field each recipient may read"
                    options={state.fields.map((f) => ({ value: f.key, label: f.label }))}
                    value={draft.fields ?? []}
                    onChange={(value) => {
                      const keys = Array.isArray(value) ? (value as readonly string[]) : [];
                      set({ fields: keys.length === 0 ? null : keys });
                    }}
                  />
                  <FieldDescription>
                    Leave empty for every field. A recipient who cannot read a field gets the file
                    without it.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Reason</FieldLabel>
                  <Input
                    value={draft.reason ?? ''}
                    maxLength={500}
                    size="sm"
                    onChange={(reason) => {
                      set({ reason: reason === '' ? null : reason });
                    }}
                  />
                  <FieldDescription>
                    Needed when pay or a bank account is in the file; kept with every run.
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
                ['everybody', 'Everybody each recipient may see'],
                ...(row !== null && row.filter.length > 0
                  ? [['filter', 'The filter it was saved with'] as const]
                  : []),
                ...segments.map((s) => [s.id, s.name] as const),
              ],
            )}
            {select(
              'How often',
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
                  WEEKDAYS.map((name, i) => [String(i + 1), name] as const),
                )
              : null}
            {draft.every === 'month'
              ? select(
                  'Day of the month',
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
                  'On whose clock',
                  draft.legalEntityId ?? 'default',
                  (value) => {
                    set({ legalEntityId: value === 'default' ? null : value });
                  },
                  [
                    ['default', 'The company’s default time zone'],
                    ...state.legalEntities.map((e) => [e.id, e.name] as const),
                  ],
                )}
            <Field required>
              <FieldLabel>Recipients</FieldLabel>
              <Combobox
                label="Recipients"
                multiple
                size="sm"
                placeholder="Pick up to 25 people"
                options={state.people.map((p) => ({
                  value: p.accountId,
                  label: p.name ?? p.workEmail ?? 'Somebody without a name yet',
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
            Cancel
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
            Save
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

  const back = { label: 'Reports', onPress: navigation.goBack };
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
        <Loading label="Loading the runs" />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={History}
          title="Not run yet"
          description="It first goes out at its next time after it was saved."
        />
      ) : (
        <>
          <Text variant="footnote" tone="muted">
            Each run, newest first. A run after the backend slept covers the periods it missed; only
            the latest is sent.
          </Text>
          <List>
            {runs.map((run) => {
              const outcome = outcomeOf(run.outcome);
              return (
                <ListItem
                  key={run.period}
                  description={[
                    run.missed > 0
                      ? `Covers ${String(run.missed)} earlier ${run.missed === 1 ? 'period' : 'periods'}`
                      : null,
                    ...run.recipients.map((r) =>
                      r.accountId === null
                        ? (WHY[r.outcome] ?? r.outcome)
                        : `${r.name ?? 'Somebody who has left'}: ${WHY[r.outcome] ?? r.outcome}`,
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
              Show older
            </Button>
          )}
        </>
      )}
    </Page>
  );
}
