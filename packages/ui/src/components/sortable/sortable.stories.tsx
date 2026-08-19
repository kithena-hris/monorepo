import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { SortableList, type SortableItem } from './sortable';

interface Approver extends SortableItem {
  name: string;
  role: string;
  required?: boolean;
}

const approvers: Approver[] = [
  { id: 'a1', name: 'Line manager', role: 'Automatic', locked: true, required: true },
  { id: 'a2', name: 'Katherine Johnson', role: 'Chief People Officer' },
  { id: 'a3', name: 'Ada Lovelace', role: 'Chief Financial Officer' },
  { id: 'a4', name: 'Mary Jackson', role: 'Head of People Operations' },
  { id: 'a5', name: 'Annie Easley', role: 'Payroll Manager' },
];

const meta = {
  title: 'Components/SortableList',
  component: SortableList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A list whose order **is** the data: approval chains, interview stages, pay elements, checklist items.',
          '',
          '### The drag is the accelerator, not the mechanism',
          '',
          'Every row carries **Move up** and **Move down** buttons as well as a handle. A drag is unreachable by a keyboard, a switch, an unsteady hand and a screen reader, so a list that can only be reordered by dragging is a list some people cannot reorder at all. dnd-kit’s keyboard sensor is wired up too. Space on the handle, then the arrows, but the buttons are the path that needs no instructions.',
          '',
          '### A handle, not the whole row',
          '',
          'Rows like these usually contain their own buttons and links, and a whole-row activator eats every one of them. The handle is a named control (*"Reorder item 3"*, not "grip icon") with its own focus ring. `activator: "row"` exists for rows that are genuinely inert.',
          '',
          '### Constrained to one axis, and to its own box',
          '',
          '`restrictToVerticalAxis` and `restrictToParentElement`. Without them a row can be dragged into the middle of the page, which says the drop will land there, and it will not. A drag that lies about where it will end is worse than one that cannot leave the list.',
          '',
          '### It never owns the order',
          '',
          '`onReorder` hands back `{ id, from, to, order }` and the caller’s array stays the truth. In a system with an audit trail a reorder is an event, not a mutation.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    items: { control: false, table: { category: 'Data' } },
    activator: {
      control: 'inline-radio',
      options: ['handle', 'row'],
      table: { defaultValue: { summary: "'handle'" }, category: 'Interaction' },
    },
    hideMoveButtons: { control: 'boolean', table: { category: 'Interaction' } },
    onReorder: { control: false, table: { category: 'Interaction' } },
    children: { control: false, table: { category: 'Data' } },
  },
  args: {
    label: 'Approval chain',
    onReorder: fn().mockName('onReorder({ id, from, to, order })'),
    items: approvers,
    children: () => null,
  },
} satisfies Meta<typeof SortableList<Approver>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [items, setItems] = useState<Approver[]>(approvers);

    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Approval chain</CardTitle>
          <Badge size="sm">{items.length} steps</Badge>
        </CardHeader>
        <CardContent>
          <SortableList
            {...args}
            items={items}
            onReorder={(move) => {
              args.onReorder(move);
              setItems((current) => {
                const byId = new Map(current.map((item) => [item.id, item]));
                return move.order.flatMap((id) => byId.get(id) ?? []);
              });
            }}
          >
            {(item, info) => (
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-2xs tabular-nums text-fg-subtle">
                  {info.index + 1}
                </span>
                <Avatar size="sm" name={item.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{item.name}</p>
                  <p className="truncate text-2xs text-fg-subtle">{item.role}</p>
                </div>
                {item.locked === true ? (
                  <Badge size="sm" tone="neutral">
                    Fixed
                  </Badge>
                ) : null}
              </div>
            )}
          </SortableList>
        </CardContent>
      </Card>
    );
  },
};

export const Locked: Story = {
  name: 'A row that cannot move',
  parameters: {
    docs: {
      description: {
        story:
          'The line manager is always first, so that row is `locked`: no handle, no buttons, and nothing can be dropped past it. Its background changes as well, because a control that silently refuses is a control people press repeatedly.',
      },
    },
  },
  render: function LockedStory(args) {
    const [items, setItems] = useState<Approver[]>(approvers);

    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Approval chain</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableList
            {...args}
            items={items}
            onReorder={(move) => {
              args.onReorder(move);
              setItems((current) => {
                const byId = new Map(current.map((item) => [item.id, item]));
                return move.order.flatMap((id) => byId.get(id) ?? []);
              });
            }}
          >
            {(item) => (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-fg">{item.name}</span>
                <span className="truncate text-2xs text-fg-subtle">{item.role}</span>
              </div>
            )}
          </SortableList>
        </CardContent>
      </Card>
    );
  },
};

export const WholeRow: Story = {
  name: 'Dragging the whole row',
  args: { activator: 'row', hideMoveButtons: false },
  parameters: {
    docs: {
      description: {
        story:
          'For rows with nothing else to click. The whole row becomes the activator, which is a bigger target and a worse neighbour, any button inside it would stop working, so only use it when there are none.',
      },
    },
  },
  render: function WholeRowStory(args) {
    const [items, setItems] = useState<Approver[]>(approvers.filter((item) => !item.locked));

    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Interview stages</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableList
            {...args}
            items={items}
            onReorder={(move) => {
              args.onReorder(move);
              setItems((current) => {
                const byId = new Map(current.map((item) => [item.id, item]));
                return move.order.flatMap((id) => byId.get(id) ?? []);
              });
            }}
          >
            {(item) => <span className="truncate text-sm text-fg">{item.name}</span>}
          </SortableList>
        </CardContent>
      </Card>
    );
  },
};
