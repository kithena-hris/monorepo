import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Note } from '../../docs/notes.tsx';
import { PEOPLE } from '../../docs/people.ts';
import { move } from '../../lib/reorder.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { SortableList, SortableRowText, type SortableListProps } from './sortable-list.tsx';

type Row = { id: string; title: string; description?: string; locked?: boolean };

const meta: Meta<SortableListProps<Row>> = {
  title: 'Components/SortableList',
  component: SortableList,
  parameters: designDocs('sortable-list'),
};

export default meta;
type Story = StoryObj<SortableListProps<Row>>;

/** A list owning its order, as a screen would. */
function Live({
  start,
  activator,
  label,
}: {
  start: Row[];
  activator?: 'handle' | 'row';
  label: string;
}): React.JSX.Element {
  const [rows, setRows] = useState(start);
  return (
    <SortableList
      label={label}
      items={rows}
      {...(activator ? { activator } : {})}
      itemLabel={(r) => r.title}
      onReorder={({ from, to }) => {
        setRows(move(rows, from, to));
      }}
    >
      {(r) => <SortableRowText title={r.title} {...(r.description ? { description: r.description } : {})} />}
    </SortableList>
  );
}

export const Playground: Story = {
  render: () => (
    <Live
      label="Notification order"
      start={[
        { id: 'payroll', title: 'Payroll', description: 'Monthly' },
        { id: 'time-off', title: 'Time off', description: 'Always' },
        { id: 'insights', title: 'Insights', description: 'Weekly' },
        { id: 'documents', title: 'Documents', description: 'Rarely' },
      ]}
    />
  ),
};

export const ARowThatCannotMove: Story = {
  name: 'A row that cannot move',
  render: () => (
    <Live
      label="Navigation order"
      start={[
        { id: 'home', title: 'Home', description: 'Always first', locked: true },
        { id: 'people', title: 'People' },
        { id: 'time-off', title: 'Time off' },
        { id: 'payroll', title: 'Payroll' },
      ]}
    />
  ),
};

export const DraggingTheWholeRow: Story = {
  name: 'Dragging the whole row',
  render: () => (
    <Live
      label="Navigation order"
      activator="row"
      start={[
        { id: 'payroll', title: 'Payroll' },
        { id: 'time-off', title: 'Time off' },
        { id: 'insights', title: 'Insights' },
      ]}
    />
  ),
};

type Approver = { id: string; name: string };

export const RowsThatSayWhatTheyAre: Story = {
  name: 'Rows that say what they are',
  render: function ApproversStory() {
    const [rows, setRows] = useState<Approver[]>(
      PEOPLE.slice(0, 4).map((p) => ({ id: p.name, name: p.name })),
    );
    const [said, setSaid] = useState('Jonas Weber, approver 2 of 4. Moved to position 1.');
    return (
      <View className="gap-2">
        <SortableList
          label="Approval chain"
          items={rows}
          itemLabel={(r, i) => `${r.name}, approver ${String(i + 1)}`}
          onReorder={({ from, to }) => {
            const moved = rows[from];
            setRows(move(rows, from, to));
            if (moved) {
              setSaid(
                `${moved.name}, approver ${String(from + 1)} of ${String(rows.length)}. Moved to position ${String(to + 1)}.`,
              );
            }
          }}
        >
          {(r, { index }) => (
            <>
              <Avatar name={r.name} size={32} decorative />
              <SortableRowText title={r.name} description={`Approver ${String(index + 1)}`} />
              <CssText className="text-[12px] leading-none font-semibold text-fg-subtle">
                {index + 1}
              </CssText>
            </>
          )}
        </SortableList>
        <Note>{`Screen reader: "${said}"`}</Note>
      </View>
    );
  },
};
