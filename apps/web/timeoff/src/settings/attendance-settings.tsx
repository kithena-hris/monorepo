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

const TITLE = 'Attendance';

const onOff = (on: boolean): JSX.Element =>
  on ? (
    <Badge size="sm">On</Badge>
  ) : (
    <Badge size="sm" variant="outline">
      Off
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
          <FormSection title="Ways to clock in" description="Where a punch can come from.">
            <List aria-label="Ways to clock in">
              <ListItem
                icon={<icons.system aria-hidden />}
                description="Everyone"
                trailing={onOff(rules.clockIn?.web ?? true)}
              >
                Web, from the top bar
              </ListItem>
              <ListItem
                icon={<icons.phone aria-hidden />}
                description="Everyone"
                trailing={onOff(rules.clockIn?.mobile ?? true)}
              >
                Mobile app
              </ListItem>
              <ListItem
                icon={<icons.location aria-hidden />}
                description="Location is only checked at the moment of a punch, and never kept."
                trailing={onOff(rules.clockIn?.area ?? false)}
              >
                Only inside the office area
              </ListItem>
            </List>
          </FormSection>
          <FormSection title="Breaks and limits" description="What the working-time law asks for.">
            <div className="grid grid-cols-1 gap-3 @min-[28rem]/attendance:grid-cols-2">
              <NumberField
                label="Break after (hours)"
                value={hours(rules.breakAfterMinutes)}
                min={0}
                max={24}
                step={0.5}
                onChange={(n) => {
                  set({ breakAfterMinutes: minutes(n, 60) });
                }}
              />
              <NumberField
                label="Break length (minutes)"
                value={rules.breakMinutes}
                min={0}
                max={240}
                step={5}
                onChange={(n) => {
                  set({ breakMinutes: minutes(n, 1) });
                }}
              />
              <NumberField
                label="Rest between days (hours)"
                value={hours(rules.restMinutes)}
                min={0}
                max={48}
                step={0.5}
                onChange={(n) => {
                  set({ restMinutes: minutes(n, 60) });
                }}
              />
              <NumberField
                label="Weekly maximum (hours)"
                hint="Overtime included"
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
          <FormSection title="Overtime becomes" description="Once a manager approves it.">
            <SegmentedControl
              aria-label="Overtime becomes"
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
              <SegmentedControlItem value="comp">Comp time</SegmentedControlItem>
              <SegmentedControlItem value="paid">Paid</SegmentedControlItem>
              <SegmentedControlItem value="choose">Person chooses</SegmentedControlItem>
            </SegmentedControl>
            {paid ? (
              <NumberField
                label="Paid at (× the hourly rate)"
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
                  comp: 'Banked hour for hour as comp time.',
                  paid: `Sent to Payroll at ${rules.overtime.multiplier}×.`,
                  choose: `Comp time hour for hour, or paid at ${rules.overtime.multiplier}× through Payroll, as the person chooses.`,
                }[rules.overtime.becomes]
              }
            </p>
          </FormSection>
        </FormSections>
        <div className="flex min-w-0 flex-col gap-6">
          <PageSection title="Working week" surface>
            {onSaveWeek === undefined || !editableWeek(data.defaultSchedule) ? (
              <List aria-label="Schedules">
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
              Anyone without a schedule of their own works this week. Interviews and meetings are
              only offered inside it.
            </p>
          </PageSection>
          <Alert tone="info" icon={<icons.locked aria-hidden />} title="What Kithena never records">
            No location trail, no screenshots, no keyboard or app activity. Only the punches people
            make.
          </Alert>
        </div>
      </div>
      {onSave === undefined ? null : form.bar(onSave)}
    </>
  );
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
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
        <Alert tone="success" title="The working week is saved" />
      ) : (
        <Alert tone="danger" title="That did not go through">
          {said.message}
        </Alert>
      )}
      <ul className="flex flex-col gap-2" aria-label="Working days">
        {DAY_NAME.map((name, i) => {
          const day = String(i + 1);
          const w = week[day];
          return (
            <li key={day} className="flex flex-wrap items-center gap-3">
              <Switch
                aria-label={`${name} is a working day`}
                checked={w !== undefined}
                onCheckedChange={(on) => {
                  put(day, on ? (week['1'] ?? standard) : undefined);
                }}
              />
              <span className="w-24 text-sm font-medium">{name}</span>
              {w === undefined ? (
                <span className="text-sm text-fg-muted">Not worked</span>
              ) : (
                <>
                  <TimePicker
                    label={`${name} starts`}
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
                    label={`${name} ends`}
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
        <p className="text-sm text-danger-fg">Each working day ends after it starts.</p>
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
          Save the working week
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
  return `${span} · ${clock(first.start)}–${clock(first.end)} · ${String(weekly)}h`;
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
