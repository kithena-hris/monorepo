import { Badge, Button, EmptyState, PageHeader, Stack, VirtualList, usePages } from '@reach/ui';
import { useCallback, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { RUN_OUTCOME } from './report-schedules';

/**
 * One scheduled report's history (PEO-069): each period it ran for, how many
 * it covered after the backend slept, and what happened to each recipient —
 * an outcome, never an address, a link or a value.
 */

export interface ReportRunsState {
  readonly id: string;
  readonly name: string;
  readonly runs: readonly {
    readonly period: string;
    readonly missed: number;
    readonly finishedAt: string | null;
    readonly outcome: string | null;
    readonly recipients: readonly {
      readonly accountId: string | null;
      readonly name: string | null;
      readonly outcome: string;
    }[];
  }[];
  /** The page before the last period shown; null on the last. Absent from an older People. */
  readonly next?: string | null;
}

export interface ReportRunsProps {
  readonly load: Loadable<ReportRunsState>;
  /** The runs before `before`, as People answers them (a `ReportRunsState`), or null. */
  readonly onLoadMore?: (before: string) => Promise<unknown>;
}

/** Why a recipient or a run got nothing, in words. */
const WHY: Record<string, string> = {
  sent: 'sent',
  failed: 'the email failed',
  not_eligible: 'has left, or has no work email',
  FIELD_NOT_FILTERABLE: 'may not filter by this audience',
  NOT_A_VIEWER: 'has nothing to see in the summary',
  EXPORT_REASON_REQUIRED: 'the file needs a reason',
  owner_not_allowed: 'its owner no longer manages People',
  segment_gone: 'its segment was deleted',
};
const why = (code: string): string => WHY[code] ?? code;

export function ReportRuns({ load, onLoadMore }: ReportRunsProps): JSX.Element {
  return (
    <Loaded load={load} what="the report’s history">
      {(state) => <Runs state={state} onLoadMore={onLoadMore} />}
    </Loaded>
  );
}

type Run = ReportRunsState['runs'][number];

/** The history, newest first, older runs loading as it scrolls and only those near the view drawn. */
function Runs({
  state,
  onLoadMore,
}: {
  readonly state: ReportRunsState;
  readonly onLoadMore: ReportRunsProps['onLoadMore'];
}): JSX.Element {
  const more = useCallback(
    async (before: string) => {
      const page = (await onLoadMore?.(before)) as ReportRunsState | null | undefined;
      return page == null ? null : { items: page.runs, next: page.next ?? null };
    },
    [onLoadMore],
  );
  const pages = usePages(
    state.runs,
    state.next ?? null,
    onLoadMore === undefined ? undefined : more,
  );
  return (
    <Stack gap={6}>
      <PageHeader
        title={state.name === '' ? 'Scheduled report' : state.name}
        description="Each run, newest first. A run after the backend slept covers the periods it missed; only the latest is sent."
        actions={
          <Button asChild variant="ghost">
            <a href="/people/reports">All scheduled reports</a>
          </Button>
        }
      />
      {state.runs.length === 0 ? (
        <EmptyState
          title="Not run yet"
          description="It first goes out at its next time after it was saved."
        />
      ) : (
        <VirtualList<Run>
          label="Runs"
          items={pages.items}
          itemKey={(run) => run.period}
          scroll="page"
          estimateItemHeight={88}
          // A hairline between runs, as a List draws its own.
          itemClassName="[&:not(:last-child)]:shadow-[inset_0_-1px_0_var(--color-border)]"
          {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
          loadingMore={pages.loading}
          renderItem={(run) => {
            const outcome =
              run.outcome === null
                ? { label: 'Did not finish', tone: 'neutral' as const }
                : (RUN_OUTCOME[run.outcome] ?? { label: run.outcome, tone: 'neutral' as const });
            return (
              <div className="flex items-start gap-3 px-4.5 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">{run.period}</span>
                  {run.missed > 0 ? (
                    <span className="text-fg-muted text-sm">
                      Covers {String(run.missed)} earlier {run.missed === 1 ? 'period' : 'periods'}
                    </span>
                  ) : null}
                  <ul
                    aria-label={`Recipients of ${run.period}`}
                    className="flex flex-col gap-0.5 text-sm"
                  >
                    {run.recipients.map((r, i) => (
                      <li key={r.accountId ?? i}>
                        {r.accountId === null
                          ? why(r.outcome)
                          : `${r.name ?? 'Somebody who has left'}: ${why(r.outcome)}`}
                      </li>
                    ))}
                  </ul>
                </div>
                <Badge tone={outcome.tone}>{outcome.label}</Badge>
              </div>
            );
          }}
        />
      )}
    </Stack>
  );
}
