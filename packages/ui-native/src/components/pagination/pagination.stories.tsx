import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { DataTable, TableTitle } from '../table/table.tsx';
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
      <DataTable
        label="People"
        rows={PEOPLE.slice(0, 3)}
        rowId={(person) => person.name}
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (person) => (
              <TableTitle title={person.name} description={person.role} avatar={person.name} />
            ),
          },
          { id: 'team', header: 'Team', cell: (person) => person.team },
          { id: 'location', header: 'Location', cell: (person) => person.location },
        ]}
        footer={<Pagination page={page} pageCount={32} onPageChange={setPage} className="flex-1" />}
      />
    );
  },
};
