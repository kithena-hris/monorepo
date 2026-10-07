import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Building2,
  Calendar,
  CalendarClock,
  Flag,
  GitBranch,
  Globe,
  IdCard,
  KeyRound,
  Landmark,
  ListChecks,
  LogOut,
  MapPin,
  Palette,
  Plus,
  Receipt,
  RefreshCw,
  ScrollText,
  SearchX,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sun,
  User,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Badge } from '../badge/badge.tsx';
import { Breadcrumb } from '../breadcrumb/breadcrumb.tsx';
import { EmptyState, Skeleton } from '../feedback/feedback.tsx';
import { Kbd } from '../kbd/kbd.tsx';
import { Text } from '../text/text.tsx';
import { GroupedNav, type GroupedNavGroup, type GroupedNavProps } from './grouped-nav.tsx';

const SETTINGS: readonly GroupedNavGroup[] = [
  {
    id: 'organisation',
    label: 'Organisation',
    icon: Building2,
    items: [
      { id: 'general', label: 'General', icon: Settings },
      { id: 'branding', label: 'Branding', icon: Palette },
      { id: 'locations', label: 'Locations', icon: MapPin, count: 6 },
      { id: 'entities', label: 'Legal entities', icon: Landmark },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: Users,
    items: [
      { id: 'fields', label: 'Profile fields', icon: IdCard },
      { id: 'roles', label: 'Roles and permissions', icon: Shield, count: 8 },
      { id: 'onboarding', label: 'Onboarding templates', icon: ListChecks },
      { id: 'offboarding', label: 'Offboarding', icon: LogOut },
    ],
  },
  {
    id: 'time-off',
    label: 'Time off',
    icon: Calendar,
    items: [
      { id: 'leave-types', label: 'Leave types', icon: Sun },
      { id: 'holidays', label: 'Public holidays', icon: Flag },
      { id: 'approvals', label: 'Approval rules', icon: GitBranch },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: Wallet,
    items: [
      { id: 'schedules', label: 'Pay schedules', icon: CalendarClock },
      { id: 'tax', label: 'Tax settings', icon: Receipt },
      { id: 'bank', label: 'Bank accounts', icon: Landmark },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: ShieldCheck,
    items: [
      { id: 'sso', label: 'Single sign-on', icon: KeyRound },
      { id: 'two-factor', label: 'Two-factor', icon: Smartphone },
      { id: 'audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];

/** The list with its selection held, as a screen would. */
function Live(props: Omit<GroupedNavProps, 'currentId' | 'onSelect'> & { initial?: string }) {
  const { initial = 'fields', ...rest } = props;
  const [current, setCurrent] = useState(initial);
  return <GroupedNav {...rest} currentId={current} onSelect={setCurrent} />;
}

const meta = {
  title: 'Components/Grouped navigation',
  component: GroupedNav,
  parameters: designDocs('grouped-nav'),
  args: { label: 'Settings', groups: SETTINGS },
} satisfies Meta<typeof GroupedNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <Live label="Settings" groups={SETTINGS} />,
};

export const CollapsibleGroups: Story = {
  name: 'Collapsible groups',
  parameters: designNote('grouped-nav', 'Collapsible groups'),
  render: () => (
    <Live
      label="Settings"
      groups={SETTINGS}
      collapsible
      defaultCollapsed={['time-off', 'payroll']}
    />
  ),
};

export const SearchAndFilter: Story = {
  name: 'Search and filter',
  render: () => (
    <Live
      label="Settings"
      groups={SETTINGS}
      searchable
      searchPlaceholder="Search settings"
      defaultQuery="ro"
    />
  ),
};

export const Nested: Story = {
  parameters: designNote('grouped-nav', 'Nested'),
  render: () => (
    <View className="gap-3">
      <Breadcrumb
        items={[{ label: 'Settings' }, { label: 'People' }, { label: 'Roles and permissions' }]}
      />
      <Live
        label="Roles"
        initial=""
        groups={[
          {
            id: 'roles',
            label: 'Roles',
            items: [
              { id: 'admin', label: 'Admin', icon: Shield, count: 3 },
              { id: 'manager', label: 'Manager', icon: Users, count: 24 },
              { id: 'employee', label: 'Employee', icon: User, count: 285 },
              { id: 'custom', label: 'Custom roles', icon: Plus },
            ],
          },
        ]}
      />
    </View>
  ),
};

export const PinnedAndRecent: Story = {
  name: 'Pinned and recent',
  render: () => (
    <Live
      label="Settings"
      groups={[
        {
          id: 'pinned',
          label: 'Pinned',
          items: [
            { id: 'p-schedules', label: 'Pay schedules', icon: CalendarClock, pinned: true },
            { id: 'p-leave', label: 'Leave types', icon: Sun, pinned: true },
          ],
        },
        {
          id: 'recent',
          label: 'Recent',
          items: [
            { id: 'r-audit', label: 'Audit log', icon: ScrollText },
            { id: 'fields', label: 'Profile fields', icon: IdCard },
          ],
        },
        // The same destinations again in their own groups: one current page, marked in both.
        ...SETTINGS.slice(0, 2),
      ]}
    />
  ),
};

export const BadgesLocksAndUpgrades: Story = {
  name: 'Badges, locks and upgrades',
  render: () => (
    <Live
      label="Settings"
      initial=""
      groups={[
        {
          id: 'security',
          label: 'Security',
          items: [
            {
              id: 'sso',
              label: 'Single sign-on',
              icon: KeyRound,
              badge: (
                <Badge tone="accent" size="sm">
                  New
                </Badge>
              ),
            },
            {
              id: 'two-factor',
              label: 'Two-factor',
              icon: Smartphone,
              badge: (
                <Badge tone="warning" size="sm">
                  Required
                </Badge>
              ),
            },
            {
              id: 'scim',
              label: 'SCIM provisioning',
              icon: RefreshCw,
              locked: true,
              badge: (
                <Badge variant="outline" size="sm">
                  Enterprise
                </Badge>
              ),
            },
            { id: 'allowlist', label: 'IP allowlist', icon: Globe, disabled: true },
          ],
        },
        {
          id: 'payroll',
          label: 'Payroll',
          items: [
            { id: 'schedules', label: 'Pay schedules', icon: CalendarClock, count: 2 },
            { id: 'bank', label: 'Bank accounts', icon: Landmark, locked: true },
          ],
        },
      ]}
    />
  ),
};

const hints: readonly [readonly string[], string][] = [
  [['up', 'down'], 'move'],
  [['left', 'right'], 'close or open a group'],
  [['/'], 'search'],
  [['enter'], 'open'],
];

export const FromTheKeyboard: Story = {
  name: 'From the keyboard',
  render: () => (
    <View className="gap-2.5">
      <Live label="Settings" initial="roles" groups={SETTINGS.slice(0, 3)} />
      <View className="flex-row flex-wrap gap-3">
        {hints.map(([keys, what]) => (
          <View key={what} className="flex-row items-center gap-1.5">
            {keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
            <Text variant="footnote" tone="muted">
              {what}
            </Text>
          </View>
        ))}
      </View>
    </View>
  ),
  play: async ({ canvasElement }) => {
    // The row after the current one, focused from the keyboard.
    const root = canvasElement as unknown as {
      querySelectorAll: (selector: string) => ArrayLike<{ focus: () => void }>;
    };
    root.querySelectorAll('[tabindex="0"]')[6]?.focus();
    await Promise.resolve();
  },
};

export const CollapsedToARail: Story = {
  name: 'Collapsed to a rail',
  render: () => (
    <View className="items-center gap-2.5">
      <View className="h-[420px] w-[320px] flex-row overflow-hidden rounded-[28px] border border-border bg-canvas">
        <View className="w-[150px] bg-surface p-2">
          <Live label="Settings" groups={SETTINGS.slice(0, 3)} presentation="sidebar" />
        </View>
        <View className="flex-1 gap-2 p-3">
          <Skeleton className="h-3.5 w-[70%]" />
          <Skeleton className="h-[60px] rounded-[10px]" />
        </View>
      </View>
      <Text variant="subhead" tone="muted" className="text-center">
        On a tablet in landscape, the grouped list sits beside the detail as a sidebar.
      </Text>
    </View>
  ),
};

export const NoMatches: Story = {
  name: 'No matches',
  render: () => (
    <Live
      label="Settings"
      groups={SETTINGS}
      searchable
      searchPlaceholder="Search settings"
      defaultQuery="payslip"
      noResults={
        <View className="rounded-[20px] bg-surface">
          <EmptyState
            icon={SearchX}
            title={'No settings match "payslip"'}
            description="Payslips are under Payroll in the main menu."
          />
        </View>
      }
    />
  ),
};
