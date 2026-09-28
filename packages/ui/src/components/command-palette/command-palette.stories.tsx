import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Calendar,
  FileText,
  MessageCircle,
  Monitor,
  Moon,
  Network,
  Search,
  Sparkles,
  Sun,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';

import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';
import { EmptyState } from '../feedback/feedback';
import { Command, CommandPalette, type CommandItem } from './command-palette';

const meta: Meta = {
  title: 'Components/Command palette',
  component: Command,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'Press ⌘K to search people, pages and actions from anywhere. Every result can be reached with the keyboard.',
          '',
          '`Command` is the field and its results and renders anywhere, which is what these stories show. `CommandPalette` puts it in a modal dialog: centred near the top at a desk, full screen under a finger, where it opens from a search button rather than a shortcut.',
          '',
          'It is the APG combobox with a listbox popup. Focus stays in the field while ↑ ↓ move the highlighted result (`aria-activedescendant`), Enter runs it or opens its page, Backspace on an empty field goes back a page, and Esc closes. The result count is announced as the query changes. There is no `cmdk` underneath: the filtering is `filterCommands`, a pure function, and it ranks a label that starts with the query above one that merely contains it.',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

/** The stage the design draws the palette on: the page, dimmed, with the panel near the top. */
function Stage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-115 justify-center bg-surface-sunken p-8 touch:min-h-140 touch:p-2">
      <div className="w-full max-w-140">{children}</div>
    </div>
  );
}

const person = (name: string): ReactNode => <Avatar name={name} size="sm" />;

const theme: CommandItem = {
  id: 'theme',
  label: 'Change theme',
  icon: <Moon />,
  group: 'Actions',
  items: [
    { id: 'light', label: 'Light', icon: <Sun />, group: 'Theme' },
    { id: 'dark', label: 'Dark', icon: <Moon />, group: 'Theme' },
    { id: 'system', label: 'Match system', icon: <Monitor />, group: 'Theme' },
  ],
};

const everything: CommandItem[] = [
  {
    id: 'amara',
    label: 'Amara Okafor',
    description: 'Product Designer',
    avatar: person('Amara Okafor'),
    group: 'Recent',
  },
  {
    id: 'leave-policy',
    label: 'Leave policy',
    description: 'Policies',
    icon: <FileText />,
    group: 'Recent',
  },
  {
    id: 'time-off',
    label: 'Request time off',
    icon: <Calendar />,
    shortcut: ['G', 'T'],
    group: 'Actions',
  },
  {
    id: 'invite',
    label: 'Invite a person',
    icon: <UserPlus />,
    shortcut: ['G', 'I'],
    group: 'Actions',
  },
  theme,
  { id: 'payroll', label: 'Payroll', icon: <Wallet />, shortcut: ['G', 'P'], group: 'Go to' },
  { id: 'org', label: 'Org chart', icon: <Network />, shortcut: ['G', 'O'], group: 'Go to' },
  {
    id: 'priya',
    label: 'Priya Shah',
    description: 'Senior Engineer',
    avatar: person('Priya Shah'),
    group: 'People',
    keywords: ['engineering'],
  },
  {
    id: 'pria',
    label: 'Pria Mendes',
    description: 'Recruiter',
    avatar: person('Pria Mendes'),
    group: 'People',
  },
  {
    id: 'message-priya',
    label: 'Message Priya',
    icon: <MessageCircle />,
    shortcut: ['⌘', 'M'],
    group: 'Actions',
  },
];

export const Playground: Story = {
  render: () => (
    <Stage>
      <Command
        label="Search or run a command"
        items={everything.filter((item) => item.group !== 'People' && item.id !== 'message-priya')}
      />
    </Stage>
  ),
};

/** The query narrows and ranks as you type; the matched letters are marked. */
export const Typing: Story = {
  render: () => (
    <Stage>
      <Command items={everything} defaultQuery="Pri" />
    </Stage>
  ),
};

/** A command with a page of its own. The chip says where you are; Backspace or the chip goes back. */
export const NestedCommands: Story = {
  render: () => (
    <Stage>
      <Command items={everything} defaultPath={['theme']} />
    </Stage>
  ),
};

/** Results from a server: the spinner in the field, placeholders in the list, and no local filtering. */
export const SearchingRemotely: Story = {
  render: () => (
    <Stage>
      <Command items={[]} filter={false} defaultQuery="contract" loading />
    </Stage>
  ),
};

export const NoResults: Story = {
  render: () => (
    <Stage>
      <Command
        items={everything}
        defaultQuery="dentl"
        empty={
          <EmptyState
            icon={<Search />}
            title="Nothing for “dentl”"
            description="Did you mean “dental”?"
            action={
              <Button size="sm" startIcon={<Sparkles aria-hidden />}>
                Ask the Assistant
              </Button>
            }
            className="border-0 py-4"
          />
        }
      />
    </Stage>
  ),
};

/**
 * The real thing: a dialog. An app passes `hotkey="k"` as well, for ⌘K or
 * Ctrl+K; this page shows two copies of every story, so it does not.
 */
export const InADialog: Story = {
  parameters: { layout: 'centered' },
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button
          startIcon={<Search aria-hidden />}
          onClick={() => {
            setOpen(true);
          }}
        >
          Search
        </Button>
        <CommandPalette open={open} onOpenChange={setOpen} items={everything} />
      </>
    );
  },
};
