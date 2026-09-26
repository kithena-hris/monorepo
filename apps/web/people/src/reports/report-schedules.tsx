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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipProvider,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';

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
}

/** The sentence every place that names recipients says. */
export const EACH_SEES_THEIR_OWN =
  'Each recipient gets only what they are allowed to see in People. The report is built again for every recipient, so different recipients may receive different people and different columns.';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

export function cadenceText(r: Pick<ScheduleRow, 'every' | 'weekday' | 'day' | 'hour'>): string {
  if (r.every === 'week')
    return `Weekly on ${WEEKDAYS[(r.weekday ?? 1) - 1] ?? 'Monday'} at ${hh(r.hour)}`;
  if (r.every === 'month') return `Monthly on day ${String(r.day ?? 1)} at ${hh(r.hour)}`;
  return `Daily at ${hh(r.hour)}`;
}

const reportText = (r: ScheduleRow): string =>
  r.kind === 'summary' ? 'Summary' : r.format === 'pdf' ? 'PDF roster' : 'Excel file';

const audienceText = (r: ScheduleRow): string =>
  r.segmentId !== null
    ? (r.segmentName ?? 'A segment you cannot see')
    : r.filter.length > 0
      ? r.filter.map((c) => `${c.key}: ${c.value}`).join(', ')
      : 'Everybody';

export const RUN_OUTCOME: Record<
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

export function ReportSchedules(props: ReportSchedulesProps): JSX.Element {
  return (
    <TooltipProvider>
      <Stack gap={6}>
        <PageHeader
          title="Scheduled reports"
          description="A file or the summary, emailed as a link on a cadence. Nobody is sent the data itself."
        />
        <Loaded load={props.load} what="the scheduled reports">
          {(state) => <Schedules {...props} state={state} />}
        </Loaded>
      </Stack>
    </TooltipProvider>
  );
}

type Editing = { readonly row: ScheduleRow | null } | null;

function Schedules({
  state,
  onCreate,
  onUpdate,
  onPause,
  onResume,
  onDelete,
}: ReportSchedulesProps & { readonly state: ReportSchedulesState }): JSX.Element {
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  if (!state.canManage) {
    return <Alert tone="info">Only HR and People administrators schedule reports.</Alert>;
  }

  const act = (outcome: Promise<Outcome>): void => {
    setRefused(null);
    void outcome.then((o) => {
      if (!o.ok) setRefused(o.message);
    });
  };

  return (
    <Stack gap={4}>
      <div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing({ row: null });
          }}
        >
          New scheduled report
        </Button>
      </div>
      {refused === null ? null : (
        <Alert tone="danger" title="Not changed">
          {refused}
        </Alert>
      )}
      {state.schedules.length === 0 ? (
        <EmptyState
          title="No scheduled reports"
          description="Schedule an Excel file, a PDF roster or the summary for the people who need it."
        />
      ) : (
        <Table aria-label="Scheduled reports">
          <TableHeader>
            <TableRow>
              <TableHead>Report</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Recipients</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.schedules.map((row) => {
              const last = row.lastRun === null ? null : outcomeOf(row.lastRun.outcome);
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-fg-muted text-sm">
                        {reportText(row)} · {audienceText(row)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{cadenceText(row)}</TableCell>
                  <TableCell>
                    {row.recipients.map((r) => r.name ?? 'Somebody who has left').join(', ')}
                  </TableCell>
                  <TableCell>
                    {row.lastRun === null || last === null ? (
                      <span className="text-fg-muted">Not yet</span>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={last.tone}>{last.label}</Badge>
                        <span className="text-fg-muted text-sm">{row.lastRun.period}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.paused ? (
                      <Badge tone="neutral">Paused</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing({ row });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          act(row.paused ? onResume(row.id) : onPause(row.id));
                        }}
                      >
                        {row.paused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/people/reports/${row.id}`}>History</a>
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDeleting(row);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {editing === null ? null : (
        <ScheduleForm
          state={state}
          row={editing.row}
          onClose={() => {
            setEditing(null);
          }}
          onSave={(draft) =>
            editing.row === null ? onCreate(draft) : onUpdate(editing.row.id, draft)
          }
        />
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Nobody will receive it again, and its run history is deleted with it.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button>Cancel</Button>
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting !== null) act(onDelete(deleting.id));
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Stack>
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

function ScheduleForm({
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
            <DialogTitle>{row === null ? 'New scheduled report' : `Edit ${row.name}`}</DialogTitle>
            <DialogDescription>
              It first goes out at its next time, not when it is saved.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              <Field required>
                <FieldLabel>Name</FieldLabel>
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
                  Only you and other HR see it; it is not in the email.
                </FieldDescription>
              </Field>

              <RadioGroup
                aria-label="Report"
                value={draft.kind === 'summary' ? 'summary' : draft.format}
                onValueChange={(value) => {
                  if (value === 'summary') set({ kind: 'summary', segmentId: null, filter: [] });
                  else set({ kind: 'export', format: value as 'xlsx' | 'pdf' });
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
                    <FieldControl>
                      <Combobox
                        label="Fields"
                        multiple
                        placeholder="Every field each recipient may read"
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
                      Leave empty for every field. A recipient who cannot read a field gets the file
                      without it.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Reason</FieldLabel>
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
                      Needed when pay or a bank account is in the file; kept with every run.
                    </FieldDescription>
                  </Field>
                </>
              ) : null}

              <Field>
                <FieldLabel>About</FieldLabel>
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
                    <SelectItem value={EVERYBODY}>Everybody each recipient may see</SelectItem>
                    {row !== null && row.filter.length > 0 ? (
                      <SelectItem value={SAVED_FILTER}>The filter it was saved with</SelectItem>
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
                  <FieldLabel>How often</FieldLabel>
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
                      <SelectItem value="day">Daily</SelectItem>
                      <SelectItem value="week">Weekly</SelectItem>
                      <SelectItem value="month">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {draft.every === 'week' ? (
                  <Field>
                    <FieldLabel>On</FieldLabel>
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
                        {WEEKDAYS.map((name, i) => (
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
                    <FieldLabel>Day of the month</FieldLabel>
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
                  <FieldLabel>At</FieldLabel>
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
                  <FieldLabel>On whose clock</FieldLabel>
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
                      <SelectItem value="default">The company’s default time zone</SelectItem>
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
                  <FieldLabel>Recipients</FieldLabel>
                  <Tooltip content={EACH_SEES_THEIR_OWN}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="What each recipient gets"
                      startIcon={<icons.help aria-hidden="true" />}
                    />
                  </Tooltip>
                </div>
                <FieldControl>
                  <Combobox
                    label="Recipients"
                    multiple
                    placeholder="Pick up to 25 people"
                    options={state.people.map((p) => ({
                      value: p.accountId,
                      label: p.name ?? p.workEmail ?? 'Somebody without a name yet',
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
                <FieldDescription>{EACH_SEES_THEIR_OWN}</FieldDescription>
              </Field>

              {refused === null ? null : (
                <Alert tone="danger" title="Not saved">
                  {refused}
                </Alert>
              )}
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!ready}
              loading={busy}
              loadingLabel="Saving"
              onClick={() => {
                if (needsConfirmation(row, draft)) setConfirming(true);
                else save();
              }}
            >
              Save
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
            <DialogTitle>Each recipient gets only what they may see</DialogTitle>
            <DialogDescription>Confirm before this schedule is saved.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={3}>
              <p>
                This report is built again for each of its {String(draft.recipients.length)}{' '}
                {draft.recipients.length === 1 ? 'recipient' : 'recipients'}, every time it runs, as
                that person. Each one gets only the people they may list and the columns they may
                read — so different recipients may receive different people and different columns,
                and a manager’s file can be much shorter than HR’s.
              </p>
              <p>
                Somebody who has left, or can no longer see the report, gets nothing, and its
                history says so. The email carries a link to sign in, never the data.
              </p>
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                setConfirming(false);
              }}
            >
              Back
            </Button>
            <Button variant="primary" loading={busy} loadingLabel="Saving" onClick={save}>
              I understand, save it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
