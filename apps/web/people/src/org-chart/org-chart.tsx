import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValues,
  OrgChart as Chart,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  icons,
  useCoarsePointer,
  type OrgNode,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';

/**
 * The org chart (W6, W7, M11).
 *
 * Everybody this viewer may see, drawn from each person's manager as People
 * holds it: pan, zoom, search, and a click on a card to see who they are
 * beside the chart without leaving it. The search focuses the chain of
 * managers to the top. Under a finger the chart opens as a tree that folds
 * open and closed, with the canvas one tap away (Reach's own phone mode).
 *
 * The chart is the directory seen another way, so the switch in the header
 * goes back to the table and the cards.
 */
export interface OrgPerson {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  /** Null for the top of the company, or a manager this viewer cannot see. */
  readonly managerId: string | null;
  readonly managerName: string | null;
  readonly avatarUrl: string | null;
  /** In words, as the directory says it: "On leave". Null when not shown. */
  readonly status: string | null;
  readonly team: string | null;
  readonly location: string | null;
}

export interface OrgChartState {
  readonly people: readonly OrgPerson[];
  /** More people than the chart was given: the first pages only. */
  readonly truncated: boolean;
}

export interface OrgChartScreenProps {
  readonly load: Loadable<OrgChartState>;
  readonly onOpen: (personId: string) => void;
  /** Back to the directory as a table or as cards. */
  readonly onDirectory?: (view: 'table' | 'cards') => void;
}

const TONE: Readonly<Record<string, 'info' | 'warning' | 'neutral'>> = {
  'On leave': 'info',
  'On notice': 'warning',
  'Starting soon': 'info',
};

export function OrgChartScreen({ load, onOpen, onDirectory }: OrgChartScreenProps): JSX.Element {
  return (
    <Loaded load={load} what="the org chart">
      {(state) => <Body state={state} onOpen={onOpen} onDirectory={onDirectory} />}
    </Loaded>
  );
}

function Body({
  state,
  onOpen,
  onDirectory,
}: {
  readonly state: OrgChartState;
  readonly onOpen: OrgChartScreenProps['onOpen'];
  readonly onDirectory: OrgChartScreenProps['onDirectory'];
}): JSX.Element {
  const coarse = useCoarsePointer();
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const [picked, setPicked] = useState<string | null>(null);
  const ids = new Set(state.people.map((p) => p.id));
  const managers = new Set(
    state.people.flatMap((p) => (p.managerId === null ? [] : [p.managerId])),
  );
  const nodes: OrgNode[] = state.people.map((p) => ({
    id: p.id,
    name: p.name,
    ...(p.title === null ? {} : { title: p.title }),
    ...(p.team === null ? {} : { meta: p.team }),
    ...(p.managerId === null || !ids.has(p.managerId) ? {} : { parentId: p.managerId }),
    ...(p.avatarUrl === null ? {} : { avatarUrl: p.avatarUrl }),
    ...(p.status === null || TONE[p.status] === undefined
      ? {}
      : { status: p.status, statusTone: TONE[p.status] }),
  }));
  const person = state.people.find((p) => p.id === picked) ?? null;
  const reports =
    person === null ? 0 : state.people.filter((p) => p.managerId === person.id).length;

  return (
    <Stack gap={5}>
      <PageHeader
        title="Org chart"
        meta={
          <Badge size="sm" tone="accent">
            New
          </Badge>
        }
        description={`${state.people.length.toLocaleString('en-GB')} people · ${String(managers.size)} managers${
          state.truncated ? ' · the first pages of the directory' : ''
        }`}
        actions={
          coarse ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                aria-label="Direction"
                size="sm"
                value={orientation}
                onValueChange={(next) => {
                  setOrientation(next === 'horizontal' ? 'horizontal' : 'vertical');
                }}
              >
                <SegmentedControlItem value="vertical">Top down</SegmentedControlItem>
                <SegmentedControlItem value="horizontal">Left to right</SegmentedControlItem>
              </SegmentedControl>
              {onDirectory === undefined ? null : (
                <SegmentedControl
                  aria-label="Show people as"
                  size="sm"
                  value="chart"
                  onValueChange={(next) => {
                    if (next === 'table' || next === 'cards') onDirectory(next);
                  }}
                >
                  <SegmentedControlItem iconOnly value="table" aria-label="Table">
                    <icons.table aria-hidden />
                  </SegmentedControlItem>
                  <SegmentedControlItem iconOnly value="cards" aria-label="Cards">
                    <icons.people aria-hidden />
                  </SegmentedControlItem>
                  <SegmentedControlItem iconOnly value="chart" aria-label="Org chart">
                    <icons.organisation aria-hidden />
                  </SegmentedControlItem>
                </SegmentedControl>
              )}
            </span>
          )
        }
      />
      {nodes.length === 0 ? (
        <EmptyState
          icon={<icons.organisation />}
          title="Nobody to chart yet"
          description="The chart draws itself from each person’s manager once people are added."
        />
      ) : (
        <div
          className={
            person === null || coarse
              ? 'min-w-0'
              : 'grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-4'
          }
        >
          <Card className="min-w-0 overflow-hidden">
            <Chart
              label="Org chart"
              nodes={nodes}
              orientation={orientation}
              searchable
              minimap
              height={coarse ? 'auto' : 'calc(100dvh - 17rem)'}
              focusMode="chain"
              {...(picked === null ? {} : { selectedId: picked })}
              onSelect={(node) => {
                if (coarse) onOpen(node.id);
                else setPicked(node.id);
              }}
            />
          </Card>
          {person === null || coarse ? null : (
            <Card padded className="sticky top-4 flex flex-col gap-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={person.name} src={person.avatarUrl ?? undefined} size="xl" />
                <div className="min-w-0">
                  <h2 className="truncate text-md font-bold">{person.name}</h2>
                  {person.title === null ? null : (
                    <p className="truncate text-sm text-fg-muted">{person.title}</p>
                  )}
                </div>
              </div>
              <KeyValues
                items={[
                  ...(person.team === null ? [] : [{ label: 'Team', value: person.team }]),
                  { label: 'Manager', value: person.managerName ?? '—' },
                  ...(person.location === null
                    ? []
                    : [{ label: 'Location', value: person.location }]),
                  { label: 'Reports', value: reports === 0 ? 'None' : String(reports) },
                ]}
              />
              <div className="flex gap-2 *:flex-1">
                <Button
                  size="sm"
                  onClick={() => {
                    setPicked(null);
                  }}
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onOpen(person.id);
                  }}
                >
                  Profile
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </Stack>
  );
}
