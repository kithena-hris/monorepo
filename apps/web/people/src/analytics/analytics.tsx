import {
  Alert,
  AutoGrid,
  Button,
  FunnelChart,
  HorizontalBarChart,
  PageHeader,
  PageSection,
  ScrollArea,
  ScrollBar,
  Sparkline,
  Stack,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TimelineChart,
  WaterfallChart,
  type ChartPoint,
  type FunnelStage,
  type ChartTone,
  type IsoDate,
  type TimelineRow,
} from '@reach/ui';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';

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
export function Analytics({ load }: AnalyticsProps): JSX.Element {
  return (
    <Loaded load={load} what="the analytics">
      {(state) => <Workforce state={state} />}
    </Loaded>
  );
}

function Workforce({ state }: { readonly state: AnalyticsState }): JSX.Element {
  const { headcount, attrition, complete, movement } = state;
  return (
    <Stack gap={6}>
      <PageHeader title="Workforce" description={`${state.asOf} · ${state.sourceNote}`} />
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
