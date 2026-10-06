import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Calendar,
  FileText,
  MessageCircle,
  Monitor,
  Moon,
  Network,
  Search,
  SearchX,
  Sparkles,
  Sun,
  UserPlus,
  Wallet,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Stage } from '../../docs/stage.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { EmptyState } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Command, CommandPalette, type CommandItem } from './command-palette.tsx';

const meta = {
  title: 'Components/Command palette',
  component: Command,
  parameters: designDocs('command-palette'),
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The design's stage: the page, dimmed, with the palette at the top. */
function PaletteStage({
  height = 560,
  children,
}: {
  height?: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Stage height={height}>
      {() => (
        <>
          <View className="absolute inset-0 bg-overlay" />
          <View className="absolute inset-x-0 top-0 p-2">{children}</View>
        </>
      )}
    </Stage>
  );
}

const person = (name: string): ReactNode => <Avatar name={name} size={28} decorative />;

const theme: CommandItem = {
  id: 'theme',
  label: 'Change theme',
  icon: Moon,
  group: 'Actions',
  items: [
    { id: 'light', label: 'Light', icon: Sun, group: 'Theme' },
    { id: 'dark', label: 'Dark', icon: Moon, group: 'Theme' },
    { id: 'system', label: 'Match system', icon: Monitor, group: 'Theme' },
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
    icon: FileText,
    group: 'Recent',
  },
  { id: 'time-off', label: 'Request time off', icon: Calendar, group: 'Actions' },
  { id: 'invite', label: 'Invite a person', icon: UserPlus, group: 'Actions' },
  theme,
  { id: 'payroll', label: 'Payroll', icon: Wallet, group: 'Go to' },
  { id: 'org', label: 'Org chart', icon: Network, group: 'Go to' },
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
  { id: 'time-off-priya', label: 'Request time off for Priya', icon: Calendar, group: 'Actions' },
  { id: 'message-priya', label: 'Message Priya', icon: MessageCircle, group: 'Actions' },
];

const close = (): void => undefined;

export const Playground: Story = {
  args: { items: everything },
  render: () => (
    <PaletteStage>
      <Command
        onClose={close}
        items={everything.filter(
          (item) => item.group !== 'People' && !item.label.includes('Priya'),
        )}
      />
    </PaletteStage>
  ),
};

/** The query narrows and ranks as you type; the matched letters are marked. */
export const Typing: Story = {
  args: { items: everything },
  render: () => (
    <PaletteStage height={480}>
      <Command onClose={close} items={everything} defaultQuery="Pri" />
    </PaletteStage>
  ),
};

/** A command with a page of its own. The chip says where you are, and goes back. */
export const NestedCommands: Story = {
  name: 'Nested commands',
  args: { items: everything },
  render: () => (
    <PaletteStage height={400}>
      <Command onClose={close} items={everything} defaultPath={['theme']} />
    </PaletteStage>
  ),
};

/** Results from a server: a spinner in the field, placeholders in the list, no local filtering. */
export const SearchingRemotely: Story = {
  name: 'Searching remotely',
  args: { items: [] },
  render: () => (
    <PaletteStage height={380}>
      <Command onClose={close} items={[]} filter={false} defaultQuery="contract" loading />
    </PaletteStage>
  ),
};

export const NoResults: Story = {
  name: 'No results',
  args: { items: everything },
  render: () => (
    <PaletteStage height={420}>
      <Command
        onClose={close}
        items={everything}
        defaultQuery="dentl"
        empty={
          <EmptyState
            icon={SearchX}
            title="Nothing for “dentl”"
            description="Did you mean “dental”?"
            action={
              <Button size="sm" startIcon={<Icon icon={Sparkles} />}>
                Ask Reach Assistant
              </Button>
            }
          />
        }
      />
    </PaletteStage>
  ),
};

/** The real thing on a phone: full screen, from a search button, the keyboard up. */
export const InADialog: Story = {
  name: 'In a dialog',
  args: { items: everything },
  render: function InADialogStory() {
    const [open, setOpen] = useState(false);
    return (
      <View className="items-start">
        <Button
          startIcon={<Icon icon={Search} />}
          onPress={() => {
            setOpen(true);
          }}
        >
          Search
        </Button>
        <CommandPalette open={open} onOpenChange={setOpen} items={everything} />
      </View>
    );
  },
};
