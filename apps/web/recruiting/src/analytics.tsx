import {
  Alert,
  BarChart,
  Button,
  ChartCard,
  EmptyState,
  FunnelChart,
  HorizontalBarChart,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TrendChart,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, useAct, words } from './shared';
import type { AnalyticsData, Bucket, ScreenProps } from './types';

/**
 * R23 and R25: dashboards over the stage history, filters in the address,
 * and a chart built from chips. Every number is Recruiting's; a group under
 * five people arrives withheld and is drawn as such.
 */

const DASHBOARDS = ['overview', 'funnel', 'speed', 'sources', 'offers', 'ask'] as const;
type Dashboard = (typeof DASHBOARDS)[number];
const PERIODS = ['last_30_days', 'last_90_days', 'this_quarter', 'this_year', 'last_year'] as const;

const METRICS: readonly { key: string; label: string; by: readonly string[] }[] = [
  {
    key: 'applications',
    label: 'Applications',
    by: ['department', 'source', 'job', 'country', 'month'],
  },
  {
    key: 'hires',
    label: 'Hires',
    by: ['department', 'source', 'job', 'country', 'month', 'hiring_manager'],
  },
  { key: 'conversion', label: 'Conversion by stage', by: ['stage', 'job', 'department', 'source'] },
  {
    key: 'time_to_hire',
    label: 'Time to hire',
    by: ['department', 'job', 'source', 'month', 'country'],
  },
  {
    key: 'rejection_reasons',
    label: 'Rejection reasons',
    by: ['rejection_reason', 'stage', 'job'],
  },
];

const points = (buckets: readonly Bucket[]) =>
  buckets
    .filter((b) => !b.suppressed && b.value !== null)
    .map((b) => ({ label: words(b.key), value: b.value ?? 0 }));

function Withheld({ buckets }: { readonly buckets: readonly Bucket[] }): JSX.Element | null {
  const n = buckets.filter((b) => b.suppressed).length;
  return n === 0 ? null : (
    <p className="text-xs text-fg-muted">{`${String(n)} group${n === 1 ? '' : 's'} under five people withheld.`}</p>
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
      <div className="flex flex-wrap items-end gap-2">
        {chip(
          'Metric',
          metric,
          (v) => {
            setMetric(v);
            setBy(METRICS.find((x) => x.key === v)?.by[0] ?? 'department');
          },
          METRICS,
        )}
        {chip(
          'By',
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
          Draw
        </Button>
      </div>
      <Refusal error={act.error} />
      {rows === null ? null : (
        <ChartCard
          title={`${m?.label ?? ''} by ${words(by).toLowerCase()}`}
          description={words(period)}
        >
          <BarChart label={`${m?.label ?? ''} by ${words(by)}`} data={points(rows)} showValues />
          <Withheld buckets={rows} />
        </ChartCard>
      )}
      <p className="text-xs text-fg-muted">
        Every chart is validated whole and computed by Kithena; a breakdown that would show a group
        under five people is refused.
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
        const days = (n: number | null) => (n === null ? '—' : `${String(Math.round(n))} d`);
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title="Analytics"
              description="Every number is computed from the stage history. Groups under five people are hidden."
              actions={
                <Select
                  value={data.filters.period}
                  onValueChange={(v) =>
                    props.onFilter?.({ period: v === 'last_90_days' ? null : v })
                  }
                >
                  <SelectTrigger aria-label="Period" className="w-44">
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
                title="One job"
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => props.onFilter?.({ job: null })}
                  >
                    All jobs
                  </Button>
                }
              >
                Filtered to the job you came from.
              </Alert>
            )}
            <h2 className="sr-only">{tab === 'ask' ? 'Build a chart' : words(tab)}</h2>
            <Tabs
              value={tab}
              onValueChange={(v) => props.onFilter?.({ dashboard: v === 'overview' ? null : v })}
            >
              <TabsList>
                {DASHBOARDS.map((d) => (
                  <TabsTrigger key={d} value={d}>
                    {d === 'ask' ? 'Build a chart' : words(d)}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview" className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Open jobs" value={String(o.openJobs)} />
                  <Stat label="Applications" value={String(o.applications)} />
                  <Stat label="Hires" value={String(o.hires)} />
                  <Stat label="Offers out" value={String(o.offersOut)} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <ChartCard title="Hires by month">
                    {o.hiresByMonth.length === 0 ? (
                      <EmptyState
                        icon={<icons.analytics aria-hidden />}
                        title="No hires in this period"
                      />
                    ) : (
                      <TrendChart
                        label="Hires by month"
                        series={[
                          {
                            label: 'Hires',
                            data: o.hiresByMonth.map((h) => ({ label: h.month, value: h.hires })),
                          },
                        ]}
                      />
                    )}
                  </ChartCard>
                  <ChartCard
                    title="Pipeline by stage"
                    description="Applications that ever reached each stage"
                  >
                    <FunnelChart
                      label="Pipeline by stage"
                      data={o.funnel.map((f) => ({ label: words(f.category), value: f.count }))}
                      showConversion
                    />
                  </ChartCard>
                </div>
              </TabsContent>
              <TabsContent value="funnel" className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Conversion per stage">
                  <FunnelChart
                    label="Conversion per stage"
                    data={o.funnel.map((f) => ({ label: words(f.category), value: f.count }))}
                    showConversion
                    highlightBiggestDrop
                  />
                </ChartCard>
                <ChartCard title="Time in stage" description="Median days">
                  <HorizontalBarChart
                    label="Median days in stage"
                    data={data.timeInStage
                      .filter((t) => t.median !== null)
                      .map((t) => ({ label: words(t.category), value: Math.round(t.median ?? 0) }))}
                    showValues
                  />
                </ChartCard>
                <ChartCard title="Rejection reasons" className="lg:col-span-2">
                  <HorizontalBarChart
                    label="Rejection reasons"
                    data={points(o.rejectionReasons)}
                    showValues
                    sorted
                  />
                  <Withheld buckets={o.rejectionReasons} />
                </ChartCard>
              </TabsContent>
              <TabsContent value="speed" className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Stat label="Median time to hire" value={days(o.timeToHire.median)} />
                  <Stat label="85th percentile" value={days(o.timeToHire.p85)} />
                </div>
                <ChartCard
                  title="Time to fill"
                  description="Job opened to the last opening hired, days"
                >
                  <HorizontalBarChart
                    label="Time to fill by job"
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
                  title="Applications by source"
                  description="Source is fixed at application, so attribution can’t drift"
                >
                  <HorizontalBarChart
                    label="Applications by source"
                    data={points(o.sources)}
                    showValues
                    sorted
                  />
                  <Withheld buckets={o.sources} />
                </ChartCard>
              </TabsContent>
              <TabsContent value="offers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Acceptance rate"
                  value={data.offers.rate === null ? '—' : `${data.offers.rate}%`}
                />
                <Stat label="Sent" value={String(data.offers.sent)} />
                <Stat label="Accepted" value={String(data.offers.accepted)} />
                <Stat label="Declined" value={String(data.offers.declined)} />
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
