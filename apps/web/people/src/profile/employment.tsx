import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  PageSection,
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
  Textarea,
  type IsoDate,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import type { Outcome } from '../load';

/**
 * HR's view of somebody's employment (PEO-119, PEO-120): whose day it is for
 * them, where they stand, every employment period, and the moves §8.1 allows
 * from here. Only HR is sent any of it; anybody else's profile has no such
 * section, not an empty one.
 *
 * The buttons offered follow the status, and People decides whether a move
 * may happen: a refusal is shown as it was worded. Every date is a day on the
 * person's own calendar, which is why their day is shown first.
 */

export type LeavingReason = 'resigned' | 'dismissed' | 'end_of_contract';

export interface EmploymentPeriod {
  readonly period: number;
  readonly startedOn: string;
  readonly lastWorkingDay: string | null;
  readonly leavingReason: LeavingReason | null;
  readonly eligibleForRehire: boolean | null;
  readonly noticeFrom: string | null;
  readonly rehireOverrideReason: string | null;
}

export interface EmploymentState {
  readonly calendar: { readonly today: string; readonly timeZone: string };
  readonly employment: {
    readonly status: string;
    readonly periods: readonly EmploymentPeriod[];
  } | null;
}

export type LifecycleMove =
  | { readonly kind: 'giveNotice'; readonly lastWorkingDay: string; readonly reason?: LeavingReason }
  | { readonly kind: 'withdrawNotice' }
  | {
      readonly kind: 'terminate';
      readonly lastWorkingDay: string;
      readonly reason: LeavingReason;
      readonly note?: string;
      readonly eligibleForRehire?: boolean;
      readonly endAccessNow?: boolean;
    }
  | { readonly kind: 'endAccess' }
  | { readonly kind: 'startLeave' }
  | { readonly kind: 'endLeave' }
  | { readonly kind: 'discard' }
  | { readonly kind: 'rehire'; readonly startDate: string; readonly overrideReason?: string };

const STATUS: Record<string, string> = {
  provisional: 'Provisional',
  pre_hire: 'Starting soon',
  active: 'Active',
  on_leave: 'On leave',
  notice: 'On notice',
  terminated: 'Left',
  discarded: 'Discarded',
};

const REASONS: readonly { readonly value: LeavingReason; readonly label: string }[] = [
  { value: 'resigned', label: 'Resigned' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'end_of_contract', label: 'End of contract' },
];

const reasonLabel = (r: LeavingReason | null): string =>
  REASONS.find((x) => x.value === r)?.label ?? '—';

type Asking = LifecycleMove['kind'];

/** The calendar day after one: arithmetic on the date alone, no zone involved. */
export function dayAfter(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** What each status may move to (§8.1). People refuses anything else anyway. */
const OFFERED: Record<string, readonly Asking[]> = {
  provisional: ['discard'],
  pre_hire: ['terminate'],
  active: ['giveNotice', 'startLeave', 'terminate'],
  on_leave: ['endLeave', 'giveNotice', 'terminate'],
  notice: ['withdrawNotice', 'terminate'],
  terminated: ['rehire', 'endAccess'],
};

const LABEL: Record<Asking, string> = {
  giveNotice: 'Give notice',
  withdrawNotice: 'Withdraw notice',
  terminate: 'Terminate',
  endAccess: 'End access now',
  startLeave: 'Start leave',
  endLeave: 'End leave',
  discard: 'Discard record',
  rehire: 'Rehire',
};

export function Employment({
  state,
  onMove,
}: {
  readonly state: EmploymentState;
  /** Absent on one's own profile: nobody moves their own employment. */
  readonly onMove?: ((move: LifecycleMove) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const [asking, setAsking] = useState<Asking | null>(null);
  const { calendar, employment } = state;
  const offered = employment === null ? [] : (OFFERED[employment.status] ?? []);
  const periods = employment?.periods ?? [];

  return (
    <PageSection
      surface
      title="Employment"
      actions={
        employment === null ? undefined : (
          <Badge tone={employment.status === 'active' ? 'success' : 'neutral'}>
            {STATUS[employment.status] ?? employment.status}
          </Badge>
        )
      }
    >
      <Stack gap={4}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
          <dt className="text-sm text-fg-muted">Their day</dt>
          <dd className="text-sm" data-testid="their-day">
            {calendar.today} ({calendar.timeZone})
          </dd>
        </dl>
        {periods.length === 0 ? null : (
          <Table aria-label="Employment periods">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Last working day</TableHead>
                <TableHead>Why they left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((p) => (
                <TableRow key={p.period}>
                  <TableCell>{p.period}</TableCell>
                  <TableCell>{p.startedOn}</TableCell>
                  <TableCell>{p.lastWorkingDay ?? '—'}</TableCell>
                  <TableCell>
                    {reasonLabel(p.leavingReason)}
                    {p.eligibleForRehire === false ? (
                      <span className="block text-fg-muted text-sm">Not eligible for rehire</span>
                    ) : null}
                    {p.rehireOverrideReason === null ? null : (
                      <span className="block text-fg-muted text-sm">
                        Rehired anyway: {p.rehireOverrideReason}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {onMove === undefined || offered.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {offered.map((kind) => (
              <Button
                key={kind}
                variant={kind === 'terminate' || kind === 'discard' ? 'destructive' : 'secondary'}
                onClick={() => {
                  setAsking(kind);
                }}
              >
                {LABEL[kind]}
              </Button>
            ))}
          </div>
        )}
      </Stack>
      {asking === null || onMove === undefined ? null : (
        <MoveDialog
          kind={asking}
          today={calendar.today}
          lastPeriod={periods.at(-1) ?? null}
          onMove={onMove}
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
    </PageSection>
  );
}

function ReasonSelect({
  value,
  onChange,
  required,
  invalid,
}: {
  readonly value: LeavingReason | '';
  readonly onChange: (r: LeavingReason) => void;
  readonly required: boolean;
  readonly invalid: boolean;
}): JSX.Element {
  return (
    <Field required={required} invalid={invalid}>
      <FieldLabel>Reason</FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => {
          onChange(v as LeavingReason);
        }}
      >
        <FieldControl>
          <SelectTrigger>
            <SelectValue placeholder="Choose a reason" />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {REASONS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError>Choose why they are leaving.</FieldError>
    </Field>
  );
}

function MoveDialog({
  kind,
  today,
  lastPeriod,
  onMove,
  onClose,
}: {
  readonly kind: Asking;
  readonly today: string;
  readonly lastPeriod: EmploymentPeriod | null;
  readonly onMove: (move: LifecycleMove) => Promise<Outcome>;
  readonly onClose: () => void;
}): JSX.Element {
  // A rehire starts after the last working day, so it is offered the day after it at the earliest.
  const [day, setDay] = useState<IsoDate | null>(
    kind === 'rehire' && lastPeriod?.lastWorkingDay != null
      ? [today, dayAfter(lastPeriod.lastWorkingDay)].toSorted().at(-1) ?? today
      : today,
  );
  const [reason, setReason] = useState<LeavingReason | ''>('');
  const [note, setNote] = useState('');
  const [eligible, setEligible] = useState(true);
  const [endNow, setEndNow] = useState(false);
  const [override, setOverride] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const notEligible = kind === 'rehire' && lastPeriod?.eligibleForRehire === false;
  const needsDay = kind === 'giveNotice' || kind === 'terminate' || kind === 'rehire';
  const problems = {
    day: needsDay && day === null,
    reason: kind === 'terminate' && reason === '',
    override: notEligible && override.trim() === '',
  };
  const invalid = Object.values(problems).some(Boolean);

  const move = (): LifecycleMove => {
    const d = day ?? today;
    switch (kind) {
      case 'giveNotice':
        return { kind, lastWorkingDay: d, ...(reason === '' ? {} : { reason }) };
      case 'terminate':
        return {
          kind,
          lastWorkingDay: d,
          reason: reason === '' ? 'resigned' : reason,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          eligibleForRehire: eligible,
          endAccessNow: endNow,
        };
      case 'rehire':
        return { kind, startDate: d, ...(notEligible ? { overrideReason: override.trim() } : {}) };
      default:
        return { kind };
    }
  };

  const WHAT: Record<Asking, string> = {
    giveNotice: 'They stay employed until the end of their last working day.',
    withdrawNotice: 'They go back to the status they held before notice.',
    terminate:
      'Their employment ends; their access ends at the end of the last working day unless you end it now.',
    endAccess: 'They can no longer sign in, from now. Their record stays.',
    startLeave: 'They are on leave from today, on their calendar.',
    endLeave: 'They are back from today, on their calendar.',
    discard: 'This provisional record was never a person. It is withdrawn.',
    rehire: 'A new employment period on the same record, starting on this day.',
  };

  const body: ReactNode[] = [];
  if (needsDay) {
    body.push(
      <div key="day" className="flex flex-col gap-1.5">
        <DatePicker
          label={kind === 'rehire' ? 'Start date' : 'Last working day'}
          value={day}
          onChange={setDay}
        />
        <p className="text-fg-muted text-xs">A day on their calendar; today there is {today}.</p>
      </div>,
    );
  }
  if (kind === 'giveNotice' || kind === 'terminate') {
    body.push(
      <ReasonSelect
        key="reason"
        value={reason}
        onChange={setReason}
        required={kind === 'terminate'}
        invalid={shown && problems.reason}
      />,
    );
  }
  if (kind === 'terminate') {
    body.push(
      <Field key="note">
        <FieldLabel>Note</FieldLabel>
        <FieldControl>
          <Textarea
            value={note}
            maxLength={500}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FieldControl>
        <FieldDescription>Kept with the termination. Optional.</FieldDescription>
      </Field>,
      <Field key="eligible" orientation="horizontal">
        <FieldControl>
          <Checkbox
            checked={eligible}
            onCheckedChange={(on) => {
              setEligible(on === true);
            }}
          />
        </FieldControl>
        <FieldLabel>Eligible for rehire</FieldLabel>
      </Field>,
      <Field key="now" orientation="horizontal">
        <FieldControl>
          <Checkbox
            checked={endNow}
            onCheckedChange={(on) => {
              setEndNow(on === true);
            }}
          />
        </FieldControl>
        <FieldLabel>End their access now</FieldLabel>
      </Field>,
    );
  }
  if (notEligible) {
    body.push(
      <Alert key="warn" tone="warning">
        Their last employment ended marked not eligible for rehire.
      </Alert>,
      <Field key="override" required invalid={shown && problems.override}>
        <FieldLabel>Why rehire them anyway</FieldLabel>
        <FieldControl>
          <Textarea
            value={override}
            maxLength={500}
            onChange={(e) => {
              setOverride(e.target.value);
            }}
          />
        </FieldControl>
        <FieldDescription>Kept on the new period and audited.</FieldDescription>
        <FieldError>Say why.</FieldError>
      </Field>,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{LABEL[kind]}</DialogTitle>
          <DialogDescription>{WHAT[kind]}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            {body}
            {refused === null ? null : (
              <Alert tone="danger" title="Not done">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={kind === 'terminate' || kind === 'discard' ? 'destructive' : 'primary'}
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              setShown(true);
              if (invalid) return;
              setBusy(true);
              setRefused(null);
              void onMove(move()).then((outcome) => {
                setBusy(false);
                if (outcome.ok) onClose();
                else setRefused(outcome.message);
              });
            }}
          >
            {LABEL[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
