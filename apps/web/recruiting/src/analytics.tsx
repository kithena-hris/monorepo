import {
  Alert,
  Badge,
  BarChart,
  Button,
  ChartCard,
  EmptyState,
  FunnelChart,
  HorizontalBarChart,
  Input,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TrendChart,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, To, useAct, words } from './shared';
import type { AnalyticsData, Bucket, ScreenProps } from './types';
import { t as tr } from './i18n';

/**
 * R23 and R25: dashboards over the stage history, filters in the address,
 * and a chart built from chips. Every number is Recruiting's; a group under
 * five people arrives withheld and is drawn as such.
 */

const DASHBOARDS = ['overview', 'funnel', 'speed', 'sources', 'offers', 'fairness', 'ask'] as const;
type Dashboard = (typeof DASHBOARDS)[number];
const PERIODS = ['last_30_days', 'last_90_days', 'this_quarter', 'this_year', 'last_year'] as const;

const METRICS: readonly { key: string; label: string; by: readonly string[] }[] = [
  {
    key: 'applications',
    label: tr('analytics.applications', 'Applications'),
    by: ['department', 'source', 'job', 'country', 'month'],
  },
  {
    key: 'hires',
    label: tr('analytics.hires', 'Hires'),
    by: ['department', 'source', 'job', 'country', 'month', 'hiring_manager'],
  },
  {
    key: 'conversion',
    label: tr('analytics.conversion_by_stage', 'Conversion by stage'),
    by: ['stage', 'job', 'department', 'source'],
  },
  {
    key: 'time_to_hire',
    label: tr('analytics.time_to_hire', 'Time to hire'),
    by: ['department', 'job', 'source', 'month', 'country'],
  },
  {
    key: 'rejection_reasons',
    label: tr('analytics.rejection_reasons', 'Rejection reasons'),
    by: ['rejection_reason', 'stage', 'job'],
  },
];

const points = (buckets: readonly Bucket[]) =>
  buckets
    .filter((b) => !b.suppressed && b.value !== null)
    .map((b) => ({ label: words(b.key), value: b.value ?? 0 }));

type Point = { readonly label: string; readonly value: number };

/** R24: each tile that opens on its own, with the rows behind it. */
const TILES: readonly {
  readonly id: string;
  readonly title: string;
  readonly dashboard: Dashboard;
  readonly unit: string;
  readonly chart: 'trend' | 'funnel' | 'bars';
  readonly rows: (data: AnalyticsData) => readonly Point[];
  readonly withheld?: (data: AnalyticsData) => readonly Bucket[];
}[] = [
  {
    id: 'hires-by-month',
    title: tr('analytics.hires_by_month', 'Hires by month'),
    dashboard: 'overview',
    unit: tr('analytics.hires', 'Hires'),
    chart: 'trend',
    rows: (d) => d.overview.hiresByMonth.map((h) => ({ label: h.month, value: h.hires })),
  },
  {
    id: 'pipeline',
    title: tr('analytics.pipeline_by_stage', 'Pipeline by stage'),
    dashboard: 'funnel',
    unit: tr('analytics.applications', 'Applications'),
    chart: 'funnel',
    rows: (d) => d.overview.funnel.map((f) => ({ label: words(f.category), value: f.count })),
  },
  {
    id: 'time-in-stage',
    title: tr('analytics.time_in_stage', 'Time in stage'),
    dashboard: 'funnel',
    unit: tr('analytics.median_days', 'Median days'),
    chart: 'bars',
    rows: (d) =>
      d.timeInStage
        .filter((t) => t.median !== null)
        .map((t) => ({ label: words(t.category), value: Math.round(t.median ?? 0) })),
  },
  {
    id: 'rejection-reasons',
    title: tr('analytics.rejection_reasons', 'Rejection reasons'),
    dashboard: 'funnel',
    unit: tr('analytics.applications', 'Applications'),
    chart: 'bars',
    rows: (d) => points(d.overview.rejectionReasons),
    withheld: (d) => d.overview.rejectionReasons,
  },
  {
    id: 'time-to-fill',
    title: tr('analytics.time_to_fill', 'Time to fill'),
    dashboard: 'speed',
    unit: tr('analytics.days', 'Days'),
    chart: 'bars',
    rows: (d) =>
      d.speed.filter((s) => s.days !== null).map((s) => ({ label: s.title, value: s.days ?? 0 })),
  },
  {
    id: 'sources',
    title: tr('analytics.applications_by_source', 'Applications by source'),
    dashboard: 'sources',
    unit: tr('analytics.applications', 'Applications'),
    chart: 'bars',
    rows: (d) => points(d.overview.sources),
    withheld: (d) => d.overview.sources,
  },
];

/** The dashboard's filters, carried to a tile and back; the tab only on the way back. */
const query = (search: ScreenProps<AnalyticsData>['search'], dashboard?: Dashboard) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search ?? {}))
    if (k !== 'dashboard' && typeof v === 'string') q.set(k, v);
  if (dashboard !== undefined && dashboard !== 'overview') q.set('dashboard', dashboard);
  const text = q.toString();
  return text === '' ? '' : `?${text}`;
};

function Detail({
  id,
  props,
}: {
  readonly id: string;
  readonly props: ScreenProps<AnalyticsData>;
}): JSX.Element {
  return (
    <To href={`/recruiting/analytics/${id}${query(props.search)}`} onNavigate={props.onNavigate}>
      {tr('analytics.details', 'Details')}
    </To>
  );
}

function Drawn({
  tile,
  rows,
}: {
  readonly tile: (typeof TILES)[number];
  readonly rows: readonly Point[];
}): JSX.Element {
  if (tile.chart === 'trend')
    return <TrendChart label={tile.title} series={[{ label: tile.unit, data: [...rows] }]} />;
  if (tile.chart === 'funnel')
    return <FunnelChart label={tile.title} data={[...rows]} showConversion />;
  return <HorizontalBarChart label={tile.title} data={[...rows]} showValues sorted />;
}

/** R24: one tile at full size, and the table it is drawn from. */
export function AnalyticsTile(props: ScreenProps<AnalyticsData>): JSX.Element {
  const tile = TILES.find((t) => t.id === props.params?.['id']);
  return (
    <Loaded load={props.load} what="this chart">
      {(data) => {
        if (tile === undefined)
          return (
            <EmptyState
              icon={<icons.analytics aria-hidden />}
              title={tr('analytics.no_such_chart', 'No such chart')}
            />
          );
        const rows = tile.rows(data);
        const back = `/recruiting/analytics${query(props.search, tile.dashboard)}`;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={tile.title}
              description={words(data.filters.period)}
              actions={
                <To href={back} onNavigate={props.onNavigate}>
                  {tr('analytics.back_to', 'Back to {{dashboard}}', {
                    dashboard: words(tile.dashboard).toLowerCase(),
                  })}
                </To>
              }
            />
            <h2 className="sr-only">{tr('analytics.chart_and_data', 'Chart and data')}</h2>
            <ChartCard title={tile.title}>
              {rows.length === 0 ? (
                <EmptyState
                  icon={<icons.analytics aria-hidden />}
                  title={tr('analytics.nothing_in_this_period', 'Nothing in this period')}
                />
              ) : (
                <Drawn tile={tile} rows={rows} />
              )}
              {tile.withheld === undefined ? null : <Withheld buckets={tile.withheld(data)} />}
            </ChartCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {tile.chart === 'trend'
                      ? tr('analytics.month', 'Month')
                      : tr('analytics.group', 'Group')}
                  </TableHead>
                  <TableHead className="text-right">{tile.unit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{String(r.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      }}
    </Loaded>
  );
}

interface ImpactRow {
  readonly stage: string;
  readonly group: string;
  readonly n: number;
  readonly rateBp: number;
  readonly ratioBp: number;
  readonly flagged: boolean;
}

const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;

function ImpactTable({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly ImpactRow[];
}): JSX.Element {
  return (
    <ChartCard
      title={title}
      description={tr(
        'analytics.share_of_each_group_that_reached',
        'Share of each group that reached the stage, against the highest',
      )}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {tr('analytics.no_group_of_five_or_more', 'No group of five or more people yet.')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr('analytics.stage', 'Stage')}</TableHead>
              <TableHead>{tr('analytics.group', 'Group')}</TableHead>
              <TableHead className="text-right">{tr('analytics.people', 'People')}</TableHead>
              <TableHead className="text-right">{tr('analytics.reached', 'Reached')}</TableHead>
              <TableHead className="text-right">{tr('analytics.ratio', 'Ratio')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.stage}:${r.group}`}>
                <TableCell>{r.stage}</TableCell>
                <TableCell>{words(r.group)}</TableCell>
                <TableCell className="text-right tabular-nums">{String(r.n)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(r.rateBp)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.flagged ? (
                    <Badge size="sm" tone="warning">
                      {tr('analytics.under_four_fifths', '{{ratioBp}}, under four-fifths', {
                        ratioBp: pct(r.ratioBp),
                      })}
                    </Badge>
                  ) : (
                    pct(r.ratioBp)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ChartCard>
  );
}

/** PRD §22.6: pass rates by voluntary self-ID group, AI-assisted and not; administrators only. */
function Fairness({ props }: { readonly props: ScreenProps<AnalyticsData> }): JSX.Element {
  const act = useAct(props);
  const [category, setCategory] = useState<'gender' | 'ethnicity'>('gender');
  const [data, setData] = useState<{
    all: readonly ImpactRow[];
    aiAssisted: readonly ImpactRow[];
    notAssisted: readonly ImpactRow[];
  } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const { call } = act;
  useEffect(() => {
    void call('RecruitingFairness', { category }).then((done) => {
      if (done.ok) {
        setRefused(null);
        setData(done.data as NonNullable<typeof data>);
      } else setRefused(done.message);
    });
  }, [call, category]);
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label={tr('analytics.group_by', 'Group by')}
        value={category}
        onValueChange={(v) => {
          setCategory(v === 'ethnicity' ? 'ethnicity' : 'gender');
        }}
      >
        <SegmentedControlItem value="gender">
          {tr('analytics.gender', 'Gender')}
        </SegmentedControlItem>
        <SegmentedControlItem value="ethnicity">
          {tr('analytics.race_or_ethnicity', 'Race or ethnicity')}
        </SegmentedControlItem>
      </SegmentedControl>
      {refused === null ? null : <Alert tone="info" title={refused} />}
      {data === null ? null : (
        <>
          <ImpactTable title={tr('analytics.every_decision', 'Every decision')} rows={data.all} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ImpactTable
              title={tr('analytics.with_an_evidence_matrix', 'With an evidence matrix')}
              rows={data.aiAssisted}
            />
            <ImpactTable
              title={tr('analytics.without_one', 'Without one')}
              rows={data.notAssisted}
            />
          </div>
        </>
      )}
      <p className="text-xs text-fg-muted">
        {tr(
          'analytics.from_voluntary_answers_given_after_applying',
          'From voluntary answers given after applying, sealed and never shown to a hiring team. A group under five people is never shown.',
        )}
      </p>
    </div>
  );
}

function Withheld({ buckets }: { readonly buckets: readonly Bucket[] }): JSX.Element | null {
  const n = buckets.filter((b) => b.suppressed).length;
  return n === 0 ? null : (
    <p className="text-xs text-fg-muted">
      {tr(
        'analytics.group_under_five_people_withheld',
        '{{n}} group{{value}} under five people withheld.',
        { n: String(n), value: n === 1 ? '' : 's' },
      )}
    </p>
  );
}

function Ask({
  props,
  period,
}: {
  readonly props: ScreenProps<AnalyticsData>;
  readonly period: string;
}): JSX.Element {
  const act = useAct(props);
  const [metric, setMetric] = useState('hires');
  const [by, setBy] = useState('department');
  const [rows, setRows] = useState<readonly Bucket[] | null>(null);
  const [question, setQuestion] = useState('');
  const m = METRICS.find((x) => x.key === metric) ?? METRICS[0];
  const chip = (
    label: string,
    value: string,
    set: (v: string) => void,
    options: readonly { key: string; label: string }[],
  ) => (
    <Select value={value} onValueChange={set}>
      <SelectTrigger aria-label={label} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act.run('AskForChart', { input: { question } }, (data) => {
            const d = data as {
              plan: { metric: string; breakdown: string | null };
              rows: readonly Bucket[];
            };
            setMetric(d.plan.metric);
            setBy(
              d.plan.breakdown ??
                METRICS.find((x) => x.key === d.plan.metric)?.by[0] ??
                'department',
            );
            setRows(d.rows);
          });
        }}
      >
        <Input
          aria-label={tr('analytics.ask_for_a_chart', 'Ask for a chart')}
          placeholder={tr(
            'analytics.offer_acceptance_by_department_this_year',
            'Offer acceptance by department this year',
          )}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          loading={act.pending}
          disabled={question.trim() === ''}
        >
          {tr('analytics.ask', 'Ask')}
        </Button>
      </form>
      <p className="text-xs text-fg-muted">
        {tr(
          'analytics.a_model_picks_the_chart_below',
          'A model picks the chart below by name; Kithena checks the plan and computes every number. Change any chip.',
        )}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {chip(
          tr('analytics.metric', 'Metric'),
          metric,
          (v) => {
            setMetric(v);
            setBy(METRICS.find((x) => x.key === v)?.by[0] ?? 'department');
          },
          METRICS,
        )}
        {chip(
          tr('analytics.by', 'By'),
          by,
          setBy,
          (m?.by ?? []).map((k) => ({ key: k, label: words(k) })),
        )}
        <Button
          loading={act.pending}
          onClick={() => {
            act.run(
              'Chart',
              {
                input: { metric, breakdown: by, filters: {}, period, compare: null, chart: 'bar' },
              },
              (data) => {
                setRows((data as { rows: readonly Bucket[] }).rows);
              },
            );
          }}
        >
          {tr('analytics.draw', 'Draw')}
        </Button>
      </div>
      <Refusal error={act.error} />
      {rows === null ? null : (
        <ChartCard
          title={tr('analytics.by_2', '{{value}} by {{by}}', {
            value: m?.label ?? '',
            by: words(by).toLowerCase(),
          })}
          description={words(period)}
        >
          <BarChart
            label={tr('analytics.by_2', '{{value}} by {{by}}', {
              value: m?.label ?? '',
              by: words(by),
            })}
            data={points(rows)}
            showValues
          />
          <Withheld buckets={rows} />
        </ChartCard>
      )}
      <p className="text-xs text-fg-muted">
        {tr(
          'analytics.every_chart_is_validated_whole_and',
          'Every chart is validated whole and computed by Kithena; a breakdown that would show a group under five people is refused.',
        )}
      </p>
    </div>
  );
}

export function Analytics(props: ScreenProps<AnalyticsData>): JSX.Element {
  const tab: Dashboard = DASHBOARDS.find((d) => d === props.search?.['dashboard']) ?? 'overview';
  return (
    <Loaded load={props.load} what="analytics">
      {(data) => {
        const o = data.overview;
        const days = (n: number | null) =>
          n === null ? '—' : tr('analytics.d', '{{round}} d', { round: String(Math.round(n)) });
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={tr('analytics.analytics', 'Analytics')}
              description={tr(
                'analytics.every_number_is_computed_from_the',
                'Every number is computed from the stage history. Groups under five people are hidden.',
              )}
              actions={
                <Select
                  value={data.filters.period}
                  onValueChange={(v) =>
                    props.onFilter?.({ period: v === 'last_90_days' ? null : v })
                  }
                >
                  <SelectTrigger aria-label={tr('analytics.period', 'Period')} className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIODS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {words(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            {data.filters.jobId === undefined ? null : (
              <Alert
                tone="info"
                title={tr('analytics.one_job', 'One job')}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => props.onFilter?.({ job: null })}
                  >
                    {tr('analytics.all_jobs', 'All jobs')}
                  </Button>
                }
              >
                {tr('analytics.filtered_to_the_job_you_came', 'Filtered to the job you came from.')}
              </Alert>
            )}
            <h2 className="sr-only">
              {tab === 'ask' ? tr('analytics.build_a_chart', 'Build a chart') : words(tab)}
            </h2>
            <Tabs
              value={tab}
              onValueChange={(v) => props.onFilter?.({ dashboard: v === 'overview' ? null : v })}
            >
              <TabsList>
                {DASHBOARDS.map((d) => (
                  <TabsTrigger key={d} value={d}>
                    {d === 'ask' ? tr('analytics.build_a_chart', 'Build a chart') : words(d)}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview" className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label={tr('analytics.open_jobs', 'Open jobs')} value={String(o.openJobs)} />
                  <Stat
                    label={tr('analytics.applications', 'Applications')}
                    value={String(o.applications)}
                  />
                  <Stat label={tr('analytics.hires', 'Hires')} value={String(o.hires)} />
                  <Stat
                    label={tr('analytics.offers_out', 'Offers out')}
                    value={String(o.offersOut)}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <ChartCard
                    title={tr('analytics.hires_by_month', 'Hires by month')}
                    action={<Detail id="hires-by-month" props={props} />}
                  >
                    {o.hiresByMonth.length === 0 ? (
                      <EmptyState
                        icon={<icons.analytics aria-hidden />}
                        title={tr('analytics.no_hires_in_this_period', 'No hires in this period')}
                      />
                    ) : (
                      <TrendChart
                        label={tr('analytics.hires_by_month', 'Hires by month')}
                        series={[
                          {
                            label: tr('analytics.hires', 'Hires'),
                            data: o.hiresByMonth.map((h) => ({ label: h.month, value: h.hires })),
                          },
                        ]}
                      />
                    )}
                  </ChartCard>
                  <ChartCard
                    title={tr('analytics.pipeline_by_stage', 'Pipeline by stage')}
                    description={tr(
                      'analytics.applications_that_ever_reached_each_stage',
                      'Applications that ever reached each stage',
                    )}
                  >
                    <FunnelChart
                      label={tr('analytics.pipeline_by_stage', 'Pipeline by stage')}
                      data={o.funnel.map((f) => ({ label: words(f.category), value: f.count }))}
                      showConversion
                    />
                  </ChartCard>
                </div>
              </TabsContent>
              <TabsContent value="funnel" className="grid gap-4 lg:grid-cols-2">
                <ChartCard
                  title={tr('analytics.conversion_per_stage', 'Conversion per stage')}
                  action={<Detail id="pipeline" props={props} />}
                >
                  <FunnelChart
                    label={tr('analytics.conversion_per_stage', 'Conversion per stage')}
                    data={o.funnel.map((f) => ({ label: words(f.category), value: f.count }))}
                    showConversion
                    highlightBiggestDrop
                  />
                </ChartCard>
                <ChartCard
                  title={tr('analytics.time_in_stage', 'Time in stage')}
                  description={tr('analytics.median_days', 'Median days')}
                  action={<Detail id="time-in-stage" props={props} />}
                >
                  <HorizontalBarChart
                    label={tr('analytics.median_days_in_stage', 'Median days in stage')}
                    data={data.timeInStage
                      .filter((t) => t.median !== null)
                      .map((t) => ({ label: words(t.category), value: Math.round(t.median ?? 0) }))}
                    showValues
                  />
                </ChartCard>
                <ChartCard
                  title={tr('analytics.rejection_reasons', 'Rejection reasons')}
                  className="lg:col-span-2"
                  action={<Detail id="rejection-reasons" props={props} />}
                >
                  <HorizontalBarChart
                    label={tr('analytics.rejection_reasons', 'Rejection reasons')}
                    data={points(o.rejectionReasons)}
                    showValues
                    sorted
                  />
                  <Withheld buckets={o.rejectionReasons} />
                </ChartCard>
              </TabsContent>
              <TabsContent value="speed" className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Stat
                    label={tr('analytics.median_time_to_hire', 'Median time to hire')}
                    value={days(o.timeToHire.median)}
                  />
                  <Stat
                    label={tr('analytics.85th_percentile', '85th percentile')}
                    value={days(o.timeToHire.p85)}
                  />
                </div>
                <ChartCard
                  title={tr('analytics.time_to_fill', 'Time to fill')}
                  action={<Detail id="time-to-fill" props={props} />}
                  description={tr(
                    'analytics.job_opened_to_the_last_opening',
                    'Job opened to the last opening hired, days',
                  )}
                >
                  <HorizontalBarChart
                    label={tr('analytics.time_to_fill_by_job', 'Time to fill by job')}
                    data={data.speed
                      .filter((s) => s.days !== null)
                      .map((s) => ({ label: s.title, value: s.days ?? 0 }))}
                    showValues
                    sorted
                  />
                </ChartCard>
              </TabsContent>
              <TabsContent value="sources">
                <ChartCard
                  title={tr('analytics.applications_by_source', 'Applications by source')}
                  action={<Detail id="sources" props={props} />}
                  description={tr(
                    'analytics.source_is_fixed_at_application_so',
                    'Source is fixed at application, so attribution can’t drift',
                  )}
                >
                  <HorizontalBarChart
                    label={tr('analytics.applications_by_source', 'Applications by source')}
                    data={points(o.sources)}
                    showValues
                    sorted
                  />
                  <Withheld buckets={o.sources} />
                </ChartCard>
              </TabsContent>
              <TabsContent value="offers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label={tr('analytics.acceptance_rate', 'Acceptance rate')}
                  value={data.offers.rate === null ? '—' : `${data.offers.rate}%`}
                />
                <Stat label={tr('analytics.sent', 'Sent')} value={String(data.offers.sent)} />
                <Stat
                  label={tr('analytics.accepted', 'Accepted')}
                  value={String(data.offers.accepted)}
                />
                <Stat
                  label={tr('analytics.declined', 'Declined')}
                  value={String(data.offers.declined)}
                />
              </TabsContent>
              <TabsContent value="fairness">
                <Fairness props={props} />
              </TabsContent>
              <TabsContent value="ask">
                <Ask props={props} period={data.filters.period} />
              </TabsContent>
            </Tabs>
          </div>
        );
      }}
    </Loaded>
  );
}
