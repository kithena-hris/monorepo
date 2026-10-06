import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { KeyHints, Note } from '../../docs/notes.tsx';
import { CANDIDATES, PEOPLE } from '../../docs/people.ts';
import { settled } from '../../docs/stage.tsx';
import { Avatar, AvatarGroup } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { BulkAction } from '../table/table.tsx';
import { Text } from '../text/text.tsx';
import {
  Kanban,
  KanbanCardMeta,
  type KanbanColumnDef,
  type KanbanMove,
  type KanbanProps,
} from './kanban.tsx';

type Candidate = { id: string; name: string; role: string; tags: readonly string[]; owner: string };

/** The design's candidate at `i`, with a recruiter from the sample people. */
const kc = (i: number): Candidate => {
  const c = CANDIDATES[i % CANDIDATES.length] ?? CANDIDATES[0];
  return {
    id: `${c.name}-${String(i)}`,
    name: c.name,
    role: c.role,
    tags: c.tags,
    owner: (PEOPLE[i % 5] ?? PEOPLE[0]).name,
  };
};

const STAGES: KanbanColumnDef[] = [
  { id: 'applied', title: 'Applied', tone: 'neutral', count: 5 },
  { id: 'screen', title: 'Screen', tone: 'info', count: 3 },
  { id: 'interview', title: 'Interview', tone: 'accent', count: 4 },
  { id: 'offer', title: 'Offer', tone: 'warning', count: 2 },
  { id: 'hired', title: 'Hired', tone: 'success', count: 6 },
];

const meta: Meta<KanbanProps<Candidate>> = {
  title: 'Components/Kanban',
  component: Kanban,
  parameters: { ...designDocs('kanban'), controls: { exclude: ['items', 'columns'] } },
};

export default meta;
type Story = StoryObj<KanbanProps<Candidate>>;

/** Applies a move to the board's cards, as the screen owning them would. */
function applyMove(
  items: Record<string, readonly Candidate[]>,
  { itemId, from, to, toIndex }: KanbanMove,
): Record<string, readonly Candidate[]> {
  const card = items[from]?.find((c) => c.id === itemId);
  if (!card) return items;
  const without = { ...items, [from]: (items[from] ?? []).filter((c) => c.id !== itemId) };
  const target = [...(without[to] ?? [])];
  target.splice(toIndex, 0, card);
  return { ...without, [to]: target };
}

const body = (c: Candidate): React.JSX.Element => (
  <KanbanCardMeta
    description={c.role}
    people={
      <AvatarGroup size={22} max={3}>
        <Avatar name={c.owner} />
      </AvatarGroup>
    }
  >
    {c.tags.map((t) => (
      <Badge key={t} size="sm">
        {t}
      </Badge>
    ))}
  </KanbanCardMeta>
);

function AddCard(): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      className="h-9 flex-row items-center gap-1.5 rounded-[10px] px-2"
    >
      <Icon icon={Plus} size={15} tone="muted" />
      <CssText className="text-[13px] leading-none font-medium text-fg-muted">Add card</CssText>
    </Pressable>
  );
}

/** A board owning its cards. */
function Board({
  columns,
  start,
  ...rest
}: Omit<KanbanProps<Candidate>, 'items' | 'onMove' | 'label' | 'cardTitle'> & {
  start: Record<string, readonly Candidate[]>;
}): React.JSX.Element {
  const [items, setItems] = useState(start);
  return (
    <Kanban
      label="Hiring"
      columns={columns}
      items={items}
      cardTitle={(c) => c.name}
      renderCard={body}
      onMove={(m) => {
        setItems(applyMove(items, m));
      }}
      {...rest}
    />
  );
}

const STANDARD = {
  applied: [0, 1, 2].map(kc),
  screen: [2, 3].map(kc),
  interview: [4, 5, 6].map(kc),
  offer: [6].map(kc),
  hired: [8, 9].map(kc),
};

export const Playground: Story = {
  render: () => (
    <Board
      columns={STAGES}
      start={STANDARD}
      handle="left"
      renderColumnFooter={(c) => (c.id === 'applied' ? <AddCard /> : null)}
    />
  ),
};

export const WithoutAMouse: Story = {
  name: 'Without a mouse',
  render: () => (
    <View className="gap-3">
      <Board
        columns={[
          { id: 'applied', title: 'Applied', count: 3 },
          { id: 'screen', title: 'Screen', count: 2 },
        ]}
        start={{ applied: [0, 1].map(kc), screen: [2, 3].map(kc) }}
        handle="left"
        focusedId={kc(0).id}
      />
      <KeyHints
        hints={[
          [['space'], 'pick up'],
          [['left', 'right'], 'move column'],
          [['up', 'down'], 'move in column'],
          [['esc'], 'cancel'],
        ]}
      />
      <View className="rounded-[10px] bg-surface-sunken px-3 py-2.5">
        <Text variant="footnote" weight="medium" tone="muted" className="leading-[1.4]">
          Hana Kim picked up. Position 1 of 3 in Applied.
        </Text>
      </View>
    </View>
  ),
};

export const LimitsAndLocked: Story = {
  name: 'Limits and locked columns',
  parameters: designNote('kanban', 'Limits and locked columns'),
  render: () => (
    <Board
      columns={[
        { id: 'interview', title: 'Interview', tone: 'accent', limit: 4 },
        { id: 'offer', title: 'Offer', tone: 'warning', limit: 3 },
        { id: 'hired', title: 'Hired', tone: 'success', locked: true, count: 6 },
      ]}
      start={{ interview: [4, 5, 6, 7].map(kc), offer: [0, 1].map(kc), hired: [2, 3].map(kc) }}
      handle="left"
      cardMenu
    />
  ),
};

export const GapOpens: Story = {
  name: 'The gap opens in both columns',
  parameters: designNote('kanban', 'The gap opens in both columns'),
  render: () => (
    <Board
      columns={[
        { id: 'screen', title: 'Screen', tone: 'info', count: 2 },
        { id: 'interview', title: 'Interview', tone: 'accent', count: 4 },
      ]}
      start={{ screen: [0, 1].map(kc), interview: [2, 3, 4].map(kc) }}
      handle="left"
    />
  ),
};

export const OnAPhone: Story = {
  name: 'On a phone',
  render: () => (
    <View className="gap-2.5">
      <Board
        layout="single"
        defaultColumn="screen"
        columns={STAGES.slice(0, 3)}
        start={{ applied: [0, 1, 7].map(kc), screen: [2, 3, 4].map(kc), interview: [5, 6].map(kc) }}
        handle="none"
        cardMenu
      />
      <Note>One column at a time. Swipe or use the segmented control to switch. Long-press to drag.</Note>
    </View>
  ),
};

const one = (i: number): Record<string, readonly Candidate[]> => ({ only: [kc(i)] });
const ONLY: KanbanColumnDef[] = [{ id: 'only', title: 'Card' }];

export const HandlePositions: Story = {
  name: 'Handle positions',
  render: () => (
    <View className="gap-3">
      {(
        [
          ['Left handle', 'left', 0],
          ['Right handle', 'right', 1],
          ['No handle', 'none', 2],
        ] as const
      ).map(([title, handle, i]) => (
        <View key={title} className="gap-1.5">
          <Text variant="caption" tone="muted">
            {title}
          </Text>
          <Board bare columns={ONLY} start={one(i)} handle={handle} />
        </View>
      ))}
    </View>
  ),
};

export const WholeCardDrags: Story = {
  name: 'The whole card drags',
  render: () => (
    <View className="gap-3">
      <Board bare columns={ONLY} start={one(3)} handle="none" />
      <Note>Without a handle, the whole card is the drag target. Links and buttons inside it still work.</Note>
    </View>
  ),
};

export const ScrollSpeed: Story = {
  name: 'Scroll speed and motion',
  render: () => (
    <View className="gap-2.5">
      <Board
        columns={STAGES.slice(0, 3)}
        start={{ applied: [0, 1].map(kc), screen: [2].map(kc), interview: [3].map(kc) }}
        handle="left"
      />
      <Note>
        Near an edge, the board scrolls faster the closer you get. Under reduced motion, cards snap into place without gliding.
      </Note>
    </View>
  ),
};

export const MenuOnly: Story = {
  name: 'Menu only',
  play: settled,
  render: () => (
    <View className="min-h-[300px]">
    <Board
      defaultMenuOpenFor={kc(0).id}
      bare
      columns={[{ id: 'only', title: 'Applied' }, ...STAGES.slice(1, 3)]}
      start={{ ...one(0), screen: [], interview: [] }}
      draggable={false}
      cardMenu
      cardActions={[{ id: 'remove', label: 'Remove', icon: Trash2, destructive: true, run: () => undefined }]}
    />
    </View>
  ),
};

function Bulk(): React.JSX.Element {
  const [selected, setSelected] = useState<readonly string[]>([kc(0).id, kc(1).id]);
  return (
    <Board
      columns={STAGES.slice(0, 2)}
      start={{ applied: [0, 1, 2].map(kc), screen: [3].map(kc) }}
      handle="left"
      selectable
      selected={selected}
      onSelectedChange={setSelected}
      bulkActions={() => (
        <>
          <BulkAction>Move to Screen</BulkAction>
          <BulkAction>Reject</BulkAction>
        </>
      )}
    />
  );
}

export const CardAndBulkActions: Story = {
  name: 'Card and bulk actions',
  render: () => <Bulk />,
};

function Sections(): React.JSX.Element {
  const [columns, setColumns] = useState<KanbanColumnDef[]>([
    { id: 'applied', title: 'Applied', count: 2 },
    { id: 'screen', title: 'Screen', count: 1 },
  ]);
  const [items, setItems] = useState<Record<string, readonly Candidate[]>>({
    applied: [kc(0)],
    screen: [kc(1)],
  });
  const [name, setName] = useState('Take-home task');
  const [deleting, setDeleting] = useState<KanbanColumnDef | null>(null);
  const remove = (id: string, into?: string): void => {
    const moved = items[id] ?? [];
    setItems({
      ...items,
      [id]: [],
      ...(into ? { [into]: [...(items[into] ?? []), ...moved] } : {}),
    });
    setColumns(columns.filter((c) => c.id !== id));
    setDeleting(null);
  };
  return (
    <>
      <Kanban
        label="Hiring"
        columns={columns}
        items={items}
        cardTitle={(c) => c.name}
        renderCard={body}
        onMove={(m) => {
          setItems(applyMove(items, m));
        }}
        columnActions={[
          {
            id: 'delete',
            label: 'Delete section',
            icon: Trash2,
            destructive: true,
            run: ([column]) => {
              if (!column) return;
              if ((items[column.id] ?? []).length > 0) setDeleting(column);
              else remove(column.id);
            },
          },
        ]}
        after={
          <View className="w-[300px] gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-border-strong p-3">
            <Input size="sm" value={name} onChange={setName} accessibilityLabel="New section name" />
            <View className="flex-row gap-1.5">
              <Button
                variant="primary"
                size="sm"
                onPress={() => {
                  const id = name.toLowerCase().replace(/\W+/g, '-');
                  setColumns([...columns, { id, title: name }]);
                  setName('');
                }}
              >
                Add section
              </Button>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </View>
          </View>
        }
      />
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Move ${deleting?.title ?? ''}'s cards first`}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Text variant="subhead" tone="muted">
              Deleting a section that has cards moves them to another one.
            </Text>
          </DialogBody>
          <DialogFooter>
            {columns
              .filter((c) => c.id !== deleting?.id)
              .map((c) => (
                <Button
                  key={c.id}
                  onPress={() => {
                    if (deleting) remove(deleting.id, c.id);
                  }}
                >
                  {`Move to ${c.title}`}
                </Button>
              ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const AddingAndDeletingSections: Story = {
  name: 'Adding and deleting sections',
  parameters: designNote('kanban', 'Adding and deleting sections'),
  render: () => <Sections />,
};

function More({ n }: { n: number }): React.JSX.Element {
  return (
    <CssText className="p-2 text-center text-[13px] leading-none font-semibold text-fg-muted">
      {`+ ${String(n)} more`}
    </CssText>
  );
}

export const AVeryLongColumn: Story = {
  name: 'A very long column',
  render: () => (
    <Board
      columns={[
        { id: 'applied', title: 'Applied', count: 48 },
        { id: 'screen', title: 'Screen', count: 2 },
      ]}
      start={{ applied: [0, 1, 2, 3, 4].map(kc), screen: [5, 6].map(kc) }}
      handle="left"
      columnHeight={520}
      renderColumnFooter={(c) => (c.id === 'applied' ? <More n={43} /> : null)}
    />
  ),
};

export const EveryColumnLong: Story = {
  name: 'Every column long',
  parameters: designNote('kanban', 'Every column long'),
  render: () => (
    <Board
      columns={STAGES.slice(0, 4).map((s, i) => ({ ...s, count: [48, 36, 22, 12][i] ?? 0 }))}
      start={Object.fromEntries(
        STAGES.slice(0, 4).map((s, si) => [s.id, [0, 1, 2, 3].map((k) => kc(si + k + si * 4))]),
      )}
      handle="left"
      columnHeight={460}
    />
  ),
};

export const JustBelowTheThreshold: Story = {
  name: 'Just below the threshold',
  render: () => (
    <View className="gap-2.5">
      <Board
        columns={[{ id: 'screen', title: 'Screen', count: 2 }]}
        start={{ screen: [0, 1].map(kc) }}
        handle="left"
      />
      <Note>
        Nothing moves until the pointer travels 6px (or you long-press for 250ms on touch), so clicks and scrolls are never mistaken for drags.
      </Note>
    </View>
  ),
};

