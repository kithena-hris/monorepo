import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, ChevronDown, Filter } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/button';
import { Badge } from '../badge/badge';
import { Field, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { ColumnChooser as ColumnChooserControl, type ColumnChoice } from '../table/column-chooser';
import { ToggleGroup, ToggleGroupItem } from '../toggle/toggle';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './popover';

const meta = {
  title: 'Components/Popover',
  component: PopoverContent,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A non-modal surface anchored to a trigger.',
          '',
          '### Tooltip, popover or dialog',
          '',
          '| Use | When | Cost |',
          '| --- | --- | --- |',
          '| `Tooltip` | A label. No interactive content, ever. It is not focusable and never appears on touch. | Free |',
          '| `Popover` | Small interactive UI: a filter editor, a date picker, a column chooser. Dismissed by clicking away; the page stays usable. | One escape key |',
          "| `Dialog` | Something that must be resolved before continuing. Traps focus, blocks the page. | The user's whole attention |",
          '',
          'A popover containing a form with a Save button that changes a record is a dialog wearing the wrong clothes.',
          '',
          '### What the primitive is doing for you',
          '',
          'Three things this layer relies on and does not reimplement: focus moves into the panel on open and back to the trigger on close; Escape and an outside click both dismiss; and the panel flips side or shifts along the edge when it would leave the viewport.',
          '',
          'Two custom properties do the responsive work. `--radix-popover-content-available-height` caps the panel at the space actually measured for it, so a popover opened near the bottom of a phone scrolls internally instead of running under the browser chrome, where it cannot be reached, because it is in a portal.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    side: {
      description: 'Preferred side. The primitive flips it when there is not room.',
      control: 'inline-radio',
      options: ['top', 'right', 'bottom', 'left'],
      table: {
        type: { summary: "'top' | 'right' | 'bottom' | 'left'" },
        defaultValue: { summary: 'bottom' },
        category: 'Position',
      },
    },
    align: {
      description:
        'Alignment along that side. `start` is right for a control anchored to a form field.',
      control: 'inline-radio',
      options: ['start', 'center', 'end'],
      table: {
        type: { summary: "'start' | 'center' | 'end'" },
        defaultValue: { summary: 'start' },
        category: 'Position',
      },
    },
    sideOffset: {
      description: 'Gap between the trigger and the panel, in pixels.',
      control: { type: 'range', min: 0, max: 24, step: 1 },
      table: { type: { summary: 'number' }, defaultValue: { summary: '6' }, category: 'Position' },
    },
    collisionPadding: {
      description:
        'Minimum distance kept from the viewport edge. Raising it is the fix for a panel that hugs the notch on a landscape iPhone.',
      control: { type: 'range', min: 0, max: 48, step: 4 },
      table: { type: { summary: 'number' }, defaultValue: { summary: '12' }, category: 'Position' },
    },
    arrow: {
      description: 'Draws the tail. Worth it when several triggers sit close together.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    matchTriggerWidth: {
      description:
        'Locks the panel to the trigger width. Right for a combobox list; wrong for a filter editor, which needs the room.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { side: 'bottom', align: 'start', sideOffset: 6, collisionPadding: 12, arrow: false },
} satisfies Meta<typeof PopoverContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button endIcon={<ChevronDown />}>Details</Button>
      </PopoverTrigger>
      <PopoverContent {...args} className="w-65 space-y-1">
        <p className="text-base font-semibold text-fg">Working hours</p>
        <p className="text-sm text-fg-muted">Mon–Fri, 9:00–17:30 CET</p>
        <p className="text-sm text-fg-muted">Core hours 10:00–16:00</p>
      </PopoverContent>
    </Popover>
  ),
};

const allColumns: ColumnChoice[] = [
  // The row's identity: a table with no name column is a grid of anonymous numbers.
  { id: 'name', label: 'Name', locked: true },
  { id: 'team', label: 'Team' },
  { id: 'location', label: 'Location' },
  { id: 'status', label: 'Status' },
  { id: 'start', label: 'Start date' },
  { id: 'salary', label: 'Salary' },
];
const defaultColumns = allColumns.slice(0, 5).map((column) => column.id);

export const ColumnChooser: Story = {
  name: 'A working column chooser',
  parameters: {
    docs: {
      description: {
        story:
          'The canonical popover, and the reason `ColumnChooser` exists: several small controls that commit immediately, with no Save button. Note the count in the trigger, a popover hides its state, so something outside it has to say what the state is.',
      },
    },
  },
  render: function ColumnsStory() {
    const [columns, setColumns] = useState<readonly ColumnChoice[]>(allColumns);
    const [visible, setVisible] = useState<readonly string[]>(defaultColumns);

    return (
      <div className="space-y-3 text-center">
        <ColumnChooserControl
          columns={columns}
          visible={visible}
          onVisibleChange={setVisible}
          onReorder={(order) => {
            const byId = new Map(columns.map((column) => [column.id, column]));
            setColumns(order.flatMap((id) => byId.get(id) ?? []));
          }}
          onReset={() => {
            setColumns(allColumns);
            setVisible(defaultColumns);
          }}
        />
        <p aria-live="polite" className="text-sm text-fg-muted">
          Showing{' '}
          {columns
            .filter((column) => visible.includes(column.id))
            .map((column) => column.label)
            .join(', ')}
        </p>
      </div>
    );
  },
};

export const Sides: Story = {
  name: 'Every side',
  parameters: {
    docs: {
      description: {
        story:
          'The `side` is a preference, not an instruction. Scroll this story until a trigger nears an edge and the panel flips, which is why a design that depends on the panel being below is a design that breaks on a laptop.\n\nOn a phone there is no side: every popover opens as a sheet from the bottom, where the thumb is, and a swipe down closes it. `sheetOnTouch={false}` on `Popover` keeps a panel anchored when its position is the point, as a combobox list or a tour step does.',
      },
    },
  },
  render: (args) => (
    <div className="grid grid-cols-2 gap-4">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Popover key={side}>
          <PopoverTrigger asChild>
            <Button>{side}</Button>
          </PopoverTrigger>
          <PopoverContent {...args} side={side} align="center" arrow className="w-48">
            <p className="text-sm text-fg">Anchored to the {side}.</p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
};

export const WithARange: Story = {
  name: 'Holding a real control',
  parameters: {
    docs: {
      description: {
        story:
          'A small form inside a popover, which is the case that proves the panel is not a tooltip: it takes focus, holds real controls, and applies only when asked. The count on the trigger says what is set while the panel is closed.',
      },
    },
  },
  render: function FilterStory(args) {
    const [status, setStatus] = useState('active');

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button startIcon={<Filter />}>
            Filter
            <Badge size="sm" tone="accent">
              2
            </Badge>
          </Button>
        </PopoverTrigger>
        <PopoverContent {...args} className="w-75 space-y-2.5">
          <Field>
            <FieldLabel>Start date</FieldLabel>
            <Input defaultValue="After 1 Jan 2024" endAdornment={<CalendarDays />} />
          </Field>
          <div className="space-y-1.5">
            <p id="filter-status" className="text-sm font-semibold text-fg">
              Status
            </p>
            <ToggleGroup
              type="single"
              aria-labelledby="filter-status"
              value={status}
              onValueChange={(next) => {
                if (next) setStatus(next);
              }}
              className="flex w-full [&>*]:flex-1"
            >
              <ToggleGroupItem value="any" size="sm">
                Any
              </ToggleGroupItem>
              <ToggleGroupItem value="active" size="sm">
                Active
              </ToggleGroupItem>
              <ToggleGroupItem value="leave" size="sm">
                Leave
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost">
              Clear
            </Button>
            <PopoverClose asChild>
              <Button size="sm" variant="primary">
                Apply
              </Button>
            </PopoverClose>
          </div>
        </PopoverContent>
      </Popover>
    );
  },
};
