import {
  Alert,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Refusal, day, useAct } from './shared';
import type { ScreenProps } from './types';

/**
 * Analytics (PRD §18; design PF7 v2): a cycle's completion and scores, how
 * raters compare, the trend across cycles, fairness, and a chart asked for in
 * words. No group smaller than five is shown: its value reads "—".
 */

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
        title="Analytics aren’t open to you"
        description="They are for HR and calibrators."
      />
    );
  if (first.empty === true || first.cycleId !== id)
    return (
      <EmptyState
        icon={<icons.analytics aria-hidden />}
        title="Nothing to measure yet"
        description="Numbers appear once this cycle has launched and reviews are written."
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
      <p className="text-sm text-fg-muted">{`Groups smaller than ${String(first.cohort)} are hidden.`}</p>
      {section('Completion and scores', views.cycle)}
      {section('Raters', views.raters)}
      {section('Fairness', views.fairness)}
      {section('Across cycles', views.trends)}
      {section('Ask for a chart', views.ask)}
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
  if (data.tab === 'cycle' && data.tiles !== undefined)
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Submitted"
            value={pct(data.tiles.completion)}
            description="Of every review in the cycle"
          />
          <Stat label="On time" value={pct(data.tiles.onTime)} description="Of those submitted" />
          <Stat
            label="Average score"
            value={data.tiles.average === null ? '—' : data.tiles.average.toFixed(2)}
            description="Manager reviews"
          />
          <Stat
            label="Released"
            value={String(data.tiles.released)}
            description={`${String(data.tiles.acknowledged)} acknowledged`}
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle level={2}>Submitted, by kind</CardTitle>
            </CardHeader>
            <CardContent>
              <HorizontalBarChart
                label="Submitted by kind"
                showValues
                format={(v) => `${String(v)}%`}
                data={Object.entries(data.tiles.byKind).map(([k, v]) => ({
                  label: k.charAt(0).toUpperCase() + k.slice(1),
                  value: v,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Scores</CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart
                label="People by score"
                showValues
                data={(data.distribution ?? []).map((d) => ({ label: d.label, value: d.count }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Self reviews submitted, by department</CardTitle>
            </CardHeader>
            <CardContent>
              {shown(data.byDepartment ?? []).length === 0 ? (
                <p className="text-sm text-fg-muted">No department is large enough to show.</p>
              ) : (
                <HorizontalBarChart
                  label="Completion by department"
                  showValues
                  format={(v) => `${String(Math.round(v))}%`}
                  data={shown(data.byDepartment ?? [])}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Submitted each day</CardTitle>
            </CardHeader>
            <CardContent>
              {(data.perDay ?? []).length < 2 ? (
                <p className="text-sm text-fg-muted">Not enough days yet.</p>
              ) : (
                <TrendChart
                  label="Reviews submitted per day"
                  series={[
                    {
                      label: 'Submitted',
                      data: (data.perDay ?? []).map((d) => ({ label: day(d.day), value: d.count })),
                    },
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
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
                  <TableHead>Rater</TableHead>
                  <TableHead>Reviews</TableHead>
                  <TableHead>Average</TableHead>
                  <TableHead>Against the company</TableHead>
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
              <p className="mt-2 text-sm text-fg-muted">{`${String(data.hiddenRaters)} raters with fewer than ${String(data.cohort)} reviews are not shown.`}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  if (data.tab === 'trends')
    return (
      <Card>
        <CardHeader>
          <CardTitle level={2}>Across cycles</CardTitle>
        </CardHeader>
        <CardContent>
          {(data.trend ?? []).length < 2 ? (
            <p className="text-sm text-fg-muted">A trend needs two cycles.</p>
          ) : (
            <TrendChart
              label="Average score and on-time share across cycles"
              series={[
                {
                  label: 'Average score',
                  data: (data.trend ?? []).map((t) => ({ label: t.cycle, value: t.average ?? 0 })),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    );
  if (data.tab === 'fairness')
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {(data.prefill ?? []).map((p) => (
            <Stat
              key={p.label}
              label={p.label}
              value={p.value === null ? '—' : p.value.toFixed(2)}
              description={`${String(p.n)} manager reviews`}
            />
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle level={2}>Average score, by department</CardTitle>
          </CardHeader>
          <CardContent>
            {shown(data.byDepartment ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">No department is large enough to show.</p>
            ) : (
              <HorizontalBarChart
                label="Score by department"
                showValues
                format={(v) => v.toFixed(2)}
                data={shown(data.byDepartment ?? [])}
              />
            )}
          </CardContent>
        </Card>
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
            aria-label="Ask for a chart"
            autoResize
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
            }}
            placeholder="Which departments are furthest behind on self reviews?"
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
            Ask
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
              Save
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
              The numbers are Kithena’s; AI chose the chart and wrote the sentences.
            </p>
          </CardContent>
        </Card>
      )}
      {(data.saved ?? []).length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>Saved charts</CardTitle>
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
