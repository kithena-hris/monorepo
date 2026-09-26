import {
  Alert,
  AutoGrid,
  BarChart,
  Button,
  FunnelChart,
  HeatmapChart,
  HorizontalBarChart,
  PageHeader,
  PageSection,
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
  type ChartPoint,
  type FunnelStage,
  type ChartTone,
  type IsoDate,
  type TimelineRow,
} from '@reach/ui';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import { SegmentSelect, type SegmentRef } from '../segments';

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
  readonly headcount: {
    readonly value: number;
    readonly change: number | null;
    readonly trend: readonly ChartPoint[];
  };
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
  /** The saved segment applied, and those the viewer could apply (PEO-068). */
  readonly segment?: SegmentRef | null;
  readonly segments?: readonly SegmentRef[];
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
  /** Applied by the shell, server-side: `?segment=<id>`. */
  readonly segmentId?: string | null;
  readonly onSegmentChange?: (segmentId: string | null) => void;
}

const percent = (n: number): string => `${n.toFixed(1)}%`;

const EXPIRY: Readonly<Record<string, { readonly label: string; readonly tone: ChartTone }>> = {
  work_permit: { label: 'Work permit', tone: 'danger' },
  fixed_term: { label: 'Contract ends', tone: 'warning' },
  probation: { label: 'Probation ends', tone: 'info' },
  certification: { label: 'Certification', tone: 'neutral' },
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
    return seen === 1 ? name : `${name} (${String(seen)})`;
  };
  for (const item of items) {
    const lane = lanes.get(item.personId) ?? { label: labelFor(item.name ?? 'Unnamed'), items: [] };
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

/**
 * Workforce analytics (PRD §16, design screen 12).
 *
 * Stat tiles with a sparkline, then one section per question, each with its
 * chart. Every chart carries its own screen-reader table, and every section
 * also offers its numbers as a visible `Table` one tap away, because a chart
 * is never the only way to get a number.
 */
export function Analytics({
  load,
  segmentId = null,
  onSegmentChange,
}: AnalyticsProps): JSX.Element {
  return (
    <Loaded load={load} what="the analytics">
      {(state) => (
        <Workforce state={state} segmentId={segmentId} onSegmentChange={onSegmentChange} />
      )}
    </Loaded>
  );
}

function Workforce({
  state,
  segmentId,
  onSegmentChange,
}: {
  readonly state: AnalyticsState;
  readonly segmentId: string | null;
  readonly onSegmentChange: AnalyticsProps['onSegmentChange'];
}): JSX.Element {
  const { headcount, attrition, complete, movement } = state;
  return (
    <Stack gap={6}>
      <PageHeader
        title="Workforce"
        description={`${state.asOf}${state.segment ? ` · ${state.segment.name}` : ''} · ${state.sourceNote}`}
        actions={
          onSegmentChange === undefined ? undefined : (
            <SegmentSelect
              segments={state.segments ?? []}
              value={segmentId}
              onChange={onSegmentChange}
            />
          )
        }
      />
      {state.segment ? (
        <Alert tone="info">
          Showing the people you may see in {state.segment.name}. Span of control, expiries and
          self-identification are not drawn for a segment.
        </Alert>
      ) : null}
      {state.source === 'history' ? (
        <Alert tone="info">
          This date is between snapshots, so it was replayed from history. It is exact, and it was
          slower to answer.
        </Alert>
      ) : null}

      <AutoGrid minItemWidth="11rem" gap={3}>
        <Stat
          label="Headcount"
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
              <Sparkline data={headcount.trend} label="Headcount by month" />
            ) : undefined
          }
        />
        {attrition === null ? null : (
          <Stat label="Attrition, rolling 12 months" value={percent(attrition.percent)} />
        )}
        {complete === null ? null : (
          <Stat label="Records complete" value={percent(complete.percent)} />
        )}
        {state.expiringIn90Days === null ? null : (
          <Stat label="Expiring in 90 days" value={state.expiringIn90Days} />
        )}
      </AutoGrid>
      {attrition === null && complete === null ? null : (
        <p className="text-xs text-fg-muted">
          {attrition === null
            ? ''
            : `Attrition is annualised over ${String(attrition.leavers)} leavers: ${attrition.formula}. `}
          {complete === null ? '' : `${String(complete.incomplete)} records are incomplete.`}
        </p>
      )}

      {movement === null ? null : (
        <ChartSection
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
        </ChartSection>
      )}

      {state.completenessBySection === null ? null : (
        <ChartSection
          title="Where our data is thin"
          description="Completeness by section"
          numbers={state.completenessBySection.map((p) => [p.label, percent(p.value)])}
        >
          <HorizontalBarChart
            label="Completeness by section"
            data={state.completenessBySection}
            format={percent}
            showValues
          />
        </ChartSection>
      )}

      {state.expiries === null ? null : (
        <ChartSection
          title="What expires next"
          description="Work permits, fixed-term contracts, probation and certifications over the next 90 days"
          numbers={state.expiries.items.map((item): [string, string] => [
            `${item.name ?? 'Unnamed'}: ${expiryOf(item.kind).label}`,
            item.day,
          ])}
        >
          {/* A time axis squeezed to a phone is a smear: it scrolls instead. */}
          <ScrollArea className="w-full">
            <div className="min-w-[36rem]">
              <TimelineChart
                label="Expiries"
                rows={expiryRows(state.expiries.items)}
                today={state.expiries.today}
                unit="week"
                empty="Nothing expires in the next 90 days."
              />
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </ChartSection>
      )}

      {attrition?.trend === undefined || attrition.trend.length < 2 ? null : (
        <ChartSection
          title="Are people leaving faster"
          description={`Rolling 12 months: ${attrition.formula}`}
          numbers={attrition.trend.map((p) => [p.label, percent(p.value)])}
        >
          <TrendChart
            label="Attrition, rolling 12 months"
            series={[{ label: 'Attrition', tone: 'danger', data: attrition.trend }]}
            format={percent}
          />
        </ChartSection>
      )}

      {state.composition == null || state.composition.categories.length === 0 ? null : (
        <ChartSection
          title="What we are made of"
          description="Headcount by department, split by employment type"
          numbers={state.composition.categories.flatMap((category, i) =>
            (state.composition?.series ?? []).map((s): [string, number] => [
              `${category}, ${s.label}`,
              s.values[i] ?? 0,
            ]),
          )}
        >
          <StackedBarChart
            label="Headcount by department and employment type"
            categories={state.composition.categories}
            series={state.composition.series}
          />
        </ChartSection>
      )}

      {state.tenure == null ? null : (
        <ChartSection
          title="Who is at risk of leaving"
          description="Tenure today, beside the tenure at leaving of the last 12 months' leavers"
          numbers={state.tenure.flatMap((b): [string, number][] => [
            [`${b.label}: here now`, b.headcount],
            [`${b.label}: left`, b.leavers],
          ])}
        >
          <StackedBarChart
            label="Tenure bands"
            categories={state.tenure.map((b) => b.label)}
            series={[
              {
                label: 'Left in the last 12 months',
                tone: 'danger',
                values: state.tenure.map((b) => b.leavers),
              },
              { label: 'Here now', tone: 'accent', values: state.tenure.map((b) => b.headcount) },
            ]}
          />
        </ChartSection>
      )}

      {state.span == null || state.span.length === 0 ? null : (
        <ChartSection
          title="Is the org shaped sensibly"
          description="How many managers have how many direct reports"
          numbers={state.span.map((p) => [p.label, p.value])}
        >
          <BarChart label="Span of control" data={state.span} showValues />
        </ChartSection>
      )}

      {state.joiners == null || state.joiners.cells.length === 0 ? null : (
        <ChartSection
          title="When people join"
          description="Joiners by department and month, the last 12 months"
          numbers={state.joiners.cells.map((c) => [`${c.row}, ${c.column}`, c.value])}
        >
          <ScrollArea className="w-full">
            <div className="min-w-[36rem]">
              <HeatmapChart
                label="Joiners by department and month"
                rows={state.joiners.departments}
                columns={state.joiners.months}
                cells={state.joiners.cells}
                describe={(value, row, column) =>
                  `${String(value)} ${value === 1 ? 'joiner' : 'joiners'} in ${row}, ${column}`
                }
              />
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </ChartSection>
      )}

      {state.selfId == null
        ? null
        : state.selfId.map((q) => <SelfIdSection key={q.key} question={q} />)}

      {state.funnel === null ? null : (
        <ChartSection
          title="Where new joiners stall"
          description="Invited through to a complete record"
          numbers={state.funnel.map((s) => [s.label, s.value])}
        >
          <FunnelChart label="Onboarding funnel" data={state.funnel} showConversion />
        </ChartSection>
      )}
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
    question.publishedAsOf === null ? 'Not published yet' : `Published ${question.publishedAsOf}`;
  if (question.status !== 'ok') {
    return (
      <PageSection
        surface
        title={question.label}
        description={`Voluntary self-identification · ${published}`}
      >
        <Alert tone="info" title="Insufficient data">
          Fewer than {question.minimum ?? 10} people in at least one answer, so nothing is shown.
        </Alert>
      </PageSection>
    );
  }
  return (
    <ChartSection
      title={question.label}
      description={`Voluntary self-identification · ${published} · ${question.note}`}
      numbers={[
        ...question.cells.map((c): [string, number] => [c.label, c.value]),
        ...(question.total === null
          ? []
          : [['Total, rounded on its own', question.total] as [string, number]]),
      ]}
    >
      <BarChart label={question.label} data={question.cells} showValues />
    </ChartSection>
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
          {shown ? 'Hide the numbers' : 'Show the numbers'}
        </Button>
      }
    >
      {children}
      <div id={tableId} hidden={!shown} className="mt-4">
        <Table aria-label={`${title}: the numbers`}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">What</TableHead>
              <TableHead scope="col" numeric>
                Value
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
