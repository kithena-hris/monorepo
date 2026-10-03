import { Alert, Button, Card, Progress, icons } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { ImportDoneView } from './import-plan';

/**
 * An approved import, as People runs it in the background: queued, running,
 * then Imported or Import failed. It goes on whether or not a page is open;
 * its page follows it (`/people/import?run=`), and while it goes nobody can
 * start another.
 */
export interface ImportRunStatus {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed';
  /** The one word for it, everywhere. */
  readonly label: 'Importing' | 'Imported' | 'Import failed';
  readonly phase: 'setup' | 'people' | 'managers' | 'lifecycle' | 'finishing';
  /** Where it stands, in words: "Adding people". */
  readonly step: string;
  /** People in, of the rows in the file; the total is null until the file is read. */
  readonly people: { readonly done: number; readonly total: number | null };
  readonly fileName: string | null;
  readonly startedBy: { readonly name: string; readonly you: boolean };
  readonly approvedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** People's clock when it answered, for the time so far. */
  readonly now: string;
  /** What it did, as the done step says it: once it succeeded, for a week. */
  readonly result: Omit<ImportDoneView, 'step'> | null;
  /** Why it stopped, what stays and what to do; null unless it failed. */
  readonly failure: string | null;
}

export const isRunning = (run: ImportRunStatus): boolean =>
  run.status === 'queued' || run.status === 'running';

/** The run's own page. */
export const runHref = (id: string): string => `/people/import?run=${encodeURIComponent(id)}`;

/** "312 of 1,000 people"; before the file is read, how many so far. */
export function peopleLine(people: ImportRunStatus['people']): string {
  const done = people.done.toLocaleString('en-GB');
  if (people.total === null) return `${done} ${people.done === 1 ? 'person' : 'people'} so far`;
  return `${done} of ${people.total.toLocaleString('en-GB')} ${people.total === 1 ? 'person' : 'people'}`;
}

/** The reader's zone once in their browser; UTC for the server's render and the first. */
export function useZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>('UTC');
  useEffect(() => {
    setZone(undefined);
  }, []);
  return zone;
}

/** "Started by you at 14:02", in the reader's own time. */
export function startedLine(run: ImportRunStatus, zone: string | undefined): string {
  const at = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(run.startedAt ?? run.approvedAt));
  return `Started by ${run.startedBy.you ? 'you' : run.startedBy.name} at ${at}`;
}

/**
 * Why Import is off while another import runs, beside it, and the way to that
 * import. The button names it by `aria-describedby`.
 */
export function ImportBusy({
  id,
  run,
}: {
  readonly id: string;
  readonly run: ImportRunStatus;
}): JSX.Element {
  const zone = useZone();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p id={id} className="text-sm text-fg-muted">
        An import is running. {startedLine(run, zone)}.
      </p>
      <Button asChild size="xs" variant="ghost" endIcon={<icons.forward aria-hidden />}>
        <a href={runHref(run.id)}>See the import</a>
      </Button>
    </div>
  );
}

/** "4 min 12 s", from the approval to People's clock. */
export function elapsedOf(run: ImportRunStatus): string {
  const s = Math.max(
    0,
    Math.floor((Date.parse(run.now) - Date.parse(run.startedAt ?? run.approvedAt)) / 1000),
  );
  return s < 60 ? `${String(s)} s` : `${String(Math.floor(s / 60))} min ${String(s % 60)} s`;
}

/** The import while it runs: where it is, how many people are in, how long so far. */
export function ImportRunning({
  run,
  waking = false,
}: {
  readonly run: ImportRunStatus;
  /** The server is waking: what is shown is where it last was, and it catches up by itself. */
  readonly waking?: boolean;
}): JSX.Element {
  return (
    <Card padded className="flex max-w-180 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-bold">Importing</h2>
        {run.fileName === null ? null : <p className="text-sm text-fg-muted">{run.fileName}</p>}
      </div>
      <Progress
        label={run.step}
        showValue
        value={run.people.total === null || run.phase === 'setup' ? null : run.people.done}
        max={Math.max(1, run.people.total ?? 1)}
        valueLabel={peopleLine(run.people)}
      />
      <p className="text-sm text-fg-muted tabular-nums">{elapsedOf(run)} so far</p>
      {waking ? (
        <Alert tone="info" title="Kithena is waking up">
          The import goes on. This page catches up by itself.
        </Alert>
      ) : null}
      <p className="text-sm">
        It carries on if you close this page. Come back here, or to Import & export, to see how it
        went; you will be told when it is done.
      </p>
    </Card>
  );
}
