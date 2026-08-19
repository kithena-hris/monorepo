import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Input } from '../input/input';
import { Slider } from './slider';

const currency = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const meta = {
  title: 'Forms/Slider',
  component: Slider,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A range input, including two-thumb ranges.',
          '',
          '### When it is the wrong control',
          '',
          'A slider is for values where approximate is fine and the range is small, a salary band filter, a notice period in days. It is the wrong control when the value must be exact: nobody sets a salary to €47,318 by dragging, and a slider that needs a 1-unit step over a 200,000 range is a control with 200,000 keyboard presses in it. Pair one with a number input when both matter: see the last story.',
          '',
          '### Touch',
          '',
          'The thumb is 20px visually and carries a 44px hit area on a coarse pointer, added as a pseudo-element so the visual weight does not change. Switch the toolbar viewport to an iPhone and the target grows without the design moving. A 20px target under a thumb is a control that does not exist on a phone.',
          '',
          '### Keyboard',
          '',
          'Arrow keys move by `step`, Page Up/Down by ten steps, Home and End jump to the ends. In a two-thumb range the thumbs cannot cross unless `minStepsBetweenThumbs` allows it.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    label: {
      description:
        'Required. Names the control, and names each thumb unless `thumbLabels` overrides it.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    thumbLabels: {
      description:
        'Per-thumb names for a range. `["Minimum", "Maximum"]`. Without them a screen reader announces "Salary 1" and "Salary 2".',
      control: 'object',
      table: { type: { summary: 'readonly string[]' }, category: 'Accessibility' },
    },
    valueDisplay: {
      description:
        'Rendered above the track, right-aligned. Use it to print the live, formatted value, the number is the fact, the track is only the gesture.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    defaultValue: {
      description: 'Uncontrolled starting value. An array: one entry per thumb.',
      control: 'object',
      table: { type: { summary: 'number[]' }, category: 'State' },
    },
    value: {
      description: 'Controlled value. Pair with `onValueChange`.',
      control: false,
      table: { type: { summary: 'number[]' }, category: 'State' },
    },
    onValueChange: {
      description: 'Fires on every movement, including during a drag.',
      control: false,
      table: { type: { summary: '(value: number[]) => void' }, category: 'State' },
    },
    onValueCommit: {
      description:
        'Fires once, when the drag ends. This is the one to hit a server with. `onValueChange` fires for every pixel.',
      control: false,
      table: { type: { summary: '(value: number[]) => void' }, category: 'State' },
    },
    min: {
      description: 'Lower bound.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, defaultValue: { summary: '0' }, category: 'Range' },
    },
    max: {
      description: 'Upper bound.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, defaultValue: { summary: '100' }, category: 'Range' },
    },
    step: {
      description:
        'Granularity, and the distance one arrow key moves. Choose it so the full range is crossable in a reasonable number of presses.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, defaultValue: { summary: '1' }, category: 'Range' },
    },
    minStepsBetweenThumbs: {
      description: 'Stops the thumbs of a range from crossing or coinciding.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, defaultValue: { summary: '0' }, category: 'Range' },
    },
    showTicks: {
      description:
        'Draws a dot per step. Only rendered when there are 21 steps or fewer: beyond that it is a grey line.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    orientation: {
      description: 'Horizontal or vertical track.',
      control: 'inline-radio',
      options: ['horizontal', 'vertical'],
      table: {
        type: { summary: "'horizontal' | 'vertical'" },
        defaultValue: { summary: 'horizontal' },
        category: 'Appearance',
      },
    },
    inverted: {
      description: 'Fills from the far end. For a value where "less is more".',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    disabled: {
      description: 'Blocks interaction and drops the opacity.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Notice period',
    defaultValue: [30],
    min: 0,
    max: 90,
    step: 15,
    showTicks: true,
    disabled: false,
  },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState<number[]>(args.defaultValue ?? [30]);
    return (
      <div className="max-w-md">
        <Slider
          {...args}
          value={value}
          onValueChange={setValue}
          valueDisplay={`${String(value[0])} days`}
        />
      </div>
    );
  },
};

export const Range: Story = {
  name: 'Two-thumb range',
  parameters: {
    docs: {
      description: {
        story:
          'A salary band filter. `thumbLabels` names each end, and `minStepsBetweenThumbs` stops them collapsing into a range of zero width, which is a filter that matches nothing.',
      },
    },
  },
  render: function RangeStory() {
    const [value, setValue] = useState([45000, 95000]);
    return (
      <div className="max-w-md">
        <Slider
          label="Base salary"
          thumbLabels={['Minimum salary', 'Maximum salary']}
          min={20000}
          max={200000}
          step={2500}
          minStepsBetweenThumbs={1}
          value={value}
          onValueChange={setValue}
          valueDisplay={`${currency.format(value[0] ?? 0)} – ${currency.format(value[1] ?? 0)}`}
        />
      </div>
    );
  },
};

export const WithTicks: Story = {
  name: 'Discrete steps',
  args: {
    label: 'Working days per week',
    min: 1,
    max: 5,
    step: 1,
    defaultValue: [4],
    showTicks: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Ticks are only honest when the steps are few and meaningful. Five working days is a real set of choices; a tick per €2,500 across a salary band is visual noise.',
      },
    },
  },
  render: function TicksStory(args) {
    const [value, setValue] = useState<number[]>([4]);
    return (
      <div className="max-w-sm">
        <Slider
          {...args}
          value={value}
          onValueChange={setValue}
          valueDisplay={`${String(value[0])} ${value[0] === 1 ? 'day' : 'days'}`}
        />
      </div>
    );
  },
};

export const PairedWithAnInput: Story = {
  name: 'Paired with a number input',
  parameters: {
    docs: {
      description: {
        story:
          'The pattern for a value that needs both: drag to explore, type to be exact. They are the same state, so neither can drift from the other. This is what to reach for whenever someone asks for a slider on a currency amount.',
      },
    },
  },
  render: function PairedStory() {
    const [value, setValue] = useState(72000);
    return (
      <div className="max-w-md space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Slider
              label="Target base salary"
              min={20000}
              max={200000}
              step={500}
              value={[value]}
              onValueChange={([next]) => {
                setValue(next ?? value);
              }}
              valueDisplay={currency.format(value)}
            />
          </div>
          <Input
            type="number"
            aria-label="Target base salary, exact"
            className="w-32"
            value={value}
            min={20000}
            max={200000}
            step={500}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isNaN(next)) setValue(next);
            }}
          />
        </div>
        <p className="text-xs text-fg-muted">
          The slider commits on release; the input commits on change. Both write the same state.
        </p>
      </div>
    );
  },
};

export const Vertical: Story = {
  args: {
    orientation: 'vertical',
    label: 'Weighting',
    defaultValue: [60],
    min: 0,
    max: 100,
    step: 5,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Vertical, for a control that sits beside something it modulates. The arrow keys follow the orientation, so Up increases here rather than Right.',
      },
    },
  },
  render: (args) => (
    <div className="h-56">
      <Slider {...args} />
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: [45] },
  parameters: {
    docs: {
      description: {
        story:
          'Disabled, for a value fixed by policy rather than by preference. Say why nearby, a control that cannot be moved and does not explain itself generates a support ticket.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-md space-y-1.5">
      <Slider {...args} valueDisplay="45 days" />
      <p className="text-xs text-fg-muted">
        Fixed by the Spanish statutory minimum for this contract type.
      </p>
    </div>
  ),
};
