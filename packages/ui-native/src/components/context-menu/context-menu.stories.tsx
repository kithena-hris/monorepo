import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Archive,
  Check,
  Calendar,
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  GitBranch,
  Link,
  LogOut,
  MessageCircle,
  Pencil,
  Pin,
  Share,
  Trash2,
  User,
  X,
} from 'lucide-react-native';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { settled } from '../../docs/stage.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu.tsx';

const meta = {
  title: 'Components/ContextMenu',
  component: ContextMenuContent,
  parameters: designDocs('context-menu'),
  // axe runs once the menu has faded in.
  play: settled,
} satisfies Meta<typeof ContextMenuContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A row that a long press opens actions on. The trigger's props reach it. */
function Row({
  children,
  label,
  ...trigger
}: { children: ReactNode; label: string } & ComponentProps<typeof Pressable>): React.JSX.Element {
  return (
    <Pressable
      {...trigger}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Long press for actions"
      className="min-h-14 flex-row items-center gap-3 rounded-[16px] bg-surface px-4 py-2.5"
    >
      {children}
    </Pressable>
  );
}

function FileRow({ name }: { name: string }): React.JSX.Element {
  return (
    <ContextMenuTrigger>
      <Row label={name}>
        <Icon icon={FileText} size={20} tone="muted" />
        <Text className="flex-1">{name}</Text>
      </Row>
    </ContextMenuTrigger>
  );
}

export const Playground: Story = {
  render: () => (
    <View className="min-h-[380px]">
      <ContextMenu defaultOpen>
        <FileRow name="Leave policy 2025.pdf" />
        <ContextMenuContent label="Leave policy 2025.pdf" className="w-[342px]">
          <ContextMenuItem icon={ExternalLink}>Open</ContextMenuItem>
          <ContextMenuItem icon={Link}>Copy link</ContextMenuItem>
          <ContextMenuItem icon={Pencil}>Rename</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={Trash2} destructive>
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </View>
  ),
};

export const SubmenusAndState: Story = {
  name: 'Submenus and state',
  render: function SubmenuStory() {
    const [pinned, setPinned] = useState(true);
    return (
      <View className="min-h-[460px]">
        <ContextMenu defaultOpen>
          <FileRow name="Contracts" />
          <ContextMenuContent label="Contracts" className="w-[210px]">
            <ContextMenuSub defaultOpen>
              <ContextMenuSubTrigger icon={FolderInput}>Move to</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem icon={Folder}>Policies</ContextMenuItem>
                <ContextMenuItem icon={Folder}>Contracts</ContextMenuItem>
                <ContextMenuItem icon={Folder}>Onboarding</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger icon={Share}>Share</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem icon={Link}>Copy link</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuCheckboxItem icon={Pin} checked={pinned} onCheckedChange={setPinned}>
              Pin
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={Archive}>Archive</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </View>
    );
  },
};

const STATUS_TONE = { Active: 'success', 'On leave': 'info' } as const;

/** One person's actions: the same list behind the long press and behind ⋯. */
function PersonActions({
  Item,
  Separator,
}: {
  Item: typeof ContextMenuItem;
  Separator: typeof ContextMenuSeparator;
}): React.JSX.Element {
  return (
    <>
      <Item icon={User}>View profile</Item>
      <Item icon={Pencil}>Edit</Item>
      <Item icon={GitBranch}>Change manager</Item>
      <Separator />
      <Item icon={LogOut} destructive>
        Offboard
      </Item>
    </>
  );
}

export const OnTableRows: Story = {
  name: 'On table rows, with the same commands elsewhere',
  parameters: designNote('context-menu', 'On table rows, with the same commands elsewhere'),
  render: () => (
    <View className="min-h-[600px] gap-2">
      {PEOPLE.slice(0, 4).map((person, i) => (
        <ContextMenu key={person.name} defaultOpen={i === 1}>
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <ContextMenuTrigger>
                <Row label={person.name}>
                  <Avatar name={person.name} size={40} decorative />
                  <View className="min-w-0 flex-1">
                    <Text weight="semibold" className="text-[16px]">
                      {person.name}
                    </Text>
                    <Text variant="footnote" tone="muted" className="text-[14px]">
                      {person.team}
                    </Text>
                  </View>
                  <Badge
                    size="sm"
                    dot
                    tone={STATUS_TONE[person.status as keyof typeof STATUS_TONE] ?? 'neutral'}
                  >
                    {person.status}
                  </Badge>
                </Row>
              </ContextMenuTrigger>
            </View>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button
                  size="xs"
                  variant="ghost"
                  startIcon={<Icon icon={Ellipsis} />}
                  accessibilityLabel={`Actions for ${person.name}`}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent label={`Actions for ${person.name}`} align="end">
                <PersonActions Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
          <ContextMenuContent label={`Actions for ${person.name}`} className="w-[300px]">
            <PersonActions Item={ContextMenuItem} Separator={ContextMenuSeparator} />
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </View>
  ),
};

export const UnavailableCommands: Story = {
  name: 'Unavailable commands',
  render: () => (
    <View className="min-h-[420px]">
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>
          <Row label="Amara Okafor, vacation, 14 to 18 October">
            <Avatar name="Amara Okafor" size={32} decorative />
            <Text className="flex-1">Vacation · 14–18 Oct</Text>
          </Row>
        </ContextMenuTrigger>
        <ContextMenuContent label="Amara Okafor’s request" className="w-[342px]">
          <ContextMenuItem icon={Check}>Approve</ContextMenuItem>
          <ContextMenuItem icon={Calendar} disabled description="Locked: payroll has already run">
            Edit dates
          </ContextMenuItem>
          <ContextMenuItem icon={X} disabled description="Only Amara can cancel">
            Cancel request
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={MessageCircle}>Message Amara</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </View>
  ),
};
