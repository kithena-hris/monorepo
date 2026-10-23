import {
  Alert,
  Card,
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
  Input,
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
import { t } from '../i18n';

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
  /** `now`: when People answered, what their local time is read from. Absent from an older People. */
  readonly calendar: { readonly today: string; readonly timeZone: string; readonly now?: string };
  readonly employment: {
    readonly status: string;
    readonly periods: readonly EmploymentPeriod[];
  } | null;
}

export type LifecycleMove =
  | {
      readonly kind: 'giveNotice';
      readonly lastWorkingDay: string;
      readonly reason?: LeavingReason;
    }
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
  provisional: t('profile.employment.provisional', 'Provisional'),
  pre_hire: t('profile.employment.starting_soon', 'Starting soon'),
  active: t('profile.employment.active', 'Active'),
  on_leave: t('profile.employment.on_leave', 'On leave'),
  notice: t('profile.employment.on_notice', 'On notice'),
  terminated: t('profile.employment.left', 'Left'),
  discarded: t('profile.employment.discarded', 'Discarded'),
  merged: t('profile.employment.merged_into_another_record', 'Merged into another record'),
};

const REASONS: readonly { readonly value: LeavingReason; readonly label: string }[] = [
  { value: 'resigned', label: t('profile.employment.resigned', 'Resigned') },
  { value: 'dismissed', label: t('profile.employment.dismissed', 'Dismissed') },
  { value: 'end_of_contract', label: t('profile.employment.end_of_contract', 'End of contract') },
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
  giveNotice: t('profile.employment.give_notice', 'Give notice'),
  withdrawNotice: t('profile.employment.withdraw_notice', 'Withdraw notice'),
  terminate: t('profile.employment.terminate', 'Terminate'),
  endAccess: t('profile.employment.end_access_now', 'End access now'),
  startLeave: t('profile.employment.start_leave', 'Start leave'),
  endLeave: t('profile.employment.end_leave', 'End leave'),
  discard: t('profile.employment.discard_record', 'Discard record'),
  rehire: t('profile.employment.rehire', 'Rehire'),
  hire: t('profile.employment.hire', 'Hire'),
};

/** The status in words: "Provisional", "On notice". */
export function statusLabel(status: string): string {
  return STATUS[status] ?? status;
}

/** A lifecycle move somebody may be asked for. */
export type MoveKind = Asking;

/** The moves §8.1 allows from a status, in the order offered. People refuses anything else anyway. */
export function offeredMoves(status: string | null): readonly MoveKind[] {
  return status === null ? [] : (OFFERED[status] ?? []);
}

/** A move in words: "Give notice". */
export function moveLabel(kind: MoveKind): string {
  return LABEL[kind];
}

/** A move that ends or withdraws somebody's employment: marked as such wherever it is offered. */
export function isDestructiveMove(kind: MoveKind): boolean {
  return kind === 'terminate' || kind === 'discard';
}

/**
 * The dialog for one move: it asks for what the move needs, says what it will
 * do, and shows People's refusal as it was worded. Every date is a day on the
 * person's own calendar.
 */
export function EmploymentMove({
  kind,
  state,
  onMove,
  name,
  placement,
  onClose,
}: {
  readonly kind: MoveKind;
  readonly state: EmploymentState;
  readonly onMove: (move: LifecycleMove) => Promise<Outcome>;
  /** Who this is, for a hire to say what it will do. */
  readonly name?: string | undefined;
  /** Where they sit: a hire asks for it when they sit nowhere yet. */
  readonly placement?: PlacementState | null | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <MoveDialog
      kind={kind}
      today={state.calendar.today}
      timeZone={state.calendar.timeZone}
      lastPeriod={state.employment?.periods.at(-1) ?? null}
      name={name ?? 'They'}
      placement={placement ?? null}
      onMove={onMove}
      onClose={onClose}
    />
  );
}

/**
 * Every employment period, once there is more than one: somebody who left and
 * came back. One period says nothing the start date does not.
 */
export function EmploymentPeriods({
  periods,
}: {
  readonly periods: readonly EmploymentPeriod[];
}): JSX.Element | null {
  if (periods.length < 2) return null;
  return (
    <PageSection surface title={t('profile.employment.employment_periods', 'Employment periods')}>
      <Table aria-label={t('profile.employment.employment_periods', 'Employment periods')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('profile.employment.started', 'Started')}</TableHead>
            <TableHead>{t('profile.employment.last_working_day', 'Last working day')}</TableHead>
            <TableHead>{t('profile.employment.why_they_left', 'Why they left')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.toReversed().map((p) => (
            <TableRow key={p.period}>
              <TableCell>{longDate(p.startedOn)}</TableCell>
              <TableCell>
                {p.lastWorkingDay === null
                  ? t('profile.employment.current', 'Current')
                  : longDate(p.lastWorkingDay)}
              </TableCell>
              <TableCell>
                {p.lastWorkingDay === null ? '—' : reasonLabel(p.leavingReason)}
                {p.eligibleForRehire === false ? (
                  <span className="block text-fg-muted text-sm">
                    {t('profile.employment.not_eligible_for_rehire', 'Not eligible for rehire')}
                  </span>
                ) : null}
                {p.rehireOverrideReason === null ? null : (
                  <span className="block text-fg-muted text-sm">
                    {t('profile.employment.rehired_anyway', 'Rehired anyway:')}{' '}
                    {p.rehireOverrideReason}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <FieldLabel>{t('profile.employment.reason', 'Reason')}</FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => {
          onChange(v as LeavingReason);
        }}
      >
        <FieldControl>
          <SelectTrigger>
            <SelectValue placeholder={t('profile.employment.choose_a_reason', 'Choose a reason')} />
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
      <FieldError>
        {t('profile.employment.choose_why_they_are_leaving', 'Choose why they are leaving.')}
      </FieldError>
    </Field>
  );
}

function MoveDialog({
  kind,
  today,
  timeZone,
  lastPeriod,
  name,
  placement,
  onMove,
  onClose,
}: {
  readonly kind: Asking;
  readonly today: string;
  /** Their calendar's zone: "Europe/Madrid". */
  readonly timeZone: string;
  readonly lastPeriod: EmploymentPeriod | null;
  readonly name: string;
  readonly placement: PlacementState | null;
  readonly onMove: (move: LifecycleMove) => Promise<Outcome>;
  readonly onClose: () => void;
}): JSX.Element {
  // A rehire starts after the last working day, so it is offered the day after it at the earliest.
  const [day, setDay] = useState<IsoDate | null>(
    kind === 'rehire' && lastPeriod?.lastWorkingDay != null
      ? ([today, dayAfter(lastPeriod.lastWorkingDay)].toSorted().at(-1) ?? today)
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

  const first = name.split(' ')[0] ?? name;
  // Their calendar's city, as people say it: "Madrid" from "Europe/Madrid".
  const city = (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ');
  const WHAT: Record<Asking, string> = {
    giveNotice: t(
      'profile.employment.keeps_access_until_the_end_of',
      '{{first}} keeps access until the end of the last working day on their own calendar.',
      { first },
    ),
    withdrawNotice: t(
      'profile.employment.they_go_back_to_the_status',
      'They go back to the status they held before notice.',
    ),
    terminate: t(
      'profile.employment.ends_s_employment_on_the_day',
      'Ends {{first}}’s employment on the day you choose. Their record stays, closed.',
      { first },
    ),
    endAccess: t(
      'profile.employment.they_can_no_longer_sign_in',
      'They can no longer sign in, from now. Their record stays.',
    ),
    startLeave: t(
      'profile.employment.they_are_on_leave_from_today',
      'They are on leave from today, on their calendar.',
    ),
    endLeave: t(
      'profile.employment.they_are_back_from_today_on',
      'They are back from today, on their calendar.',
    ),
    discard: t(
      'profile.employment.this_provisional_record_was_never_a',
      'This provisional record was never a person. It is withdrawn.',
    ),
    rehire: t(
      'profile.employment.a_new_employment_period_on_the',
      'A new employment period on the same record, starting on this day.',
    ),
    hire: t(
      'profile.employment.is_pre_hire_until_the_start',
      '{{first}} is pre-hire until the start date, then an employee from it.',
      { first },
    ),
  };
  const TITLE: Partial<Record<Asking, string>> = {
    giveNotice: t('profile.employment.is_leaving', '{{first}} is leaving', { first }),
    terminate: t('profile.employment.terminate_2', 'Terminate {{name}}', { name }),
    rehire: t('profile.employment.rehire_2', 'Rehire {{name}}', { name }),
    hire: t('profile.employment.is_an_employee', 'Is {{name}} an employee?', { name }),
  };

  const body: ReactNode[] = [];
  const dayField = needsDay ? (
    <Field key="day">
      <FieldLabel>
        {kind === 'rehire' || kind === 'hire'
          ? t('profile.employment.start_date', 'Start date')
          : t('profile.employment.last_working_day', 'Last working day')}
      </FieldLabel>
      <FieldControl>
        <DatePicker
          label={
            kind === 'rehire' || kind === 'hire'
              ? t('profile.employment.start_date', 'Start date')
              : t('profile.employment.last_working_day', 'Last working day')
          }
          value={day}
          onChange={setDay}
          today={today}
        />
      </FieldControl>
      <FieldDescription>
        {t(
          'profile.employment.a_day_on_their_calendar_today',
          'A day on their calendar; today there is',
        )}{' '}
        {longDate(today)}.
      </FieldDescription>
    </Field>
  ) : null;
  if (kind === 'giveNotice' || kind === 'terminate') {
    // The day and the reason, side by side.
    body.push(
      <div key="when" className="grid gap-3 sm:grid-cols-2">
        {dayField}
        <ReasonSelect
          value={reason}
          onChange={setReason}
          required={kind === 'terminate'}
          invalid={shown && problems.reason}
        />
      </div>,
    );
  } else if (dayField !== null) {
    body.push(dayField);
  }
  if (kind === 'terminate') {
    body.push(
      <Field key="note">
        <FieldLabel>{t('profile.employment.note', 'Note')}</FieldLabel>
        <FieldControl>
          <Input
            value={note}
            maxLength={500}
            placeholder={t('profile.employment.optional', 'Optional')}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FieldControl>
      </Field>,
      <div key="flags" className="flex flex-wrap gap-x-6 gap-y-2">
        <Field orientation="horizontal">
          <FieldControl>
            <Checkbox
              checked={eligible}
              onCheckedChange={(on) => {
                setEligible(on === true);
              }}
            />
          </FieldControl>
          <FieldLabel>
            {t('profile.employment.eligible_for_rehire', 'Eligible for rehire')}
          </FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <FieldControl>
            <Checkbox
              checked={endNow}
              onCheckedChange={(on) => {
                setEndNow(on === true);
              }}
            />
          </FieldControl>
          <FieldLabel>
            {t('profile.employment.end_their_access_now', 'End their access now')}
          </FieldLabel>
        </Field>
      </div>,
    );
  }
  if (places) {
    body.push(
      <Alert
        key="nowhere"
        tone="neutral"
        title={t('profile.employment.is_placed_nowhere', '{{first}} is placed nowhere', { first })}
      >
        {t('profile.employment.choose_where_they_work', 'Choose where they work.')}
      </Alert>,
      <div key="placement" className="grid gap-3 sm:grid-cols-2">
        <PlacementPickers
          placement={placement}
          entity={entity}
          location={location}
          onEntity={setEntity}
          onLocation={setLocation}
          required
          invalid={shown && problems.entity}
        />
      </div>,
    );
  }
  if (notEligible) {
    body.push(
      <Alert
        key="warn"
        tone="warning"
        title={t(
          'profile.employment.was_marked_not_eligible_for_rehire',
          '{{first}} was marked not eligible for rehire',
          { first },
        )}
      >
        {t(
          'profile.employment.say_why_you_are_rehiring_anyway',
          'Say why you are rehiring anyway. It’s kept on the record.',
        )}
      </Alert>,
      <Field key="override" required invalid={shown && problems.override}>
        <FieldLabel>
          {t('profile.employment.why_rehire_them_anyway', 'Why rehire them anyway')}
        </FieldLabel>
        <FieldControl>
          <Textarea
            value={override}
            maxLength={500}
            onChange={(e) => {
              setOverride(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{t('profile.employment.say_why', 'Say why.')}</FieldError>
      </Field>,
    );
  }
  // What the move sets going, on their own calendar (D5).
  const happens =
    day === null
      ? null
      : kind === 'hire'
        ? day <= today
          ? t(
              'profile.employment.becomes_an_employee_from',
              '{{name}} becomes an employee from {{longDate}}.',
              { name, longDate: longDate(day) },
            )
          : t(
              'profile.employment.is_pre_hire_until_and_an',
              '{{name}} is pre-hire until {{longDate}}, and an employee from then.',
              { name, longDate: longDate(day) },
            )
        : kind === 'giveNotice' || kind === 'terminate'
          ? t(
              'profile.employment.keeps_access_until_the_end_of_2',
              '{{first}} keeps access until the end of {{longDate}} on their own calendar ({{city}}), not at midnight UTC.{{value}}',
              {
                first,
                longDate: longDate(day),
                city,
                value:
                  kind === 'terminate' && endNow
                    ? ' Their access ends now instead.'
                    : ' You can withdraw this before then.',
              },
            )
          : kind === 'rehire'
            ? t(
                'profile.employment.a_new_employment_period_starts_on',
                'A new employment period starts on {{longDate}}.',
                { longDate: longDate(day) },
              )
            : null;
  if (happens !== null) {
    body.push(
      <Card key="happens" variant="fill" padded>
        <p className="text-sm font-semibold text-fg">
          {t('profile.employment.what_happens', 'What happens')}
        </p>
        <p className="mt-2 text-sm text-fg-muted">{happens}</p>
      </Card>,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-150">
        <DialogHeader>
          <DialogTitle>{TITLE[kind] ?? LABEL[kind]}</DialogTitle>
          <DialogDescription>{WHAT[kind]}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            {body}
            {refused === null ? null : (
              <Alert tone="danger" title={t('profile.employment.not_done', 'Not done')}>
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('profile.employment.cancel', 'Cancel')}</Button>
          <Button
            variant={kind === 'terminate' || kind === 'discard' ? 'destructive' : 'primary'}
            loading={busy}
            loadingLabel={t('profile.employment.saving', 'Saving')}
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
      <FieldLabel className="sr-only">
        {t('profile.employment.for', '{{what}} for {{who}}', { what, who })}
      </FieldLabel>
    );
  const offices = placement.locations.filter((l) => entity === '' || l.legalEntityId === entity);
  return (
    <>
      <Field required={required} invalid={invalid}>
        {label(t('profile.employment.legal_entity', 'Legal entity'))}
        <Select
          value={entity}
          onValueChange={(next) => {
            onEntity(next);
            if (
              !placement.locations.some((l) => l.value === location && l.legalEntityId === next)
            ) {
              onLocation('');
            }
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder={t('profile.employment.choose', 'Choose')} />
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
        <FieldError>
          {t(
            'profile.employment.choose_where_they_are_employed',
            'Choose where they are employed.',
          )}
        </FieldError>
      </Field>
      <Field>
        {label(t('profile.employment.work_location', 'Work location'))}
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
              <SelectValue placeholder={t('profile.employment.choose', 'Choose')} />
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
