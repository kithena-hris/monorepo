import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartCard,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  HorizontalBarChart,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
  regionName,
  WidgetGrid,
  widgetSpan,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, newId, useAct, words } from './shared';
import type {
  AnalyticsData,
  OwnerRole,
  Phase,
  ScreenProps,
  SettingsData,
  TaskKind,
  TemplateTask,
  TemplatesData,
} from './types';
import { t as tr } from './i18n';

/**
 * O2 templates, O7 settings and O9 analytics, for administrators and HR.
 * Country tasks are not here: they ship with the country and are added to
 * every plan for it, locked.
 */

const PHASES: readonly Phase[] = [
  'before_start',
  'day_one',
  'first_week',
  'first_month',
  'probation',
];
const ROLES: readonly OwnerRole[] = ['new_hire', 'manager', 'buddy', 'hr', 'it'];
const KINDS: readonly TaskKind[] = [
  'todo',
  'form',
  'document',
  'acknowledge',
  'meeting',
  'equipment',
  'account',
  'goal',
  'training',
];
const COUNTRIES = ['DE', 'ES', 'GB', 'IN', 'US'] as const;
const label = (k: string) => (k === 'it' ? 'IT' : k === 'hr' ? 'HR' : words(k));

function Pick<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  readonly name: string;
  readonly value: T;
  readonly options: readonly T[];
  readonly onChange: (v: T) => void;
}): JSX.Element {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        onChange(v as T);
      }}
    >
      <SelectTrigger aria-label={name}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {label(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Draft = TemplatesData['templates'][number];

function Editor({
  template,
  props,
  onDone,
}: {
  readonly template: Draft;
  readonly props: ScreenProps<TemplatesData>;
  readonly onDone: () => void;
}): JSX.Element {
  const act = useAct(props);
  const [t, setT] = useState<Draft>(template);
  const [title, setTitle] = useState('');
  const set = (i: number, patch: Partial<TemplateTask>) => {
    setT({ ...t, tasks: t.tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  };
  const countries = t.conditions.countries ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>
          {t.name === '' ? tr('templates.new_template', 'New template') : t.name}
        </CardTitle>
        <CardDescription>
          {tr(
            'templates.due_rules_days_from_the_start',
            'Due rules: days from the start (-14d, 0, +30d) or from probation’s end (probation-14d).',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Refusal error={act.error} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field required>
            <FieldLabel>{tr('templates.name', 'Name')}</FieldLabel>
            <FieldControl>
              <Input
                value={t.name}
                onChange={(e) => {
                  setT({ ...t, name: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{tr('templates.only_for_departments', 'Only for departments')}</FieldLabel>
            <FieldControl>
              <Input
                value={(t.conditions.departments ?? []).join(', ')}
                onChange={(e) => {
                  setT({
                    ...t,
                    conditions: {
                      ...t.conditions,
                      departments: e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    },
                  });
                }}
                placeholder={tr('templates.every_department', 'Every department')}
              />
            </FieldControl>
            <FieldDescription>
              {tr('templates.comma_separated_empty_means_any', 'Comma-separated; empty means any.')}
            </FieldDescription>
          </Field>
        </div>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-medium">
            {tr(
              'templates.only_for_countries_none_means_any',
              'Only for countries (none means any)',
            )}
          </legend>
          {COUNTRIES.map((c) => (
            <Field key={c} orientation="horizontal" className="justify-start">
              <FieldControl>
                <Switch
                  checked={countries.includes(c)}
                  onCheckedChange={(on) => {
                    setT({
                      ...t,
                      conditions: {
                        ...t.conditions,
                        countries: on ? [...countries, c] : countries.filter((x) => x !== c),
                      },
                    });
                  }}
                />
              </FieldControl>
              <FieldLabel>{regionName(c)}</FieldLabel>
            </Field>
          ))}
        </fieldset>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr('templates.task', 'Task')}</TableHead>
              <TableHead>{tr('templates.phase', 'Phase')}</TableHead>
              <TableHead>{tr('templates.owner', 'Owner')}</TableHead>
              <TableHead>{tr('templates.kind', 'Kind')}</TableHead>
              <TableHead>{tr('templates.due', 'Due')}</TableHead>
              <TableHead>
                <span className="sr-only">{tr('templates.remove', 'Remove')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.tasks.map((x, i) => (
              <TableRow key={x.key}>
                <TableCell>
                  <Input
                    aria-label={tr('templates.title', 'Title')}
                    value={x.title}
                    onChange={(e) => {
                      set(i, { title: e.target.value });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Pick
                    name="Phase"
                    value={x.phase}
                    options={PHASES}
                    onChange={(v) => {
                      set(i, { phase: v });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Pick
                    name="Owner"
                    value={x.ownerRole === 'person' ? 'hr' : x.ownerRole}
                    options={ROLES}
                    onChange={(v) => {
                      set(i, { ownerRole: v });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Pick
                    name="Kind"
                    value={x.kind}
                    options={KINDS}
                    onChange={(v) => {
                      set(i, { kind: v });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={tr('templates.due', 'Due')}
                    className="w-28"
                    value={x.due}
                    onChange={(e) => {
                      set(i, { due: e.target.value });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={tr('templates.remove_2', 'Remove {{title}}', { title: x.title })}
                    startIcon={<icons.delete aria-hidden />}
                    onClick={() => {
                      setT({ ...t, tasks: t.tasks.filter((_, j) => j !== i) });
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const key =
              title
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/gu, '_')
                .replace(/^_+|_+$/gu, '')
                .slice(0, 50) || 'task';
            setT({
              ...t,
              tasks: [
                ...t.tasks,
                {
                  key: /^[a-z]/u.test(key) ? `${key}_${String(t.tasks.length)}` : `t_${key}`,
                  title: title.trim(),
                  phase: 'first_week',
                  ownerRole: 'manager',
                  ownerPersonId: null,
                  kind: 'todo',
                  due: '+5d',
                  link: null,
                },
              ],
            });
            setTitle('');
          }}
        >
          <Input
            aria-label={tr('templates.a_new_task', 'A new task')}
            placeholder={tr('templates.set_first_30_day_goals', 'Set first 30-day goals')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <Button type="submit" variant="secondary" disabled={title.trim() === ''}>
            {tr('templates.add_task', 'Add task')}
          </Button>
        </form>
        <div className="flex items-center justify-between gap-2">
          <Field orientation="horizontal" className="justify-start">
            <FieldControl>
              <Switch
                checked={t.active}
                onCheckedChange={(on) => {
                  setT({ ...t, active: on });
                }}
              />
            </FieldControl>
            <FieldLabel>{tr('templates.in_use', 'In use')}</FieldLabel>
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onDone}>
              {tr('templates.close', 'Close')}
            </Button>
            <Button
              disabled={t.name.trim() === ''}
              loading={act.pending}
              onClick={() => {
                const { id, ...input } = t;
                act.run('SaveOnboardingTemplate', { id, input }, onDone);
              }}
            >
              {tr('templates.save_template', 'Save template')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Templates(props: ScreenProps<TemplatesData>): JSX.Element {
  const [editing, setEditing] = useState<Draft | null>(null);
  return (
    <Loaded load={props.load} what="templates">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('templates.templates', 'Templates')}
            description={tr(
              'templates.every_template_whose_conditions_match_a',
              'Every template whose conditions match a hire is merged into the plan. Country tasks are added on top and cannot be removed.',
            )}
            actions={
              <Button
                startIcon={<icons.add aria-hidden />}
                onClick={() => {
                  setEditing({ id: newId(), name: '', active: true, conditions: {}, tasks: [] });
                }}
              >
                {tr('templates.new_template', 'New template')}
              </Button>
            }
          />
          {editing === null ? null : (
            <Editor
              key={editing.id}
              template={editing}
              props={props}
              onDone={() => {
                setEditing(null);
              }}
            />
          )}
          {data.templates.length === 0 ? (
            <EmptyState
              icon={<icons.list aria-hidden />}
              title={tr('templates.no_templates_yet', 'No templates yet')}
              description={tr(
                'templates.the_first_hire_gets_the_default',
                'The first hire gets the default template.',
              )}
            />
          ) : (
            data.templates.map((t) => (
              <Card key={t.id} padded className="flex flex-wrap items-center gap-3">
                <span className="flex-1 font-semibold">{t.name}</span>
                <span className="text-sm text-fg-muted">
                  {tr('templates.tasks', '{{length}} tasks{{value}}', {
                    length: String(t.tasks.length),
                    value:
                      (t.conditions.countries ?? []).length > 0
                        ? ` · ${(t.conditions.countries ?? []).join(', ')}`
                        : '',
                  })}
                </span>
                <Badge size="sm" tone={t.active ? 'success' : 'neutral'}>
                  {t.active ? tr('templates.in_use', 'In use') : tr('templates.off', 'Off')}
                </Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditing(t);
                  }}
                >
                  {tr('templates.edit', 'Edit')}
                </Button>
              </Card>
            ))
          )}
        </div>
      )}
    </Loaded>
  );
}

/** O7: who holds HR and IT, the holidays plans skip, the company's own country. */
export function Settings(props: ScreenProps<SettingsData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('templates.onboardings_settings', 'Onboarding’s settings')}>
      {(data) => <SettingsBody data={data} props={props} />}
    </Loaded>
  );
}

function SettingsBody({
  data,
  props,
}: {
  readonly data: SettingsData;
  readonly props: ScreenProps<SettingsData>;
}): JSX.Element {
  const act = useAct(props);
  const [hr, setHr] = useState<readonly string[]>(data.roles.hr);
  const [it, setIt] = useState<readonly string[]>(data.roles.it);
  const [country, setCountry] = useState(data.defaultCountry);
  const [holidays, setHolidays] = useState(
    Object.entries(data.holidays)
      .map(([c, days]) => tr('templates.text', '{{c}}: {{join}}', { c, join: days.join(', ') }))
      .join('\n'),
  );
  const toggle = (list: readonly string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((x) => x !== id);
  const save = () => {
    const parsed: Record<string, string[]> = {};
    for (const line of holidays.split('\n')) {
      const [c, rest] = line.split(':');
      if (c === undefined || rest === undefined) continue;
      parsed[c.trim().toUpperCase()] = rest
        .split(',')
        .map((d) => d.trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/u.test(d));
    }
    act.run('SaveOnboardingSettings', {
      input: { roles: { hr, it }, holidays: parsed, defaultCountry: country },
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={tr('templates.onboarding', 'Onboarding')}
        description={tr('templates.settings', 'Settings')}
      />
      <Refusal error={act.error} />
      <Card>
        <CardHeader>
          <CardTitle level={2}>
            {tr('templates.who_does_hrs_and_its_tasks', 'Who does HR’s and IT’s tasks')}
          </CardTitle>
          <CardDescription>
            {tr(
              'templates.administrators_of_onboarding_are_hr_as',
              'Administrators of Onboarding are HR as well',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('templates.person', 'Person')}</TableHead>
                <TableHead>{tr('templates.hr', 'HR')}</TableHead>
                <TableHead>{tr('templates.it', 'IT')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <TableRow key={m.personId}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={tr('templates.is_hr', '{{name}} is HR', { name: m.name })}
                      checked={hr.includes(m.personId)}
                      onCheckedChange={(on) => {
                        setHr(toggle(hr, m.personId, on));
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={tr('templates.is_it', '{{name}} is IT', { name: m.name })}
                      checked={it.includes(m.personId)}
                      onCheckedChange={(on) => {
                        setIt(toggle(it, m.personId, on));
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('templates.dates', 'Dates')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel>
              {tr('templates.country_of_a_hire_people_sends', 'Country of a hire People sends')}
            </FieldLabel>
            <Select value={country} onValueChange={setCountry}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {tr(
                'templates.peoples_hire_names_no_country_recruitings',
                'People’s hire names no country; Recruiting’s does.',
              )}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>
              {tr('templates.holidays_a_due_date_skips', 'Holidays a due date skips')}
            </FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={holidays}
                onChange={(e) => {
                  setHolidays(e.target.value);
                }}
                placeholder={tr('templates.de_2026_12_25_2026_12', 'DE: 2026-12-25, 2026-12-26')}
              />
            </FieldControl>
            <FieldDescription>
              {tr(
                'templates.one_line_per_country_with_time',
                'One line per country. With Time Off, its calendars are used too.',
              )}
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button loading={act.pending} onClick={save}>
          {tr('templates.save', 'Save')}
        </Button>
      </div>
    </div>
  );
}

/** O9: counts Onboarding computed. */
export function Analytics(props: ScreenProps<AnalyticsData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('templates.onboarding_analytics', 'onboarding analytics')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader title={tr('templates.onboarding_analytics_2', 'Onboarding analytics')} />
          <h2 className="sr-only">{tr('templates.figures', 'Figures')}</h2>
          <WidgetGrid size="sm">
            <Stat
              icon={<icons.pending aria-hidden />}
              label={tr('templates.plans_in_flight', 'Plans in flight')}
              value={String(data.inFlight)}
            />
            <Stat
              icon={<icons.goal aria-hidden />}
              label={tr('templates.on_track', 'On track')}
              value={String(data.onTrack)}
            />
            <Stat
              icon={<icons.success aria-hidden />}
              label={tr('templates.completed', 'Completed')}
              value={String(data.completed)}
            />
          </WidgetGrid>
          <WidgetGrid>
            <ChartCard
              className={widgetSpan(2)}
              title={tr('templates.late_tasks_by_owner', 'Late tasks by owner')}
            >
              {data.lateByRole.length === 0 ? (
                <Alert tone="success" title={tr('templates.nothing_late', 'Nothing late')} />
              ) : (
                <HorizontalBarChart
                  label={tr('templates.late_tasks_by_owner', 'Late tasks by owner')}
                  data={data.lateByRole.map((r) => ({ label: label(r.role), value: r.count }))}
                  showValues
                  sorted
                />
              )}
            </ChartCard>
            <ChartCard
              className={widgetSpan(2)}
              title={tr('templates.probation_outcomes', 'Probation outcomes')}
            >
              <HorizontalBarChart
                label={tr('templates.probation_outcomes', 'Probation outcomes')}
                data={data.probation.map((r) => ({ label: words(r.outcome), value: r.count }))}
                showValues
              />
            </ChartCard>
          </WidgetGrid>
        </div>
      )}
    </Loaded>
  );
}
