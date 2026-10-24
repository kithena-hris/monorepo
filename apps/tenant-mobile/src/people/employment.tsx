import {
  Alert,
  Button,
  Card,
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
  FieldDescription,
  FieldError,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Sparkles } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { useAct } from './act';
import { longDate } from './display';
import { t } from '../i18n';

/**
 * Employment moves (design D4, D5), as the web's `profile/employment.tsx`:
 * which moves a status allows (§8.1), what each needs, what it will do, in a
 * centred dialog. People refuses anything else anyway; this only offers what
 * fits.
 */
export type MoveKind =
  | 'giveNotice'
  | 'withdrawNotice'
  | 'terminate'
  | 'endAccess'
  | 'startLeave'
  | 'endLeave'
  | 'discard'
  | 'rehire'
  | 'hire';

const OFFERED: Record<string, readonly MoveKind[]> = {
  provisional: ['hire', 'discard'],
  pre_hire: ['terminate'],
  onboarding: ['terminate'],
  active: ['giveNotice', 'startLeave', 'terminate'],
  on_leave: ['endLeave', 'giveNotice', 'terminate'],
  notice: ['withdrawNotice', 'terminate'],
  terminated: ['rehire', 'endAccess'],
};

export const MOVE_LABEL: Record<MoveKind, string> = {
  get giveNotice(): string {
    return t('people.employment.give_notice', 'Give notice');
  },
  get withdrawNotice(): string {
    return t('people.employment.withdraw_notice', 'Withdraw notice');
  },
  get terminate(): string {
    return t('people.employment.terminate', 'Terminate');
  },
  get endAccess(): string {
    return t('people.employment.end_access_now', 'End access now');
  },
  get startLeave(): string {
    return t('people.employment.start_leave', 'Start leave');
  },
  get endLeave(): string {
    return t('people.employment.end_leave', 'End leave');
  },
  get discard(): string {
    return t('people.employment.discard_record', 'Discard record');
  },
  get rehire(): string {
    return t('people.employment.rehire', 'Rehire');
  },
  get hire(): string {
    return t('people.employment.hire', 'Hire');
  },
};

const OPERATION = (): Record<MoveKind, string> => ({
  giveNotice: 'GiveNotice',
  withdrawNotice: 'WithdrawNotice',
  terminate: 'TerminatePerson',
  endAccess: 'EndPersonAccess',
  startLeave: 'StartLeave',
  endLeave: 'EndLeave',
  discard: 'DiscardPerson',
  rehire: 'RehirePerson',
  hire: 'HirePerson',
});

export const offeredMoves = (status: string | null): readonly MoveKind[] =>
  status === null ? [] : (OFFERED[status] ?? []);

export const isDestructive = (kind: MoveKind): boolean =>
  kind === 'terminate' || kind === 'discard';

const REASONS = () =>
  [
    { value: 'resigned', label: t('people.employment.resigned', 'Resigned') },
    { value: 'dismissed', label: t('people.employment.dismissed', 'Dismissed') },
    { value: 'end_of_contract', label: t('people.employment.end_of_contract', 'End of contract') },
  ] as const;

export interface Period {
  readonly period: number;
  readonly startedOn: string;
  readonly lastWorkingDay: string | null;
  readonly leavingReason: string | null;
  readonly eligibleForRehire: boolean | null;
  readonly rehireOverrideReason: string | null;
}

export interface Placement {
  readonly legalEntityId: string | null;
  readonly locationId: string | null;
  readonly entities: readonly { readonly value: string; readonly label: string }[];
  readonly locations: readonly {
    readonly value: string;
    readonly label: string;
    readonly legalEntityId: string;
  }[];
}

/** The calendar day after one: arithmetic on the date alone. */
function dayAfter(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A legal entity and one of its locations: a location names its entity, so choosing one sets the other. */
export function PlacementPickers({
  placement,
  entity,
  location,
  onEntity,
  onLocation,
  invalid = false,
}: {
  placement: Pick<Placement, 'entities' | 'locations'>;
  entity: string;
  location: string;
  onEntity: (entity: string) => void;
  onLocation: (location: string) => void;
  invalid?: boolean;
}): React.JSX.Element {
  const offices = placement.locations.filter((l) => entity === '' || l.legalEntityId === entity);
  return (
    <>
      <Field required invalid={invalid}>
        <FieldLabel>{t('people.employment.legal_entity', 'Legal entity')}</FieldLabel>
        <Select
          value={entity}
          onValueChange={(next) => {
            onEntity(next);
            if (!placement.locations.some((l) => l.value === location && l.legalEntityId === next))
              onLocation('');
          }}
        >
          <SelectTrigger accessibilityLabel={t('people.employment.legal_entity', 'Legal entity')}>
            <SelectValue placeholder={t('people.employment.choose', 'Choose')} />
          </SelectTrigger>
          <SelectContent>
            {placement.entities.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {invalid ? (
          <FieldError>
            {t(
              'people.employment.choose_where_they_are_employed',
              'Choose where they are employed.',
            )}
          </FieldError>
        ) : null}
      </Field>
      <Field>
        <FieldLabel>{t('people.employment.work_location', 'Work location')}</FieldLabel>
        <Select
          value={location}
          onValueChange={(next) => {
            onLocation(next);
            const office = placement.locations.find((l) => l.value === next);
            if (office) onEntity(office.legalEntityId);
          }}
        >
          <SelectTrigger accessibilityLabel={t('people.employment.work_location', 'Work location')}>
            <SelectValue placeholder={t('people.employment.choose', 'Choose')} />
          </SelectTrigger>
          <SelectContent>
            {offices.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

/** A centred dialog with Cancel and one action, the shape every move and ask takes on a phone. */
function ActionDialog({
  title,
  description,
  action,
  destructive = false,
  busy,
  onAction,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  action: string;
  destructive?: boolean;
  busy: boolean;
  onAction: () => void;
  onClose: () => void;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children === undefined ? null : (
          <DialogBody>
            <Stack gap={3}>{children}</Stack>
          </DialogBody>
        )}
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.employment.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant={destructive ? 'danger' : 'primary'}
            loading={busy}
            onPress={onAction}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One employment move, asking for what it needs and saying what it will do. */
export function MoveDialog({
  kind,
  personId,
  name,
  today,
  timeZone,
  lastPeriod,
  placement,
  reports = 0,
  onClose,
  onDone,
}: {
  kind: MoveKind;
  personId: string;
  name: string;
  today: string;
  timeZone: string;
  lastPeriod: Period | null;
  placement: Placement | null;
  /** How many report to them: a leaver's reports need a new manager. */
  reports?: number;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [day, setDay] = useState<string | null>(
    kind === 'rehire' && lastPeriod?.lastWorkingDay != null
      ? ([today, dayAfter(lastPeriod.lastWorkingDay)].sort().at(-1) ?? today)
      : today,
  );
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [eligible, setEligible] = useState(true);
  const [endNow, setEndNow] = useState(false);
  const [override, setOverride] = useState('');
  const [entity, setEntity] = useState('');
  const [location, setLocation] = useState('');
  const [shown, setShown] = useState(false);

  const first = name.split(' ')[0] ?? name;
  const city = (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ');
  const places =
    kind === 'hire' &&
    placement !== null &&
    placement.legalEntityId === null &&
    placement.entities.length > 0;
  const notEligible = kind === 'rehire' && lastPeriod?.eligibleForRehire === false;
  const needsDay =
    kind === 'giveNotice' || kind === 'terminate' || kind === 'rehire' || kind === 'hire';
  const problems = {
    day: needsDay && day === null,
    entity: places && entity === '',
    reason: kind === 'terminate' && reason === '',
    override: notEligible && override.trim() === '',
  };

  const WHAT: Record<MoveKind, string> = {
    giveNotice: `${first} keeps access until the end of the last working day on their own calendar.`,
    withdrawNotice: t(
      'people.employment.they_go_back_to_the_status',
      'They go back to the status they held before notice.',
    ),
    terminate: t(
      'people.employment.ends_s_employment_on_the_day',
      'Ends {{first}}’s employment on the day you choose. Their record stays, closed.',
      { first },
    ),
    endAccess: t(
      'people.employment.they_can_no_longer_sign_in',
      'They can no longer sign in, from now. Their record stays.',
    ),
    startLeave: t(
      'people.employment.they_are_on_leave_from_today',
      'They are on leave from today, on their calendar.',
    ),
    endLeave: t(
      'people.employment.they_are_back_from_today_on',
      'They are back from today, on their calendar.',
    ),
    discard: t(
      'people.employment.this_provisional_record_was_never_a',
      'This provisional record was never a person. It is withdrawn.',
    ),
    rehire: t(
      'people.employment.a_new_employment_period_on_the',
      'A new employment period on the same record, starting on this day.',
    ),
    hire: `${first} is pre-hire until the start date, then an employee from it.`,
  };
  const TITLE: Partial<Record<MoveKind, string>> = {
    giveNotice: `${first} is leaving`,
    terminate: `Terminate ${name}`,
    rehire: `Rehire ${name}`,
    hire: t('people.employment.is_an_employee', 'Is {{name}} an employee?', { name }),
  };

  const input = (): Record<string, unknown> => {
    const d = day ?? today;
    switch (kind) {
      case 'giveNotice':
        return { lastWorkingDay: d, ...(reason === '' ? {} : { reason }) };
      case 'terminate':
        return {
          lastWorkingDay: d,
          reason,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          eligibleForRehire: eligible,
          endAccessNow: endNow,
        };
      case 'rehire':
        return { startDate: d, ...(notEligible ? { overrideReason: override.trim() } : {}) };
      case 'hire':
        return {
          hireDate: d,
          ...(places && entity !== '' ? { legalEntityId: entity } : {}),
          ...(places && location !== '' ? { locationId: location } : {}),
        };
      default:
        return {};
    }
  };

  const happens =
    day === null
      ? null
      : kind === 'hire'
        ? day <= today
          ? `${name} becomes an employee from ${longDate(day)}.`
          : `${name} is pre-hire until ${longDate(day)}, and an employee from then.`
        : kind === 'giveNotice' || kind === 'terminate'
          ? `${first} keeps access until the end of ${longDate(day)} on their own calendar (${city}).${
              kind === 'terminate' && endNow
                ? t(
                    'people.employment.their_access_ends_now_instead',
                    ' Their access ends now instead.',
                  )
                : t(
                    'people.employment.you_can_withdraw_this_before_then',
                    ' You can withdraw this before then.',
                  )
            }`
          : kind === 'rehire'
            ? t(
                'people.employment.a_new_employment_period_starts_on',
                'A new employment period starts on {{longDate}}.',
                { longDate: longDate(day) },
              )
            : null;

  return (
    <ActionDialog
      title={TITLE[kind] ?? MOVE_LABEL[kind]}
      description={WHAT[kind]}
      action={MOVE_LABEL[kind]}
      destructive={isDestructive(kind)}
      busy={busy !== null}
      onClose={onClose}
      onAction={() => {
        setShown(true);
        if (Object.values(problems).some(Boolean)) return;
        void act(OPERATION()[kind], { personId, ...input() }, `${MOVE_LABEL[kind]}: done`).then(
          (done) => {
            if (done !== null) {
              onClose();
              onDone();
            }
          },
        );
      }}
    >
      {needsDay ? (
        <Field invalid={shown && problems.day}>
          <FieldLabel>
            {kind === 'rehire' || kind === 'hire'
              ? t('people.employment.start_date', 'Start date')
              : t('people.employment.last_working_day', 'Last working day')}
          </FieldLabel>
          <DatePicker
            label={
              kind === 'rehire' || kind === 'hire'
                ? t('people.employment.start_date', 'Start date')
                : t('people.employment.last_working_day', 'Last working day')
            }
            value={day}
            onChange={setDay}
            size="sm"
          />
          <FieldDescription>
            {t(
              'people.employment.a_day_on_their_calendar_today',
              'A day on their calendar; today there is {{date}}.',
              { date: longDate(today) },
            )}
          </FieldDescription>
        </Field>
      ) : null}
      {kind === 'giveNotice' || kind === 'terminate' ? (
        <Field required={kind === 'terminate'} invalid={shown && problems.reason}>
          <FieldLabel>{t('people.employment.reason', 'Reason')}</FieldLabel>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger accessibilityLabel={t('people.employment.reason', 'Reason')}>
              <SelectValue
                placeholder={t('people.employment.choose_a_reason', 'Choose a reason')}
              />
            </SelectTrigger>
            <SelectContent>
              {REASONS().map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {shown && problems.reason ? (
            <FieldError>
              {t('people.employment.choose_why_they_are_leaving', 'Choose why they are leaving.')}
            </FieldError>
          ) : null}
        </Field>
      ) : null}
      {kind === 'terminate' ? (
        <>
          <Field>
            <FieldLabel>{t('people.employment.note', 'Note')}</FieldLabel>
            <Input
              value={note}
              onChange={setNote}
              placeholder={t('people.employment.optional', 'Optional')}
              maxLength={500}
              size="sm"
            />
          </Field>
          <Checkbox checked={eligible} onCheckedChange={setEligible}>
            {t('people.employment.eligible_for_rehire', 'Eligible for rehire')}
          </Checkbox>
          <Checkbox checked={endNow} onCheckedChange={setEndNow}>
            {t('people.employment.end_their_access_now', 'End their access now')}
          </Checkbox>
        </>
      ) : null}
      {places ? (
        <>
          <Alert
            tone="neutral"
            title={t('people.employment.is_placed_nowhere', '{{first}} is placed nowhere', {
              first,
            })}
          >
            {t('people.employment.choose_where_they_work', 'Choose where they work.')}
          </Alert>
          <PlacementPickers
            placement={placement}
            entity={entity}
            location={location}
            onEntity={setEntity}
            onLocation={setLocation}
            invalid={shown && problems.entity}
          />
        </>
      ) : null}
      {notEligible ? (
        <>
          <Alert
            tone="warning"
            title={t(
              'people.employment.was_marked_not_eligible_for_rehire',
              '{{first}} was marked not eligible for rehire',
              { first },
            )}
          >
            {t(
              'people.employment.say_why_you_are_rehiring_anyway',
              'Say why you are rehiring anyway. It’s kept on the record.',
            )}
          </Alert>
          <Field required invalid={shown && problems.override}>
            <FieldLabel>
              {t('people.employment.why_rehire_them_anyway', 'Why rehire them anyway')}
            </FieldLabel>
            <Textarea value={override} onChange={setOverride} maxLength={500} />
            {shown && problems.override ? (
              <FieldError>{t('people.employment.say_why', 'Say why.')}</FieldError>
            ) : null}
          </Field>
        </>
      ) : null}
      {happens === null ? null : (
        // What follows from it (design v3 P17), so nothing is forgotten and nothing is a surprise.
        <Card variant={kind === 'giveNotice' || kind === 'terminate' ? 'assistant' : 'fill'}>
          <View className="flex-row items-center gap-2">
            {kind === 'giveNotice' || kind === 'terminate' ? (
              <Icon icon={Sparkles} size={16} tone="accent" />
            ) : null}
            <Text weight="semibold">
              {kind === 'giveNotice' || kind === 'terminate'
                ? t('people.employment.kithena_will_also', 'Kithena will also')
                : t('people.employment.what_happens', 'What happens')}
            </Text>
          </View>
          <Text variant="subhead" tone="muted">
            {happens}
          </Text>
          {(kind === 'giveNotice' || kind === 'terminate') && reports > 0 ? (
            <Text variant="subhead" tone="muted">
              {t(
                'people.employment.s_a_new_manager_before_then',
                {
                  one: '{{first}}’s {{count}} report needs a new manager before then.',
                  other: '{{first}}’s {{count}} reports need a new manager before then.',
                },
                { count: reports, first },
              )}
            </Text>
          ) : null}
        </Card>
      )}
    </ActionDialog>
  );
}

/** Moving somebody to another entity or location, from a date (PEO-123): HR's. */
export function PlaceDialog({
  personId,
  name,
  today,
  placement,
  onClose,
  onDone,
}: {
  personId: string;
  name: string;
  today: string;
  placement: Placement;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [entity, setEntity] = useState(placement.legalEntityId ?? '');
  const [location, setLocation] = useState(placement.locationId ?? '');
  const [from, setFrom] = useState<string | null>(today);
  const [shown, setShown] = useState(false);
  return (
    <ActionDialog
      title={t('people.employment.change_s_placement', 'Change {{value}}’s placement', {
        value: name.split(' ')[0] ?? name,
      })}
      description={t(
        'people.employment.where_they_are_employed_and_where',
        'Where they are employed and where they work, from a date.',
      )}
      action={t('people.employment.change_placement', 'Change placement')}
      busy={busy !== null}
      onClose={onClose}
      onAction={() => {
        setShown(true);
        if (entity === '') return;
        void act(
          'PlacePerson',
          {
            personId,
            legalEntityId: entity,
            locationId: location === '' ? null : location,
            ...(from === null ? {} : { effectiveFrom: from }),
          },
          t('people.employment.placement_changed', 'Placement changed'),
        ).then((done) => {
          if (done !== null) {
            onClose();
            onDone();
          }
        });
      }}
    >
      <PlacementPickers
        placement={placement}
        entity={entity}
        location={location}
        onEntity={setEntity}
        onLocation={setLocation}
        invalid={shown && entity === ''}
      />
      <Field>
        <FieldLabel>{t('people.employment.from', 'From')}</FieldLabel>
        <DatePicker
          label={t('people.employment.from', 'From')}
          value={from}
          onChange={setFrom}
          size="sm"
        />
      </Field>
    </ActionDialog>
  );
}

/** Something that needs a reason for the audit log first: viewing as somebody, a PDF of their record. */
export function ReasonDialog({
  title,
  description,
  action,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  action: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(false);
  return (
    <ActionDialog
      title={title}
      description={description}
      action={action}
      busy={busy}
      onClose={onClose}
      onAction={() => {
        setShown(true);
        if (reason.trim() !== '') onSubmit(reason.trim());
      }}
    >
      <Field required invalid={shown && reason.trim() === ''}>
        <FieldLabel>{t('people.employment.reason', 'Reason')}</FieldLabel>
        <Input value={reason} onChange={setReason} maxLength={500} size="sm" />
        <FieldDescription>
          {t('people.employment.kept_in_the_activity_log', 'Kept in the activity log.')}
        </FieldDescription>
        {shown && reason.trim() === '' ? (
          <FieldError>{t('people.employment.say_why', 'Say why.')}</FieldError>
        ) : null}
      </Field>
    </ActionDialog>
  );
}

/** Every employment period, once there is more than one: somebody who left and came back. */
export function EmploymentPeriods({
  periods,
}: {
  periods: readonly Period[];
}): React.JSX.Element | null {
  if (periods.length < 2) return null;
  const why = (r: string | null): string => REASONS().find((x) => x.value === r)?.label ?? '—';
  return (
    <Stack gap={2}>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        {t('people.employment.employment_periods', 'Employment periods')}
      </Text>
      <List>
        {[...periods].reverse().map((p) => (
          <ListItem
            key={p.period}
            description={[
              p.lastWorkingDay === null
                ? 'Current'
                : `Until ${longDate(p.lastWorkingDay)} · ${why(p.leavingReason)}`,
              p.eligibleForRehire === false
                ? t('people.employment.not_eligible_for_rehire', 'Not eligible for rehire')
                : null,
              p.rehireOverrideReason === null
                ? null
                : t('people.employment.rehired_anyway', 'Rehired anyway: {{reason}}', {
                    reason: p.rehireOverrideReason,
                  }),
            ]
              .filter((x) => x !== null)
              .join(' · ')}
          >
            {t('people.employment.from_2', 'From {{longDate}}', {
              longDate: longDate(p.startedOn),
            })}
          </ListItem>
        ))}
      </List>
    </Stack>
  );
}
