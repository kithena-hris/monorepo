import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  CalendarDays,
  ChartColumn,
  ChevronRight,
  Folder,
  House,
  Network,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import { useState, type ComponentPropsWithoutRef, type JSX } from 'react';

import { Badge } from '../badge/badge';
import { Nav, NavGroup, NavItem, NavList, TertiaryNav } from './nav';

/** Stands in for a framework's client-side link: an anchor the router intercepts. */
function RouterLink(props: ComponentPropsWithoutRef<'a'>): JSX.Element {
  return <a data-router-link="" {...props} />;
}

const meta = {
  title: 'Components/Nav',
  component: NavItem,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Primary and secondary navigation: a landmark, a list, and an item per destination.',
          '',
          '**`asChild` for a framework link.** The child is the link and its children are the label; the icon, label and badge are drawn inside it, so a client-side route looks and reads exactly like a plain `<a>`.',
          '',
          '`aria-current="page"` carries the current destination, not the colour.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof NavItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const areas = [
  { icon: <House />, label: 'Home' },
  { icon: <Users />, label: 'People', current: true },
  { icon: <CalendarDays />, label: 'Time off', count: '3' },
  { icon: <Wallet />, label: 'Payroll' },
  { icon: <ChartColumn />, label: 'Insights' },
];

const slug = (label: string): string => `#${label.toLowerCase().replaceAll(' ', '-')}`;

/**
 * The sidebar: an icon per area, the current one filled, a count where
 * something is waiting, and a quiet heading above the workspace settings.
 * Each item is a framework link through `asChild`.
 */
export const SectionNavigation: Story = {
  args: { children: 'People' },
  render: () => (
    <Nav label="Main" className="w-60">
      <NavList>
        {areas.map((area) => (
          <NavItem
            key={area.label}
            asChild
            icon={area.icon}
            current={area.current === true}
            {...(area.count === undefined
              ? {}
              : {
                  badge: (
                    <Badge size="sm" tone="neutral">
                      {area.count}
                    </Badge>
                  ),
                })}
          >
            <RouterLink href={slug(area.label)}>{area.label}</RouterLink>
          </NavItem>
        ))}
        <NavGroup label="Workspace">
          <NavItem href="#settings" icon={<Settings />}>
            Settings
          </NavItem>
        </NavGroup>
      </NavList>
    </Nav>
  ),
};

/**
 * Groups that fold away, for sections people only sometimes need. The toggle
 * sits at the end of the heading, and the rows inside it line up with the
 * labels above.
 */
export const SectionsOnDemand: Story = {
  name: 'Sections On Demand',
  args: { children: 'People' },
  render: () => (
    <Nav label="People" className="w-60">
      <NavList>
        <NavItem href="#people" icon={<Users />} current>
          People
        </NavItem>
        <NavGroup label="Teams" collapsible>
          {['Engineering', 'Design', 'Sales'].map((team) => (
            <NavItem key={team} href={slug(team)} level={2}>
              {team}
            </NavItem>
          ))}
        </NavGroup>
        <NavGroup label="Locations" collapsible defaultOpen={false}>
          {['Berlin', 'London', 'Paris'].map((city) => (
            <NavItem key={city} href={slug(city)} level={2}>
              {city}
            </NavItem>
          ))}
        </NavGroup>
      </NavList>
    </Nav>
  ),
};

const destinations = [
  { icon: <Users />, label: 'Directory', description: 'Everyone at Reach', current: true },
  { icon: <Network />, label: 'Org chart', description: 'Who reports to whom' },
  { icon: <Folder />, label: 'Documents', description: 'Policies and contracts' },
];

/**
 * A line under each label, for destinations people do not know by name yet.
 * The chevron says each row opens somewhere.
 */
export const DescribedMenu: Story = {
  name: 'Described Menu',
  args: { children: 'Directory' },
  render: () => (
    <Nav label="People" className="w-60">
      <NavList>
        {destinations.map((item) => (
          <NavItem
            key={item.label}
            href={slug(item.label)}
            icon={item.icon}
            description={item.description}
            current={item.current === true}
            action={<ChevronRight aria-hidden className="size-4 text-fg-subtle" />}
          >
            {item.label}
          </NavItem>
        ))}
      </NavList>
    </Nav>
  ),
};

const profileSections = [
  { id: 'personal', label: 'Personal' },
  { id: 'employment', label: 'Employment' },
  { id: 'pay', label: 'Pay' },
  { id: 'time-off', label: 'Time off' },
  { id: 'documents', label: 'Documents' },
];

/**
 * The sections of the page you are on. Down the side it is a list with a rule;
 * across the top, where a phone puts it, it is a scrolling row of pills.
 */
export const InPage: Story = {
  name: 'In-page navigation',
  args: { children: 'Employment' },
  render: function InPageStory() {
    const [active, setActive] = useState('employment');
    return (
      <div className="flex flex-col gap-8">
        <TertiaryNav
          label="Profile sections"
          items={profileSections}
          activeId={active}
          onSelect={setActive}
          className="w-50"
        />
        <TertiaryNav
          label="Profile sections, across"
          items={profileSections}
          activeId={active}
          onSelect={setActive}
          orientation="horizontal"
        />
      </div>
    );
  },
};
