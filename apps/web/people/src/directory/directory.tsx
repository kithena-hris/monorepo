import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ListDetail,
  PageHeader,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Toolbar,
  useBreakpoint,
  type DataColumn,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';

/** A column, generated from the published schema: only what this viewer may read. */
export interface DirectoryColumn {
  readonly key: string;
  readonly label: string;
}

export interface DirectoryPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  /** Display text per column key. A key the viewer cannot read is absent. */
  readonly values: Readonly<Record<string, string>>;
  /** Missing required values, or null when this viewer is not shown completeness. */
  readonly missing: number | null;
}

/** A field the viewer may filter on: one they can read on everybody. */
export interface DirectoryFilter {
  readonly key: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface DirectoryState {
  readonly active: number;
  readonly incomplete: number | null;
  readonly columns: readonly DirectoryColumn[];
  readonly filterable: readonly DirectoryFilter[];
  readonly people: readonly DirectoryPerson[];
}

export interface DirectoryProps {
  readonly load: Loadable<DirectoryState>;
  readonly search: string;
  readonly onSearchChange: (search: string) => void;
  /** Applied by the shell, server-side: `?filter=key:value`. */
  readonly filters: Readonly<Record<string, string>>;
  readonly onFiltersChange: (filters: Readonly<Record<string, string>>) => void;
  readonly onOpen: (personId: string) => void;
  /** Present only when the viewer may do each. */
  readonly onExport?: () => void;
  readonly onImport?: () => void;
}

const ANY = '__any';

/**
 * The directory (PRD §13.1, design screen 7).
 *
 * Columns come from the published schema rather than from this file, so a
 * field a tenant invented on Tuesday is a column and a filter by Wednesday.
 * Filtering runs where the rows are — the shell passes `filters` to People —
 * because 50,000 rows do not travel to a browser to be searched. Completeness
 * is a count, not a percentage: "2 missing" is actionable and "94%" is not.
 */
export function Directory(props: DirectoryProps): JSX.Element {
  const { load } = props;
  const summary =
    load.status === 'ready'
      ? [
          `${String(load.data.active)} active`,
          load.data.incomplete === null ? null : `${String(load.data.incomplete)} incomplete`,
        ]
          .filter((x) => x !== null)
          .join(' · ')
      : undefined;

  return (
    <Stack gap={6}>
      <PageHeader
        title="People"
        description={summary}
        actions={
          <span className="flex gap-2">
            {props.onExport === undefined ? null : <Button onClick={props.onExport}>Export</Button>}
            {props.onImport === undefined ? null : <Button onClick={props.onImport}>Import</Button>}
          </span>
        }
      />
      <Loaded load={load} what="the directory">
        {(state) => <Table {...props} state={state} />}
      </Loaded>
    </Stack>
  );
}

function Table({
  state,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  onOpen,
}: DirectoryProps & { readonly state: DirectoryState }): JSX.Element {
  const wide = useBreakpoint('md');
  const columns: DataColumn<DirectoryPerson>[] = [
    {
      id: 'person',
      header: 'Person',
      sticky: true,
      sortBy: (p) => p.name,
      cell: (p) => (
        <span className="flex items-center gap-2">
          <Avatar size="sm" name={p.name} src={p.avatarUrl ?? undefined} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{p.name}</span>
            {p.email === null ? null : (
              <span className="block truncate text-xs text-fg-muted">{p.email}</span>
            )}
          </span>
        </span>
      ),
    },
    ...state.columns.map((c): DataColumn<DirectoryPerson> => ({
      id: c.key,
      header: c.label,
      sortBy: (p) => p.values[c.key] ?? '',
      cell: (p) => p.values[c.key] ?? '',
    })),
  ];
  if (state.people.some((p) => p.missing !== null)) {
    columns.push({
      id: 'record',
      header: 'Record',
      sortBy: (p) => p.missing ?? -1,
      cell: (p) =>
        p.missing === null ? null : (
          <Badge tone={p.missing === 0 ? 'success' : 'warning'} size="sm">
            {p.missing === 0 ? 'Complete' : `${String(p.missing)} missing`}
          </Badge>
        ),
    });
  }

  return (
    <Stack gap={4}>
      <Toolbar
        search={<SearchField label="Search people" value={search} onValueChange={onSearchChange} />}
        filters={state.filterable.map((f) => (
          <Select
            key={f.key}
            value={filters[f.key] ?? ANY}
            onValueChange={(value) => {
              const rest = Object.fromEntries(Object.entries(filters).filter(([k]) => k !== f.key));
              onFiltersChange(value === ANY ? rest : { ...rest, [f.key]: value });
            }}
          >
            <SelectTrigger aria-label={f.label} className="w-auto min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{f.label}: any</SelectItem>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {f.label}: {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      />
      {wide ? (
        <DataTable
          label="People"
          rows={state.people}
          columns={columns}
          rowId={(p) => p.id}
          describeRow={(p) => p.name}
          onRowClick={(p) => {
            onOpen(p.id);
          }}
          stickyHeader
          empty={
            <EmptyState
              title="Nobody matches"
              description="Clear a filter or the search to see more people."
            />
          }
        />
      ) : (
        <Cards state={state} onOpen={onOpen} />
      )}
    </Stack>
  );
}

/**
 * The directory on a phone (§17.2): a card per person carrying the two
 * columns that matter, the rest one tap away in the detail pane. The same
 * people, the same filters; only the layout differs, and `useBreakpoint`
 * decides — nothing asks what device this is.
 */
function Cards({
  state,
  onOpen,
}: {
  readonly state: DirectoryState;
  readonly onOpen: (personId: string) => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<string | null>(null);
  const person = state.people.find((p) => p.id === chosen) ?? null;
  const [first, second] = state.columns;

  if (state.people.length === 0) {
    return (
      <EmptyState
        title="Nobody matches"
        description="Clear a filter or the search to see more people."
      />
    );
  }
  return (
    <ListDetail
      listLabel="People"
      detailLabel={person?.name ?? 'Person'}
      selected={person !== null}
      onBack={() => {
        setChosen(null);
      }}
      backLabel="All people"
      list={
        <ul className="flex flex-col gap-2">
          {state.people.map((p) => (
            <li key={p.id}>
              <Card className="flex items-center gap-3 p-3">
                <Avatar size="md" name={p.name} src={p.avatarUrl ?? undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {[first, second]
                      .map((c) => (c === undefined ? undefined : p.values[c.key]))
                      .filter((v) => v !== undefined && v !== '')
                      .join(' · ')}
                  </span>
                </span>
                {p.missing === null || p.missing === 0 ? null : (
                  <Badge tone="warning" size="sm">
                    {p.missing} missing
                  </Badge>
                )}
                <Button
                  size="sm"
                  aria-label={`Details for ${p.name}`}
                  onClick={() => {
                    setChosen(p.id);
                  }}
                >
                  Details
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      }
      detail={
        person === null ? null : (
          <Stack gap={4} className="p-4">
            <dl className="grid gap-3">
              {state.columns.map((c) => (
                <div key={c.key}>
                  <dt className="text-xs text-fg-muted">{c.label}</dt>
                  <dd className="text-sm">{person.values[c.key] ?? ''}</dd>
                </div>
              ))}
            </dl>
            <div>
              <Button
                variant="primary"
                onClick={() => {
                  onOpen(person.id);
                }}
              >
                Open profile
              </Button>
            </div>
          </Stack>
        )
      }
    />
  );
}
