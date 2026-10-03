import {
  Alert,
  Badge,
  FormSection,
  FormSections,
  List,
  ListItem,
  NumberField,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

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
}

const TITLE = 'Attendance';
const DESCRIPTION = 'How people clock in, and what counts as a working day.';
const page = '@container/attendance flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[60rem]/attendance:grid @min-[60rem]/attendance:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @min-[60rem]/attendance:items-start';

export function AttendanceSettings({ load, onSave }: AttendanceSettingsProps): JSX.Element {
  if (load.status === 'loading') return <AttendanceSettingsSkeleton />;
  return (
    <div className={page}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Loaded load={load} what="the attendance rules">
        {(data) => <Ready data={data} onSave={onSave} />}
      </Loaded>
    </div>
  );
}

/** Minutes as the hours a form asks in: 360 → 6, 2520 → 42. */
const hours = (minutes: number): number => minutes / 60;

function Ready({
  data,
  onSave,
}: {
  readonly data: AttendanceSettingsData;
  readonly onSave: AttendanceSettingsProps['onSave'];
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
                trailing={<Badge size="sm">On</Badge>}
              >
                Web, from the top bar
              </ListItem>
              <ListItem
                icon={<icons.phone aria-hidden />}
                description="Everyone"
                trailing={<Badge size="sm">On</Badge>}
              >
                Mobile app
              </ListItem>
              <ListItem
                icon={<icons.location aria-hidden />}
                description="Location is only checked at the moment of a punch, and never kept."
                trailing={
                  <Badge size="sm" variant="outline">
                    Off
                  </Badge>
                }
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
          <PageSection title="Schedules" surface>
            <List aria-label="Schedules">
              <ListItem
                icon={<icons.scheduled aria-hidden />}
                description={scheduleLine(data.defaultSchedule)}
              >
                {data.defaultSchedule.name}
              </ListItem>
            </List>
            <p className="mt-3 text-sm text-fg-muted">
              Anyone without a schedule of their own works this one.
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
