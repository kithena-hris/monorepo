import type { Meta, StoryObj } from '@storybook/react-vite';

import { icons } from '../../icons';
import { Badge } from '../badge/badge';
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
          'A long list opens with a filter: typing narrows it, ↓ goes into the list and ↵ opens the first match. Under a finger it is the same menu, anchored to the trigger, and `variant="title"` makes a phone’s navigation-bar title the switcher.',
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

const six = [
  { href: '#overview', label: 'Overview', icon: <icons.overview /> },
  { href: '#directory', label: 'Directory', icon: <icons.people /> },
  { href: '#approvals', label: 'Approvals', icon: <icons.approve />, count: 4 },
  { href: '#data-health', label: 'Data health', icon: <icons.health />, count: 6, current: true },
  { href: '#import-export', label: 'Import & export', icon: <icons.transfer /> },
  { href: '#insights', label: 'Insights', icon: <icons.analytics /> },
].map(({ count, ...item }) => ({
  ...item,
  ...(count === undefined
    ? {}
    : {
        badge: (
          <Badge size="xs" variant="solid" tone={item.label === 'Approvals' ? 'danger' : 'warning'}>
            {count}
            <span className="sr-only"> need action</span>
          </Badge>
        ),
      }),
}));

const tabs = ['Completeness', 'ID checks', 'Duplicates', 'Access requests'].map((label) => ({
  href: `#${label.toLowerCase().replaceAll(' ', '-')}`,
  label,
  current: label === 'Duplicates',
}));

/**
 * An umbrella page's trail has two switchers: the section, which lists the
 * sections with their icons and, under "In Data health", its tabs, ticked;
 * and the tab. The section's is no longer the page (`current={false}`).
 */
export const TwoSwitchers: Story = {
  name: 'Two switchers',
  args: { label: 'Data health', menuLabel: 'People sections', groups: [] },
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#people">People</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbMenu
            label="Data health"
            current={false}
            menuLabel="People sections"
            groups={[
              { label: 'People', items: six.map(({ badge: _badge, ...item }) => item) },
              { label: 'In Data health', items: tabs },
            ]}
          />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbMenu
            label="Duplicates"
            menuLabel="Data health tabs"
            groups={[{ label: 'Data health', items: tabs }]}
          />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

/** The title switcher: a small menu anchored under the title, each section with its icon and count. */
export const WithIconsAndCounts: Story = {
  name: 'With icons and counts',
  args: {
    label: 'Data health',
    menuLabel: 'People sections, switch',
    groups: [{ label: 'People', items: six }],
    variant: 'title',
  },
  render: (args) => (
    <div className="flex justify-center rounded-lg bg-surface-sunken p-1">
      <BreadcrumbMenu {...args} />
    </div>
  ),
};
