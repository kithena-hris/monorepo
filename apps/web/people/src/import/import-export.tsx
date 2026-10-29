import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  type DataColumn,
  DataTable,
  dateFormat,
  EmptyState,
  icons,
  ListItem,
  locale,
  PageHeader,
  Progress,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  usePages,
  VirtualList,
  type VirtualListProps,
} from '@reach/ui';
import { useCallback, useId, useMemo, useState, type JSX, type ReactNode } from 'react';

import { useHeld, useTyped } from '../held';
import { Loaded, type Loadable } from '../load';
import {
  ImportBusy,
  isRunning,
  peopleLine,
  runHref,
  useZone,
  type ImportRunStatus,
} from './import-run';
import { t } from '../i18n';

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
  /**
   * An import's state, in the one set of words: Importing with how many people
   * are in, Imported, Import failed; its id is the run's. Null for an export.
   */
  readonly run?: {
    readonly status: 'importing' | 'imported' | 'failed';
    readonly label: string;
    readonly people: { readonly done: number; readonly total: number | null };
  } | null;
}

export interface ImportExportState {
  readonly canImport: boolean;
  /** False while nothing is published: the import sends setup first. Absent is set up. */
  readonly setUp?: boolean;
  /**
   * Newest first, the first page read with the rest of the page so the first
   * HTML holds it, older ones as it scrolls (`onLoadMore`). `null`: not this
   * viewer’s to read.
   */
  readonly history: TransferHistory | null;
  /** When the page was read, so "Today" means the same on the server and in the browser. */
  readonly now: string;
}

export interface TransferHistory {
  readonly items: readonly TransferEntry[];
  /** The cursor for older entries; null on the last page. */
  readonly next: string | null;
  /** How many entries there are over every page. Absent from an older People. */
  readonly total?: number | null;
}

export interface ImportExportProps {
  readonly load: Loadable<ImportExportState>;
  /** The history narrowed to imports or exports (`?kind=`), held by the host. */
  readonly kind?: HistoryKind;
  readonly onKindChange?: (kind: HistoryKind) => void;
  /** The history's search (`?q=`), once typing rests. */
  readonly search?: string;
  readonly onSearchChange?: (search: string) => void;
  /** The company's import running now, as the host follows it: Import waits for it. */
  readonly running?: ImportRunStatus | null;
  /**
   * An export described in a sentence on the Export card: read into the
   * export page's choices, which it opens with them. Absent, no sentence.
   */
  readonly onDescribe?: (
    sentence: string,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** The history before `before`, as People answers it (a `TransferHistory`), or null. */
  readonly onLoadMore?: (before: string) => Promise<unknown>;
}

export type HistoryKind = 'all' | 'import' | 'export';

/** The template, as a file: the shell's download route. */
export const TEMPLATE_URL = '/people/downloads/import-template';

const FORMAT: Readonly<Record<string, string>> = {
  csv: 'CSV',
  get xlsx(): string {
    return t('import.import-export.excel', 'Excel');
  },
  pdf: 'PDF',
};

/** What it was: the file, the reason, or what kind it is when People kept neither. */
export const titleOf = (e: TransferEntry): string =>
  e.title ??
  (e.kind === 'import'
    ? t('import.import-export.an_imported_file', 'An imported file')
    : t('import.import-export.an_export', 'An export'));

/** What came of it, in words, and how loudly: skipped rows are a warning. */
export function resultOf(e: TransferEntry): {
  readonly text: string;
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral';
} {
  if (e.run?.status === 'importing') {
    return {
      text: t('import.import-export.importing', 'Importing… {{peopleLine}}', {
        peopleLine: peopleLine(e.run.people),
      }),
      tone: 'neutral',
    };
  }
  if (e.run?.status === 'failed')
    return { text: t('import.import-export.import_failed', 'Import failed'), tone: 'danger' };
  if (e.imported !== null) {
    const { created, updated, blocked } = e.imported;
    // Imported: the word every import is said with once it is over.
    const lead = e.run == null ? '' : t('import.import-export.imported', 'Imported ·') + ' ';
    const n = (count: number): string => count.toLocaleString(locale());
    if (blocked === 0) {
      return {
        text: t('import.import-export.created_or_updated', '{{lead}}{{n}} created or updated', {
          lead,
          n: n(created + updated),
        }),
        tone: 'success',
      };
    }
    const parts = [
      created > 0 ? t('import.import-export.created', '{{n}} created', { n: n(created) }) : null,
      updated > 0 ? t('import.import-export.updated', '{{n}} updated', { n: n(updated) }) : null,
      t('import.import-export.skipped', '{{n}} skipped', { n: n(blocked) }),
    ].filter((p) => p !== null);
    return { text: `${lead}${parts.join(' · ')}`, tone: 'warning' };
  }
  if (e.exported !== null) {
    const { rows } = e.exported;
    const people = t(
      'import.import-export.text',
      { one: '{{count}} person', other: '{{count}} people' },
      { count: rows },
    );
    const format = e.exported.format === null ? undefined : FORMAT[e.exported.format];
    return {
      text:
        format === undefined
          ? people
          : t('import.import-export.text_2', '{{people}} · {{format}}', { people, format }),
      tone: 'neutral',
    };
  }
  return {
    text:
      e.kind === 'import'
        ? t('import.import-export.importing_2', 'Importing')
        : t('import.import-export.being_prepared', 'Being prepared'),
    tone: 'neutral',
  };
}

/**
 * An import still running, or one that failed: its page. One imported: its
 * report. An export's files: the export page hands the asker theirs.
 */
export const hrefOf = (e: TransferEntry): string | null =>
  e.kind === 'import'
    ? e.run != null && e.run.status !== 'imported'
      ? runHref(e.id)
      : e.reportUrl
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
  const time = dateFormat({
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
  if (day(at) === day(now)) return t('import.import-export.today', 'Today {{time}}', { time });
  const days = (Date.parse(day(now)) - Date.parse(day(at))) / 86_400_000;
  if (days > 0 && days < 7) {
    const weekday = dateFormat({ timeZone: zone, weekday: 'short' }).format(new Date(at));
    return t('import.import-export.weekday_time', '{{weekday}} {{time}}', { weekday, time });
  }
  return dateFormat({ timeZone: zone, day: 'numeric', month: 'short' }).format(new Date(at));
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

export function ImportExport({
  load,
  running = null,
  onDescribe,
  ...held
}: ImportExportProps): JSX.Element {
  const busyId = useId();
  const going = running !== null && isRunning(running) ? running : null;
  return (
    <Stack gap={5}>
      <PageHeader
        title={t('import.import-export.import_export', 'Import & export')}
        description={t(
          'import.import-export.bring_people_in_from_a_spreadsheet',
          'Bring people in from a spreadsheet, or take data out with a recorded reason.',
        )}
      />
      <Loaded
        load={load}
        what={t('import.import-export.imports_and_exports', 'imports and exports')}
      >
        {(state) => (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl/page:grid-cols-2 touch:grid-cols-2 touch:gap-2.5">
              {state.canImport ? (
                <Action
                  icon={<icons.upload aria-hidden />}
                  title={t('import.import-export.import_people', 'Import people')}
                  short={t('import.import-export.import', 'Import')}
                  description={t(
                    'import.import-export.create_or_update_people_in_bulk',
                    'Create or update people in bulk. Nothing is written until you accept a dry run.',
                  )}
                  shortDescription={t(
                    'import.import-export.from_a_spreadsheet',
                    'From a spreadsheet',
                  )}
                  facts={[
                    t('import.import-export.csv_or_excel', 'CSV or Excel'),
                    t('import.import-export.up_to_50_000_rows', 'Up to 50,000 rows'),
                  ]}
                  href={going === null ? '/people/import' : runHref(going.id)}
                  start={t('import.import-export.start_import', 'Start import')}
                  startIcon={<icons.upload aria-hidden />}
                  busy={
                    going === null
                      ? null
                      : {
                          id: busyId,
                          reason: <ImportBusy id={busyId} run={going} />,
                          progress: (
                            <Progress
                              label={t('import.import-export.importing_3', 'Importing… {{step}}', {
                                step: going.step,
                              })}
                              showValue
                              value={going.people.total === null ? null : going.people.done}
                              max={Math.max(1, going.people.total ?? 1)}
                              valueLabel={peopleLine(going.people)}
                            />
                          ),
                          short: t('import.import-export.importing', 'Importing… {{peopleLine}}', {
                            peopleLine: peopleLine(going.people),
                          }),
                        }
                  }
                  more={
                    // Before setup there are no fields, so nothing to template.
                    state.setUp === false ? null : (
                      <Button
                        asChild
                        variant="secondary"
                        startIcon={<icons.spreadsheet aria-hidden />}
                      >
                        <a href={TEMPLATE_URL} download>
                          {t('import.import-export.template', 'Template')}
                        </a>
                      </Button>
                    )
                  }
                />
              ) : null}
              <Action
                icon={<icons.download aria-hidden />}
                title={t('import.import-export.export_people', 'Export people')}
                short={t('import.import-export.export', 'Export')}
                description={t(
                  'import.import-export.download_people_data_field_permissions_apply',
                  'Download people data. Field permissions apply, and each export records why.',
                )}
                shortDescription={t('import.import-export.with_a_reason', 'With a reason')}
                facts={[
                  t('import.import-export.csv_excel_or_pdf', 'CSV, Excel or PDF'),
                  t('import.import-export.as_of_any_date', 'As of any date'),
                ]}
                href="/people/export"
                start={t('import.import-export.new_export', 'New export')}
                startIcon={<icons.add aria-hidden />}
                shortcut="create"
                lead={onDescribe === undefined ? null : <DescribeExport onDescribe={onDescribe} />}
              />
            </div>
            {state.history === null ? null : (
              <History history={state.history} going={going} now={state.now} {...held} />
            )}
          </>
        )}
      </Loaded>
    </Stack>
  );
}

/**
 * The Export card's sentence: described here, the export page opens with it
 * read into who, which fields, as of when, the format and a reason. Nothing
 * leaves until a button there is pressed.
 */
function DescribeExport({
  onDescribe,
}: {
  readonly onDescribe: NonNullable<ImportExportProps['onDescribe']>;
}): JSX.Element {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <Stack gap={2}>
      <SearchField
        variant="prompt"
        size="sm"
        label={t('import.import-export.describe_an_export', 'Describe an export')}
        placeholder={t(
          'import.import-export.describe_it_like_salaries_in_madrid',
          'Describe it, like “salaries in Madrid as of 30 June, for Finance”',
        )}
        enterKeyHint="go"
        maxLength={300}
        loading={busy}
        value={typed}
        onValueChange={setTyped}
        onSearch={(value) => {
          if (value.trim() === '') return;
          setBusy(true);
          setRefused(null);
          void onDescribe(value.trim()).then((answer) => {
            setBusy(false);
            if (!answer.ok) setRefused(answer.message);
          });
        }}
      />
      {refused === null ? null : (
        <Alert
          tone="danger"
          title={t('import.import-export.nothing_was_built', 'Nothing was built')}
        >
          {refused}
        </Alert>
      )}
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
  lead = null,
  shortcut,
  busy = null,
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
  /** Above the buttons, at a desk: the export's sentence, the way most exports start. */
  readonly lead?: ReactNode;
  /** The shortcut the start answers to (C for a new export), shown in its tooltip. */
  readonly shortcut?: string;
  /**
   * Another of these is running: the start is off, with why beside it, and how
   * far that one is. Under a finger the tile opens it, saying how far.
   */
  readonly busy?: {
    readonly id: string;
    readonly reason: ReactNode;
    readonly progress: ReactNode;
    readonly short: string;
  } | null;
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
        {busy === null ? null : busy.progress}
        {lead}
        <div className="flex gap-2">
          {busy === null ? (
            <Button
              asChild
              variant="primary"
              startIcon={startIcon}
              {...(shortcut === undefined ? {} : { shortcut })}
            >
              <a href={href}>{start}</a>
            </Button>
          ) : (
            <Button variant="primary" startIcon={startIcon} disabled aria-describedby={busy.id}>
              {start}
            </Button>
          )}
          {more}
        </div>
        {busy === null ? null : busy.reason}
      </Card>
      <Card interactive padded className="relative hidden flex-col gap-2.5 touch:flex">
        <Avatar size="lg" shape="rounded" tone="accent" name={short} fallback={icon} />
        <div>
          <a href={href} className="text-md font-bold before:absolute before:inset-0">
            {short}
          </a>
          <p className="mt-0.5 text-sm text-fg-muted">{busy?.short ?? shortDescription}</p>
        </div>
      </Card>
    </>
  );
}

const KIND = {
  import: {
    get label(): string {
      return t('import.import-export.import', 'Import');
    },
    tone: 'info',
    icon: <icons.upload aria-hidden />,
  },
  export: {
    get label(): string {
      return t('import.import-export.export', 'Export');
    },
    tone: 'accent',
    icon: <icons.download aria-hidden />,
  },
} as const;

/** One history for both, newest first: every import and export, whoever ran it. */
function History({
  history,
  going,
  now,
  onLoadMore,
  ...held
}: Omit<ImportExportProps, 'load'> & {
  readonly history: TransferHistory;
  /** The run as the host follows it, not as the page was read. */
  readonly going: {
    readonly id: string;
    readonly people: { done: number; total: number | null };
  } | null;
  readonly now: string;
}): JSX.Element {
  const [kind, setKind] = useHeld<HistoryKind>(held.kind, held.onKindChange, 'all');
  const [search, setSearch] = useTyped(held.search ?? '', held.onSearchChange);
  const zone = useZone();
  // Older pages as it scrolls; the kind and the search narrow what is loaded,
  // and a narrowed list too short to scroll keeps loading until it is not.
  const more = useCallback(
    async (before: string) => {
      const page = (await onLoadMore?.(before)) as TransferHistory | null | undefined;
      return page == null ? null : { items: page.items, next: page.next };
    },
    [onLoadMore],
  );
  const pages = usePages(history.items, history.next, onLoadMore === undefined ? undefined : more);
  const items =
    going === null
      ? pages.items
      : pages.items.map((e) =>
          e.id === going.id && e.run != null
            ? { ...e, run: { ...e.run, people: going.people } }
            : e,
        );
  const shown = filterHistory(items, kind, search);
  const infinite = {
    ...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore }),
    loadingMore: pages.loading,
    // People counts the whole history; a kind or a search narrows only what is loaded.
    ...(kind === 'all' && search === '' && history.total != null ? { total: history.total } : {}),
  };
  const when = useCallback((e: TransferEntry) => whenOf(e.at, now, zone), [now, zone]);
  // Held while the clock and the zone hold, so a page landing or a search
  // redraws only the rows that changed.
  const columns = useMemo<readonly DataColumn<TransferEntry>[]>(
    () => [
      {
        id: 'type',
        header: t('import.import-export.type', 'Type'),
        width: '7.5rem',
        hideOnCard: true,
        cell: (e) => (
          <Badge size="sm" tone={KIND[e.kind].tone}>
            {KIND[e.kind].icon}
            {KIND[e.kind].label}
          </Badge>
        ),
      },
      {
        id: 'title',
        header: t('import.import-export.file_or_reason', 'File or reason'),
        cell: (e) => {
          const href = hrefOf(e);
          const title = titleOf(e);
          return href === null ? (
            title
          ) : (
            <a
              href={href}
              aria-label={
                e.kind === 'export'
                  ? t('import.import-export.download', 'Download {{title}}', { title })
                  : href === e.reportUrl
                    ? t('import.import-export.report_of', 'Report of {{title}}', { title })
                    : t('import.import-export.open_the_import_of', 'Open the import of {{title}}', {
                        title,
                      })
              }
            >
              {title}
            </a>
          );
        },
      },
      {
        id: 'by',
        header: t('import.import-export.by', 'By'),
        cell: (e) => (
          <span className="flex items-center gap-2">
            <Avatar size="sm" name={e.by.name} src={e.by.avatarUrl ?? undefined} />
            {e.by.name}
          </span>
        ),
      },
      {
        id: 'when',
        header: t('import.import-export.when', 'When'),
        width: '7.5rem',
        cell: (e) => when(e),
      },
      {
        id: 'result',
        header: t('import.import-export.result', 'Result'),
        cardTrailing: true,
        cell: (e) => {
          const result = resultOf(e);
          return result.tone === 'neutral' ? (
            result.text
          ) : (
            <Badge size="sm" tone={result.tone}>
              {result.text}
            </Badge>
          );
        },
      },
    ],
    [when],
  );
  const renderItem = useCallback<VirtualListProps<TransferEntry>['renderItem']>(
    (e, _i, row) => {
      const href = hrefOf(e);
      return (
        <ListItem
          key={e.id}
          {...row}
          leading={
            <Avatar
              size="lg"
              shape="rounded"
              tone={KIND[e.kind].tone}
              name={KIND[e.kind].label}
              fallback={KIND[e.kind].icon}
            />
          }
          description={t('import.import-export.text_5', '{{text}} · {{e}}', {
            text: resultOf(e).text,
            e: when(e),
          })}
          {...(href === null ? {} : { asChild: true, chevron: true })}
        >
          {href === null ? titleOf(e) : <a href={href}>{titleOf(e)}</a>}
        </ListItem>
      );
    },
    [when],
  );
  return (
    <section aria-labelledby="history" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="history" className="text-md font-semibold">
          {t('import.import-export.history', 'History')}
        </h2>
        <SegmentedControl
          aria-label={t('import.import-export.show', 'Show')}
          size="sm"
          value={kind}
          onValueChange={(next) => {
            if (next === 'all' || next === 'import' || next === 'export') setKind(next);
          }}
          className="touch:hidden"
        >
          <SegmentedControlItem value="all">
            {t('import.import-export.all', 'All')}
          </SegmentedControlItem>
          <SegmentedControlItem value="import">
            {t('import.import-export.imports', 'Imports')}
          </SegmentedControlItem>
          <SegmentedControlItem value="export">
            {t('import.import-export.exports', 'Exports')}
          </SegmentedControlItem>
        </SegmentedControl>
        <SearchField
          label={t('import.import-export.search_the_history', 'Search the history')}
          placeholder={t(
            'import.import-export.search_by_file_person_or_reason',
            'Search by file, person or reason',
          )}
          size="sm"
          value={search}
          onValueChange={setSearch}
          containerClassName="ms-auto w-full @3xl/page:w-75 touch:hidden"
        />
        {/* The company's activity log, narrowed to these (`docs/audit.md`). */}
        <Button asChild size="sm" variant="ghost" startIcon={<icons.history aria-hidden />}>
          <a href="/settings/activity?area=imports_exports">
            {t('import.import-export.see_all_activity', 'See all activity')}
          </a>
        </Button>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={
            items.length === 0
              ? t(
                  'import.import-export.nothing_imported_or_exported_yet',
                  'Nothing imported or exported yet',
                )
              : t('import.import-export.nothing_matches', 'Nothing matches')
          }
        />
      ) : (
        <>
          {/* At a desk, a virtualized table that is the page's one scroll. */}
          <DataTable<TransferEntry>
            label={t('import.import-export.imports_and_exports_2', 'Imports and exports')}
            rows={shown}
            rowId={(e) => e.id}
            describeRow={titleOf}
            fill
            containerClassName="touch:hidden"
            {...infinite}
            columns={columns}
          />
          {/* Under a finger, a list that scrolls with the page, drawn near the view. */}
          <VirtualList
            label={t('import.import-export.imports_and_exports_2', 'Imports and exports')}
            items={shown}
            itemKey={(e) => e.id}
            scroll="page"
            listItems
            estimateItemHeight={72}
            className="hidden touch:block"
            {...infinite}
            renderItem={renderItem}
          />
        </>
      )}
    </section>
  );
}
