import {
  Alert,
  AutoGrid,
  BarChart,
  Button,
  Card,
  ChartCard,
  type ChartPoint,
  type ChartTone,
  ChipGroup,
  ChipGroupItem,
  EmptyState,
  HeatmapChart,
  HorizontalBarChart,
  Icon,
  List,
  ListItem,
  numberFormat,
  type RangeBand,
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
  type TimelineRow,
  TrendChart,
  WaterfallChart,
} from '@reach/ui-native';
import { ChartColumn, Clock, Mail } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { ask, useRead, useSigned } from '../api';
import { parsed } from '../review/load';
import type { PeopleScreen } from '../routes';
import { cadenceText, type ScheduleRow } from './reports';
import { WhatChanged } from './what-changed';
import { t } from '../../i18n';

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

const TABS = () =>
  [
    ['summary', t('people.insights.insights.summary', 'Summary')],
    ['what-changed', t('people.insights.insights.what_changed', 'What changed')],
    ['headcount', t('people.insights.insights.headcount', 'Headcount')],
    ['turnover', t('people.insights.insights.turnover', 'Turnover')],
    ['data-quality', t('people.insights.insights.quality', 'Quality')],
    ['pay', t('people.insights.insights.pay', 'Pay')],
  ] as const;

const percent = (n: number): string => `${n.toFixed(1)}%`;

/** A calendar date some days on: the 90 days the expiries cover. */
const plusDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const EXPIRY = (): Readonly<Record<string, { label: string; tone: ChartTone }>> => ({
  work_permit: { label: t('people.insights.insights.work_permit', 'Work permit'), tone: 'danger' },
  fixed_term: {
    label: t('people.insights.insights.contract_ends', 'Contract ends'),
    tone: 'warning',
  },
  probation: {
    label: t('people.insights.insights.probation_ends', 'Probation ends'),
    tone: 'info',
  },
  certification: {
    label: t('people.insights.insights.certification', 'Certification'),
    tone: 'neutral',
  },
});

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
    const { label, tone } = EXPIRY()[item.kind] ?? { label: item.kind, tone: 'neutral' as const };
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
  numberFormat({ style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
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
          : t(
              'people.insights.insights.insufficient_data_fewer_than_people',
              'Insufficient data, fewer than {{String}} people: {{join}}. ',
              { String: String(minimum), join: withheld.map((g) => g.label).join(', ') },
            )
      }${unbanded.length === 0 ? '' : t('people.insights.insights.no_band_set', 'No band set: {{join}}.', { join: unbanded.map((g) => g.label).join(', ') })}`}
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
        label={t('people.insights.insights.headcount', 'Headcount')}
        value={headcount.value.toLocaleString()}
        {...(headcount.change === null
          ? {}
          : {
              delta: `${headcount.change > 0 ? '+' : ''}${String(headcount.change)}`,
              deltaLabel: t('people.insights.insights.since_last_month', 'since last month'),
              direction: headcount.change > 0 ? 'up' : headcount.change < 0 ? 'down' : 'flat',
            })}
      />,
    );
    if (joined !== null)
      figures.push(
        <Stat
          key="joined"
          label={t('people.insights.insights.joined_12m', 'Joined, 12M')}
          value={joined}
        />,
      );
    if (attrition !== null) {
      figures.push(
        <Stat
          key="left"
          label={t('people.insights.insights.left_12m', 'Left, 12M')}
          value={attrition.leavers}
          description={t('people.insights.insights.attrition', '{{percent}} attrition', {
            percent: percent(attrition.percent),
          })}
        />,
      );
    }
    if (a.startingSoon !== null) {
      figures.push(
        <Stat
          key="starting"
          label={t('people.insights.insights.starting_soon', 'Starting soon')}
          value={a.startingSoon}
          description={t(
            'people.insights.insights.hired_not_started_yet',
            'Hired, not started yet',
          )}
        />,
      );
    }
    if (headcount.trend.length > 1) {
      sections.push(
        <Section
          key="trend"
          title={t('people.insights.insights.headcount_by_month', 'Headcount by month')}
          description={t('people.insights.insights.today', '{{toLocaleString}} today', {
            toLocaleString: headcount.value.toLocaleString(),
          })}
          numbers={headcount.trend.map((p) => [p.label, p.value])}
        >
          <TrendChart
            label={t('people.insights.insights.headcount_by_month', 'Headcount by month')}
            series={[
              {
                label: t('people.insights.insights.headcount', 'Headcount'),
                data: headcount.trend,
              },
            ]}
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
          title={t(
            'people.insights.insights.where_the_change_came_from',
            'Where the change came from',
          )}
          description={t(
            'people.insights.insights.the_numbers_reconcile_to_the_closing',
            '{{period}} · the numbers reconcile to the closing headcount',
            { period: movement.period },
          )}
          numbers={[
            ['Opening', movement.opening],
            ['Joiners', movement.joiners],
            ['Internal moves', movement.moves],
            ['Leavers', -movement.leavers],
            ['Closing', movement.closing],
          ]}
        >
          <WaterfallChart
            label={t('people.insights.insights.headcount_movement', 'Headcount movement')}
            data={[
              {
                label: t('people.insights.insights.opening', 'Opening'),
                value: movement.opening,
                total: true,
              },
              {
                label: t('people.insights.insights.joiners', 'Joiners'),
                value: movement.joiners,
                tone: 'success',
              },
              { label: t('people.insights.insights.moves', 'Moves'), value: movement.moves },
              {
                label: t('people.insights.insights.leavers', 'Leavers'),
                value: -movement.leavers,
                tone: 'danger',
              },
              {
                label: t('people.insights.insights.closing', 'Closing'),
                value: movement.closing,
                total: true,
              },
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
          title={t('people.insights.insights.what_we_are_made_of', 'What we are made of')}
          description={t(
            'people.insights.insights.headcount_by_department_split_by_employment',
            'Headcount by department, split by employment type',
          )}
          numbers={composition.categories.flatMap((category, i) =>
            composition.series.map((s): [string, number] => [
              `${category}, ${s.label}`,
              s.values[i] ?? 0,
            ]),
          )}
        >
          <StackedBarChart
            label={t(
              'people.insights.insights.headcount_by_department_and_employment_type',
              'Headcount by department and employment type',
            )}
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
          title={t('people.insights.insights.when_people_join', 'When people join')}
          description={t(
            'people.insights.insights.joiners_by_department_and_month_the',
            'Joiners by department and month, the last 12 months',
          )}
          numbers={joiners.cells.map((c) => [`${c.row}, ${c.column}`, c.value])}
        >
          <Wide>
            <HeatmapChart
              label={t(
                'people.insights.insights.joiners_by_department_and_month',
                'Joiners by department and month',
              )}
              rows={joiners.departments}
              columns={joiners.months}
              cells={joiners.cells}
              describe={(value, row, column) =>
                t(
                  'people.insights.insights.joiners_in',
                  {
                    one: '{{count}} joiner in {{row}}, {{column}}',
                    other: '{{count}} joiners in {{row}}, {{column}}',
                  },
                  { count: value, row, column },
                )
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
          label={t(
            'people.insights.insights.attrition_rolling_12_months',
            'Attrition, rolling 12 months',
          )}
          value={percent(attrition.percent)}
          description={t(
            'people.insights.insights.annualised_over_leavers',
            'Annualised over {{String}} leavers: {{formula}}',
            { String: String(attrition.leavers), formula: attrition.formula },
          )}
        />,
      );
      if (attrition.trend !== null && attrition.trend.length >= 2) {
        sections.push(
          <Section
            key="attrition"
            title={t(
              'people.insights.insights.are_people_leaving_faster',
              'Are people leaving faster',
            )}
            description={t(
              'people.insights.insights.rolling_12_months',
              'Rolling 12 months: {{formula}}',
              { formula: attrition.formula },
            )}
            numbers={attrition.trend.map((p) => [p.label, percent(p.value)])}
          >
            <TrendChart
              label={t(
                'people.insights.insights.attrition_rolling_12_months',
                'Attrition, rolling 12 months',
              )}
              series={[
                {
                  label: t('people.insights.insights.attrition_2', 'Attrition'),
                  tone: 'danger',
                  data: attrition.trend,
                },
              ]}
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
          title={t(
            'people.insights.insights.who_is_at_risk_of_leaving',
            'Who is at risk of leaving',
          )}
          description={t(
            'people.insights.insights.tenure_today_beside_the_tenure_at',
            "Tenure today, beside the tenure at leaving of the last 12 months' leavers",
          )}
          numbers={tenure.flatMap((b): [string, number][] => [
            [`${b.label}: here now`, b.headcount],
            [`${b.label}: left`, b.leavers],
          ])}
        >
          <StackedBarChart
            label={t('people.insights.insights.tenure_bands', 'Tenure bands')}
            categories={tenure.map((b) => b.label)}
            series={[
              {
                label: t(
                  'people.insights.insights.left_in_the_last_12_months',
                  'Left in the last 12 months',
                ),
                tone: 'danger',
                values: tenure.map((b) => b.leavers),
              },
              {
                label: t('people.insights.insights.here_now', 'Here now'),
                tone: 'accent',
                values: tenure.map((b) => b.headcount),
              },
            ]}
          />
        </Section>,
      );
    }
    if (a.span !== null && a.span.length > 0) {
      sections.push(
        <Section
          key="span"
          title={t(
            'people.insights.insights.is_the_org_shaped_sensibly',
            'Is the org shaped sensibly',
          )}
          description={t(
            'people.insights.insights.how_many_managers_have_how_many',
            'How many managers have how many direct reports',
          )}
          numbers={a.span.map((p) => [p.label, p.value])}
        >
          <BarChart
            label={t('people.insights.insights.span_of_control', 'Span of control')}
            data={a.span}
            showValues
          />
        </Section>,
      );
    }
  }

  if (tab === 'data-quality') {
    if (complete !== null) {
      figures.push(
        <Stat
          key="complete"
          label={t('people.insights.insights.records_complete', 'Records complete')}
          value={percent(complete.percent)}
          description={t(
            'people.insights.insights.records_are_incomplete',
            '{{String}} records are incomplete',
            { String: String(complete.incomplete) },
          )}
        />,
      );
    }
    if (a.expiringIn90Days !== null) {
      figures.push(
        <Stat
          key="expiring"
          label={t('people.insights.insights.expiring_in_90_days', 'Expiring in 90 days')}
          value={a.expiringIn90Days}
        />,
      );
    }
    if (a.completenessBySection !== null) {
      sections.push(
        <Section
          key="sections"
          title={t('people.insights.insights.where_our_data_is_thin', 'Where our data is thin')}
          description={t(
            'people.insights.insights.completeness_by_section',
            'Completeness by section',
          )}
          numbers={a.completenessBySection.map((p) => [p.label, percent(p.value)])}
        >
          <HorizontalBarChart
            label={t('people.insights.insights.completeness_by_section', 'Completeness by section')}
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
          title={t('people.insights.insights.what_expires_next', 'What expires next')}
          description={t(
            'people.insights.insights.work_permits_fixed_term_contracts_probation',
            'Work permits, fixed-term contracts, probation and certifications over the next 90 days',
          )}
          numbers={expiries.items.map((item): [string, string] => [
            `${item.name ?? 'Unnamed'}: ${EXPIRY()[item.kind]?.label ?? item.kind}`,
            item.day,
          ])}
        >
          {expiries.items.length === 0 ? (
            <Text tone="muted">
              {t(
                'people.insights.insights.nothing_expires_in_the_next_90',
                'Nothing expires in the next 90 days.',
              )}
            </Text>
          ) : (
            <Wide>
              <TimelineChart
                label={t('people.insights.insights.expiries', 'Expiries')}
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
          <Alert
            key="pay"
            tone="info"
            title={t('people.insights.insights.how_pay_is_distributed', 'How pay is distributed')}
          >
            {t(
              'people.insights.insights.pay_in_aggregate_appears_after_the',
              'Pay in aggregate appears after the next nightly snapshot.',
            )}
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
            ? t('people.insights.insights.insufficient_data', 'Insufficient data')
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
              title={t(
                'people.insights.insights.how_pay_sits_in_each_band',
                'How pay sits in each band, {{currency}}',
                { currency },
              )}
              description={note}
              numbers={groups.map((g) => [
                `${g.label}: 25th / median / 75th`,
                quartiles(g, format, scale),
              ])}
            >
              {data.length === 0 ? null : (
                <RangeChart
                  label={t(
                    'people.insights.insights.base_salary_by_grade',
                    'Base salary by grade, {{currency}}',
                    { currency },
                  )}
                  valueLabel={t('people.insights.insights.median', 'Median')}
                  spreadLabel={t('people.insights.insights.middle_half', 'Middle half')}
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
              title={t(
                'people.insights.insights.pay_against_tenure',
                'Pay against tenure, {{currency}}',
                { currency },
              )}
              description={t(
                'people.insights.insights.by_tenure_band_never_a_point',
                '{{note}} · by tenure band, never a point per person',
                { note },
              )}
              numbers={groups.map((g) => [
                `${g.label}: 25th / median / 75th`,
                quartiles(g, format, scale),
              ])}
            >
              {shown.length < 2 ? null : (
                <TrendChart
                  label={t(
                    'people.insights.insights.base_salary_by_tenure_band',
                    'Base salary by tenure band, {{currency}}',
                    { currency },
                  )}
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
              title={t(
                'people.insights.insights.compa_ratio_by_grade',
                'Compa-ratio by grade, {{currency}}',
                { currency },
              )}
              description={`${note} · salary over the band midpoint; 1.00 is on midpoint`}
              numbers={groups.map((g) => [
                `${g.label}: 25th / median / 75th`,
                quartiles(g, ratio, Number),
              ])}
            >
              {data.length === 0 ? null : (
                <RangeChart
                  label={t(
                    'people.insights.insights.compa_ratio_by_grade',
                    'Compa-ratio by grade, {{currency}}',
                    { currency },
                  )}
                  valueLabel={t(
                    'people.insights.insights.median_compa_ratio',
                    'Median compa-ratio',
                  )}
                  spreadLabel={t('people.insights.insights.middle_half', 'Middle half')}
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
        q.publishedAsOf === null
          ? t('people.insights.insights.not_published_yet', 'Not published yet')
          : `Published ${q.publishedAsOf}`;
      sections.push(
        q.status === 'ok' ? (
          <Section
            key={q.key}
            title={q.label}
            description={t(
              'people.insights.insights.voluntary_self_identification',
              'Voluntary self-identification · {{published}} · {{note}}',
              { published, note: q.note },
            )}
            numbers={q.cells.map((c) => [c.label, c.value])}
          >
            <BarChart label={q.label} data={q.cells} showValues />
          </Section>
        ) : (
          <Alert
            key={q.key}
            tone="info"
            title={t(
              'people.insights.insights.insufficient_data_2',
              '{{label}}: insufficient data',
              { label: q.label },
            )}
          >
            {t(
              'people.insights.insights.fewer_than_people_in_at_least',
              'Fewer than {{String}} people in at least one answer, so nothing is shown.',
              { String: String(q.minimum ?? 10) },
            )}
          </Alert>
        ),
      );
    }
  }

  if (figures.length === 0 && sections.length === 0) {
    return (
      <EmptyState
        icon={ChartColumn}
        title={t(
          'people.insights.insights.nothing_to_show_on_this_tab',
          'Nothing to show on this tab',
        )}
        description={t(
          'people.insights.insights.none_of_its_figures_are_yours',
          'None of its figures are yours to see, or People has none to draw yet.',
        )}
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
  const [tab, setTab] = useState<string>(route.params?.tab ?? 'summary');
  const [segment, setSegment] = useState<string | null>(null);
  const { load, reload } = useRead<Analytics>('Analytics', { segment });
  const schedules = useRead<{ canManage: boolean; schedules: readonly ScheduleRow[] }>(
    'ReportSchedules',
  ).load;
  const reports = schedules.status === 'ready' && schedules.data.canManage ? schedules.data : null;
  const back = {
    label: t('people.insights.insights.people', 'People'),
    onPress: navigation.goBack,
  };
  const trailing =
    reports === null ? undefined : (
      <Button
        size="sm"
        variant="ghost"
        startIcon={<Icon icon={Clock} />}
        accessibilityLabel={t('people.insights.insights.scheduled_reports', 'Scheduled reports')}
        onPress={() => {
          navigation.navigate('ScheduledReports');
        }}
      />
    );

  return (
    <Page
      title={t('people.insights.insights.insights', 'Insights')}
      back={back}
      {...(trailing === undefined ? {} : { trailing })}
    >
      <View>
        <ChipGroup
          type="single"
          value={tab}
          onValueChange={setTab}
          accessibilityLabel={t('people.insights.insights.insights', 'Insights')}
          scroll
        >
          {TABS().map(([value, label]) => (
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
          <SelectTrigger
            size="sm"
            accessibilityLabel={t('people.insights.insights.segment', 'Segment')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="everybody">
              {t('people.insights.insights.everybody_you_may_see', 'Everybody you may see')}
            </SelectItem>
            {load.data.segments.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {tab === 'summary' ? (
        load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : load.status === 'loading' ? (
          <Loading
            label={t('people.insights.insights.loading_the_figures', 'Loading the figures')}
          />
        ) : (
          <Summary a={load.data} segment={segment} />
        )
      ) : tab === 'what-changed' ? (
        <WhatChanged
          segment={segment}
          go={(to) => {
            if (to.screen === 'Insights') setTab(to.tab);
            else if (to.screen === 'Directory')
              navigation.navigate('People', { conditions: to.conditions });
            else if (to.screen === 'OrgChart') navigation.navigate('People', { view: 'org' });
            else navigation.navigate('Review');
          }}
        />
      ) : load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label={t('people.insights.insights.loading_the_figures', 'Loading the figures')} />
      ) : (
        <Stack gap={3}>
          <Text variant="footnote" tone="muted">
            {`${load.data.asOf}${load.data.segment === null ? '' : ` · ${load.data.segment.name}`} · ${load.data.sourceNote}${
              load.data.minimum === null
                ? ''
                : t(
                    'people.insights.insights.groups_under_people_are_hidden',
                    ' Groups under {{String}} people are hidden.',
                    { String: String(load.data.minimum) },
                  )
            }`}
          </Text>
          {load.data.segment === null ? null : (
            <Alert tone="info">
              {t(
                'people.insights.insights.showing_the_people_you_may_see',
                'Showing the people you may see in {{name}}. Span of control, expiries and self-identification are not drawn for a segment.',
                { name: load.data.segment.name },
              )}
            </Alert>
          )}
          {load.data.source === 'history' ? (
            <Alert tone="info">
              {t(
                'people.insights.insights.this_date_is_between_snapshots_so',
                'This date is between snapshots, so it was replayed from history. It is exact, and it was slower to answer.',
              )}
            </Alert>
          ) : null}
          <Charts a={load.data} tab={tab} />
        </Stack>
      )}
      {reports === null ? null : (
        // Sent automatically (P10): each schedule as a line, at the foot of the same page.
        <Card padded={false} className="overflow-hidden">
          <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
            <Text variant="headline">
              {t('people.insights.insights.sent_automatically', 'Sent automatically')}
            </Text>
            <Button
              size="xs"
              variant="link"
              onPress={() => {
                navigation.navigate('ScheduledReports');
              }}
            >
              {t('people.insights.insights.manage', 'Manage')}
            </Button>
          </View>
          {reports.schedules.length === 0 ? (
            <Text tone="muted" className="px-4 pb-4">
              {t(
                'people.insights.insights.nothing_is_sent_on_a_schedule',
                'Nothing is sent on a schedule yet.',
              )}
            </Text>
          ) : (
            reports.schedules.map((r) => (
              <ListItem
                key={r.id}
                listitem={false}
                icon={Mail}
                description={`${r.recipients
                  .map((x) => x.name ?? 'someone')
                  .slice(0, 2)
                  .join(', ')} · ${cadenceText(r).toLowerCase()}${r.paused ? ' · paused' : ''}`}
                chevron
                onPress={() => {
                  navigation.navigate('ReportHistory', { id: r.id, name: r.name });
                }}
              >
                {r.name}
              </ListItem>
            ))
          )}
        </Card>
      )}
    </Page>
  );
}

/**
 * The summary (design v3 P10): a sentence first, from What changed, then
 * four numbers and one chart. Everything else is a chip away.
 */
function Summary({ a, segment }: { a: Analytics; segment: string | null }): React.JSX.Element {
  const signed = useSigned();
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void ask<string>(signed, 'WhatChanged', { segment }).then((answer) => {
      const got = answer.ok
        ? (parsed(answer.data) as { points?: readonly { text: string }[] } | null)
        : null;
      if (live)
        setSaid(
          (got?.points ?? [])
            .slice(0, 3)
            .map((p) => p.text)
            .join(' ') || null,
        );
    });
    return () => {
      live = false;
    };
  }, [signed, segment]);
  const trend = a.headcount.trend.slice(-6);
  const change = a.headcount.change;
  return (
    <Stack gap={3}>
      {said === null ? null : (
        <Alert tone="accent" variant="summary">
          {said}
        </Alert>
      )}
      <AutoGrid minItemWidth={150} gap={2}>
        <Stat
          label={t('people.insights.insights.headcount', 'Headcount')}
          value={a.headcount.value.toLocaleString()}
          size={26}
          {...(change === null || change === 0
            ? {}
            : {
                description: t(
                  'people.insights.insights.since_last_month_2',
                  '{{value}}{{String}} since last month',
                  { value: change > 0 ? '+' : '', String: String(change) },
                ),
              })}
        />
        {a.attrition === null ? null : (
          <Stat
            label={t('people.insights.insights.turnover', 'Turnover')}
            value={a.attrition.percent.toFixed(0)}
            unit="%"
            size={26}
            description={t('people.insights.insights.last_12_months', 'last 12 months')}
          />
        )}
        {a.complete === null ? null : (
          <Stat
            label={t('people.insights.insights.complete', 'Complete')}
            value={String(a.complete.percent)}
            unit="%"
            size={26}
            description={t(
              'people.insights.insights.records_missing_details',
              '{{String}} records missing details',
              { String: String(a.complete.incomplete) },
            )}
          />
        )}
        {a.startingSoon === null ? null : (
          <Stat
            label={t('people.insights.insights.starting_soon', 'Starting soon')}
            value={String(a.startingSoon)}
            size={26}
            description={t('people.insights.insights.hired_not_started', 'hired, not started')}
          />
        )}
      </AutoGrid>
      {trend.length === 0 ? null : (
        <ChartCard title={t('people.insights.insights.headcount', 'Headcount')}>
          <BarChart
            label={t('people.insights.insights.headcount_by_month', 'Headcount by month')}
            data={trend}
            showValues
            highlightIndex={trend.length - 1}
          />
        </ChartCard>
      )}
    </Stack>
  );
}
