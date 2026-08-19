import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ArrowRightLeft,
  Clock,
  Columns3,
  FileDown,
  MoreHorizontal,
  Trash2,
  UserPen,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';

const meta = {
  title: 'Components/Dropdown menu',
  component: DropdownMenu,
  subcomponents: {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioItem,
    DropdownMenuSub,
  },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          '**A menu holds commands.** If the items set a value. That is a `Select`, and the difference is not cosmetic: the two have different keyboard contracts and announce differently to a screen reader.',
          '',
          '### Item kinds',
          '',
          '| Item | For |',
          '| --- | --- |',
          '| `DropdownMenuItem` | A command. Add `destructive` for anything that loses data. |',
          '| `DropdownMenuCheckboxItem` | An independent toggle: column visibility, filters. |',
          '| `DropdownMenuRadioItem` | One of a set: sort order, density. |',
          '| `DropdownMenuSub` | A nested list. One level only; two is a navigation problem in disguise. |',
          '',
          '### Notes',
          '',
          '- `destructive` colours the item but does not confirm anything. Anything irreversible still opens a `Dialog`.',
          '- `DropdownMenuShortcut` is a label, not a binding. Register the actual key handler yourself, or it lies.',
          '- The trigger must be a real button. `asChild` onto a `<div>` loses the keyboard contract entirely.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    open: {
      description: 'Controlled open state.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    defaultOpen: {
      description: 'Uncontrolled starting state.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    modal: {
      description: 'Blocks interaction with the page behind while open.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Behaviour',
      },
    },
    dir: {
      description: 'Reading direction: drives which arrow key opens a submenu.',
      control: 'inline-radio',
      options: ['ltr', 'rtl'],
      table: { type: { summary: "'ltr' | 'rtl'" }, category: 'Behaviour' },
    },
    onOpenChange: { action: 'open changed', table: { category: 'Events' } },
  },
  args: { modal: true },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RowActions: Story = {
  name: 'Row actions',
  parameters: {
    docs: {
      description: {
        story:
          'The canonical table-row menu: commands, one submenu, and the destructive action fenced off below a separator so it is not adjacent to anything pressed by reflex.',
      },
    },
  },
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" startIcon={<MoreHorizontal />} aria-label="Row actions">
          {null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Grace Hopper</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <UserPen />
            Edit profile
            <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Clock />
            View change history
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowRightLeft />
              Move to team
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Platform</DropdownMenuItem>
              <DropdownMenuItem>Payroll</DropdownMenuItem>
              <DropdownMenuItem>People Operations</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem>
            <FileDown />
            Export record
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>
          <Trash2 />
          Offboard
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const CheckboxItems: Story = {
  name: 'Checkbox items',
  parameters: {
    docs: {
      description: {
        story:
          'Independent toggles. The menu stays open on selection, because changing three column toggles should not cost three round trips through the trigger.',
      },
    },
  },
  render: function CheckboxItemsStory(args) {
    const [columns, setColumns] = useState({ team: true, hired: true, salary: false });

    return (
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" startIcon={<Columns3 />}>
            Columns
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48">
          <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(['team', 'hired', 'salary'] as const).map((key) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={columns[key]}
              onCheckedChange={(next) => {
                setColumns((c) => ({ ...c, [key]: next }));
              }}
              onSelect={(event) => {
                event.preventDefault();
              }}
              className="capitalize"
            >
              {key}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
};

export const RadioItems: Story = {
  name: 'Radio items',
  parameters: {
    docs: {
      description: {
        story: 'One of a set. Closes on selection, because the choice is complete once it is made.',
      },
    },
  },
  render: function RadioItemsStory(args) {
    const [sort, setSort] = useState('name');
    return (
      <div className="space-y-3 text-center">
        <DropdownMenu {...args}>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Sort</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hired">Hire date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="salary">Base salary</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="font-mono text-xs text-fg-muted">sort: {sort}</p>
      </div>
    );
  },
};
