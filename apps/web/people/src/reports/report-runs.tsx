import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@reach/ui';
import type { JSX } from 'react';

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
}

export interface ReportRunsProps {
  readonly load: Loadable<ReportRunsState>;
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

export function ReportRuns({ load }: ReportRunsProps): JSX.Element {
  return (
    <Loaded load={load} what="the report’s history">
      {(state) => (
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
            <Table aria-label="Runs">
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Recipients</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.runs.map((run) => {
                  const outcome =
                    run.outcome === null
                      ? { label: 'Did not finish', tone: 'neutral' as const }
                      : (RUN_OUTCOME[run.outcome] ?? {
                          label: run.outcome,
                          tone: 'neutral' as const,
                        });
                  return (
                    <TableRow key={run.period}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{run.period}</span>
                          {run.missed > 0 ? (
                            <span className="text-fg-muted text-sm">
                              Covers {String(run.missed)} earlier{' '}
                              {run.missed === 1 ? 'period' : 'periods'}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge tone={outcome.tone}>{outcome.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <ul className="flex flex-col gap-1">
                          {run.recipients.map((r, i) => (
                            <li key={r.accountId ?? i}>
                              {r.accountId === null
                                ? why(r.outcome)
                                : `${r.name ?? 'Somebody who has left'}: ${why(r.outcome)}`}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Stack>
      )}
    </Loaded>
  );
}
