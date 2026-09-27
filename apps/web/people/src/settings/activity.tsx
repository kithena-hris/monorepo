import {
  Avatar,
  Button,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Timeline,
  TimelineItem,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';

/**
 * Every change to People's settings: who made it, when on the reader's own
 * clock, and what, in words — newest first, grouped by day, narrowed to one
 * area if asked. Recorded as each command succeeds, so a change made through
 * the API reads the same as one made here.
 */

export type ActivityArea = 'fields' | 'organisation' | 'roles' | 'integrations';

export interface SettingsActivityState {
  readonly entries: readonly {
    readonly id: string;
    readonly at: string;
    readonly action: string;
    readonly subject: string | null;
    readonly area: string;
    readonly by: string;
    readonly avatarUrl: string | null;
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
}

const AREAS: readonly { readonly value: ActivityArea | 'all'; readonly label: string }[] = [
  { value: 'all', label: 'All settings' },
  { value: 'fields', label: 'Employee fields' },
  { value: 'organisation', label: 'Organisation' },
  { value: 'roles', label: 'Roles' },
  { value: 'integrations', label: 'Integrations' },
];

/** The reader's zone once in their browser; UTC for the server's render and the first. */
function useZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>('UTC');
  useEffect(() => {
    setZone(undefined);
  }, []);
  return zone;
}

export function SettingsActivity(props: SettingsActivityProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Activity"
        description="Every change to People’s settings: who made it, when, and what."
        actions={
          <Select
            value={props.area ?? 'all'}
            onValueChange={(v) => {
              props.onArea(v === 'all' ? null : (v as ActivityArea));
            }}
          >
            <SelectTrigger aria-label="Settings area" className="w-auto min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AREAS.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <Loaded load={props.load} what="the activity">
        {(state) => <Entries state={state} {...props} />}
      </Loaded>
    </Stack>
  );
}

function Entries({
  state,
  onOlder,
  onNewest,
}: SettingsActivityProps & { readonly state: SettingsActivityState }): JSX.Element {
  const zone = useZone();
  if (state.entries.length === 0) {
    return (
      <EmptyState
        title="Nothing changed yet"
        description="Changes to fields, the organisation, roles and integrations are listed here as they are made."
      />
    );
  }
  const day = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'full' }).format(new Date(iso));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: zone, timeStyle: 'short' }).format(new Date(iso));
  const days = new Map<string, SettingsActivityState['entries'][number][]>();
  for (const e of state.entries) days.set(day(e.at), [...(days.get(day(e.at)) ?? []), e]);

  return (
    <Stack gap={6}>
      {[...days].map(([label, entries]) => (
        <section key={label} aria-label={label} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-fg-muted">{label}</h2>
          <Timeline aria-label={`Changes on ${label}`}>
            {entries.map((e, i) => (
              <TimelineItem
                key={e.id}
                last={i === entries.length - 1}
                marker={<Avatar size="sm" name={e.by} src={e.avatarUrl ?? undefined} />}
                title={e.subject === null ? e.action : `${e.action}: ${e.subject}`}
                timestamp={
                  <time dateTime={e.at} title={new Date(e.at).toISOString()}>
                    {time(e.at)}
                  </time>
                }
              >
                By {e.by}
              </TimelineItem>
            ))}
          </Timeline>
        </section>
      ))}
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
