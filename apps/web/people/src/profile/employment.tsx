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
import { longDate } from '../record/display';

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
  | { readonly kind: 'rehire'; readonly startDate: string; readonly overrideReason?: string }
  | {
      readonly kind: 'hire';
      readonly hireDate: string;
      readonly legalEntityId?: string;
      readonly locationId?: string;
    };

/** Where a person sits and where they may go (PEO-123), for HR only. */
export interface PlacementState {
  readonly legalEntityId: string | null;
  readonly locationId: string | null;
  readonly entities: readonly { readonly value: string; readonly label: string }[];
  readonly locations: readonly {
    readonly value: string;
    readonly label: string;
    readonly legalEntityId: string;
  }[];
}

const STATUS: Record<string, string> = {
  provisional: 'Provisional',
  pre_hire: 'Starting soon',
  active: 'Active',
  on_leave: 'On leave',
  notice: 'On notice',
  terminated: 'Left',
  discarded: 'Discarded',
  merged: 'Merged into another record',
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
  provisional: ['hire', 'discard'],
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
  hire: 'Hire',
};

export function Employment({
  state,
  onMove,
  name,
  placement,
}: {
  readonly state: EmploymentState;
  /** Absent on one's own profile: nobody moves their own employment. */
  readonly onMove?: ((move: LifecycleMove) => Promise<Outcome>) | undefined;
  /** Who this is, for a hire to say what it will do. */
  readonly name?: string | undefined;
  /** Where they sit: a hire asks for it when they sit nowhere yet. */
  readonly placement?: PlacementState | null | undefined;
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
          name={name ?? 'They'}
          placement={placement ?? null}
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
  name,
  placement,
  onMove,
  onClose,
}: {
  readonly kind: Asking;
  readonly today: string;
  readonly lastPeriod: EmploymentPeriod | null;
  readonly name: string;
  readonly placement: PlacementState | null;
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
  const [entity, setEntity] = useState('');
  const [location, setLocation] = useState('');
  // A hire places somebody who sits nowhere, where the tenant has somewhere to put them.
  const places =
    kind === 'hire' &&
    placement !== null &&
    placement.legalEntityId === null &&
    placement.entities.length > 0;
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const notEligible = kind === 'rehire' && lastPeriod?.eligibleForRehire === false;
  const needsDay =
    kind === 'giveNotice' || kind === 'terminate' || kind === 'rehire' || kind === 'hire';
  const problems = {
    day: needsDay && day === null,
    entity: places && entity === '',
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
      case 'hire':
        return {
          kind,
          hireDate: d,
          ...(places && entity !== '' ? { legalEntityId: entity } : {}),
          ...(places && location !== '' ? { locationId: location } : {}),
        };
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
    hire: 'Their employment starts on this day, on their calendar: past or future.',
  };

  const body: ReactNode[] = [];
  if (needsDay) {
    body.push(
      <div key="day" className="flex flex-col gap-1.5">
        <DatePicker
          label={kind === 'rehire' || kind === 'hire' ? 'Start date' : 'Last working day'}
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
  if (places) {
    body.push(
      <PlacementPickers
        key="placement"
        placement={placement}
        entity={entity}
        location={location}
        onEntity={setEntity}
        onLocation={setLocation}
        required
        invalid={shown && problems.entity}
      />,
    );
  }
  if (kind === 'hire' && day !== null) {
    body.push(
      <Alert key="what" tone="info">
        {day <= today
          ? `${name} becomes an employee from ${longDate(day)}.`
          : `${name} is pre-hire until ${longDate(day)}, and an employee from then.`}
      </Alert>,
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

/**
 * A legal entity and one of its work locations (PEO-123): a location names
 * its entity, so choosing one sets the other, and an entity keeps only its
 * own locations on offer.
 */
export function PlacementPickers({
  placement,
  entity,
  location,
  onEntity,
  onLocation,
  required = false,
  invalid = false,
  locationHint,
  who,
}: {
  readonly placement: Pick<PlacementState, 'entities' | 'locations'>;
  readonly entity: string;
  readonly location: string;
  readonly onEntity: (entity: string) => void;
  readonly onLocation: (location: string) => void;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly locationHint?: string;
  /** Whose placement, in a list of people: the labels name them, and are read rather than shown. */
  readonly who?: string;
}): JSX.Element {
  const label = (what: string) =>
    who === undefined ? (
      <FieldLabel>{what}</FieldLabel>
    ) : (
      <FieldLabel className="sr-only">{`${what} for ${who}`}</FieldLabel>
    );
  const offices = placement.locations.filter((l) => entity === '' || l.legalEntityId === entity);
  return (
    <>
      <Field required={required} invalid={invalid}>
        {label('Legal entity')}
        <Select
          value={entity}
          onValueChange={(next) => {
            onEntity(next);
            if (!placement.locations.some((l) => l.value === location && l.legalEntityId === next)) {
              onLocation('');
            }
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {placement.entities.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError>Choose where they are employed.</FieldError>
      </Field>
      <Field>
        {label('Work location')}
        <Select
          value={location}
          onValueChange={(next) => {
            onLocation(next);
            const office = placement.locations.find((l) => l.value === next);
            if (office) onEntity(office.legalEntityId);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {offices.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {locationHint === undefined ? null : <FieldDescription>{locationHint}</FieldDescription>}
      </Field>
    </>
  );
}
