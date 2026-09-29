import {
  Avatar,
  Badge,
  Button,
  ChangeDiff,
  ChipGroup,
  ChipGroupItem,
  DataTable,
  EmptyState,
  PageHeader,
  SearchField,
  Stack,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { useTyped } from '../held';
import { Loaded, type Loadable } from '../load';

/**
 * Every change to People's settings: who made it, when on the reader's own
 * clock, and what, in words — newest first, a row opening onto what it was
 * and what it became, narrowed to one area if asked. Recorded as each command succeeds, so a change made through
 * the API reads the same as one made here.
 */

export type ActivityArea = 'fields' | 'organisation' | 'roles' | 'integrations';

export interface SettingsActivityState {
  readonly entries: readonly {
    readonly id: string;
    readonly at: string;
    readonly action: string;
    readonly subject: string | null;
    /** What it did, in one plain sentence; absent on older entries. */
    readonly detail?: string | null;
    readonly area: string;
    /** "You", or who did it. */
    readonly by: string;
    /** Who did it by name, "You" included: the avatar's initials. */
    readonly name?: string;
    readonly avatarUrl: string | null;
    /**
     * `system` for an account nobody in People holds, and `support` for
     * Kithena support signed in from the back office: an icon, not initials.
     */
    readonly kind?: 'person' | 'system' | 'support';
    /** Why Kithena support was signed in, as the operator said. */
    readonly reason?: string | null;
  }[];
  readonly next: string | null;
}

export interface SettingsActivityProps {
  readonly load: Loadable<SettingsActivityState>;
  readonly area: ActivityArea | null;
  readonly onArea: (area: ActivityArea | null) => void;
  /** Older entries, from the cursor; absent on the last page. */
  readonly onOlder?: (before: string) => void;
  /** Back to the newest. */
  readonly onNewest?: () => void;
  /** The search over what is loaded (`?q=`), once typing rests. */
  readonly search?: string;
  readonly onSearchChange?: (search: string) => void;
}

const AREAS: readonly { readonly value: ActivityArea | 'all'; readonly label: string }[] = [
  { value: 'all', label: 'All settings' },
  { value: 'fields', label: 'Employee fields' },
  { value: 'organisation', label: 'Organisation' },
  { value: 'roles', label: 'Roles' },
  { value: 'integrations', label: 'Integrations' },
];

/** "Seen by: HR → HR and their manager." as its parts; null for a plain sentence. */
export function changesIn(
  text: string,
): readonly { readonly what: string; readonly from: string; readonly to: string }[] | null {
  const found = [...text.matchAll(/([^:.→]+): (.*?) → (.*?)\.(?=\s|$)/g)].map((m) => ({
    what: (m[1] ?? '').trim(),
    from: m[2] ?? '',
    to: m[3] ?? '',
  }));
  return found.length === 0 ? null : found;
}

const AREA_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  AREAS.filter((a) => a.value !== 'all').map((a) => [a.value, a.label]),
);

/** The reader's zone once in their browser; UTC for the server's render and the first. */
function useZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>('UTC');
  useEffect(() => {
    setZone(undefined);
  }, []);
  return zone;
}

export function SettingsActivity(props: SettingsActivityProps): JSX.Element {
  const [query, setQuery] = useTyped(props.search ?? '', props.onSearchChange);
  return (
    <Stack gap={6}>
      <PageHeader title="Activity log" description="Every settings change, who made it and when." />
      {/* Search what is loaded, and narrow to one area (S19). */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72 touch:w-full">
          <SearchField
            label="Search changes"
            placeholder="Search changes"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <ChipGroup
          type="single"
          scroll
          aria-label="Settings area"
          value={props.area ?? 'all'}
          onValueChange={(v) => {
            props.onArea(v === '' || v === 'all' ? null : (v as ActivityArea));
          }}
          className="min-w-0 gap-1.5"
        >
          {AREAS.map((a) => (
            <ChipGroupItem key={a.value} value={a.value} variant="view">
              {a.label}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </div>
      <Loaded load={props.load} what="the activity">
        {(state) => <Entries state={state} query={query} {...props} />}
      </Loaded>
    </Stack>
  );
}

type Entry = SettingsActivityState['entries'][number];

function Entries({
  state,
  query,
  onOlder,
  onNewest,
}: SettingsActivityProps & {
  readonly state: SettingsActivityState;
  readonly query: string;
}): JSX.Element {
  const zone = useZone();
  if (state.entries.length === 0) {
    return (
      <EmptyState
        title="Nothing changed yet"
        description="Changes to fields, the organisation, roles and integrations are listed here as they are made."
      />
    );
  }
  const when = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const needle = query.trim().toLowerCase();
  const rows =
    needle === ''
      ? state.entries
      : state.entries.filter((e) =>
          [e.action, e.subject, e.detail, e.by, e.name, e.reason].some(
            (v) => v?.toLowerCase().includes(needle) === true,
          ),
        );
  const what = (e: Entry) =>
    e.subject === null ? (
      e.action
    ) : (
      <>
        {e.action}: <span className="font-semibold">{e.subject}</span>
      </>
    );

  return (
    <Stack gap={4}>
      <DataTable<Entry>
        label="Settings changes"
        rows={rows}
        rowId={(e) => e.id}
        columns={[
          {
            id: 'when',
            header: 'When',
            width: '9.5rem',
            cell: (e) => (
              <time dateTime={e.at} title={new Date(e.at).toISOString()} className="tabular-nums">
                {when(e.at)}
              </time>
            ),
          },
          {
            id: 'who',
            header: 'Who',
            cell: (e) => (
              <span className="flex items-center gap-2.5">
                {e.kind === 'system' || e.kind === 'support' ? (
                  <Avatar size="sm" name={e.by} fallback={<icons.system aria-hidden />} />
                ) : (
                  <Avatar size="sm" name={e.name ?? e.by} src={e.avatarUrl ?? undefined} />
                )}
                {e.by}
              </span>
            ),
          },
          { id: 'what', header: 'What changed', cell: what },
          {
            id: 'area',
            header: 'Area',
            cardTrailing: true,
            cell: (e) => <Badge>{AREA_NAME[e.area] ?? 'Settings'}</Badge>,
          },
        ]}
        renderDetail={(e) => {
          const changed = e.detail == null ? null : changesIn(e.detail);
          const what =
            changed !== null ? (
              <ChangeDiff
                items={changed.map((c) => ({
                  id: c.what,
                  label: c.what,
                  before: c.from,
                  after: c.to,
                }))}
              />
            ) : (
              <p className="text-sm text-fg-muted">{e.detail ?? 'No more detail was recorded.'}</p>
            );
          if (e.kind !== 'support') return what;
          return (
            <Stack gap={2}>
              {what}
              <p className="text-sm text-fg-muted">
                {e.reason == null || e.reason === ''
                  ? 'Done by Kithena support, signed in from the back office.'
                  : `Kithena support was signed in from the back office: ${e.reason}`}
              </p>
            </Stack>
          );
        }}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No change on this page matches “{query.trim()}”.</p>
      ) : null}
      {onOlder === undefined && onNewest === undefined ? null : (
        <nav aria-label="Older activity" className="flex gap-2">
          {onNewest === undefined ? null : <Button onClick={onNewest}>Newest</Button>}
          {onOlder === undefined || state.next === null ? null : (
            <Button
              onClick={() => {
                if (state.next !== null) onOlder(state.next);
              }}
            >
              Older
            </Button>
          )}
        </nav>
      )}
    </Stack>
  );
}
