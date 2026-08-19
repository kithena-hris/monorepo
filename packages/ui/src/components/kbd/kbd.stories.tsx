import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/button';
import { Input } from '../input/input';
import { Tooltip } from '../tooltip/tooltip';
import { Kbd } from './kbd';

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A keyboard key.',
          '',
          '### Why this is a component and not a `<kbd>` with a class',
          '',
          '`keyName="mod"` renders **⌘** on Apple platforms and **Ctrl** everywhere else. Printing "Ctrl+K" to a Mac user is a small lie that makes the shortcut look broken, and hard-coding either one is how it happens. Platform detection runs once on the client and falls back to the non-Apple form on the server, a hydration mismatch is not worth a client-only render, and Ctrl is the safer default to be wrong with.',
          '',
          '### Accessibility',
          '',
          'Most screen readers announce **⌘** as nothing at all. Each named key therefore carries an `aria-label`, such as "Command or Control" or "Arrow up", so a shortcut hint is still a shortcut hint when it is read aloud rather than looked at.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    keyName: {
      description:
        'A named key, rendered with the right glyph for the platform and given a spoken name. Leave it unset and pass `children` for a literal key.',
      control: 'select',
      options: [undefined, 'mod', 'shift', 'alt', 'enter', 'esc', 'tab', 'backspace', 'up', 'down'],
      table: {
        type: {
          summary:
            "'mod' | 'shift' | 'alt' | 'enter' | 'esc' | 'tab' | 'backspace' | 'up' | 'down'",
        },
        category: 'Content',
      },
    },
    children: {
      description: 'A literal key, a letter, a digit, `/`. Ignored when `keyName` is set.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { children: 'K' },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const NamedKeys: Story = {
  name: 'Named keys',
  parameters: {
    docs: {
      description: {
        story:
          'Every named key. On a Mac these read ⌘ ⇧ ⌥ ↵ esc ⇥ ⌫; on Windows and Linux, Ctrl Shift Alt Enter Esc Tab Bksp. Same source, different machine.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {(['mod', 'shift', 'alt', 'enter', 'esc', 'tab', 'backspace', 'up', 'down'] as const).map(
        (keyName) => (
          <Kbd key={keyName} keyName={keyName} />
        ),
      )}
    </div>
  ),
};

export const Combinations: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Combinations are composed rather than parsed from a string, so the modifier and the literal key stay separate elements, which is what lets the modifier swap per platform while the letter does not.',
      },
    },
  },
  render: () => (
    <div className="space-y-2 text-sm text-fg-muted">
      {(
        [
          [['mod'], 'K', 'Open the command palette'],
          [['mod'], '/', 'Show every shortcut'],
          [['mod', 'shift'], 'A', 'Approve the selected request'],
          [['mod'], 'Enter', 'Submit the form'],
        ] as const
      ).map(([modifiers, key, description]) => (
        <div key={description} className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            {modifiers.map((modifier) => (
              <Kbd key={modifier} keyName={modifier} />
            ))}
            <Kbd>{key}</Kbd>
          </span>
          <span>{description}</span>
        </div>
      ))}
    </div>
  ),
};

export const InAnInput: Story = {
  name: 'In a search field',
  parameters: {
    docs: {
      description: {
        story:
          'The canonical use: a hint at the trailing edge of a search input. It is decoration for the pointer user and a genuine affordance for the keyboard one.',
      },
    },
  },
  render: () => (
    <div className="w-80">
      <Input
        aria-label="Search people"
        placeholder="Search people"
        endAdornment={
          <span className="flex items-center gap-0.5">
            <Kbd keyName="mod" />
            <Kbd>K</Kbd>
          </span>
        }
      />
    </div>
  ),
};

export const InATooltip: Story = {
  name: 'In a tooltip',
  parameters: {
    docs: {
      description: {
        story:
          'The other canonical use: teaching the shortcut for a button someone is already reaching for with a mouse. This is how a pointer user becomes a keyboard user.',
      },
    },
  },
  render: () => (
    <Tooltip
      content={
        <span className="flex items-center gap-1.5">
          Approve
          <Kbd keyName="mod" />
          <Kbd keyName="shift" />
          <Kbd>A</Kbd>
        </span>
      }
    >
      <Button variant="primary">Approve</Button>
    </Tooltip>
  ),
};
