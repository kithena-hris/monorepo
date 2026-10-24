import { Alert, Button, Card, dateFormat, icons, locale, Progress } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { ImportDoneView } from './import-plan';
import { t } from '../i18n';

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
  const done = people.done.toLocaleString(locale());
  if (people.total === null)
    return t(
      'import.import-run.so_far',
      { one: '{{done}} person so far', other: '{{done}} people so far' },
      { count: people.done, done },
    );
  return t(
    'import.import-run.of',
    { one: '{{done}} of {{count}} person', other: '{{done}} of {{count}} people' },
    { count: people.total, done },
  );
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
  const at = dateFormat({
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(run.startedAt ?? run.approvedAt));
  return run.startedBy.you
    ? t('import.import-run.started_by_you_at', 'Started by you at {{at}}', { at })
    : t('import.import-run.started_by_at', 'Started by {{value}} at {{at}}', {
        value: run.startedBy.name,
        at,
      });
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
        {t('import.import-run.an_import_is_running', 'An import is running.')}{' '}
        {startedLine(run, zone)}.
      </p>
      <Button asChild size="xs" variant="ghost" endIcon={<icons.forward aria-hidden />}>
        <a href={runHref(run.id)}>{t('import.import-run.see_the_import', 'See the import')}</a>
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
  return s < 60
    ? t('import.import-run.s', '{{s}} s', { s: String(s) })
    : t('import.import-run.min_s', '{{floor}} min {{value}} s', {
        floor: String(Math.floor(s / 60)),
        value: String(s % 60),
      });
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
        <h2 className="font-display text-xl font-bold">
          {t('import.import-run.importing', 'Importing')}
        </h2>
        {run.fileName === null ? null : <p className="text-sm text-fg-muted">{run.fileName}</p>}
      </div>
      <Progress
        label={run.step}
        showValue
        value={run.people.total === null || run.phase === 'setup' ? null : run.people.done}
        max={Math.max(1, run.people.total ?? 1)}
        valueLabel={peopleLine(run.people)}
      />
      <p className="text-sm text-fg-muted tabular-nums">
        {elapsedOf(run)} {t('import.import-run.so_far_2', 'so far')}
      </p>
      {waking ? (
        <Alert
          tone="info"
          title={t('import.import-run.kithena_is_waking_up', 'Kithena is waking up')}
        >
          {t(
            'import.import-run.the_import_goes_on_this_page',
            'The import goes on. This page catches up by itself.',
          )}
        </Alert>
      ) : null}
      <p className="text-sm">
        {t(
          'import.import-run.it_carries_on_if_you_close',
          'It carries on if you close this page. Come back here, or to Import & export, to see how it went; you will be told when it is done.',
        )}
      </p>
    </Card>
  );
}
