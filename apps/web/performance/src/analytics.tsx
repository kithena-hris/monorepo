import {
  Alert,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartCard,
  EmptyState,
  HorizontalBarChart,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  TrendChart,
  icons,
  WidgetGrid,
  widgetSpan,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Refusal, day, useAct } from './shared';
import type { ScreenProps } from './types';
import { t as tr } from './i18n';

/**
 * Analytics (PRD §18; design PF7 v2): a cycle's completion and scores, how
 * raters compare, the trend across cycles, fairness, and a chart asked for in
 * words. No group smaller than five is shown: its value reads "—".
 */

/** A widget's way on: where its figure is worked on. */
function Go({ href, children }: { readonly href: string; readonly children: string }): JSX.Element {
  return (
    <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
      <a href={href}>{children}</a>
    </Button>
  );
}

interface Metric {
  readonly label: string;
  readonly value: number | null;
  readonly n: number;
}

export interface AnalyticsData {
  readonly tab: string;
  readonly cycles: readonly { readonly id: string; readonly name: string }[];
  readonly cycleId: string | null;
  readonly cohort: number;
  readonly empty?: boolean;
  readonly tiles?: {
    readonly completion: number;
    readonly byKind: Readonly<Record<string, number>>;
    readonly onTime: number | null;
    readonly average: number | null;
    readonly acknowledged: number;
    readonly released: number;
  };
  readonly byDepartment?: readonly Metric[];
  readonly distribution?: readonly {
    readonly label: string;
    readonly value: number;
    readonly count: number;
  }[];
  readonly perDay?: readonly { readonly day: string; readonly count: number }[];
  readonly company?: number | null;
  readonly raters?: readonly {
    readonly name: string;
    readonly average: number | null;
    readonly count: number;
    readonly spread: readonly number[];
  }[];
  readonly notes?: readonly {
    readonly tone: string;
    readonly title: string;
    readonly detail: string;
  }[];
  readonly hiddenRaters?: number;
  readonly trend?: readonly {
    readonly cycle: string;
    readonly average: number | null;
    readonly onTime: number | null;
  }[];
  readonly prefill?: readonly Metric[];
  readonly hidden?: readonly { readonly title: string; readonly detail: string }[];
  readonly saved?: readonly {
    readonly id: string;
    readonly title: string;
    readonly plan: unknown;
  }[];
}

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${String(v)}%`;
const shown = (rows: readonly Metric[]): { label: string; value: number }[] =>
  rows.filter((r) => r.value !== null).map((r) => ({ label: r.label, value: r.value ?? 0 }));

/** Each view of one cycle's analytics, as Performance answers it; any may be missing (not allowed). */
export type CycleAnalyticsData = Partial<
  Record<'cycle' | 'raters' | 'fairness' | 'trends' | 'ask', AnalyticsData>
>;

/**
 * A cycle's analytics on its own page, one section after another: completion
 * and scores, how raters compare, fairness, the trend up to it, and a chart
 * asked for in words. A draft has none: analytics answers for the latest
 * launched cycle when asked about one, so a view about another cycle is not
 * shown.
 */
export function CycleAnalytics({
  id,
  views,
  ...props
}: ScreenProps<unknown> & {
  readonly id: string;
  readonly views: CycleAnalyticsData;
}): JSX.Element {
  const first = views.cycle ?? views.raters;
  if (first === undefined)
    return (
      <EmptyState
        icon={<icons.analytics aria-hidden />}
        title={tr('analytics.analytics_arent_open_to_you', 'Analytics aren’t open to you')}
        description={tr(
          'analytics.they_are_for_hr_and_calibrators',
          'They are for HR and calibrators.',
        )}
      />
    );
  if (first.empty === true || first.cycleId !== id)
    return (
      <EmptyState
        icon={<icons.analytics aria-hidden />}
        title={tr('analytics.nothing_to_measure_yet', 'Nothing to measure yet')}
        description={tr(
          'analytics.numbers_appear_once_this_cycle_has',
          'Numbers appear once this cycle has launched and reviews are written.',
        )}
      />
    );
  const section = (title: string, data: AnalyticsData | undefined): JSX.Element | null =>
    data === undefined ? null : (
      <section className="flex flex-col gap-3" aria-label={title}>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <Body data={data} {...(props as ScreenProps<AnalyticsData>)} />
      </section>
    );
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-fg-muted">
        {tr(
          'analytics.groups_smaller_than_are_hidden',
          'Groups smaller than {{cohort}} are hidden.',
          { cohort: String(first.cohort) },
        )}
      </p>
      {section(tr('analytics.completion_and_scores', 'Completion and scores'), views.cycle)}
      {section(tr('analytics.raters', 'Raters'), views.raters)}
      {section(tr('analytics.fairness', 'Fairness'), views.fairness)}
      {section(tr('analytics.across_cycles', 'Across cycles'), views.trends)}
      {section(tr('analytics.ask_for_a_chart', 'Ask for a chart'), views.ask)}
    </div>
  );
}

function Body({
  data,
  ...props
}: ScreenProps<AnalyticsData> & { readonly data: AnalyticsData }): JSX.Element {
  const act = useAct(props);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{
    plan: { title: string; chart: string };
    data: readonly Metric[];
    insights: readonly string[];
  } | null>(null);
  if (data.tab === 'cycle' && data.tiles !== undefined) {
    const cycle = `/performance/cycles/${data.cycleId ?? ''}`;
    return (
      <div className="flex flex-col gap-4">
        <WidgetGrid size="sm">
          <Stat
            label={tr('analytics.submitted', 'Submitted')}
            href={cycle}
            icon={<icons.success aria-hidden />}
            value={pct(data.tiles.completion)}
            description={tr(
              'analytics.of_every_review_in_the_cycle',
              'Of every review in the cycle',
            )}
          />
          <Stat
            label={tr('analytics.on_time', 'On time')}
            href={cycle}
            icon={<icons.scheduled aria-hidden />}
            value={pct(data.tiles.onTime)}
            description={tr('analytics.of_those_submitted', 'Of those submitted')}
          />
          <Stat
            label={tr('analytics.average_score', 'Average score')}
            href="/performance/calibration"
            icon={<icons.analytics aria-hidden />}
            value={data.tiles.average === null ? '—' : data.tiles.average.toFixed(2)}
            description={tr('analytics.manager_reviews', 'Manager reviews')}
          />
          <Stat
            label={tr('analytics.released', 'Released')}
            href={cycle}
            icon={<icons.document aria-hidden />}
            value={String(data.tiles.released)}
            description={tr('analytics.acknowledged', '{{acknowledged}} acknowledged', {
              acknowledged: String(data.tiles.acknowledged),
            })}
          />
        </WidgetGrid>
        <WidgetGrid>
          <ChartCard
            className={widgetSpan(2)}
            title={tr('analytics.submitted_by_kind', 'Submitted, by kind')}
            action={<Go href={cycle}>{tr('analytics.chase', 'Chase')}</Go>}
          >
            <HorizontalBarChart
              label={tr('analytics.submitted_by_kind_2', 'Submitted by kind')}
              showValues
              format={(v) => `${String(v)}%`}
              data={Object.entries(data.tiles.byKind).map(([k, v]) => ({
                label: k.charAt(0).toUpperCase() + k.slice(1),
                value: v,
              }))}
            />
          </ChartCard>
          <ChartCard
            className={widgetSpan(2)}
            title={tr('analytics.scores', 'Scores')}
            action={
              <Go href="/performance/calibration">{tr('analytics.calibrate', 'Calibrate')}</Go>
            }
          >
            <BarChart
              label={tr('analytics.people_by_score', 'People by score')}
              showValues
              data={(data.distribution ?? []).map((d) => ({ label: d.label, value: d.count }))}
            />
          </ChartCard>
          <ChartCard
            className={widgetSpan(2)}
            title={tr(
              'analytics.self_reviews_submitted_by_department',
              'Self reviews submitted, by department',
            )}
            action={<Go href={cycle}>{tr('analytics.chase', 'Chase')}</Go>}
          >
            {shown(data.byDepartment ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">
                {tr(
                  'analytics.no_department_is_large_enough_to',
                  'No department is large enough to show.',
                )}
              </p>
            ) : (
              <HorizontalBarChart
                label={tr('analytics.completion_by_department', 'Completion by department')}
                showValues
                format={(v) => `${String(Math.round(v))}%`}
                data={shown(data.byDepartment ?? [])}
              />
            )}
          </ChartCard>
          <ChartCard
            className={widgetSpan(2)}
            title={tr('analytics.submitted_each_day', 'Submitted each day')}
            action={<Go href={cycle}>{tr('analytics.open_the_cycle', 'Open the cycle')}</Go>}
          >
            {(data.perDay ?? []).length < 2 ? (
              <p className="text-sm text-fg-muted">
                {tr('analytics.not_enough_days_yet', 'Not enough days yet.')}
              </p>
            ) : (
              <TrendChart
                label={tr('analytics.reviews_submitted_per_day', 'Reviews submitted per day')}
                series={[
                  {
                    label: tr('analytics.submitted', 'Submitted'),
                    data: (data.perDay ?? []).map((d) => ({ label: day(d.day), value: d.count })),
                  },
                ]}
              />
            )}
          </ChartCard>
        </WidgetGrid>
      </div>
    );
  }
  if (data.tab === 'raters')
    return (
      <div className="flex flex-col gap-4">
        {(data.notes ?? []).map((n) => (
          <Alert key={n.title} tone="warning" title={n.title}>
            {n.detail}
          </Alert>
        ))}
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('analytics.rater', 'Rater')}</TableHead>
                  <TableHead>{tr('analytics.reviews', 'Reviews')}</TableHead>
                  <TableHead>{tr('analytics.average', 'Average')}</TableHead>
                  <TableHead>
                    {tr('analytics.against_the_company', 'Against the company')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.raters ?? []).map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm">{String(r.count)}</TableCell>
                    <TableCell className="text-sm">{r.average?.toFixed(2) ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      {r.average === null || data.company === null || data.company === undefined
                        ? '—'
                        : `${r.average >= data.company ? '+' : ''}${(r.average - data.company).toFixed(2)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(data.hiddenRaters ?? 0) > 0 ? (
              <p className="mt-2 text-sm text-fg-muted">
                {tr(
                  'analytics.raters_with_fewer_than_reviews_are',
                  '{{hiddenRaters}} raters with fewer than {{cohort}} reviews are not shown.',
                  { hiddenRaters: String(data.hiddenRaters), cohort: String(data.cohort) },
                )}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  if (data.tab === 'trends')
    return (
      <WidgetGrid>
        <ChartCard
          className={widgetSpan(3)}
          title={tr('analytics.across_cycles', 'Across cycles')}
          action={<Go href="/performance/cycles">{tr('analytics.all_cycles', 'All cycles')}</Go>}
        >
          {(data.trend ?? []).length < 2 ? (
            <p className="text-sm text-fg-muted">
              {tr('analytics.a_trend_needs_two_cycles', 'A trend needs two cycles.')}
            </p>
          ) : (
            <TrendChart
              label={tr(
                'analytics.average_score_and_on_time_share',
                'Average score and on-time share across cycles',
              )}
              series={[
                {
                  label: tr('analytics.average_score', 'Average score'),
                  data: (data.trend ?? []).map((t) => ({ label: t.cycle, value: t.average ?? 0 })),
                },
              ]}
            />
          )}
        </ChartCard>
      </WidgetGrid>
    );
  if (data.tab === 'fairness')
    return (
      <div className="flex flex-col gap-4">
        <WidgetGrid size="sm">
          {(data.prefill ?? []).map((p) => (
            <Stat
              key={p.label}
              label={p.label}
              value={p.value === null ? '—' : p.value.toFixed(2)}
              description={tr('analytics.manager_reviews_2', '{{n}} manager reviews', {
                n: String(p.n),
              })}
            />
          ))}
        </WidgetGrid>
        <WidgetGrid>
          <ChartCard
            className={widgetSpan(2)}
            title={tr('analytics.average_score_by_department', 'Average score, by department')}
            action={
              <Go href="/performance/calibration">{tr('analytics.calibrate', 'Calibrate')}</Go>
            }
          >
            {shown(data.byDepartment ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">
                {tr(
                  'analytics.no_department_is_large_enough_to',
                  'No department is large enough to show.',
                )}
              </p>
            ) : (
              <HorizontalBarChart
                label={tr('analytics.score_by_department', 'Score by department')}
                showValues
                format={(v) => v.toFixed(2)}
                data={shown(data.byDepartment ?? [])}
              />
            )}
          </ChartCard>
        </WidgetGrid>
        {(data.hidden ?? []).map((h) => (
          <Alert key={h.title} tone="info" title={h.title}>
            {h.detail}
          </Alert>
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label={tr('analytics.ask_for_a_chart', 'Ask for a chart')}
            autoResize
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
            }}
            placeholder={tr(
              'analytics.which_departments_are_furthest_behind_on',
              'Which departments are furthest behind on self reviews?',
            )}
          />
          <Button
            className="self-start"
            disabled={question.trim().length < 3}
            loading={act.pending}
            startIcon={<icons.assistant aria-hidden />}
            onClick={() => {
              void act
                .call('AskPerformanceChart', { input: { question, cycleId: data.cycleId } })
                .then((d) => {
                  if (d.ok) setAnswer(d.data as NonNullable<typeof answer>);
                });
            }}
          >
            {tr('analytics.ask', 'Ask')}
          </Button>
          <Refusal error={act.error} />
        </CardContent>
      </Card>
      {answer === null ? null : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle level={2}>{answer.plan.title}</CardTitle>
            <Button
              size="sm"
              variant="secondary"
              loading={act.pending}
              onClick={() => {
                act.run('SavePerformanceChart', {
                  input: { title: answer.plan.title, plan: answer.plan },
                });
              }}
            >
              {tr('analytics.save', 'Save')}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <HorizontalBarChart label={answer.plan.title} showValues data={shown(answer.data)} />
            {answer.insights.map((i) => (
              <p key={i} className="text-sm">
                {i}
              </p>
            ))}
            <p className="text-xs text-fg-muted">
              {tr(
                'analytics.the_numbers_are_kithenas_ai_chose',
                'The numbers are Kithena’s; AI chose the chart and wrote the sentences.',
              )}
            </p>
          </CardContent>
        </Card>
      )}
      {(data.saved ?? []).length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('analytics.saved_charts', 'Saved charts')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {(data.saved ?? []).map((c) => (
              <p key={c.id}>{c.title}</p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
