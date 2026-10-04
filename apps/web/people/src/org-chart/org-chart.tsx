import {
  Avatar,
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
import type { JSX } from 'react';

import { ViewSwitch, type DirectoryView } from '../directory/directory';
import { useHeld } from '../held';
import { Loaded, type Loadable } from '../load';

/**
 * The Directory's org chart view (V3, MV4; W6, W7, M11), at
 * `/people/directory/org-chart`.
 *
 * Everybody this viewer may see, drawn from each person's manager as People
 * holds it: pan, zoom, search, and a click on a card to see who they are
 * beside the chart without leaving it. The search focuses the chain of
 * managers to the top. Under a finger the chart opens as a tree that folds
 * open and closed, with the canvas one tap away (Reach's own phone mode).
 *
 * The chart is the directory seen another way, so it shares the Directory's
 * header with Org chart chosen, and the switch goes back to the list and the
 * cards with the same search and filters.
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
  /** Back to the directory as a list or as cards. */
  readonly onViewChange?: (view: DirectoryView) => void;
  /** Which way the tree grows, held by the host (`?layout=horizontal`). */
  readonly layout?: Orientation;
  readonly onLayoutChange?: (layout: Orientation) => void;
  /** Whose chain the search focused (`?focus=<id>`); null for everybody. */
  readonly focusId?: string | null;
  readonly onFocusChange?: (personId: string | null) => void;
  /** Whose side card is open (`?person=<id>`); null for none. */
  readonly pickedId?: string | null;
  readonly onPickedChange?: (personId: string | null) => void;
}

export type Orientation = 'vertical' | 'horizontal';

const TONE: Readonly<Record<string, 'info' | 'warning' | 'neutral'>> = {
  'On leave': 'info',
  'On notice': 'warning',
  'Starting soon': 'info',
};

export function OrgChartScreen({ load, ...props }: OrgChartScreenProps): JSX.Element {
  return (
    <Loaded load={load} what="the org chart">
      {(state) => <Body state={state} {...props} />}
    </Loaded>
  );
}

function Body({
  state,
  onOpen,
  onViewChange,
  layout,
  onLayoutChange,
  focusId,
  onFocusChange,
  pickedId,
  onPickedChange,
}: Omit<OrgChartScreenProps, 'load'> & { readonly state: OrgChartState }): JSX.Element {
  const coarse = useCoarsePointer();
  const [orientation, setOrientation] = useHeld<Orientation>(layout, onLayoutChange, 'vertical');
  const [focused, setFocused] = useHeld<string | null>(focusId, onFocusChange, null);
  const [chosen, setPicked] = useHeld<string | null>(pickedId, onPickedChange, null);
  const ids = new Set(state.people.map((p) => p.id));
  // Somebody a link names who is not on this viewer's chart: no card.
  const picked = chosen !== null && ids.has(chosen) ? chosen : null;
  // Somebody a link focused who is not on this viewer's chart: everybody.
  const focus = focused !== null && ids.has(focused) ? focused : null;
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
        title="Directory"
        description={`${state.people.length.toLocaleString('en-GB')} people · ${String(managers.size)} managers${
          state.truncated ? ' · the first pages of the directory' : ''
        }`}
        actions={
          onViewChange === undefined ? undefined : (
            <ViewSwitch view="org-chart" onChange={onViewChange} />
          )
        }
      />
      {onViewChange === undefined ? null : (
        <ViewSwitch phone view="org-chart" onChange={onViewChange} />
      )}
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
              searchPlaceholder="Find a person or team"
              // The direction sits on the canvas it turns; a phone's tree has none.
              {...(coarse
                ? {}
                : {
                    toolbar: (
                      <span className="flex items-center gap-2 text-sm text-fg-muted">
                        <span aria-hidden>Direction</span>
                        <SegmentedControl
                          aria-label="Direction"
                          size="sm"
                          value={orientation}
                          onValueChange={(next) => {
                            setOrientation(next === 'horizontal' ? 'horizontal' : 'vertical');
                          }}
                        >
                          <SegmentedControlItem value="vertical">Top down</SegmentedControlItem>
                          <SegmentedControlItem value="horizontal">
                            Left to right
                          </SegmentedControlItem>
                        </SegmentedControl>
                      </span>
                    ),
                  })}
              minimap
              height={coarse ? 'auto' : 'calc(100dvh - 17rem)'}
              focusMode="chain"
              focusId={focus}
              onFocusChange={setFocused}
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
