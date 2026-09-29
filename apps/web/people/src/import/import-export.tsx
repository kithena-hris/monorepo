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
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';

/**
 * Import & export (V6, MV5): two ways in and out of People, and one history
 * of both. The flows themselves are unchanged; this page starts them.
 *
 * Importing is HR's, as it always was: anybody else sees Export alone. The
 * history is People's to keep. It keeps none it can list yet, so the page says
 * that rather than drawing rows it does not have.
 */

/** One import or export, as People would word it. */
export interface TransferEntry {
  readonly id: string;
  readonly kind: 'import' | 'export';
  /** The file's name for an import; for an export, the reason recorded with it. */
  readonly title: string;
  readonly by: { readonly name: string; readonly avatarUrl: string | null } | null;
  /** When, in words: "Today 14:02", "15 Sep". */
  readonly at: string;
  /** "369 created or updated", "124 people · Excel". */
  readonly result: string;
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** The import's report or the export's file, while there is one. */
  readonly href: string | null;
}

export interface ImportExportState {
  readonly canImport: boolean;
  /** Newest first. `null`: People keeps no history of these it can list. */
  readonly history: readonly TransferEntry[] | null;
}

export interface ImportExportProps {
  readonly load: Loadable<ImportExportState>;
}

export type HistoryKind = 'all' | 'import' | 'export';

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
        e.title.toLocaleLowerCase().includes(needle) ||
        (e.by?.name.toLocaleLowerCase().includes(needle) ?? false)),
  );
}

export function ImportExport({ load }: ImportExportProps): JSX.Element {
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
              />
            </div>
            <History history={state.history} />
          </>
        )}
      </Loaded>
    </Stack>
  );
}

/**
 * A way in or out. At a desk a card with what it takes and its start button;
 * under a finger a tile that is itself the link.
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
          <Button asChild variant="primary" startIcon={startIcon}>
            <a href={href}>{start}</a>
          </Button>
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
function History({ history }: { readonly history: readonly TransferEntry[] | null }): JSX.Element {
  const [kind, setKind] = useState<HistoryKind>('all');
  const [search, setSearch] = useState('');
  if (history === null) {
    return (
      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-md font-semibold">
          History
        </h2>
        <EmptyState
          icon={<icons.history />}
          title="No history to show yet"
          description="Past imports and exports are not listed here yet. Each export is still recorded with who asked, which fields and why."
        />
      </section>
    );
  }
  const shown = filterHistory(history, kind, search);
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
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={history.length === 0 ? 'Nothing imported or exported yet' : 'Nothing matches'}
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
              {shown.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Badge size="sm" tone={KIND[e.kind].tone}>
                      {KIND[e.kind].icon}
                      {KIND[e.kind].label}
                    </Badge>
                  </TableCell>
                  <TableCell>{e.title}</TableCell>
                  <TableCell>
                    {e.by === null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Avatar size="sm" name={e.by.name} src={e.by.avatarUrl ?? undefined} />
                        {e.by.name}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{e.at}</TableCell>
                  <TableCell>
                    {e.tone === 'neutral' ? (
                      e.result
                    ) : (
                      <Badge size="sm" tone={e.tone}>
                        {e.result}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {e.href === null ? null : (
                      <Button asChild size="xs" variant="ghost">
                        <a
                          href={e.href}
                          aria-label={
                            e.kind === 'import' ? `Report of ${e.title}` : `Download ${e.title}`
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
              ))}
            </TableBody>
          </Table>
          <List aria-label="Imports and exports" className="hidden touch:block">
            {shown.map((e) => (
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
                description={`${e.result} · ${e.at}`}
                {...(e.href === null ? {} : { asChild: true, chevron: true })}
              >
                {e.href === null ? e.title : <a href={e.href}>{e.title}</a>}
              </ListItem>
            ))}
          </List>
        </>
      )}
    </section>
  );
}
