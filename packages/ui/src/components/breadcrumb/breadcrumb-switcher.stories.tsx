import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbMenu,
  BreadcrumbSeparator,
} from './breadcrumb';

const settings = [
  {
    label: 'Settings',
    items: [
      { href: '#fields', label: 'Employee fields', current: true },
      { href: '#organisation', label: 'Organisation' },
      { href: '#roles', label: 'Roles' },
      { href: '#integrations', label: 'Integrations' },
      { href: '#activity', label: 'Activity log' },
      { href: '#reminders', label: 'Completeness and reminders' },
      { href: '#packs', label: 'Country packs' },
      { href: '#directory', label: 'Directory' },
    ],
  },
];

const sections = [
  {
    label: 'Workspace',
    items: [
      { href: '#overview', label: 'Overview' },
      { href: '#directory', label: 'Directory', current: true },
      { href: '#org-chart', label: 'Org chart' },
      { href: '#me', label: 'My profile' },
      { href: '#approvals', label: 'Approvals' },
    ],
  },
  {
    label: 'Records',
    items: [
      { href: '#completeness', label: 'Data completeness' },
      { href: '#ids', label: 'ID verification' },
      { href: '#duplicates', label: 'Duplicate records' },
      { href: '#import', label: 'Import' },
      { href: '#export', label: 'Export' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '#analytics', label: 'Workforce analytics' },
      { href: '#reports', label: 'Report schedules' },
    ],
  },
];

const meta = {
  title: 'Components/Breadcrumb switcher',
  component: BreadcrumbMenu,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'The last breadcrumb opens a menu of its siblings, so you can move sideways without going up a level. The current one is ticked; each item is a link.',
          '',
          'A long list opens with a filter: typing narrows it, ↓ goes into the list and ↵ opens the first match. Under a finger the list is a sheet, and `variant="title"` makes a phone’s navigation-bar title the switcher.',
        ].join('\n'),
      },
    },
  },
  args: { label: 'Employee fields', menuLabel: 'Settings sections', groups: settings },
} satisfies Meta<typeof BreadcrumbMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Breadcrumb>
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
          <BreadcrumbMenu {...args} />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

export const GroupedSiblings: Story = {
  name: 'Grouped siblings',
  args: { label: 'Directory', menuLabel: 'People sections', groups: sections },
  render: (args) => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#people">People</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbMenu {...args} />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

export const OnAPhone: Story = {
  name: 'On a phone',
  args: { label: 'Directory', menuLabel: 'People sections', groups: sections, variant: 'title' },
  render: (args) => (
    <div className="flex justify-center rounded-lg bg-surface-sunken p-1">
      <BreadcrumbMenu {...args} />
    </div>
  ),
};
