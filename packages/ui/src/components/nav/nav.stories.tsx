import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, ChartColumn, House, Settings, Users, Wallet } from 'lucide-react';
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

const sections = [
  { group: 'Records', items: ['Overview', 'Directory', 'Approvals'] },
  { group: 'Reporting', items: ['Analytics', 'Scheduled reports'] },
  { group: 'Settings', items: ['Fields', 'Roles'] },
];

/** The sections of one area, beside its content: grouped, one of them current. */
export const SectionNavigation: Story = {
  args: { children: 'Directory' },
  render: () => (
    <Nav label="Sections" className="w-56">
      <NavList>
        {sections.map((s) => (
          <NavGroup key={s.group} label={s.group}>
            {s.items.map((item) => (
              <NavItem key={item} asChild level={2} current={item === 'Directory'}>
                <RouterLink href={`#${item.toLowerCase().replaceAll(' ', '-')}`}>{item}</RouterLink>
              </NavItem>
            ))}
          </NavGroup>
        ))}
      </NavList>
    </Nav>
  ),
};

const areas = [
  { icon: <House />, label: 'Home' },
  { icon: <Users />, label: 'People', current: true },
  { icon: <CalendarDays />, label: 'Time off', badge: '2' },
  { icon: <Wallet />, label: 'Payroll' },
  { icon: <ChartColumn />, label: 'Insights' },
  { icon: <Settings />, label: 'Settings' },
];

/** Primary navigation in the sidebar: an icon per area, the current one a pill. */
export const Sidebar: Story = {
  args: { children: 'People' },
  render: () => (
    <Nav label="Main" className="w-60">
      <NavList>
        {areas.map((area) => (
          <NavItem
            key={area.label}
            href={`#${area.label.toLowerCase().replaceAll(' ', '-')}`}
            icon={area.icon}
            current={area.current === true}
            {...(area.badge === undefined
              ? {}
              : {
                  badge: (
                    <Badge size="sm" tone="accent">
                      {area.badge}
                    </Badge>
                  ),
                })}
          >
            {area.label}
          </NavItem>
        ))}
      </NavList>
    </Nav>
  ),
};

/** Groups that fold away. The heading is sentence case, and quieter than the items it heads. */
export const CollapsibleGroups: Story = {
  name: 'Collapsible groups',
  args: { children: 'Directory' },
  render: () => (
    <Nav label="People" className="w-60">
      <NavList>
        <NavGroup label="Records" collapsible>
          <NavItem href="#overview" level={2}>
            Overview
          </NavItem>
          <NavItem href="#directory" level={2} current>
            Directory
          </NavItem>
          <NavItem href="#org-chart" level={2}>
            Org chart
          </NavItem>
        </NavGroup>
        <NavGroup label="Reporting" collapsible defaultOpen={false} badge="2">
          <NavItem href="#analytics" level={2}>
            Analytics
          </NavItem>
          <NavItem href="#scheduled" level={2}>
            Scheduled reports
          </NavItem>
        </NavGroup>
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
