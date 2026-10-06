import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Text } from '../text/text.tsx';
import { Pagination } from './pagination.tsx';

const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  parameters: designDocs('pagination'),
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

export const Playground: Story = {
  args: { page: 3, pageCount: 5, onPageChange: noop },
  render: function PlaygroundStory() {
    const [page, setPage] = useState(3);
    return <Pagination page={page} pageCount={5} onPageChange={setPage} />;
  },
};

export const Elision: Story = {
  name: 'How the window elides',
  args: { page: 1, pageCount: 1, onPageChange: noop },
  render: () => (
    <View className="gap-2.5">
      {[2, 25, 51].map((start) => (
        <Pager key={start} start={start} />
      ))}
    </View>
  ),
};

function Pager({ start, count = 52 }: { start: number; count?: number }): React.JSX.Element {
  const [page, setPage] = useState(start);
  return (
    <Pagination
      numbered
      page={page}
      pageCount={count}
      onPageChange={setPage}
      label={`Pagination from page ${String(start)}`}
    />
  );
}

export const FewPages: Story = {
  name: 'Few enough not to elide',
  args: { page: 1, pageCount: 1, onPageChange: noop },
  render: () => <Pager start={4} count={7} />,
};

export const UnderATable: Story = {
  name: 'Under a table',
  args: { page: 1, pageCount: 1, onPageChange: noop },
  render: function TableStory() {
    const [page, setPage] = useState(3);
    return (
      <View className="overflow-hidden rounded-[22px] bg-surface shadow-sm">
        {PEOPLE.slice(0, 3).map((person) => (
          <View
            key={person.name}
            className="flex-row items-center gap-3 border-b border-border px-4 py-3.5"
          >
            <Avatar name={person.name} size={40} decorative />
            <View className="min-w-0 flex-1">
              <Text weight="semibold" className="text-[16px]">
                {person.name}
              </Text>
              <Text variant="footnote" tone="muted" className="text-[14px]">
                {person.role}
              </Text>
            </View>
            <Text variant="subhead" tone="muted">
              {person.team}
            </Text>
          </View>
        ))}
        <View className="p-3">
          <Pagination page={page} pageCount={32} onPageChange={setPage} />
        </View>
      </View>
    );
  },
};
