import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { List as ListIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { KeyHints, Note } from '../../docs/notes.tsx';
import { PEOPLE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { EmptyState } from '../feedback/feedback.tsx';
import { ListItem } from '../list-item/list-item.tsx';
import { Text } from '../text/text.tsx';
import { VirtualList, type VirtualListProps, type VirtualWindow } from './virtual-list.tsx';

type Row = { id: number; name: string; team: string };

/** Twenty thousand rows, the sample people over and over, each numbered. */
const ROWS: Row[] = Array.from({ length: 20_000 }, (_, id) => {
  const person = PEOPLE[id % PEOPLE.length] ?? PEOPLE[0];
  return { id, name: person.name, team: person.team };
});

const number = new Intl.NumberFormat('en-GB');

/*
 * Typed to a row rather than inferred: `VirtualList` is generic, and
 * `satisfies Meta<typeof VirtualList>` would resolve its row to `unknown`.
 * The data never becomes an arg (twenty thousand nodes in the controls panel).
 */
const meta: Meta<VirtualListProps<Row>> = {
  title: 'Components/VirtualList',
  component: VirtualList,
  parameters: {
    ...designDocs('virtual-list'),
    controls: { exclude: ['items', 'renderItem', 'itemKey'] },
  },
};

export default meta;
type Story = StoryObj<VirtualListProps<Row>>;

function PersonRow({ row }: { row: Row }): React.JSX.Element {
  return (
    <ListItem
      listitem={false}
      className="min-h-[52px]"
      leading={
        <View className="flex-row items-center gap-3">
          <Text mono className="w-12 text-[11px] leading-none text-fg-subtle">
            #{number.format(row.id + 1)}
          </Text>
          <Avatar name={row.name} size={28} decorative />
        </View>
      }
      description={row.team}
    >
      {row.name}
    </ListItem>
  );
}

export const TwentyThousand: Story = {
  name: 'Twenty Thousand',
  render: function TwentyThousandStory() {
    const [view, setView] = useState<VirtualWindow>({ rendered: 0, first: 12_480, progress: 0.62 });
    return (
      <View className="gap-2">
        <VirtualList
          items={ROWS}
          label="Everyone"
          height={340}
          initialIndex={12_480}
          itemKey={(row) => String(row.id)}
          renderItem={(row) => <PersonRow row={row} />}
          onWindowChange={setView}
        />
        <Note>
          {`Rendering ${String(view.rendered)} of ${number.format(ROWS.length)} · scrolled to ${String(Math.round(view.progress * 100))}%`}
        </Note>
      </View>
    );
  },
};

const POSTS = [
  [
    'Nora Becker',
    'Announced the new parental leave policy. Everyone gets up to 14 weeks of paid leave in the first year, starting 1 January.',
  ],
  ['Jonas Weber', 'Approved.'],
  [
    'Mei Tanaka',
    'Q3 expenses are in. We came in 4% under budget, mostly thanks to fewer flights and the new travel policy.',
  ],
  ['Lucas Moreau', 'Thanks!'],
] as const;

type Post = { id: number; name: string; text: string };
const FEED: Post[] = Array.from({ length: 5000 }, (_, id) => {
  const [name, text] = POSTS[id % POSTS.length] ?? POSTS[0];
  return { id, name, text };
});

export const VariableHeights: Story = {
  name: 'Variable Heights',
  render: () => (
    <VirtualList
      items={FEED}
      label="Activity"
      height={306}
      itemKey={(post) => String(post.id)}
      renderItem={(post) => (
        <View className="flex-row gap-3 px-4 py-3.5">
          <Avatar name={post.name} size={32} decorative />
          <View className="min-w-0 flex-1">
            <Text className="text-[14px] leading-[1.3] font-semibold">{post.name}</Text>
            <Text variant="subhead" tone="muted" className="leading-[1.5]">
              {post.text}
            </Text>
          </View>
        </View>
      )}
    />
  ),
};

export const Keyboard: Story = {
  render: function KeyboardStory() {
    const [opened, setOpened] = useState<string | null>(null);
    return (
      <View className="gap-2.5">
        <VirtualList
          items={ROWS.slice(0, 2000)}
          label="People"
          height={226}
          navigable
          defaultActive={2}
          onOpen={(row) => {
            setOpened(row.name);
          }}
          itemKey={(row) => String(row.id)}
          renderItem={(row) => (
            <ListItem
              listitem={false}
              className="min-h-12 bg-transparent"
              leading={<Avatar name={row.name} size={28} decorative />}
              description={row.team}
            >
              {row.name}
            </ListItem>
          )}
        />
        <KeyHints
          hints={[
            [['up', 'down'], 'move'],
            [['Home', 'End'], 'jump'],
            [['PgDn'], 'page'],
            [['enter'], opened ? `opened ${opened}` : 'open'],
          ]}
        />
      </View>
    );
  },
};

export const Empty: Story = {
  render: () => (
    <VirtualList<Row>
      items={[]}
      label="Activity"
      itemKey={(row) => String(row.id)}
      renderItem={() => null}
      empty={
        <EmptyState
          icon={ListIcon}
          title="No activity yet"
          description="Changes to people and teams will be listed here."
          className="py-3"
        />
      }
    />
  ),
};
