import type { Meta, StoryObj } from '@storybook/react-vite';
import { Info, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Separator } from '../separator/separator';
import { Slider } from '../slider/slider';
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
        <Button startIcon={<Settings2 />}>Display options</Button>
      </PopoverTrigger>
      <PopoverContent {...args} className="w-72">
        <p className="text-base font-medium text-fg">Display</p>
        <p className="mt-1 text-sm text-fg-muted">
          Changes apply immediately and are remembered for this table.
        </p>
      </PopoverContent>
    </Popover>
  ),
};

export const ColumnChooser: Story = {
  name: 'A working column chooser',
  parameters: {
    docs: {
      description: {
        story:
          'The canonical popover: several small controls that commit immediately, with no Save button. Note the count in the trigger, a popover hides its state, so something outside it has to say what the state is.',
      },
    },
  },
  render: function ColumnsStory(args) {
    const allColumns = ['Employee', 'Team', 'Manager', 'Location', 'Start date', 'Base salary'];
    const [visible, setVisible] = useState<string[]>(['Employee', 'Team', 'Base salary']);

    return (
      <div className="space-y-3 text-center">
        <Popover>
          <PopoverTrigger asChild>
            <Button startIcon={<Settings2 />}>Columns ({visible.length})</Button>
          </PopoverTrigger>
          <PopoverContent {...args} className="w-64">
            <p className="mb-2 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
              Visible columns
            </p>
            <div className="space-y-1">
              {allColumns.map((column) => (
                <label
                  key={column}
                  className="flex min-h-tap cursor-pointer items-center gap-2.5 rounded-sm px-1 text-base text-fg hover:bg-surface-hover"
                >
                  <Checkbox
                    checked={visible.includes(column)}
                    // The first column is the row's identity; a table with no
                    // identity column is a grid of anonymous numbers.
                    disabled={column === 'Employee'}
                    onCheckedChange={(checked) => {
                      setVisible((current) =>
                        checked ? [...current, column] : current.filter((c) => c !== column),
                      );
                    }}
                  />
                  {column}
                </label>
              ))}
            </div>
            <Separator className="my-2" />
            <PopoverClose asChild>
              <Button size="sm" variant="ghost" fullWidth>
                Done
              </Button>
            </PopoverClose>
          </PopoverContent>
        </Popover>
        <p aria-live="polite" className="text-sm text-fg-muted">
          Showing {visible.join(', ')}
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
          'The `side` is a preference, not an instruction. Scroll this story until a trigger nears an edge and the panel flips, which is why a design that depends on the panel being below is a design that breaks on a laptop.',
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
          'A slider inside a popover, which is the case that proves the panel is not a tooltip: it is focusable, it survives a drag that leaves its bounds, and the value it edits is applied live behind it.',
      },
    },
  },
  render: function RangeStory(args) {
    const [range, setRange] = useState([45000, 95000]);
    const currency = new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    });

    return (
      <div className="space-y-3 text-center">
        <Popover>
          <PopoverTrigger asChild>
            <Button startIcon={<Info />}>Salary band</Button>
          </PopoverTrigger>
          <PopoverContent {...args} className="w-72">
            <Slider
              label="Base salary"
              thumbLabels={['Minimum salary', 'Maximum salary']}
              min={20000}
              max={200000}
              step={2500}
              minStepsBetweenThumbs={1}
              value={range}
              onValueChange={setRange}
              valueDisplay={`${currency.format(range[0] ?? 0)} – ${currency.format(range[1] ?? 0)}`}
            />
          </PopoverContent>
        </Popover>
        <p aria-live="polite" className="text-sm text-fg-muted">
          Filtering {currency.format(range[0] ?? 0)} to {currency.format(range[1] ?? 0)}
        </p>
      </div>
    );
  },
};
