import {
  Alert,
  AutoGrid,
  Avatar,
  BarChart,
  Button,
  EmptyState,
  FunnelChart,
  HeatmapChart,
  HorizontalBarChart,
  List,
  ListItem,
  PageHeader,
  PageSection,
  RangeChart,
  ScrollArea,
  ScrollBar,
  Sparkline,
  Stack,
  Stat,
  StackedBarChart,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TimelineChart,
  TrendChart,
  WaterfallChart,
  icons,
  type ChartPoint,
  type RangeBand,
  type FunnelStage,
  type ChartTone,
  type IsoDate,
  type TimelineRow,
} from '@reach/ui';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import type { ReportSchedulesState } from '../reports/report-schedules';
import { SegmentSelect, type SegmentRef } from '../segments';
import { t } from '../i18n';

/**
 * What People may answer about its own data, already shaped by the query
 * layer (PRD §16). A chart the viewer may not see is `null` and is not drawn —
 * the same absent-not-empty rule a profile follows — and the cohort minimum
 * was applied where the numbers were counted, so it holds here, in the
 * tooltip and in the export alike.
 */
export interface AnalyticsState {
  /** "As of 22 Sep 2026". */
  readonly asOf: string;
  /** Snapshots are fast; a date off the snapshot grid replays history and says so. */
  readonly source: 'snapshot' | 'history';
  /** "snapshot taken 04:00 today". */
  readonly sourceNote: string;
  /** The cohort minimum in force: smaller groups are hidden. Absent: not said. */
  readonly minimum?: number;
  readonly headcount: {
    readonly value: number;
    readonly change: number | null;
    readonly trend: readonly ChartPoint[];
  };
  /** Hired, not started yet: HR's, and never under a segment. Absent or null: not shown. */
  readonly startingSoon?: number | null;
  readonly attrition: {
    readonly percent: number;
    readonly leavers: number;
    readonly formula: string;
    /** Rolling 12-month attrition, in percent, by month (PEO-067). */
    readonly trend?: readonly ChartPoint[];
  } | null;
  readonly complete: { readonly percent: number; readonly incomplete: number } | null;
  readonly expiringIn90Days: number | null;
  readonly movement: {
    readonly period: string;
    readonly opening: number;
    readonly joiners: number;
    readonly moves: number;
    readonly leavers: number;
    readonly closing: number;
  } | null;
  /** Percent complete by section. */
  readonly completenessBySection: readonly ChartPoint[] | null;
  /**
   * What is about to lapse (PEO-122), item by item, each one the viewer reads
   * on that person. An item they may not read is not here at all, so the
   * chart has no gap where it would have been.
   */
  readonly expiries: { readonly today: IsoDate; readonly items: readonly ExpiryItem[] } | null;
  readonly funnel: readonly FunnelStage[] | null;
  /** Here now, and left in the last 12 months, by tenure band (PEO-067). */
  readonly tenure?:
    | readonly {
        readonly label: string;
        readonly headcount: number;
        readonly leavers: number;
      }[]
    | null;
  /** Managers by number of direct reports. */
  readonly span?: readonly ChartPoint[] | null;
  /** Joiners by department and month. */
  readonly joiners?: {
    readonly months: readonly string[];
    readonly departments: readonly string[];
    readonly cells: readonly {
      readonly row: string;
      readonly column: string;
      readonly value: number;
    }[];
  } | null;
  /** Headcount by department, split by employment type. */
  readonly composition?: {
    readonly categories: readonly string[];
    readonly series: readonly { readonly label: string; readonly values: readonly number[] }[];
  } | null;
  /**
   * Voluntary self-identification, HR's only (PEO-070): each question from its
   * monthly publication, rounded to 5, withheld whole below the cohort
   * minimum. A withheld one has no numbers here to show.
   */
  readonly selfId?: readonly SelfIdChart[] | null;
  /**
   * Pay in aggregate, finance's only (PEO-078): quartiles per group, one
   * currency each. A group under the cohort minimum has no number here at all.
   */
  readonly pay?: PayState | null;
  /** The saved segment applied, and those the viewer could apply (PEO-068). */
  readonly segment?: SegmentRef | null;
  readonly segments?: readonly SegmentRef[];
  /** The report schedules, read beside the analytics; null where People refuses them. */
  readonly schedules?: ReportSchedulesState | null;
}

export interface SelfIdChart {
  readonly key: string;
  readonly label: string;
  readonly status: 'ok' | 'insufficient_data';
  readonly minimum: number | null;
  readonly publishedAsOf: string | null;
  readonly total: number | null;
  readonly note: string;
  readonly cells: readonly ChartPoint[];
}

export interface PayGroup {
  readonly label: string;
  readonly currency: string;
  readonly status: 'ok' | 'insufficient_data';
  readonly people: number | null;
  /** Minor units for salary, a ratio for compa-ratio; null when withheld. */
  readonly p25: string | null;
  readonly median: string | null;
  readonly p75: string | null;
  readonly band: {
    readonly minimumMinor: string;
    readonly midpointMinor: string;
    readonly maximumMinor: string;
  } | null;
}

export interface PayState {
  readonly asOf: string | null;
  readonly minimum: number;
  readonly grade: readonly PayGroup[];
  readonly tenure: readonly PayGroup[];
  readonly compa: readonly PayGroup[];
}

export interface ExpiryItem {
  /** `work_permit`, `fixed_term`, `probation` or `certification`. */
  readonly kind: string;
  readonly personId: string;
  /** Null when the viewer reads none of the name. */
  readonly name: string | null;
  readonly day: IsoDate;
}

export interface AnalyticsProps {
  readonly load: Loadable<AnalyticsState>;
  /** The tab its route names; the host draws the row of tabs. */
  readonly tab?: InsightsTab;
  /** Applied by the shell, server-side: `?segment=<id>`. */
  readonly segmentId?: string | null;
  readonly onSegmentChange?: (segmentId: string | null) => void;
}

const percent = (n: number): string => `${n.toFixed(1)}%`;

const EXPIRY: Readonly<Record<string, { readonly label: string; readonly tone: ChartTone }>> = {
  work_permit: { label: t('analytics.analytics.work_permit', 'Work permit'), tone: 'danger' },
  fixed_term: { label: t('analytics.analytics.contract_ends', 'Contract ends'), tone: 'warning' },
  probation: { label: t('analytics.analytics.probation_ends', 'Probation ends'), tone: 'info' },
  certification: {
    label: t('analytics.analytics.certification', 'Certification'),
    tone: 'neutral',
  },
};
const expiryOf = (kind: string) => EXPIRY[kind] ?? { label: kind, tone: 'neutral' as const };

/**
 * One lane per person, their items in date order, as the query sent them.
 *
 * `TimelineChart` knows a lane by its label, so a second person with the same
 * name is numbered rather than merged into the first one's lane.
 * ponytail: an `id` on Reach's `TimelineRow` would let two lanes share a label.
 */
export function expiryRows(items: readonly ExpiryItem[]): TimelineRow[] {
  const lanes = new Map<string, { label: string; items: TimelineRow['items'][number][] }>();
  const taken = new Map<string, number>();
  const labelFor = (name: string): string => {
    const seen = (taken.get(name) ?? 0) + 1;
    taken.set(name, seen);
    return seen === 1
      ? name
      : t('analytics.analytics.text', '{{name}} ({{seen}})', { name, seen: String(seen) });
  };
  for (const item of items) {
    const lane = lanes.get(item.personId) ?? {
      label: labelFor(item.name ?? t('analytics.analytics.unnamed', 'Unnamed')),
      items: [],
    };
    const { label, tone } = expiryOf(item.kind);
    lane.items.push({
      id: `${item.personId}:${item.kind}:${item.day}`,
      label,
      start: item.day,
      tone,
    });
    lanes.set(item.personId, lane);
  }
  return [...lanes.values()];
}

/** Insights' four tabs, each a route: `/people/insights/<tab>`. */
export type InsightsTab = 'headcount' | 'turnover' | 'data-quality' | 'pay';

const grid = 'grid scroll-mt-4 grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-2';

/** One tab's numbers as CSV, for the segment on screen: the shell's download route. */
export const exportUrl = (tab: InsightsTab, segmentId: string | null): string =>
  `/people/downloads/insights?tab=${tab}${
    segmentId === null ? '' : `&segment=${encodeURIComponent(segmentId)}`
  }`;

/**
 * Insights (V7, MV6; PRD §16, design screen 12): workforce analytics, a tab
 * at a time, with the Scheduled reports page a button away.
 *
 * The tab is the route, and the host draws the tabs; this screen draws the
 * one it is given. Each tab opens with its figures, then one section per
 * question, each with its chart. Every chart carries its own screen-reader
 * table, and every section also offers its numbers as a visible `Table` one
 * tap away, because a chart is never the only way to get a number.
 */
export function Analytics({
  load,
  tab = 'headcount',
  segmentId = null,
  onSegmentChange,
}: AnalyticsProps): JSX.Element {
  return (
    <Loaded load={load} what="the analytics">
      {(state) => (
        <Workforce
          state={state}
          tab={tab}
          segmentId={segmentId}
          onSegmentChange={onSegmentChange}
        />
      )}
    </Loaded>
  );
}

/**
 * Insights' header, on every tab: the title, what the figures are, the
 * segment, the button to the Scheduled reports page, and the tab's own export.
 */
export function InsightsHeader({
  description,
  segments,
  segmentId,
  onSegmentChange,
  reports,
  exportAction,
}: {
  readonly description: string;
  readonly segments: readonly SegmentRef[];
  readonly segmentId: string | null;
  readonly onSegmentChange: ((segmentId: string | null) => void) | undefined;
  /** The schedules HR may manage; null for anybody else. */
  readonly reports: ReportSchedulesState | null;
  readonly exportAction: ReactNode;
}): JSX.Element {
  return (
    <PageHeader
      title={t('analytics.analytics.insights', 'Insights')}
      // A phone's bar holds the clock (MV6), as the design draws it.
      touchBarActions
      description={description}
      actions={
        <>
          {onSegmentChange === undefined ? null : (
            <SegmentSelect segments={segments} value={segmentId} onChange={onSegmentChange} />
          )}
          {reports === null ? null : (
            <>
              {/* One list of schedules, on its own page: the button opens it. */}
              <Button asChild startIcon={<icons.scheduled aria-hidden />} className="touch:hidden">
                <a href="/people/reports">{t('analytics.analytics.schedules', 'Schedules')}</a>
              </Button>
              {/* A phone's bar keeps the clock; the page is a tap away. */}
              <Button asChild variant="ghost" className="hidden touch:inline-flex">
                <a
                  href="/people/reports"
                  aria-label={t('analytics.analytics.scheduled_reports', 'Scheduled reports')}
                >
                  <icons.scheduled aria-hidden />
                </a>
              </Button>
            </>
          )}
          {exportAction}
        </>
      }
    />
  );
}

/** Under a finger, the schedules sit at the foot of the page too (MV6). */
export function SchedulesRow({
  reports,
}: {
  readonly reports: ReportSchedulesState | null;
}): JSX.Element | null {
  if (reports === null) return null;
  const running = reports.schedules.filter((s) => !s.paused).length;
  return (
    <List
      aria-label={t('analytics.analytics.report_schedules', 'Report schedules')}
      className="hidden touch:block"
    >
      <ListItem
        asChild
        chevron
        leading={
          <Avatar
            size="lg"
            shape="rounded"
            tone="neutral"
            name="Scheduled reports"
            fallback={<icons.scheduled aria-hidden />}
          />
        }
        description={t('analytics.analytics.active', '{{running}} active', {
          running: String(running),
        })}
      >
        <a href="/people/reports">
          {t('analytics.analytics.scheduled_reports', 'Scheduled reports')}
        </a>
      </ListItem>
    </List>
  );
}

function Workforce({
  state,
  tab,
  segmentId,
  onSegmentChange,
}: {
  readonly state: AnalyticsState;
  readonly tab: InsightsTab;
  readonly segmentId: string | null;
  readonly onSegmentChange: AnalyticsProps['onSegmentChange'];
}): JSX.Element {
  const { headcount, attrition, complete, movement } = state;
  // The schedules HR may manage: the Schedules button and the phone's row.
  const reports = state.schedules != null && state.schedules.canManage ? state.schedules : null;
  const joined =
    state.joiners == null ? null : state.joiners.cells.reduce((n, c) => n + c.value, 0);

  const figures: JSX.Element[] = [];
  const sections: JSX.Element[] = [];
  if (tab === 'headcount') {
    figures.push(
      <Stat
        key="headcount"
        label={t('analytics.analytics.headcount', 'Headcount')}
        value={headcount.value.toLocaleString()}
        {...(headcount.change === null
          ? {}
          : {
              delta: `${headcount.change > 0 ? '+' : ''}${String(headcount.change)}`,
              deltaLabel: 'since last month',
              direction:
                headcount.change > 0
                  ? ('up' as const)
                  : headcount.change < 0
                    ? ('down' as const)
                    : ('flat' as const),
            })}
        chart={
          headcount.trend.length > 1 ? (
            <Sparkline
              data={headcount.trend}
              label={t('analytics.analytics.headcount_by_month', 'Headcount by month')}
            />
          ) : undefined
        }
      />,
    );
    if (joined !== null)
      figures.push(
        <Stat
          key="joined"
          label={t('analytics.analytics.joined_12m', 'Joined, 12M')}
          value={joined}
        />,
      );
    if (attrition !== null) {
      figures.push(
        <Stat
          key="left"
          label={t('analytics.analytics.left_12m', 'Left, 12M')}
          value={attrition.leavers}
          description={t('analytics.analytics.attrition', '{{percent}} attrition', {
            percent: percent(attrition.percent),
          })}
        />,
      );
    }
    // The design's fourth figure was open roles, which are recruiting's to
    // count; pre-hires are People's, and the honest figure in that place.
    if (state.startingSoon != null) {
      figures.push(
        <Stat
          key="starting"
          label={t('analytics.analytics.starting_soon', 'Starting soon')}
          value={state.startingSoon}
          description={t('analytics.analytics.hired_not_started_yet', 'Hired, not started yet')}
        />,
      );
    }
    if (headcount.trend.length > 1) {
      sections.push(
        <ChartSection
          key="trend"
          title={t('analytics.analytics.headcount_by_month', 'Headcount by month')}
          description={t('analytics.analytics.today', '{{toLocaleString}} today', {
            toLocaleString: headcount.value.toLocaleString(),
          })}
          numbers={headcount.trend.map((p) => [p.label, p.value])}
        >
          <TrendChart
            label={t('analytics.analytics.headcount_by_month', 'Headcount by month')}
            series={[{ label: 'Headcount', data: headcount.trend }]}
            area
            showLastPoint
          />
        </ChartSection>,
      );
    }
    if (movement !== null) {
      sections.push(
        <ChartSection
          key="movement"
          title={t('analytics.analytics.where_the_change_came_from', 'Where the change came from')}
          description={t(
            'analytics.analytics.the_numbers_reconcile_to_the_closing',
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
            label={t('analytics.analytics.headcount_movement', 'Headcount movement')}
            data={[
              { label: 'Opening', value: movement.opening, total: true },
              { label: 'Joiners', value: movement.joiners, tone: 'success' },
              { label: 'Moves', value: movement.moves },
              { label: 'Leavers', value: -movement.leavers, tone: 'danger' },
              { label: 'Closing', value: movement.closing, total: true },
            ]}
          />
        </ChartSection>,
      );
    }
    if (state.composition != null && state.composition.categories.length > 0) {
      const composition = state.composition;
      sections.push(
        <ChartSection
          key="composition"
          title={t('analytics.analytics.what_we_are_made_of', 'What we are made of')}
          description={t(
            'analytics.analytics.headcount_by_department_split_by_employment',
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
              'analytics.analytics.headcount_by_department_and_employment_type',
              'Headcount by department and employment type',
            )}
            categories={composition.categories}
            series={composition.series}
          />
        </ChartSection>,
      );
    }
    if (state.joiners != null && state.joiners.cells.length > 0) {
      const joiners = state.joiners;
      sections.push(
        <ChartSection
          key="joiners"
          title={t('analytics.analytics.when_people_join', 'When people join')}
          description={t(
            'analytics.analytics.joiners_by_department_and_month_the',
            'Joiners by department and month, the last 12 months',
          )}
          numbers={joiners.cells.map((c) => [`${c.row}, ${c.column}`, c.value])}
        >
          <ScrollArea className="w-full">
            <div className="min-w-[36rem]">
              <HeatmapChart
                label={t(
                  'analytics.analytics.joiners_by_department_and_month',
                  'Joiners by department and month',
                )}
                rows={joiners.departments}
                columns={joiners.months}
                cells={joiners.cells}
                describe={(value, row, column) =>
                  `${String(value)} ${value === 1 ? 'joiner' : 'joiners'} in ${row}, ${column}`
                }
              />
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </ChartSection>,
      );
    }
  }

  if (tab === 'turnover') {
    if (attrition !== null) {
      figures.push(
        <Stat
          key="attrition"
          label={t(
            'analytics.analytics.attrition_rolling_12_months',
            'Attrition, rolling 12 months',
          )}
          value={percent(attrition.percent)}
          description={t(
            'analytics.analytics.annualised_over_leavers',
            'Annualised over {{leavers}} leavers: {{formula}}',
            { leavers: String(attrition.leavers), formula: attrition.formula },
          )}
        />,
      );
    }
    if (attrition?.trend !== undefined && attrition.trend.length >= 2) {
      sections.push(
        <ChartSection
          key="attrition"
          title={t('analytics.analytics.are_people_leaving_faster', 'Are people leaving faster')}
          description={t(
            'analytics.analytics.rolling_12_months',
            'Rolling 12 months: {{formula}}',
            { formula: attrition.formula },
          )}
          numbers={attrition.trend.map((p) => [p.label, percent(p.value)])}
        >
          <TrendChart
            label={t(
              'analytics.analytics.attrition_rolling_12_months',
              'Attrition, rolling 12 months',
            )}
            series={[{ label: 'Attrition', tone: 'danger', data: attrition.trend }]}
            format={percent}
          />
        </ChartSection>,
      );
    }
    if (state.tenure != null) {
      const tenure = state.tenure;
      sections.push(
        <ChartSection
          key="tenure"
          title={t('analytics.analytics.who_is_at_risk_of_leaving', 'Who is at risk of leaving')}
          description={t(
            'analytics.analytics.tenure_today_beside_the_tenure_at',
            "Tenure today, beside the tenure at leaving of the last 12 months' leavers",
          )}
          numbers={tenure.flatMap((b): [string, number][] => [
            [`${b.label}: here now`, b.headcount],
            [`${b.label}: left`, b.leavers],
          ])}
        >
          <StackedBarChart
            label={t('analytics.analytics.tenure_bands', 'Tenure bands')}
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
        </ChartSection>,
      );
    }
    if (state.span != null && state.span.length > 0) {
      const span = state.span;
      sections.push(
        <ChartSection
          key="span"
          title={t('analytics.analytics.is_the_org_shaped_sensibly', 'Is the org shaped sensibly')}
          description={t(
            'analytics.analytics.how_many_managers_have_how_many',
            'How many managers have how many direct reports',
          )}
          numbers={span.map((p) => [p.label, p.value])}
        >
          <BarChart
            label={t('analytics.analytics.span_of_control', 'Span of control')}
            data={span}
            showValues
          />
        </ChartSection>,
      );
    }
  }

  if (tab === 'data-quality') {
    if (complete !== null) {
      figures.push(
        <Stat
          key="complete"
          label={t('analytics.analytics.records_complete', 'Records complete')}
          value={percent(complete.percent)}
          description={t(
            'analytics.analytics.records_are_incomplete',
            '{{incomplete}} records are incomplete',
            { incomplete: String(complete.incomplete) },
          )}
        />,
      );
    }
    if (state.expiringIn90Days !== null) {
      figures.push(
        <Stat
          key="expiring"
          label={t('analytics.analytics.expiring_in_90_days', 'Expiring in 90 days')}
          value={state.expiringIn90Days}
        />,
      );
    }
    if (state.completenessBySection !== null) {
      const bySection = state.completenessBySection;
      sections.push(
        <ChartSection
          key="sections"
          title={t('analytics.analytics.where_our_data_is_thin', 'Where our data is thin')}
          description={t('analytics.analytics.completeness_by_section', 'Completeness by section')}
          numbers={bySection.map((p) => [p.label, percent(p.value)])}
        >
          <HorizontalBarChart
            label={t('analytics.analytics.completeness_by_section', 'Completeness by section')}
            data={bySection}
            format={percent}
            showValues
          />
        </ChartSection>,
      );
    }
    if (state.expiries !== null) {
      const expiries = state.expiries;
      sections.push(
        <ChartSection
          key="expiries"
          title={t('analytics.analytics.what_expires_next', 'What expires next')}
          description={t(
            'analytics.analytics.work_permits_fixed_term_contracts_probation',
            'Work permits, fixed-term contracts, probation and certifications over the next 90 days',
          )}
          numbers={expiries.items.map((item): [string, string] => [
            `${item.name ?? 'Unnamed'}: ${expiryOf(item.kind).label}`,
            item.day,
          ])}
        >
          {/* A time axis squeezed to a phone is a smear: it scrolls instead. */}
          <ScrollArea className="w-full">
            <div className="min-w-[36rem]">
              <TimelineChart
                label={t('analytics.analytics.expiries', 'Expiries')}
                rows={expiryRows(expiries.items)}
                today={expiries.today}
                unit="week"
                empty={t(
                  'analytics.analytics.nothing_expires_in_the_next_90',
                  'Nothing expires in the next 90 days.',
                )}
              />
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </ChartSection>,
      );
    }
    if (state.funnel !== null) {
      sections.push(
        <ChartSection
          key="funnel"
          title={t('analytics.analytics.where_new_joiners_stall', 'Where new joiners stall')}
          description={t(
            'analytics.analytics.invited_through_to_a_complete_record',
            'Invited through to a complete record',
          )}
          numbers={state.funnel.map((s) => [s.label, s.value])}
        >
          <FunnelChart
            label={t('analytics.analytics.onboarding_funnel', 'Onboarding funnel')}
            data={state.funnel}
            showConversion
          />
        </ChartSection>,
      );
    }
  }

  if (tab === 'pay') {
    if (state.pay != null) sections.push(<PaySections key="pay" pay={state.pay} />);
    for (const q of state.selfId ?? []) sections.push(<SelfIdSection key={q.key} question={q} />);
  }

  return (
    <Stack gap={6}>
      <InsightsHeader
        description={t(
          'analytics.analytics.text_2',
          '{{asOf}}{{value}} · {{sourceNote}}{{value2}}',
          {
            asOf: state.asOf,
            value: state.segment ? ` · ${state.segment.name}` : '',
            sourceNote: state.sourceNote,
            value2:
              state.minimum === undefined
                ? ''
                : ' ' +
                  t(
                    'analytics.analytics.groups_under_people_are_hidden',
                    'Groups under {{minimum}} people are hidden.',
                    { minimum: String(state.minimum) },
                  ),
          },
        )}
        segments={state.segments ?? []}
        segmentId={segmentId}
        onSegmentChange={onSegmentChange}
        reports={reports}
        exportAction={
          // This tab's numbers as a file, at a desk (V7).
          <Button
            asChild
            variant="secondary"
            startIcon={<icons.download aria-hidden />}
            className="touch:hidden"
          >
            <a href={exportUrl(tab, state.segment?.id ?? null)} download>
              {t('analytics.analytics.export', 'Export')}
            </a>
          </Button>
        }
      />
      {state.segment ? (
        <Alert tone="info">
          {t(
            'analytics.analytics.showing_the_people_you_may_see',
            'Showing the people you may see in {{name}}. Span of control, expiries and self-identification are not drawn for a segment.',
            { name: state.segment.name },
          )}
        </Alert>
      ) : null}
      {state.source === 'history' ? (
        <Alert tone="info">
          {t(
            'analytics.analytics.this_date_is_between_snapshots_so',
            'This date is between snapshots, so it was replayed from history. It is exact, and it was slower to answer.',
          )}
        </Alert>
      ) : null}

      {figures.length === 0 ? null : (
        <AutoGrid minItemWidth="11rem" gap={3}>
          {figures}
        </AutoGrid>
      )}
      {sections.length === 0 ? (
        figures.length === 0 ? (
          <EmptyState
            icon={<icons.analytics />}
            title={t(
              'analytics.analytics.nothing_to_show_on_this_tab',
              'Nothing to show on this tab',
            )}
            description={t(
              'analytics.analytics.none_of_its_figures_are_yours',
              'None of its figures are yours to see, or People has none to draw yet.',
            )}
          />
        ) : null
      ) : (
        <div className={grid}>{sections}</div>
      )}

      <SchedulesRow reports={reports} />
    </Stack>
  );
}

/**
 * One self-identification question in aggregate (PRD §6.7, §16.1). Withheld
 * whole below the cohort minimum, and then there is no number anywhere on
 * the page to read: not in a bar, a tooltip, nor the table.
 */
function SelfIdSection({ question }: { readonly question: SelfIdChart }): JSX.Element {
  const published =
    question.publishedAsOf === null
      ? t('analytics.analytics.not_published_yet', 'Not published yet')
      : t('analytics.analytics.published', 'Published {{publishedAsOf}}', {
          publishedAsOf: question.publishedAsOf,
        });
  if (question.status !== 'ok') {
    return (
      <PageSection
        surface
        title={question.label}
        description={t(
          'analytics.analytics.voluntary_self_identification',
          'Voluntary self-identification · {{published}}',
          { published },
        )}
      >
        <Alert tone="info" title={t('analytics.analytics.insufficient_data', 'Insufficient data')}>
          {t('analytics.analytics.fewer_than', 'Fewer than')} {question.minimum ?? 10}{' '}
          {t(
            'analytics.analytics.people_in_at_least_one_answer',
            'people in at least one answer, so nothing is shown.',
          )}
        </Alert>
      </PageSection>
    );
  }
  return (
    <ChartSection
      title={question.label}
      description={t(
        'analytics.analytics.voluntary_self_identification_2',
        'Voluntary self-identification · {{published}} · {{note}}',
        { published, note: question.note },
      )}
      numbers={[
        ...question.cells.map((c): [string, number] => [c.label, c.value]),
        ...(question.total === null
          ? []
          : [
              [
                t('analytics.analytics.total_rounded_on_its_own', 'Total, rounded on its own'),
                question.total,
              ] as [string, number],
            ]),
      ]}
    >
      <BarChart label={question.label} data={question.cells} showValues />
    </ChartSection>
  );
}

/** A currency's minor unit, as Intl knows it: 2 for EUR, 0 for JPY. */
const digits = (currency: string): number =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;

/** Minor units as a number to draw. The figure itself stays the string People sent. */
const major = (minor: string, currency: string): number => Number(minor) / 10 ** digits(currency);

const money = (currency: string) => (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const ratio = (value: number): string => value.toFixed(2);

const byCurrency = (groups: readonly PayGroup[]): [string, PayGroup[]][] => {
  const found = new Map<string, PayGroup[]>();
  for (const g of groups) found.set(g.currency, [...(found.get(g.currency) ?? []), g]);
  return [...found];
};

/** "47,750 / 50,500 / 53,250", or the words for a withheld group: never a number. */
const quartileText = (g: PayGroup, format: (v: number) => string, scale: (v: string) => number) =>
  g.status !== 'ok' || g.p25 === null || g.median === null || g.p75 === null
    ? t('analytics.analytics.insufficient_data', 'Insufficient data')
    : t(
        'analytics.analytics.people',
        '{{format}} / {{format2}} / {{format3}} ({{people}} people)',
        {
          format: format(scale(g.p25)),
          format2: format(scale(g.median)),
          format3: format(scale(g.p75)),
          people: String(g.people),
        },
      );

/** The groups a chart could not draw, said in words beneath it. */
function Unshown({
  withheld,
  unbanded = [],
  minimum,
}: {
  readonly withheld: readonly PayGroup[];
  readonly unbanded?: readonly PayGroup[];
  readonly minimum: number;
}): JSX.Element | null {
  if (withheld.length === 0 && unbanded.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-fg-muted">
      {withheld.length === 0
        ? ''
        : t(
            'analytics.analytics.insufficient_data_fewer_than_people',
            'Insufficient data, fewer than {{minimum}} people: {{join}}.',
            { minimum: String(minimum), join: withheld.map((g) => g.label).join(', ') },
          ) + ' '}
      {unbanded.length === 0
        ? ''
        : t('analytics.analytics.no_band_set', 'No band set: {{join}}.', {
            join: unbanded.map((g) => g.label).join(', '),
          })}
    </p>
  );
}

/**
 * Pay in aggregate (PRD §16.2, PEO-078), finance's only. Per currency, never
 * mixed: the median and middle half of each grade inside its band, pay
 * against tenure by band, and compa-ratio against the band midpoint. A group
 * under the cohort minimum is named as insufficient data and drawn nowhere.
 */
function PaySections({ pay }: { readonly pay: PayState }): JSX.Element {
  const when =
    pay.asOf === null
      ? t('analytics.analytics.no_pay_snapshot_yet', 'No pay snapshot yet')
      : t('analytics.analytics.from_the_snapshot_of', 'From the snapshot of {{asOf}}', {
          asOf: pay.asOf,
        });
  if (pay.asOf === null) {
    return (
      <PageSection
        surface
        title={t('analytics.analytics.how_pay_is_distributed', 'How pay is distributed')}
        description={when}
      >
        <Alert tone="info">
          {t(
            'analytics.analytics.pay_in_aggregate_appears_after_the',
            'Pay in aggregate appears after the next nightly snapshot.',
          )}
        </Alert>
      </PageSection>
    );
  }
  const note = `${when} · quartiles only; groups under ${String(pay.minimum)} people are not shown`;
  return (
    <>
      {byCurrency(pay.grade).map(([currency, groups]) => {
        const format = money(currency);
        const scale = (v: string) => major(v, currency);
        const drawn = groups.filter((g) => g.status === 'ok' && g.band !== null);
        const data: RangeBand[] = drawn.map((g) => ({
          label: g.label,
          meta: `${String(g.people)} people`,
          min: scale(g.band?.minimumMinor ?? '0'),
          mid: scale(g.band?.midpointMinor ?? '0'),
          max: scale(g.band?.maximumMinor ?? '0'),
          value: scale(g.median ?? '0'),
          spread: { low: scale(g.p25 ?? '0'), high: scale(g.p75 ?? '0') },
        }));
        return (
          <ChartSection
            key={`grade:${currency}`}
            title={t(
              'analytics.analytics.how_pay_sits_in_each_band',
              'How pay sits in each band, {{currency}}',
              { currency },
            )}
            description={note}
            numbers={groups.map((g) => [
              t('analytics.analytics.25th_median_75th', '{{label}}: 25th / median / 75th', {
                label: g.label,
              }),
              quartileText(g, format, scale),
            ])}
          >
            {data.length === 0 ? null : (
              <RangeChart
                label={t(
                  'analytics.analytics.base_salary_by_grade',
                  'Base salary by grade, {{currency}}',
                  { currency },
                )}
                valueLabel="Median"
                spreadLabel="Middle half"
                data={data}
                format={format}
              />
            )}
            <Unshown
              withheld={groups.filter((g) => g.status !== 'ok')}
              unbanded={groups.filter((g) => g.status === 'ok' && g.band === null)}
              minimum={pay.minimum}
            />
          </ChartSection>
        );
      })}

      {byCurrency(pay.tenure).map(([currency, groups]) => {
        const format = money(currency);
        const scale = (v: string) => major(v, currency);
        const shown = groups.filter((g) => g.status === 'ok');
        const series = (name: string, tone: ChartTone, pick: (g: PayGroup) => string | null) => ({
          label: name,
          tone,
          data: shown.map((g) => ({ label: g.label, value: scale(pick(g) ?? '0') })),
        });
        return (
          <ChartSection
            key={`tenure:${currency}`}
            title={t('analytics.analytics.pay_against_tenure', 'Pay against tenure, {{currency}}', {
              currency,
            })}
            description={t(
              'analytics.analytics.by_tenure_band_never_a_point',
              '{{note}} · by tenure band, never a point per person',
              { note },
            )}
            numbers={groups.map((g) => [
              t('analytics.analytics.25th_median_75th', '{{label}}: 25th / median / 75th', {
                label: g.label,
              }),
              quartileText(g, format, scale),
            ])}
          >
            {shown.length < 2 ? null : (
              <TrendChart
                label={t(
                  'analytics.analytics.base_salary_by_tenure_band',
                  'Base salary by tenure band, {{currency}}',
                  { currency },
                )}
                format={format}
                series={[
                  series('75th percentile', 'neutral', (g) => g.p75),
                  series(t('analytics.analytics.median', 'Median'), 'accent', (g) => g.median),
                  series('25th percentile', 'neutral', (g) => g.p25),
                ]}
              />
            )}
            <Unshown withheld={groups.filter((g) => g.status !== 'ok')} minimum={pay.minimum} />
          </ChartSection>
        );
      })}

      {byCurrency(pay.compa).map(([currency, groups]) => {
        const scale = (v: string) => Number(v);
        const drawn = groups.filter((g) => g.status === 'ok' && g.band !== null);
        const data: RangeBand[] = drawn.map((g) => {
          const mid = Number(g.band?.midpointMinor ?? '1');
          return {
            label: g.label,
            meta: `${String(g.people)} people`,
            min: Number(g.band?.minimumMinor ?? '0') / mid,
            mid: 1,
            max: Number(g.band?.maximumMinor ?? '0') / mid,
            value: scale(g.median ?? '0'),
            spread: { low: scale(g.p25 ?? '0'), high: scale(g.p75 ?? '0') },
          };
        });
        return (
          <ChartSection
            key={`compa:${currency}`}
            title={t(
              'analytics.analytics.compa_ratio_by_grade',
              'Compa-ratio by grade, {{currency}}',
              { currency },
            )}
            description={t(
              'analytics.analytics.salary_over_the_band_midpoint_1',
              '{{note}} · salary over the band midpoint; 1.00 is on midpoint',
              { note },
            )}
            numbers={groups.map((g) => [
              t('analytics.analytics.25th_median_75th', '{{label}}: 25th / median / 75th', {
                label: g.label,
              }),
              quartileText(g, ratio, scale),
            ])}
          >
            {data.length === 0 ? null : (
              <RangeChart
                label={t(
                  'analytics.analytics.compa_ratio_by_grade',
                  'Compa-ratio by grade, {{currency}}',
                  { currency },
                )}
                valueLabel="Median compa-ratio"
                spreadLabel="Middle half"
                data={data}
                format={ratio}
              />
            )}
            <Unshown withheld={groups.filter((g) => g.status !== 'ok')} minimum={pay.minimum} />
          </ChartSection>
        );
      })}
    </>
  );
}

/** A question, its chart, and its numbers as a table one tap away. */
function ChartSection({
  title,
  description,
  numbers,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly numbers: readonly (readonly [string, string | number])[];
  readonly children: ReactNode;
}): JSX.Element {
  const [shown, setShown] = useState(false);
  const tableId = useId();
  return (
    <PageSection
      surface
      title={title}
      description={description}
      actions={
        <Button
          size="sm"
          aria-expanded={shown}
          aria-controls={tableId}
          onClick={() => {
            setShown((s) => !s);
          }}
        >
          {shown
            ? t('analytics.analytics.hide_the_numbers', 'Hide the numbers')
            : t('analytics.analytics.show_the_numbers', 'Show the numbers')}
        </Button>
      }
    >
      {children}
      <div id={tableId} hidden={!shown} className="mt-4">
        <Table
          aria-label={t('analytics.analytics.the_numbers', '{{title}}: the numbers', { title })}
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('analytics.analytics.what', 'What')}</TableHead>
              <TableHead scope="col" numeric>
                {t('analytics.analytics.value', 'Value')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {numbers.map(([what, value], i) => (
              // Two certifications of one person share a label, never a row.
              <TableRow key={`${String(i)}:${what}`}>
                <TableCell>{what}</TableCell>
                <TableCell numeric>
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageSection>
  );
}
