import {
  Alert,
  AutoGrid,
  BarChart,
  Button,
  ChartCard,
  ChipGroup,
  ChipGroupItem,
  EmptyState,
  HeatmapChart,
  HorizontalBarChart,
  Icon,
  List,
  ListItem,
  RangeChart,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  StackedBarChart,
  Stat,
  Text,
  TimelineChart,
  TrendChart,
  WaterfallChart,
  type ChartPoint,
  type ChartTone,
  type RangeBand,
  type TimelineRow,
} from '@reach/ui-native';
import { ChartColumn, Clock } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useRead } from '../api';
import type { PeopleScreen } from '../routes';
import { WhatChanged } from './what-changed';

interface PayGroup {
  readonly label: string;
  readonly currency: string;
  readonly status: 'ok' | 'insufficient_data';
  readonly people: number | null;
  readonly p25: string | null;
  readonly median: string | null;
  readonly p75: string | null;
  readonly band: {
    readonly minimumMinor: string;
    readonly midpointMinor: string;
    readonly maximumMinor: string;
  } | null;
}

/** `peopleAnalytics`, as much of it as the phone draws. */
interface Analytics {
  readonly asOf: string;
  readonly source: 'snapshot' | 'history';
  readonly sourceNote: string;
  readonly minimum: number | null;
  readonly segment: { readonly id: string; readonly name: string } | null;
  readonly segments: readonly { readonly id: string; readonly name: string }[];
  readonly headcount: { value: number; change: number | null; trend: readonly ChartPoint[] };
  readonly startingSoon: number | null;
  readonly attrition: {
    percent: number;
    leavers: number;
    formula: string;
    trend: readonly ChartPoint[] | null;
  } | null;
  readonly complete: { percent: number; incomplete: number } | null;
  readonly expiringIn90Days: number | null;
  readonly expiries: {
    today: string;
    items: readonly { kind: string; personId: string; name: string | null; day: string }[];
  } | null;
  readonly movement: {
    period: string;
    opening: number;
    joiners: number;
    moves: number;
    leavers: number;
    closing: number;
  } | null;
  readonly completenessBySection: readonly ChartPoint[] | null;
  readonly tenure: readonly { label: string; headcount: number; leavers: number }[] | null;
  readonly span: readonly ChartPoint[] | null;
  readonly joiners: {
    months: readonly string[];
    departments: readonly string[];
    cells: readonly { row: string; column: string; value: number }[];
  } | null;
  readonly composition: {
    categories: readonly string[];
    series: readonly { label: string; values: readonly number[] }[];
  } | null;
  readonly selfId:
    | readonly {
        key: string;
        label: string;
        status: 'ok' | 'insufficient_data';
        minimum: number | null;
        publishedAsOf: string | null;
        note: string;
        cells: readonly ChartPoint[];
      }[]
    | null;
  readonly pay: {
    asOf: string | null;
    minimum: number;
    grade: readonly PayGroup[];
    tenure: readonly PayGroup[];
    compa: readonly PayGroup[];
  } | null;
}

const TABS = [
  ['what-changed', 'What changed'],
  ['headcount', 'Headcount'],
  ['turnover', 'Turnover'],
  ['data-quality', 'Quality'],
  ['pay', 'Pay'],
] as const;

const percent = (n: number): string => `${n.toFixed(1)}%`;

/** A calendar date some days on: the 90 days the expiries cover. */
const plusDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const EXPIRY: Readonly<Record<string, { label: string; tone: ChartTone }>> = {
  work_permit: { label: 'Work permit', tone: 'danger' },
  fixed_term: { label: 'Contract ends', tone: 'warning' },
  probation: { label: 'Probation ends', tone: 'info' },
  certification: { label: 'Certification', tone: 'neutral' },
};

/** One lane per person, numbered when two share a name, as the web's `expiryRows`. */
function expiryRows(items: NonNullable<Analytics['expiries']>['items']): TimelineRow[] {
  const lanes = new Map<string, { label: string; items: TimelineRow['items'][number][] }>();
  const taken = new Map<string, number>();
  for (const item of items) {
    let lane = lanes.get(item.personId);
    if (lane === undefined) {
      const name = item.name ?? 'Unnamed';
      const seen = (taken.get(name) ?? 0) + 1;
      taken.set(name, seen);
      lane = { label: seen === 1 ? name : `${name} (${String(seen)})`, items: [] };
      lanes.set(item.personId, lane);
    }
    const { label, tone } = EXPIRY[item.kind] ?? { label: item.kind, tone: 'neutral' as const };
    lane.items.push({
      id: `${item.personId}:${item.kind}:${item.day}`,
      label,
      start: item.day,
      tone,
    });
  }
  return [...lanes.values()];
}

const digits = (currency: string): number =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
const money = (currency: string) => (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
const byCurrency = (groups: readonly PayGroup[]): [string, PayGroup[]][] => {
  const found = new Map<string, PayGroup[]>();
  for (const g of groups) found.set(g.currency, [...(found.get(g.currency) ?? []), g]);
  return [...found];
};

/** The groups a chart could not draw, said in words beneath it: never a number. */
function unshown(
  withheld: readonly PayGroup[],
  minimum: number,
  unbanded: readonly PayGroup[] = [],
) {
  if (withheld.length === 0 && unbanded.length === 0) return null;
  return (
    <Text variant="footnote" tone="muted">
      {`${
        withheld.length === 0
          ? ''
          : `Insufficient data, fewer than ${String(minimum)} people: ${withheld.map((g) => g.label).join(', ')}. `
      }${unbanded.length === 0 ? '' : `No band set: ${unbanded.map((g) => g.label).join(', ')}.`}`}
    </Text>
  );
}

/**
 * A question and its chart, its numbers a tap away: a chart is never the
 * only way to a number.
 */
function Section({
  title,
  description,
  numbers,
  children,
}: {
  title: string;
  description: string;
  numbers: readonly (readonly [string, string | number])[];
  children: ReactNode;
}): React.JSX.Element {
  const [shown, setShown] = useState(false);
  return (
    <ChartCard
      title={title}
      description={description}
      action={
        <Button
          size="sm"
          variant="ghost"
          onPress={() => {
            setShown((s) => !s);
          }}
        >
          {shown ? 'Hide' : 'Numbers'}
        </Button>
      }
    >
      {children}
      {shown ? (
        <List>
          {numbers.map(([what, value], i) => (
            <ListItem
              key={`${String(i)}:${what}`}
              trailing={
                <Text className="tabular-nums">
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </Text>
              }
            >
              {what}
            </ListItem>
          ))}
        </List>
      ) : null}
    </ChartCard>
  );
}

/** A chart wider than a phone: it scrolls sideways rather than squeezing to a smear. */
const Wide = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <ScrollView horizontal showsHorizontalScrollIndicator>
    <View style={{ width: 576 }}>{children}</View>
  </ScrollView>
);

/** One tab of the charts (design G2): its figures, then each question, stacked. */
function Charts({ a, tab }: { a: Analytics; tab: string }): React.JSX.Element {
  const figures: React.JSX.Element[] = [];
  const sections: React.JSX.Element[] = [];
  const { headcount, attrition, complete, movement } = a;
  const joined = a.joiners === null ? null : a.joiners.cells.reduce((n, c) => n + c.value, 0);

  if (tab === 'headcount') {
    figures.push(
      <Stat
        key="headcount"
        label="Headcount"
        value={headcount.value.toLocaleString()}
        {...(headcount.change === null
          ? {}
          : {
              delta: `${headcount.change > 0 ? '+' : ''}${String(headcount.change)}`,
              deltaLabel: 'since last month',
              direction: headcount.change > 0 ? 'up' : headcount.change < 0 ? 'down' : 'flat',
            })}
      />,
    );
    if (joined !== null) figures.push(<Stat key="joined" label="Joined, 12M" value={joined} />);
    if (attrition !== null) {
      figures.push(
        <Stat
          key="left"
          label="Left, 12M"
          value={attrition.leavers}
          description={`${percent(attrition.percent)} attrition`}
        />,
      );
    }
    if (a.startingSoon !== null) {
      figures.push(
        <Stat
          key="starting"
          label="Starting soon"
          value={a.startingSoon}
          description="Hired, not started yet"
        />,
      );
    }
    if (headcount.trend.length > 1) {
      sections.push(
        <Section
          key="trend"
          title="Headcount by month"
          description={`${headcount.value.toLocaleString()} today`}
          numbers={headcount.trend.map((p) => [p.label, p.value])}
        >
          <TrendChart
            label="Headcount by month"
            series={[{ label: 'Headcount', data: headcount.trend }]}
            area
            showLastPoint
          />
        </Section>,
      );
    }
    if (movement !== null) {
      sections.push(
        <Section
          key="movement"
          title="Where the change came from"
          description={`${movement.period} · the numbers reconcile to the closing headcount`}
          numbers={[
            ['Opening', movement.opening],
            ['Joiners', movement.joiners],
            ['Internal moves', movement.moves],
            ['Leavers', -movement.leavers],
            ['Closing', movement.closing],
          ]}
        >
          <WaterfallChart
            label="Headcount movement"
            data={[
              { label: 'Opening', value: movement.opening, total: true },
              { label: 'Joiners', value: movement.joiners, tone: 'success' },
              { label: 'Moves', value: movement.moves },
              { label: 'Leavers', value: -movement.leavers, tone: 'danger' },
              { label: 'Closing', value: movement.closing, total: true },
            ]}
          />
        </Section>,
      );
    }
    const composition = a.composition;
    if (composition !== null && composition.categories.length > 0) {
      sections.push(
        <Section
          key="composition"
          title="What we are made of"
          description="Headcount by department, split by employment type"
          numbers={composition.categories.flatMap((category, i) =>
            composition.series.map((s): [string, number] => [
              `${category}, ${s.label}`,
              s.values[i] ?? 0,
            ]),
          )}
        >
          <StackedBarChart
            label="Headcount by department and employment type"
            categories={composition.categories}
            series={composition.series}
          />
        </Section>,
      );
    }
    const joiners = a.joiners;
    if (joiners !== null && joiners.cells.length > 0) {
      sections.push(
        <Section
          key="joiners"
          title="When people join"
          description="Joiners by department and month, the last 12 months"
          numbers={joiners.cells.map((c) => [`${c.row}, ${c.column}`, c.value])}
        >
          <Wide>
            <HeatmapChart
              label="Joiners by department and month"
              rows={joiners.departments}
              columns={joiners.months}
              cells={joiners.cells}
              describe={(value, row, column) =>
                `${String(value)} ${value === 1 ? 'joiner' : 'joiners'} in ${row}, ${column}`
              }
            />
          </Wide>
        </Section>,
      );
    }
  }

  if (tab === 'turnover') {
    if (attrition !== null) {
      figures.push(
        <Stat
          key="attrition"
          label="Attrition, rolling 12 months"
          value={percent(attrition.percent)}
          description={`Annualised over ${String(attrition.leavers)} leavers: ${attrition.formula}`}
        />,
      );
      if (attrition.trend !== null && attrition.trend.length >= 2) {
        sections.push(
          <Section
            key="attrition"
            title="Are people leaving faster"
            description={`Rolling 12 months: ${attrition.formula}`}
            numbers={attrition.trend.map((p) => [p.label, percent(p.value)])}
          >
            <TrendChart
              label="Attrition, rolling 12 months"
              series={[{ label: 'Attrition', tone: 'danger', data: attrition.trend }]}
              format={percent}
            />
          </Section>,
        );
      }
    }
    const tenure = a.tenure;
    if (tenure !== null) {
      sections.push(
        <Section
          key="tenure"
          title="Who is at risk of leaving"
          description="Tenure today, beside the tenure at leaving of the last 12 months' leavers"
          numbers={tenure.flatMap((b): [string, number][] => [
            [`${b.label}: here now`, b.headcount],
            [`${b.label}: left`, b.leavers],
          ])}
        >
          <StackedBarChart
            label="Tenure bands"
            categories={tenure.map((b) => b.label)}
            series={[
              {
                label: 'Left in the last 12 months',
                tone: 'danger',
                values: tenure.map((b) => b.leavers),
              },
              { label: 'Here now', tone: 'accent', values: tenure.map((b) => b.headcount) },
            ]}
          />
        </Section>,
      );
    }
    if (a.span !== null && a.span.length > 0) {
      sections.push(
        <Section
          key="span"
          title="Is the org shaped sensibly"
          description="How many managers have how many direct reports"
          numbers={a.span.map((p) => [p.label, p.value])}
        >
          <BarChart label="Span of control" data={a.span} showValues />
        </Section>,
      );
    }
  }

  if (tab === 'data-quality') {
    if (complete !== null) {
      figures.push(
        <Stat
          key="complete"
          label="Records complete"
          value={percent(complete.percent)}
          description={`${String(complete.incomplete)} records are incomplete`}
        />,
      );
    }
    if (a.expiringIn90Days !== null) {
      figures.push(<Stat key="expiring" label="Expiring in 90 days" value={a.expiringIn90Days} />);
    }
    if (a.completenessBySection !== null) {
      sections.push(
        <Section
          key="sections"
          title="Where our data is thin"
          description="Completeness by section"
          numbers={a.completenessBySection.map((p) => [p.label, percent(p.value)])}
        >
          <HorizontalBarChart
            label="Completeness by section"
            data={a.completenessBySection}
            format={percent}
          />
        </Section>,
      );
    }
    const expiries = a.expiries;
    if (expiries !== null) {
      sections.push(
        <Section
          key="expiries"
          title="What expires next"
          description="Work permits, fixed-term contracts, probation and certifications over the next 90 days"
          numbers={expiries.items.map((item): [string, string] => [
            `${item.name ?? 'Unnamed'}: ${EXPIRY[item.kind]?.label ?? item.kind}`,
            item.day,
          ])}
        >
          {expiries.items.length === 0 ? (
            <Text tone="muted">Nothing expires in the next 90 days.</Text>
          ) : (
            <Wide>
              <TimelineChart
                label="Expiries"
                rows={expiryRows(expiries.items)}
                today={expiries.today}
                domain={{ start: expiries.today, end: plusDays(expiries.today, 90) }}
                unit="week"
              />
            </Wide>
          )}
        </Section>,
      );
    }
  }

  if (tab === 'pay') {
    const pay = a.pay;
    if (pay !== null) {
      if (pay.asOf === null) {
        sections.push(
          <Alert key="pay" tone="info" title="How pay is distributed">
            Pay in aggregate appears after the next nightly snapshot.
          </Alert>,
        );
      } else {
        const note = `From the snapshot of ${pay.asOf} · quartiles only; groups under ${String(pay.minimum)} people are not shown`;
        const quartiles = (
          g: PayGroup,
          format: (v: number) => string,
          scale: (v: string) => number,
        ) =>
          g.status !== 'ok' || g.p25 === null || g.median === null || g.p75 === null
            ? 'Insufficient data'
            : `${format(scale(g.p25))} / ${format(scale(g.median))} / ${format(scale(g.p75))} (${String(g.people)} people)`;
        for (const [currency, groups] of byCurrency(pay.grade)) {
          const format = money(currency);
          const scale = (v: string): number => Number(v) / 10 ** digits(currency);
          const data: RangeBand[] = groups
            .filter((g) => g.status === 'ok' && g.band !== null)
            .map((g) => ({
              label: g.label,
              meta: `${String(g.people)} people`,
              min: scale(g.band?.minimumMinor ?? '0'),
              mid: scale(g.band?.midpointMinor ?? '0'),
              max: scale(g.band?.maximumMinor ?? '0'),
              value: scale(g.median ?? '0'),
              spread: { low: scale(g.p25 ?? '0'), high: scale(g.p75 ?? '0') },
            }));
          sections.push(
            <Section
              key={`grade:${currency}`}
              title={`How pay sits in each band, ${currency}`}
              description={note}
              numbers={groups.map((g) => [
                `${g.label}: 25th / median / 75th`,
                quartiles(g, format, scale),
              ])}
            >
              {data.length === 0 ? null : (
                <RangeChart
                  label={`Base salary by grade, ${currency}`}
                  valueLabel="Median"
                  spreadLabel="Middle half"
                  data={data}
                  format={format}
                />
              )}
              {unshown(
                groups.filter((g) => g.status !== 'ok'),
                pay.minimum,
                groups.filter((g) => g.status === 'ok' && g.band === null),
              )}
            </Section>,
          );
        }
        for (const [currency, groups] of byCurrency(pay.tenure)) {
          const format = money(currency);
          const scale = (v: string): number => Number(v) / 10 ** digits(currency);
          const shown = groups.filter((g) => g.status === 'ok');
          const series = (
            label: string,
            tone: ChartTone,
            pick: (g: PayGroup) => string | null,
          ) => ({
            label,
            tone,
            data: shown.map((g) => ({ label: g.label, value: scale(pick(g) ?? '0') })),
          });
          sections.push(
            <Section
              key={`tenure:${currency}`}
              title={`Pay against tenure, ${currency}`}
              description={`${note} · by tenure band, never a point per person`}
              numbers={groups.map((g) => [
                `${g.label}: 25th / median / 75th`,
                quartiles(g, format, scale),
              ])}
            >
              {shown.length < 2 ? null : (
                <TrendChart
                  label={`Base salary by tenure band, ${currency}`}
                  format={format}
                  series={[
                    series('75th percentile', 'neutral', (g) => g.p75),
                    series('Median', 'accent', (g) => g.median),
                    series('25th percentile', 'neutral', (g) => g.p25),
                  ]}
                />
              )}
              {unshown(
                groups.filter((g) => g.status !== 'ok'),
                pay.minimum,
              )}
            </Section>,
          );
        }
        for (const [currency, groups] of byCurrency(pay.compa)) {
          const ratio = (v: number): string => v.toFixed(2);
          const data: RangeBand[] = groups
            .filter((g) => g.status === 'ok' && g.band !== null)
            .map((g) => {
              const mid = Number(g.band?.midpointMinor ?? '1');
              return {
                label: g.label,
                meta: `${String(g.people)} people`,
                min: Number(g.band?.minimumMinor ?? '0') / mid,
                mid: 1,
                max: Number(g.band?.maximumMinor ?? '0') / mid,
                value: Number(g.median ?? '0'),
                spread: { low: Number(g.p25 ?? '0'), high: Number(g.p75 ?? '0') },
              };
            });
          sections.push(
            <Section
              key={`compa:${currency}`}
              title={`Compa-ratio by grade, ${currency}`}
              description={`${note} · salary over the band midpoint; 1.00 is on midpoint`}
              numbers={groups.map((g) => [
                `${g.label}: 25th / median / 75th`,
                quartiles(g, ratio, Number),
              ])}
            >
              {data.length === 0 ? null : (
                <RangeChart
                  label={`Compa-ratio by grade, ${currency}`}
                  valueLabel="Median compa-ratio"
                  spreadLabel="Middle half"
                  data={data}
                  format={ratio}
                />
              )}
              {unshown(
                groups.filter((g) => g.status !== 'ok'),
                pay.minimum,
              )}
            </Section>,
          );
        }
      }
    }
    for (const q of a.selfId ?? []) {
      const published =
        q.publishedAsOf === null ? 'Not published yet' : `Published ${q.publishedAsOf}`;
      sections.push(
        q.status === 'ok' ? (
          <Section
            key={q.key}
            title={q.label}
            description={`Voluntary self-identification · ${published} · ${q.note}`}
            numbers={q.cells.map((c) => [c.label, c.value])}
          >
            <BarChart label={q.label} data={q.cells} showValues />
          </Section>
        ) : (
          <Alert key={q.key} tone="info" title={`${q.label}: insufficient data`}>
            {`Fewer than ${String(q.minimum ?? 10)} people in at least one answer, so nothing is shown.`}
          </Alert>
        ),
      );
    }
  }

  if (figures.length === 0 && sections.length === 0) {
    return (
      <EmptyState
        icon={ChartColumn}
        title="Nothing to show on this tab"
        description="None of its figures are yours to see, or People has none to draw yet."
      />
    );
  }
  return (
    <>
      {figures.length === 0 ? null : (
        <AutoGrid minItemWidth={150} gap={2}>
          {figures}
        </AutoGrid>
      )}
      {sections}
    </>
  );
}

/**
 * Insights (design G1, G2): What changed, then the charts a tab at a time,
 * stacked; the segment they are about; and Scheduled reports behind the
 * clock, and at the foot, for HR.
 */
export function Insights({ navigation, route }: PeopleScreen<'Insights'>): React.JSX.Element {
  const [tab, setTab] = useState<string>(route.params?.tab ?? 'what-changed');
  const [segment, setSegment] = useState<string | null>(null);
  const { load, reload } = useRead<Analytics>('Analytics', { segment });
  const schedules = useRead<{ canManage: boolean; schedules: readonly { paused: boolean }[] }>(
    'ReportSchedules',
  ).load;
  const reports = schedules.status === 'ready' && schedules.data.canManage ? schedules.data : null;
  const back = { label: 'People', onPress: navigation.goBack };
  const trailing =
    reports === null ? undefined : (
      <Button
        size="sm"
        variant="ghost"
        startIcon={<Icon icon={Clock} />}
        accessibilityLabel="Scheduled reports"
        onPress={() => {
          navigation.navigate('ScheduledReports');
        }}
      />
    );

  return (
    <Page title="Insights" back={back} {...(trailing === undefined ? {} : { trailing })}>
      <View>
        <ChipGroup
          type="single"
          value={tab}
          onValueChange={setTab}
          accessibilityLabel="Insights"
          scroll
        >
          {TABS.map(([value, label]) => (
            <ChipGroupItem key={value} value={value} variant="view">
              {label}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </View>
      {load.status === 'ready' && load.data.segments.length > 0 ? (
        <Select
          value={segment ?? 'everybody'}
          onValueChange={(value) => {
            setSegment(value === 'everybody' ? null : value);
          }}
        >
          <SelectTrigger size="sm" accessibilityLabel="Segment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="everybody">Everybody you may see</SelectItem>
            {load.data.segments.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {tab === 'what-changed' ? (
        <WhatChanged
          segment={segment}
          go={(to) => {
            if (to.screen === 'Insights') setTab(to.tab);
            else if (to.screen === 'Directory')
              navigation.navigate('Directory', { conditions: to.conditions });
            else navigation.navigate(to.screen);
          }}
        />
      ) : load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading the figures" />
      ) : (
        <Stack gap={3}>
          <Text variant="footnote" tone="muted">
            {`${load.data.asOf}${load.data.segment === null ? '' : ` · ${load.data.segment.name}`} · ${load.data.sourceNote}${
              load.data.minimum === null
                ? ''
                : ` Groups under ${String(load.data.minimum)} people are hidden.`
            }`}
          </Text>
          {load.data.segment === null ? null : (
            <Alert tone="info">
              {`Showing the people you may see in ${load.data.segment.name}. Span of control, expiries and self-identification are not drawn for a segment.`}
            </Alert>
          )}
          {load.data.source === 'history' ? (
            <Alert tone="info">
              This date is between snapshots, so it was replayed from history. It is exact, and it
              was slower to answer.
            </Alert>
          ) : null}
          <Charts a={load.data} tab={tab} />
        </Stack>
      )}
      {reports === null ? null : (
        <List>
          <ListItem
            icon={Clock}
            description={`${String(reports.schedules.filter((s) => !s.paused).length)} active`}
            chevron
            onPress={() => {
              navigation.navigate('ScheduledReports');
            }}
          >
            Scheduled reports
          </ListItem>
        </List>
      )}
    </Page>
  );
}
