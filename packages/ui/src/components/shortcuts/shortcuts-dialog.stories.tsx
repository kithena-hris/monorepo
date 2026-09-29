import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { Field, FieldControl, FieldLabel } from '../field/field';
import { Switch } from '../switch/switch';
import { ShortcutsDialog, type ShortcutGroup } from './shortcuts-dialog';

const groups: ShortcutGroup[] = [
  {
    label: 'Go to',
    shortcuts: [
      { label: 'Home', keys: ['g', 'h'] },
      { label: 'Projects', keys: ['g', 'p'] },
      { label: 'Inbox', keys: ['g', 'n'] },
      { label: 'Settings', keys: ['g', 's'] },
    ],
  },
  {
    label: 'On a page',
    shortcuts: [
      { label: 'Search this page', keys: ['/'] },
      { label: 'Previous tab', keys: ['['] },
      { label: 'Next tab', keys: [']'] },
      { label: 'Close what is open', keys: ['escape'] },
    ],
  },
  {
    label: 'Everywhere',
    shortcuts: [
      { label: 'Show keyboard shortcuts', keys: ['?'] },
      { label: 'Search', keys: ['mod+k'] },
      { label: 'Collapse the sidebar', keys: ['mod+\\'] },
    ],
  },
];

const meta = {
  title: 'Components/ShortcutsDialog',
  component: ShortcutsDialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Every keyboard shortcut an app has, by group: what `?` opens.',
          '',
          'It lists and nothing else. The app owns the keys and passes them as chords (`chordOf` writes them: `["g", "d"]`, `["mod+k"]`), drawn with `KbdShortcut` so ⌘ becomes Ctrl off a Mac.',
          '',
          '### WCAG 2.1.4',
          '',
          'A shortcut of one character key must be something a person can turn off. Put that switch in `footer`, beside a way to change the keys, so the list is also where they are controlled.',
        ].join('\n'),
      },
    },
  },
  args: { open: true, onOpenChange: () => undefined, groups },
} satisfies Meta<typeof ShortcutsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const [open, setOpen] = useState(args.open);
    const [on, setOn] = useState(true);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Keyboard shortcuts
        </Button>
        <ShortcutsDialog
          {...args}
          open={open}
          onOpenChange={setOpen}
          description={
            on
              ? 'Press G, then a letter, to go somewhere.'
              : 'Single-key shortcuts are off. Those with ⌘ or Ctrl still work.'
          }
          footer={
            <>
              <Field orientation="horizontal" className="gap-3">
                <FieldLabel>Single-key shortcuts</FieldLabel>
                <FieldControl>
                  <Switch checked={on} onCheckedChange={setOn} />
                </FieldControl>
              </Field>
              <Button variant="ghost" size="sm">
                Change shortcuts
              </Button>
            </>
          }
        />
      </>
    );
  },
};
