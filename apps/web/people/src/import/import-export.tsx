import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  List,
  ListItem,
  PageHeader,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { useHeld, useTyped } from '../held';
import { Loaded, type Loadable } from '../load';

/**
 * Import & export (V6, MV5): two ways in and out of People, and one history
 * of both. The flows themselves are unchanged; this page starts them.
 *
 * Importing is HR's, as it always was: anybody else sees Export alone. The
 * history is People's, from its two ledgers, and HR's and People
 * administrators' to read; anybody else is shown none rather than an empty one.
 */

/** One import or export, as People's history answers it. Worded here. */
export interface TransferEntry {
  readonly id: string;
  readonly kind: 'import' | 'export';
  /** The file's name for an import; for an export, its reason, else its file. */
  readonly title: string | null;
  readonly by: { readonly name: string; readonly avatarUrl: string | null };
  /** When it started or was asked for, as an instant. */
  readonly at: string;
  readonly imported: {
    readonly created: number;
    readonly updated: number;
    readonly blocked: number;
  } | null;
  readonly exported: { readonly rows: number; readonly format: string | null } | null;
  /** The viewer's own export, still there to download. */
  readonly downloadable: boolean;
  /** An import's blocked-row report, while it is kept: a link that expires. */
  readonly reportUrl: string | null;
}

export interface ImportExportState {
  readonly canImport: boolean;
  /** Newest first, a page at a time. `null`: not this viewer's to read. */
  readonly history: {
    readonly items: readonly TransferEntry[];
    /** The cursor for older entries; null on the last page. */
    readonly next: string | null;
    /** An older page, so "Newest" leads back. */
    readonly paged: boolean;
  } | null;
  /** When the page was read, so "Today" means the same on the server and in the browser. */
  readonly now: string;
}

export interface ImportExportProps {
  readonly load: Loadable<ImportExportState>;
  /** The history narrowed to imports or exports (`?kind=`), held by the host. */
  readonly kind?: HistoryKind;
  readonly onKindChange?: (kind: HistoryKind) => void;
  /** The history's search (`?q=`), once typing rests. */
  readonly search?: string;
  readonly onSearchChange?: (search: string) => void;
}

export type HistoryKind = 'all' | 'import' | 'export';

/** Where the page lives, and so its older pages. */
const HERE = '/people/import-export';
/** The template, as a file: the shell's download route. */
export const TEMPLATE_URL = '/people/downloads/import-template';

const FORMAT: Readonly<Record<string, string>> = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };

/** What it was: the file, the reason, or what kind it is when People kept neither. */
export const titleOf = (e: TransferEntry): string =>
  e.title ?? (e.kind === 'import' ? 'An imported file' : 'An export');

/** What came of it, in words, and how loudly: blocked rows are a warning. */
export function resultOf(e: TransferEntry): {
  readonly text: string;
  readonly tone: 'success' | 'warning' | 'neutral';
} {
  if (e.imported !== null) {
    const { created, updated, blocked } = e.imported;
    if (blocked === 0) {
      return { text: `${String(created + updated)} created or updated`, tone: 'success' };
    }
    const parts = [
      created > 0 ? `${String(created)} created` : null,
      updated > 0 ? `${String(updated)} updated` : null,
      `${String(blocked)} blocked`,
    ].filter((p) => p !== null);
    return { text: parts.join(' · '), tone: 'warning' };
  }
  if (e.exported !== null) {
    const { rows } = e.exported;
    const people = `${rows.toLocaleString('en-GB')} ${rows === 1 ? 'person' : 'people'}`;
    const format = e.exported.format === null ? undefined : FORMAT[e.exported.format];
    return { text: format === undefined ? people : `${people} · ${format}`, tone: 'neutral' };
  }
  return { text: e.kind === 'import' ? 'Importing' : 'Being prepared', tone: 'neutral' };
}

/** An import's report, or an export's files: the export page hands the asker theirs. */
export const hrefOf = (e: TransferEntry): string | null =>
  e.kind === 'import'
    ? e.reportUrl
    : e.downloadable
      ? `/people/export?export=${encodeURIComponent(e.id)}`
      : null;

/**
 * When, as the design words it: "Today 14:02", "Mon 09:02" within the week,
 * "15 Sep" before that. In the reader's zone once in their browser.
 */
export function whenOf(at: string, now: string, zone: string | undefined): string {
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, dateStyle: 'short' }).format(new Date(iso));
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
  if (day(at) === day(now)) return `Today ${time}`;
  const days = (Date.parse(day(now)) - Date.parse(day(at))) / 86_400_000;
  if (days > 0 && days < 7) {
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short' }).format(
      new Date(at),
    );
    return `${weekday} ${time}`;
  }
  // "15 Sep": en-GB now abbreviates September as "Sept", so the parts are put together here.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')}`;
}

/** The reader's zone once in their browser; UTC for the server's render and the first. */
function useZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>('UTC');
  useEffect(() => {
    setZone(undefined);
  }, []);
  return zone;
}

/** The history under its switch and its search: a file, a person or a reason. */
export function filterHistory(
  entries: readonly TransferEntry[],
  kind: HistoryKind,
  search: string,
): TransferEntry[] {
  const needle = search.trim().toLocaleLowerCase();
  return entries.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (needle === '' ||
        titleOf(e).toLocaleLowerCase().includes(needle) ||
        e.by.name.toLocaleLowerCase().includes(needle)),
  );
}

export function ImportExport({ load, ...held }: ImportExportProps): JSX.Element {
  return (
    <Stack gap={5}>
      <PageHeader
        title="Import & export"
        description="Bring people in from a spreadsheet, or take data out with a recorded reason."
      />
      <Loaded load={load} what="imports and exports">
        {(state) => (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl/page:grid-cols-2 touch:grid-cols-2 touch:gap-2.5">
              {state.canImport ? (
                <Action
                  icon={<icons.import aria-hidden />}
                  title="Import people"
                  short="Import"
                  description="Create or update people in bulk. Nothing is written until you accept a dry run."
                  shortDescription="From a spreadsheet"
                  facts={['CSV or Excel', 'Up to 50,000 rows']}
                  href="/people/import"
                  start="Start import"
                  startIcon={<icons.upload aria-hidden />}
                  more={
                    <Button
                      asChild
                      variant="secondary"
                      startIcon={<icons.spreadsheet aria-hidden />}
                    >
                      <a href={TEMPLATE_URL} download>
                        Template
                      </a>
                    </Button>
                  }
                />
              ) : null}
              <Action
                icon={<icons.export aria-hidden />}
                title="Export people"
                short="Export"
                description="Download people data. Field permissions apply, and each export records why."
                shortDescription="With a reason"
                facts={['CSV, Excel or PDF', 'As of any date']}
                href="/people/export"
                start="New export"
                startIcon={<icons.download aria-hidden />}
                shortcut="create"
              />
            </div>
            {state.history === null ? null : (
              <History history={state.history} now={state.now} {...held} />
            )}
          </>
        )}
      </Loaded>
    </Stack>
  );
}

/**
 * A way in or out. At a desk a card with what it takes and its buttons; under
 * a finger a tile that is itself the link.
 */
function Action({
  icon,
  title,
  short,
  description,
  shortDescription,
  facts,
  href,
  start,
  startIcon,
  more = null,
  shortcut,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly short: string;
  readonly description: string;
  readonly shortDescription: string;
  readonly facts: readonly string[];
  readonly href: string;
  readonly start: string;
  readonly startIcon: ReactNode;
  /** A second button beside the start, at a desk: the import's template. */
  readonly more?: ReactNode;
  /** The shortcut the start answers to (C for a new export), shown in its tooltip. */
  readonly shortcut?: string;
}): JSX.Element {
  return (
    <>
      <Card padded className="flex flex-col gap-3.5 touch:hidden">
        <div className="flex items-start gap-4">
          <Avatar size="xl" shape="rounded" tone="accent" name={title} fallback={icon} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold">{title}</h2>
            <p className="mt-1.5 text-sm text-fg-muted">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {facts.map((f) => (
            <Badge key={f} size="sm">
              {f}
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            asChild
            variant="primary"
            startIcon={startIcon}
            {...(shortcut === undefined ? {} : { shortcut })}
          >
            <a href={href}>{start}</a>
          </Button>
          {more}
        </div>
      </Card>
      <Card interactive padded className="relative hidden flex-col gap-2.5 touch:flex">
        <Avatar size="lg" shape="rounded" tone="accent" name={short} fallback={icon} />
        <div>
          <a href={href} className="text-md font-bold before:absolute before:inset-0">
            {short}
          </a>
          <p className="mt-0.5 text-sm text-fg-muted">{shortDescription}</p>
        </div>
      </Card>
    </>
  );
}

const KIND = {
  import: { label: 'Import', tone: 'info', icon: <icons.import aria-hidden /> },
  export: { label: 'Export', tone: 'accent', icon: <icons.export aria-hidden /> },
} as const;

/** One history for both, newest first: every import and export, whoever ran it. */
function History({
  history,
  now,
  ...held
}: Omit<ImportExportProps, 'load'> & {
  readonly history: NonNullable<ImportExportState['history']>;
  readonly now: string;
}): JSX.Element {
  const [kind, setKind] = useHeld<HistoryKind>(held.kind, held.onKindChange, 'all');
  const [search, setSearch] = useTyped(held.search ?? '', held.onSearchChange);
  const zone = useZone();
  // Older and newest keep what the history is narrowed to.
  const page = (before: string | null): string => {
    const q = new URLSearchParams();
    if (before !== null) q.set('before', before);
    if (kind !== 'all') q.set('kind', kind);
    if (search.trim() !== '') q.set('q', search);
    const qs = q.toString();
    return qs === '' ? HERE : `${HERE}?${qs}`;
  };
  const shown = filterHistory(history.items, kind, search);
  const when = (e: TransferEntry) => whenOf(e.at, now, zone);
  return (
    <section aria-labelledby="history" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="history" className="text-md font-semibold">
          History
        </h2>
        <SegmentedControl
          aria-label="Show"
          size="sm"
          value={kind}
          onValueChange={(next) => {
            if (next === 'all' || next === 'import' || next === 'export') setKind(next);
          }}
          className="touch:hidden"
        >
          <SegmentedControlItem value="all">All</SegmentedControlItem>
          <SegmentedControlItem value="import">Imports</SegmentedControlItem>
          <SegmentedControlItem value="export">Exports</SegmentedControlItem>
        </SegmentedControl>
        <SearchField
          label="Search the history"
          placeholder="Search by file, person or reason"
          size="sm"
          value={search}
          onValueChange={setSearch}
          containerClassName="ms-auto w-full @3xl/page:w-75 touch:hidden"
        />
        {/* The company's activity log, narrowed to these (`docs/audit.md`). */}
        <Button asChild size="sm" variant="ghost" startIcon={<icons.history aria-hidden />}>
          <a href="/settings/activity?area=imports_exports">See all activity</a>
        </Button>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={history.items.length === 0 ? 'Nothing imported or exported yet' : 'Nothing matches'}
        />
      ) : (
        <>
          <Table aria-label="Imports and exports" containerClassName="touch:hidden">
            <TableHeader>
              <TableRow>
                <TableHead className="w-30">Type</TableHead>
                <TableHead>File or reason</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="w-30">When</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="w-15">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => {
                const title = titleOf(e);
                const result = resultOf(e);
                const href = hrefOf(e);
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Badge size="sm" tone={KIND[e.kind].tone}>
                        {KIND[e.kind].icon}
                        {KIND[e.kind].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">{title}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Avatar size="sm" name={e.by.name} src={e.by.avatarUrl ?? undefined} />
                        {e.by.name}
                      </span>
                    </TableCell>
                    <TableCell>{when(e)}</TableCell>
                    <TableCell>
                      {result.tone === 'neutral' ? (
                        result.text
                      ) : (
                        <Badge size="sm" tone={result.tone}>
                          {result.text}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {href === null ? null : (
                        <Button asChild size="xs" variant="ghost">
                          <a
                            href={href}
                            aria-label={
                              e.kind === 'import' ? `Report of ${title}` : `Download ${title}`
                            }
                          >
                            {e.kind === 'import' ? (
                              <icons.document aria-hidden />
                            ) : (
                              <icons.download aria-hidden />
                            )}
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <List aria-label="Imports and exports" className="hidden touch:block">
            {shown.map((e) => {
              const href = hrefOf(e);
              return (
                <ListItem
                  key={e.id}
                  leading={
                    <Avatar
                      size="lg"
                      shape="rounded"
                      tone={KIND[e.kind].tone}
                      name={KIND[e.kind].label}
                      fallback={KIND[e.kind].icon}
                    />
                  }
                  description={`${resultOf(e).text} · ${when(e)}`}
                  {...(href === null ? {} : { asChild: true, chevron: true })}
                >
                  {href === null ? titleOf(e) : <a href={href}>{titleOf(e)}</a>}
                </ListItem>
              );
            })}
          </List>
        </>
      )}
      {history.next === null && !history.paged ? null : (
        <nav aria-label="Older history" className="flex gap-2">
          {history.paged ? (
            <Button asChild>
              <a href={page(null)}>Newest</a>
            </Button>
          ) : null}
          {history.next === null ? null : (
            <Button asChild>
              <a href={page(history.next)}>Older</a>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
