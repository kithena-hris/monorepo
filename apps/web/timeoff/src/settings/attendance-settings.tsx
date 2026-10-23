import {
  Alert,
  Badge,
  Button,
  FormSection,
  FormSections,
  List,
  ListItem,
  NumberField,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  TimePicker,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { SettingsSkeleton, useSaved } from './shared';
import { t as tr } from '../i18n';

/**
 * Attendance rules (T33, TOF-081): how people clock in, the breaks and
 * limits the working-time law sets, the schedule anyone without one works,
 * and what overtime becomes (PRD §11.5).
 *
 * What Time Off never records is written on the page itself, beside the
 * switches, so nobody turns on surveillance by accident: there is no switch
 * for it to be beside.
 */

export interface AttendanceRules {
  readonly breakAfterMinutes: number;
  readonly breakMinutes: number;
  readonly restMinutes: number;
  /** The week plus the overtime allowed on top: 40h + 2h. */
  readonly weeklyMaxMinutes: number;
  readonly overtime: {
    readonly becomes: 'comp' | 'paid' | 'choose';
    /** Paid overtime's rate, as a decimal string: "1.25". */
    readonly multiplier: string;
  };
  /** Which ways of clocking in are on; switched on the phone (S16). */
  readonly clockIn?: { readonly web: boolean; readonly mobile: boolean; readonly area?: boolean };
}

type WorkWindow = { readonly start: number; readonly end: number; readonly breakMinutes: number };

export interface AttendanceSettingsData {
  readonly rules: AttendanceRules;
  /** The schedule a member without one works: Time Off's own shape. */
  readonly defaultSchedule: {
    readonly kind: string;
    readonly name: string;
    readonly week?: Partial<Record<string, WorkWindow>>;
  };
}

export interface AttendanceSettingsProps {
  readonly load: Loadable<AttendanceSettingsData>;
  readonly onSave?: (rules: AttendanceRules) => Promise<Outcome>;
  /** The company's working week, saved on its own. */
  readonly onSaveWeek?: (schedule: {
    kind: 'fixed';
    name: string;
    week: Partial<Record<string, WorkWindow>>;
  }) => Promise<Outcome>;
}

const TITLE = tr('settings.attendance-settings.attendance', 'Attendance');

const onOff = (on: boolean): JSX.Element =>
  on ? (
    <Badge size="sm">{tr('settings.attendance-settings.on', 'On')}</Badge>
  ) : (
    <Badge size="sm" variant="outline">
      {tr('settings.attendance-settings.off', 'Off')}
    </Badge>
  );
const DESCRIPTION = 'How people clock in, and what counts as a working day.';
const page = '@container/attendance flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[60rem]/attendance:grid @min-[60rem]/attendance:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @min-[60rem]/attendance:items-start';

export function AttendanceSettings({
  load,
  onSave,
  onSaveWeek,
}: AttendanceSettingsProps): JSX.Element {
  if (load.status === 'loading') return <AttendanceSettingsSkeleton />;
  return (
    <div className={page}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Loaded load={load} what="the attendance rules">
        {(data) => <Ready data={data} onSave={onSave} onSaveWeek={onSaveWeek} />}
      </Loaded>
    </div>
  );
}

/** Minutes as the hours a form asks in: 360 → 6, 2520 → 42. */
const hours = (minutes: number): number => minutes / 60;

function Ready({
  data,
  onSave,
  onSaveWeek,
}: {
  readonly data: AttendanceSettingsData;
  readonly onSave: AttendanceSettingsProps['onSave'];
  readonly onSaveWeek: AttendanceSettingsProps['onSaveWeek'];
}): JSX.Element {
  const form = useSaved(data.rules);
  const rules = form.draft;
  const set = (patch: Partial<AttendanceRules>): void => {
    form.set({ ...rules, ...patch });
  };
  const minutes = (n: number | null, per: number): number => Math.round((n ?? 0) * per);
  const paid = rules.overtime.becomes !== 'comp';
  return (
    <>
      {form.refusal}
      <div className={columns}>
        <FormSections>
          <FormSection
            title={tr('settings.attendance-settings.ways_to_clock_in', 'Ways to clock in')}
            description={tr(
              'settings.attendance-settings.where_a_punch_can_come_from',
              'Where a punch can come from.',
            )}
          >
            <List
              aria-label={tr('settings.attendance-settings.ways_to_clock_in', 'Ways to clock in')}
            >
              <ListItem
                icon={<icons.system aria-hidden />}
                description={tr('settings.attendance-settings.everyone', 'Everyone')}
                trailing={onOff(rules.clockIn?.web ?? true)}
              >
                {tr('settings.attendance-settings.web_from_the_top_bar', 'Web, from the top bar')}
              </ListItem>
              <ListItem
                icon={<icons.phone aria-hidden />}
                description={tr('settings.attendance-settings.everyone', 'Everyone')}
                trailing={onOff(rules.clockIn?.mobile ?? true)}
              >
                {tr('settings.attendance-settings.mobile_app', 'Mobile app')}
              </ListItem>
              <ListItem
                icon={<icons.location aria-hidden />}
                description={tr(
                  'settings.attendance-settings.location_is_only_checked_at_the',
                  'Location is only checked at the moment of a punch, and never kept.',
                )}
                trailing={onOff(rules.clockIn?.area ?? false)}
              >
                {tr(
                  'settings.attendance-settings.only_inside_the_office_area',
                  'Only inside the office area',
                )}
              </ListItem>
            </List>
          </FormSection>
          <FormSection
            title={tr('settings.attendance-settings.breaks_and_limits', 'Breaks and limits')}
            description={tr(
              'settings.attendance-settings.what_the_working_time_law_asks',
              'What the working-time law asks for.',
            )}
          >
            <div className="grid grid-cols-1 gap-3 @min-[28rem]/attendance:grid-cols-2">
              <NumberField
                label={tr('settings.attendance-settings.break_after_hours', 'Break after (hours)')}
                value={hours(rules.breakAfterMinutes)}
                min={0}
                max={24}
                step={0.5}
                onChange={(n) => {
                  set({ breakAfterMinutes: minutes(n, 60) });
                }}
              />
              <NumberField
                label={tr(
                  'settings.attendance-settings.break_length_minutes',
                  'Break length (minutes)',
                )}
                value={rules.breakMinutes}
                min={0}
                max={240}
                step={5}
                onChange={(n) => {
                  set({ breakMinutes: minutes(n, 1) });
                }}
              />
              <NumberField
                label={tr(
                  'settings.attendance-settings.rest_between_days_hours',
                  'Rest between days (hours)',
                )}
                value={hours(rules.restMinutes)}
                min={0}
                max={48}
                step={0.5}
                onChange={(n) => {
                  set({ restMinutes: minutes(n, 60) });
                }}
              />
              <NumberField
                label={tr(
                  'settings.attendance-settings.weekly_maximum_hours',
                  'Weekly maximum (hours)',
                )}
                hint={tr('settings.attendance-settings.overtime_included', 'Overtime included')}
                value={hours(rules.weeklyMaxMinutes)}
                min={0}
                max={168}
                step={0.5}
                onChange={(n) => {
                  set({ weeklyMaxMinutes: minutes(n, 60) });
                }}
              />
            </div>
          </FormSection>
          <FormSection
            title={tr('settings.attendance-settings.overtime_becomes', 'Overtime becomes')}
            description={tr(
              'settings.attendance-settings.once_a_manager_approves_it',
              'Once a manager approves it.',
            )}
          >
            <SegmentedControl
              aria-label={tr('settings.attendance-settings.overtime_becomes', 'Overtime becomes')}
              value={rules.overtime.becomes}
              onValueChange={(becomes) => {
                if (becomes !== '')
                  set({
                    overtime: {
                      ...rules.overtime,
                      becomes: becomes as AttendanceRules['overtime']['becomes'],
                    },
                  });
              }}
            >
              <SegmentedControlItem value="comp">
                {tr('settings.attendance-settings.comp_time', 'Comp time')}
              </SegmentedControlItem>
              <SegmentedControlItem value="paid">
                {tr('settings.attendance-settings.paid', 'Paid')}
              </SegmentedControlItem>
              <SegmentedControlItem value="choose">
                {tr('settings.attendance-settings.person_chooses', 'Person chooses')}
              </SegmentedControlItem>
            </SegmentedControl>
            {paid ? (
              <NumberField
                label={tr(
                  'settings.attendance-settings.paid_at_the_hourly_rate',
                  'Paid at (× the hourly rate)',
                )}
                value={Number(rules.overtime.multiplier)}
                min={1}
                max={5}
                step={0.05}
                precision={2}
                onChange={(n) => {
                  set({ overtime: { ...rules.overtime, multiplier: String(n ?? 1) } });
                }}
              />
            ) : null}
            <p className="text-sm text-fg-muted">
              {
                {
                  comp: tr(
                    'settings.attendance-settings.banked_hour_for_hour_as_comp',
                    'Banked hour for hour as comp time.',
                  ),
                  paid: tr(
                    'settings.attendance-settings.sent_to_payroll_at',
                    'Sent to Payroll at {{multiplier}}×.',
                    { multiplier: rules.overtime.multiplier },
                  ),
                  choose: tr(
                    'settings.attendance-settings.comp_time_hour_for_hour_or',
                    'Comp time hour for hour, or paid at {{multiplier}}× through Payroll, as the person chooses.',
                    { multiplier: rules.overtime.multiplier },
                  ),
                }[rules.overtime.becomes]
              }
            </p>
          </FormSection>
        </FormSections>
        <div className="flex min-w-0 flex-col gap-6">
          <PageSection
            title={tr('settings.attendance-settings.working_week', 'Working week')}
            surface
          >
            {onSaveWeek === undefined || !editableWeek(data.defaultSchedule) ? (
              <List aria-label={tr('settings.attendance-settings.schedules', 'Schedules')}>
                <ListItem
                  icon={<icons.scheduled aria-hidden />}
                  description={scheduleLine(data.defaultSchedule)}
                >
                  {data.defaultSchedule.name}
                </ListItem>
              </List>
            ) : (
              <WeekEditor schedule={data.defaultSchedule} onSave={onSaveWeek} />
            )}
            <p className="mt-3 text-sm text-fg-muted">
              {tr(
                'settings.attendance-settings.anyone_without_a_schedule_of_their',
                'Anyone without a schedule of their own works this week. Interviews and meetings are only offered inside it.',
              )}
            </p>
          </PageSection>
          <Alert
            tone="info"
            icon={<icons.locked aria-hidden />}
            title={tr(
              'settings.attendance-settings.what_kithena_never_records',
              'What Kithena never records',
            )}
          >
            {tr(
              'settings.attendance-settings.no_location_trail_no_screenshots_no',
              'No location trail, no screenshots, no keyboard or app activity. Only the punches people make.',
            )}
          </Alert>
        </div>
      </div>
      {onSave === undefined ? null : form.bar(onSave)}
    </>
  );
}

const DAY = [
  tr('settings.attendance-settings.mon', 'Mon'),
  tr('settings.attendance-settings.tue', 'Tue'),
  tr('settings.attendance-settings.wed', 'Wed'),
  tr('settings.attendance-settings.thu', 'Thu'),
  tr('settings.attendance-settings.fri', 'Fri'),
  tr('settings.attendance-settings.sat', 'Sat'),
  tr('settings.attendance-settings.sun', 'Sun'),
];
const DAY_NAME = [
  tr('settings.attendance-settings.monday', 'Monday'),
  tr('settings.attendance-settings.tuesday', 'Tuesday'),
  tr('settings.attendance-settings.wednesday', 'Wednesday'),
  tr('settings.attendance-settings.thursday', 'Thursday'),
  tr('settings.attendance-settings.friday', 'Friday'),
  tr('settings.attendance-settings.saturday', 'Saturday'),
  tr('settings.attendance-settings.sunday', 'Sunday'),
];
const toMinutes = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** The company week is edited here when it is a plain week, the shape HR sets it in. */
const editableWeek = (schedule: AttendanceSettingsData['defaultSchedule']): boolean =>
  schedule.kind === 'fixed' || schedule.kind === 'flexible';

/**
 * The company's working week, a day at a time: worked or not, when it
 * starts and ends, and the break inside it. Saved on its own, apart from
 * the rules beside it.
 */
function WeekEditor({
  schedule,
  onSave,
}: {
  readonly schedule: AttendanceSettingsData['defaultSchedule'];
  readonly onSave: NonNullable<AttendanceSettingsProps['onSaveWeek']>;
}): JSX.Element {
  const [week, setWeek] = useState<Partial<Record<string, WorkWindow>>>(schedule.week ?? {});
  const [said, setSaid] = useState<Outcome | null>(null);
  const [pending, start] = useTransition();
  const standard: WorkWindow = { start: 540, end: 1050, breakMinutes: 30 };
  const put = (day: string, w: WorkWindow | undefined): void => {
    const rest = Object.fromEntries(Object.entries(week).filter(([d]) => d !== day));
    setWeek(w === undefined ? rest : { ...rest, [day]: w });
    setSaid(null);
  };
  const wrong = Object.values(week).some(
    (w) => w !== undefined && (w.end <= w.start || w.breakMinutes > w.end - w.start),
  );
  return (
    <div className="flex flex-col gap-3">
      {said === null ? null : said.ok ? (
        <Alert
          tone="success"
          title={tr(
            'settings.attendance-settings.the_working_week_is_saved',
            'The working week is saved',
          )}
        />
      ) : (
        <Alert
          tone="danger"
          title={tr(
            'settings.attendance-settings.that_did_not_go_through',
            'That did not go through',
          )}
        >
          {said.message}
        </Alert>
      )}
      <ul
        className="flex flex-col gap-2"
        aria-label={tr('settings.attendance-settings.working_days', 'Working days')}
      >
        {DAY_NAME.map((name, i) => {
          const day = String(i + 1);
          const w = week[day];
          return (
            <li key={day} className="flex flex-wrap items-center gap-3">
              <Switch
                aria-label={tr(
                  'settings.attendance-settings.is_a_working_day',
                  '{{name}} is a working day',
                  { name },
                )}
                checked={w !== undefined}
                onCheckedChange={(on) => {
                  put(day, on ? (week['1'] ?? standard) : undefined);
                }}
              />
              <span className="w-24 text-sm font-medium">{name}</span>
              {w === undefined ? (
                <span className="text-sm text-fg-muted">
                  {tr('settings.attendance-settings.not_worked', 'Not worked')}
                </span>
              ) : (
                <>
                  <TimePicker
                    label={tr('settings.attendance-settings.starts', '{{name}} starts', { name })}
                    size="sm"
                    step={15}
                    value={clock(w.start)}
                    onChange={(t) => {
                      if (t !== null) put(day, { ...w, start: toMinutes(t) });
                    }}
                  />
                  <span aria-hidden className="text-fg-muted">
                    –
                  </span>
                  <TimePicker
                    label={tr('settings.attendance-settings.ends', '{{name}} ends', { name })}
                    size="sm"
                    step={15}
                    value={clock(w.end)}
                    onChange={(t) => {
                      if (t !== null) put(day, { ...w, end: toMinutes(t) });
                    }}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {wrong ? (
        <p className="text-sm text-danger-fg">
          {tr(
            'settings.attendance-settings.each_working_day_ends_after_it',
            'Each working day ends after it starts.',
          )}
        </p>
      ) : null}
      <div>
        <Button
          size="sm"
          loading={pending}
          disabled={wrong || Object.keys(week).length === 0}
          onClick={() => {
            start(async () => {
              setSaid(await onSave({ kind: 'fixed', name: schedule.name, week }));
            });
          }}
        >
          {tr('settings.attendance-settings.save_the_working_week', 'Save the working week')}
        </Button>
      </div>
    </div>
  );
}
const clock = (m: number): string =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "Mon–Fri · 09:00–17:30 · 40h" for a week of one window; its kind otherwise. */
function scheduleLine(schedule: AttendanceSettingsData['defaultSchedule']): string {
  const days = Object.entries(schedule.week ?? {}).filter(
    (e): e is [string, WorkWindow] => e[1] !== undefined,
  );
  const first = days[0]?.[1];
  const same =
    first !== undefined && days.every(([, w]) => w.start === first.start && w.end === first.end);
  if (!same) return schedule.kind.charAt(0).toUpperCase() + schedule.kind.slice(1);
  const nums = days.map(([d]) => Number(d)).toSorted((a, b) => a - b);
  const run = nums.every((n, i) => i === 0 || n === (nums[i - 1] ?? 0) + 1);
  const span = run
    ? `${DAY[(nums[0] ?? 1) - 1] ?? ''}–${DAY[(nums.at(-1) ?? 1) - 1] ?? ''}`
    : nums.map((n) => DAY[n - 1]).join(', ');
  const weekly = days.reduce((t, [, w]) => t + w.end - w.start - w.breakMinutes, 0) / 60;
  return tr('settings.attendance-settings.h', '{{span}} · {{clock}}–{{clock2}} · {{weekly}}h', {
    span,
    clock: clock(first.start),
    clock2: clock(first.end),
    weekly: String(weekly),
  });
}

/** The page while it loads: the three sections, and the schedules and the promise beside them. */
export function AttendanceSettingsSkeleton(): JSX.Element {
  return (
    <SettingsSkeleton
      title={TITLE}
      description={DESCRIPTION}
      container="@container/attendance"
      columns={columns}
      main={['h-64', 'h-48', 'h-40']}
      side={['h-40', 'h-28']}
    />
  );
}
