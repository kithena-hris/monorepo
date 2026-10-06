import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Archive,
  Building2,
  Calendar,
  ChevronDown,
  Download,
  Ellipsis,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  GitBranch,
  Keyboard,
  LogOut,
  MessageCircle,
  Pencil,
  RotateCcw,
  Search,
  Settings,
  Share,
  Sheet,
  User,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { settled } from '../../docs/stage.tsx';
import { menuRowClass, MenuRowContent } from '../../lib/menu.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../popover/popover.tsx';
import { Text } from '../text/text.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu.tsx';

const meta = {
  title: 'Components/Dropdown menu',
  component: DropdownMenuContent,
  parameters: designDocs('dropdown-menu'),
  // axe runs once the menu has faded in.
  play: settled,
} satisfies Meta<typeof DropdownMenuContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Room under the trigger for the open menu, so the story's frame holds it. */
function Room({
  height,
  children,
}: {
  height: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View className="items-start" style={{ minHeight: height }}>
      {children}
    </View>
  );
}

function MoreButton({ label }: { label: string }): React.JSX.Element {
  return (
    <DropdownMenuTrigger>
      <Button size="sm" startIcon={<Icon icon={Ellipsis} />} accessibilityLabel={label} />
    </DropdownMenuTrigger>
  );
}

export const RowActions: Story = {
  name: 'Row actions',
  render: () => (
    <Room height={330}>
      <DropdownMenu defaultOpen>
        <MoreButton label="Actions for Priya Shah" />
        <DropdownMenuContent label="Actions for Priya Shah" className="w-[358px]">
          <DropdownMenuItem icon={User}>View profile</DropdownMenuItem>
          <DropdownMenuItem icon={Pencil}>Edit</DropdownMenuItem>
          <DropdownMenuItem icon={GitBranch}>Change manager</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={LogOut} destructive>
            Offboard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Room>
  ),
};

export const OpensOnHover: Story = {
  name: 'Opens on hover',
  render: () => (
    <Room height={340}>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>
          <Button variant="ghost" endIcon={<Icon icon={ChevronDown} />}>
            Products
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent label="Products" className="w-[280px]">
          <DropdownMenuItem icon={Users} description="Directory and org chart">
            People
          </DropdownMenuItem>
          <DropdownMenuItem icon={Calendar} description="Requests and balances">
            Time off
          </DropdownMenuItem>
          <DropdownMenuItem icon={Wallet} description="Runs and payslips">
            Payroll
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <View className="absolute bottom-0 left-0">
        <Text variant="subhead" tone="muted">
          There’s no hover on a phone. The same menu opens on tap.
        </Text>
      </View>
    </Room>
  ),
};

export const CheckboxItems: Story = {
  name: 'Checkbox items',
  render: function CheckboxStory() {
    const [shown, setShown] = useState<Record<string, boolean>>({
      Team: true,
      Location: true,
      'Start date': false,
      Salary: false,
    });
    return (
      <Room height={400}>
        <DropdownMenu defaultOpen>
          <MoreButton label="Columns" />
          <DropdownMenuContent label="Columns" className="w-[358px]">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            {Object.entries(shown).map(([column, on]) => (
              <DropdownMenuCheckboxItem
                key={column}
                checked={on}
                keepOpen
                onCheckedChange={(next) => {
                  setShown({ ...shown, [column]: next });
                }}
              >
                {column}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={RotateCcw}>Reset to default</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Room>
    );
  },
};

export const RadioItems: Story = {
  name: 'Radio items',
  render: function RadioStory() {
    const [sort, setSort] = useState('name');
    const [order, setOrder] = useState('asc');
    return (
      <Room height={440}>
        <DropdownMenu defaultOpen>
          <MoreButton label="Sort" />
          <DropdownMenuContent label="Sort" className="w-[358px]">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="start">Start date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="team">Team</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Order</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={order} onValueChange={setOrder}>
              <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Room>
    );
  },
};

export const WithSectionsIconsAndShortcuts: Story = {
  name: 'With sections, icons and shortcuts',
  parameters: designNote('dropdown-menu', 'With sections, icons and shortcuts'),
  render: () => (
    <Room height={460}>
      <DropdownMenu defaultOpen>
        <MoreButton label="Actions for Priya Shah" />
        <DropdownMenuContent label="Actions for Priya Shah" className="w-[358px]">
          <DropdownMenuLabel>Person</DropdownMenuLabel>
          <DropdownMenuItem icon={User}>View profile</DropdownMenuItem>
          <DropdownMenuItem icon={MessageCircle}>Message</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Manage</DropdownMenuLabel>
          <DropdownMenuItem icon={Users}>Change team</DropdownMenuItem>
          <DropdownMenuItem icon={GitBranch}>Change manager</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={LogOut} destructive>
            Offboard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Room>
  ),
};

export const Submenu: Story = {
  render: function SubmenuStory() {
    return (
      <Room height={420}>
        <DropdownMenu defaultOpen>
          <MoreButton label="Document actions" />
          <DropdownMenuContent label="Document actions" className="w-[200px]">
            <DropdownMenuSub defaultOpen>
              <DropdownMenuSubTrigger icon={FolderInput}>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem icon={Folder}>Policies</DropdownMenuItem>
                <DropdownMenuItem icon={Folder}>Contracts</DropdownMenuItem>
                <DropdownMenuItem icon={FolderPlus}>New folder…</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={Share}>Share</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Copy link</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={Archive}>Archive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Room>
    );
  },
};

const TEAMS = ['Engineering', 'Engineering Management', 'Sales Engineering', 'Design', 'People'];

/** The label with the matched part in bold, as a list does when you search it. */
function Highlighted({ text, query }: { text: string; query: string }): React.JSX.Element {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Text weight="bold" tone="accent">
        {text.slice(at, at + query.length)}
      </Text>
      {text.slice(at + query.length)}
    </>
  );
}

/*
 * A list worth searching is not a menu: a menu may hold only its rows, and a
 * search field is not one. It is a popover holding a field and the matching
 * rows, drawn as a menu's rows are.
 */
export const Searchable: Story = {
  render: function SearchableStory() {
    const [query, setQuery] = useState('en');
    const [team, setTeam] = useState('Engineering');
    const shown = TEAMS.filter((name) => name.toLowerCase().includes(query.toLowerCase()));
    return (
      <Room height={300}>
        <Popover defaultOpen>
          <PopoverTrigger>
            <Button endIcon={<Icon icon={ChevronDown} />}>{team}</Button>
          </PopoverTrigger>
          <PopoverContent label="Team" className="w-[358px] p-1.5">
            <View className="mb-1 h-11 flex-row items-center gap-2 rounded-[14px] bg-surface-sunken px-3">
              <Icon icon={Search} size={18} tone="muted" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                accessibilityLabel="Search teams"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 p-0 text-body text-fg outline-none"
              />
            </View>
            {shown.map((name) => (
              <PopoverClose key={name} asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={name}
                  onPress={() => {
                    setTeam(name);
                  }}
                  className={menuRowClass({ highlighted: name === team })}
                >
                  <MenuRowContent>
                    <Highlighted text={name} query={query} />
                  </MenuRowContent>
                </Pressable>
              </PopoverClose>
            ))}
          </PopoverContent>
        </Popover>
      </Room>
    );
  },
};

export const AccountMenu: Story = {
  name: 'Account menu',
  render: () => (
    <Room height={470}>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>
          <Button size="sm" startIcon={<Icon icon={User} />} accessibilityLabel="Account" />
        </DropdownMenuTrigger>
        <DropdownMenuContent label="Account" className="w-[260px]">
          <DropdownMenuItem
            lead={<Avatar name="Priya Shah" size={32} decorative />}
            description="priya@reach.co"
          >
            Priya Shah
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={User}>Profile</DropdownMenuItem>
          <DropdownMenuItem icon={Settings}>Settings</DropdownMenuItem>
          <DropdownMenuItem icon={Keyboard}>Keyboard shortcuts</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={Building2}>Switch organisation</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Reach Labs</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem icon={LogOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Room>
  ),
};

const FORMATS = [
  ['csv', 'Export CSV', FileSpreadsheet],
  ['xlsx', 'Export Excel', Sheet],
  ['pdf', 'Export PDF', FileText],
] as const;

export const SplitButton: Story = {
  name: 'Split button',
  render: function SplitStory() {
    const [format, setFormat] = useState<string>('csv');
    const label = FORMATS.find(([value]) => value === format)?.[1] ?? 'Export CSV';
    return (
      <Room height={260}>
        <View className="flex-row gap-0.5">
          <Button
            variant="primary"
            startIcon={<Icon icon={Download} />}
            className="rounded-r-[6px]"
          >
            {label}
          </Button>
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>
              <Button
                variant="primary"
                startIcon={<Icon icon={ChevronDown} />}
                accessibilityLabel="Export format"
                className="rounded-l-[6px]"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent label="Export format" align="end" className="w-[220px]">
              {FORMATS.map(([value, name, icon]) => (
                <DropdownMenuCheckboxItem
                  key={value}
                  icon={icon}
                  checked={format === value}
                  onCheckedChange={() => {
                    setFormat(value);
                  }}
                >
                  {name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      </Room>
    );
  },
};
