import type { Meta, StoryObj } from '@storybook/react-vite';
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
  Receipt,
  RefreshCw,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
  Wallet,
} from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';

import { Badge } from '../badge/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../breadcrumb/breadcrumb';
import { Kbd } from '../kbd/kbd';
import { Skeleton } from '../feedback/feedback';
import { GroupedNav, type GroupedNavGroup } from './grouped-nav';

const meta: Meta = {
  title: 'Components/Grouped navigation',
  component: GroupedNav,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A long navigation list in labelled groups, for settings, admin and documentation. It supports search, collapsing, nesting and pinning.',
          '',
          'On a phone it is a settings screen: each group an inset list, each row a coloured tile that pushes a new screen, and never an indented tree.',
          '',
          'Every row is a link or a button, so Tab works through them. ↑ ↓ move between rows, → ← open and close a group or a nested item, `/` jumps to the search, and Enter in the search opens the first result.',
          '',
          'Collapsed to a rail, the same destinations are `Nav` inside a collapsed `PageLayout` sidebar, which already draws one icon per item with its label in a tooltip.',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const settings: GroupedNavGroup[] = [
  {
    id: 'organisation',
    label: 'Organisation',
    icon: <Building2 />,
    items: [
      { id: 'general', label: 'General', icon: <Settings /> },
      { id: 'branding', label: 'Branding', icon: <Palette /> },
      { id: 'locations', label: 'Locations', icon: <MapPin />, count: 6 },
      { id: 'legal-entities', label: 'Legal entities', icon: <Landmark /> },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: <Users />,
    items: [
      { id: 'profile-fields', label: 'Profile fields', icon: <IdCard /> },
      { id: 'roles', label: 'Roles and permissions', icon: <Shield />, count: 8 },
      { id: 'onboarding', label: 'Onboarding templates', icon: <ListChecks /> },
      { id: 'offboarding', label: 'Offboarding', icon: <LogOut /> },
    ],
  },
  {
    id: 'time-off',
    label: 'Time off',
    icon: <Calendar />,
    items: [
      { id: 'leave-types', label: 'Leave types', icon: <Sun /> },
      { id: 'public-holidays', label: 'Public holidays', icon: <Flag /> },
      { id: 'approval-rules', label: 'Approval rules', icon: <GitBranch /> },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: <Wallet />,
    items: [
      { id: 'pay-schedules', label: 'Pay schedules', icon: <CalendarClock /> },
      { id: 'tax', label: 'Tax settings', icon: <Receipt /> },
      { id: 'bank-accounts', label: 'Bank accounts', icon: <Landmark /> },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: <ShieldCheck />,
    items: [
      { id: 'sso', label: 'Single sign-on', icon: <KeyRound /> },
      { id: 'two-factor', label: 'Two-factor', icon: <Smartphone /> },
      { id: 'audit-log', label: 'Audit log', icon: <ScrollText /> },
    ],
  },
];

/** The design's frame: the nav in a surface column beside skeleton content. On a phone, the nav alone. */
function Frame({ children, footer }: { children: ReactNode; footer?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex overflow-hidden rounded-lg border border-border bg-canvas touch:border-0 touch:bg-transparent">
        <div className="w-62 shrink-0 border-e border-border bg-surface px-2.5 py-3.5 touch:w-full touch:border-0 touch:bg-transparent touch:p-0">
          {children}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 touch:hidden">
          <Skeleton className="h-4.5 w-2/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-22 w-full" />
        </div>
      </div>
      {footer}
    </div>
  );
}

export const Playground: Story = {
  render: function Render() {
    const [current, setCurrent] = useState('profile-fields');
    return (
      <Frame>
        <GroupedNav label="Settings" groups={settings} currentId={current} onSelect={setCurrent} />
      </Frame>
    );
  },
};

/** Open and closed groups are the reader's; the group holding the current page always opens. */
export const CollapsibleGroups: Story = {
  render: () => (
    <Frame>
      <GroupedNav
        label="Settings"
        groups={settings}
        currentId="profile-fields"
        collapsible
        defaultCollapsed={['time-off', 'payroll']}
      />
    </Frame>
  ),
};

export const SearchAndFilter: Story = {
  render: () => (
    <Frame>
      <GroupedNav
        label="Settings"
        groups={settings}
        currentId="profile-fields"
        searchable
        searchPlaceholder="Search settings"
        defaultQuery="ro"
      />
    </Frame>
  ),
};

/** Up to three levels at a desk, with guide lines. On a phone each level is its own screen. */
export const Nested: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Breadcrumb className="hidden touch:block">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#settings">Settings</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="#people">People</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Roles and permissions</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <Frame>
        <GroupedNav
          label="Settings"
          currentId="manager"
          groups={[
            {
              id: 'people',
              label: 'People',
              items: [
                { id: 'profile-fields', label: 'Profile fields', icon: <IdCard /> },
                {
                  id: 'roles',
                  label: 'Roles and permissions',
                  icon: <Shield />,
                  href: '#roles',
                  items: [
                    { id: 'admin', label: 'Admin', count: 3 },
                    { id: 'manager', label: 'Manager', count: 24 },
                    { id: 'employee', label: 'Employee', count: 285 },
                    {
                      id: 'custom',
                      label: 'Custom roles',
                      href: '#custom',
                      items: [
                        { id: 'payroll-viewer', label: 'Payroll viewer' },
                        { id: 'recruiter', label: 'Recruiter' },
                      ],
                    },
                  ],
                },
                { id: 'onboarding', label: 'Onboarding templates', icon: <ListChecks /> },
              ],
            },
          ]}
        />
      </Frame>
    </div>
  ),
};

export const PinnedAndRecent: Story = {
  render: () => (
    <Frame>
      <GroupedNav
        label="Settings"
        currentId="profile-fields-recent"
        groups={[
          {
            id: 'pinned',
            label: 'Pinned',
            items: [
              {
                id: 'pay-schedules-pinned',
                label: 'Pay schedules',
                icon: <CalendarClock />,
                pinned: true,
              },
              { id: 'leave-types-pinned', label: 'Leave types', icon: <Sun />, pinned: true },
            ],
          },
          {
            id: 'recent',
            label: 'Recent',
            items: [
              { id: 'audit-log-recent', label: 'Audit log', icon: <ScrollText /> },
              { id: 'profile-fields-recent', label: 'Profile fields', icon: <IdCard /> },
            ],
          },
          ...settings.slice(0, 2),
        ]}
      />
    </Frame>
  ),
};

export const BadgesLocksAndUpgrades: Story = {
  render: () => (
    <Frame>
      <GroupedNav
        label="Settings"
        groups={[
          {
            id: 'security',
            label: 'Security',
            items: [
              {
                id: 'sso',
                label: 'Single sign-on',
                icon: <KeyRound />,
                badge: (
                  <Badge size="sm" tone="accent">
                    New
                  </Badge>
                ),
              },
              {
                id: 'two-factor',
                label: 'Two-factor',
                icon: <Smartphone />,
                badge: (
                  <Badge size="sm" tone="warning">
                    Required
                  </Badge>
                ),
              },
              {
                id: 'scim',
                label: 'SCIM provisioning',
                icon: <RefreshCw />,
                locked: true,
                badge: <Badge size="sm">Enterprise</Badge>,
              },
              { id: 'ip-allowlist', label: 'IP allowlist', icon: <Globe />, disabled: true },
            ],
          },
          {
            id: 'payroll',
            label: 'Payroll',
            items: [
              { id: 'pay-schedules', label: 'Pay schedules', icon: <CalendarClock />, count: 2 },
              { id: 'bank-accounts', label: 'Bank accounts', icon: <Landmark />, locked: true },
            ],
          },
        ]}
      />
    </Frame>
  ),
};

export const FromTheKeyboard: Story = {
  render: () => (
    <Frame
      footer={
        <p className="flex flex-wrap gap-3 text-sm text-fg-muted touch:hidden">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>←</Kbd> <Kbd>→</Kbd> close or open a group
          </span>
          <span>
            <Kbd>/</Kbd> search
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
        </p>
      }
    >
      <GroupedNav
        label="Settings"
        groups={settings.slice(0, 3)}
        currentId="roles"
        collapsible
        searchable
        searchPlaceholder="Search settings"
      />
    </Frame>
  ),
};

export const NoMatches: Story = {
  render: () => (
    <Frame>
      <GroupedNav
        label="Settings"
        groups={settings}
        searchable
        searchPlaceholder="Search settings"
        defaultQuery="payslip"
        noResults="Payslips are under Payroll in the main menu."
      />
    </Frame>
  ),
};
