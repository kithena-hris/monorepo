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

import { icons } from '../../icons/index';
import { Badge } from '../badge/badge';
import { Nav, NavGroup, NavItem, NavList, TertiaryNav } from './nav';

const HomeIcon = icons.home;
const PeopleIcon = icons.people;
const DocumentIcon = icons.document;

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
export const FoldingGroups: Story = {
  name: 'Folding Groups',
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
export const DescribedItems: Story = {
  name: 'Described Items',
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

const sections = [
  { group: 'Records', items: ['Overview', 'Directory', 'Approvals'] },
  { group: 'Reporting', items: ['Analytics', 'Scheduled reports'] },
  { group: 'Settings', items: ['Fields', 'Roles'] },
];

/**
 * An area's sections on demand: hover, focus, ArrowRight or a first tap on
 * People opens them beside it, so the content keeps the whole width the rest
 * of the time. Tab goes from People into its sections and on; Escape returns
 * to People. The story opens it by focusing People, as a keyboard would.
 */
export const SectionsOnDemand: Story = {
  args: { children: 'People' },
  render: () => (
    <Nav label="Areas" className="w-60">
      <NavList>
        <NavItem asChild icon={<HomeIcon />}>
          <RouterLink href="#home">Home</RouterLink>
        </NavItem>
        <NavItem
          asChild
          current
          icon={<PeopleIcon />}
          flyout={
            <Nav label="People sections">
              <NavList>
                {sections.map((s) => (
                  <NavGroup key={s.group} label={s.group}>
                    {s.items.map((item) => (
                      <NavItem key={item} asChild level={2} current={item === 'Directory'}>
                        <RouterLink href={`#${item.toLowerCase().replaceAll(' ', '-')}`}>
                          {item}
                        </RouterLink>
                      </NavItem>
                    ))}
                  </NavGroup>
                ))}
              </NavList>
            </Nav>
          }
        >
          <RouterLink href="#people">People</RouterLink>
        </NavItem>
        <NavItem asChild icon={<DocumentIcon />}>
          <RouterLink href="#documents">Documents</RouterLink>
        </NavItem>
      </NavList>
    </Nav>
  ),
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('a[href="#people"]')?.focus();
  },
};

const menu = [
  {
    group: 'Everyday',
    items: [
      {
        label: 'Overview',
        icon: icons.home,
        text: 'Your details, what needs you, and who you report to.',
      },
      {
        label: 'Directory',
        icon: icons.people,
        text: 'Everybody here. Search, filter and open a profile.',
      },
      { label: 'Approvals', icon: icons.approve, text: 'Changes waiting for somebody to decide.' },
    ],
  },
  {
    group: 'Records',
    items: [
      {
        label: 'Missing information',
        icon: icons.missing,
        text: 'Records with required details still to fill in.',
      },
      {
        label: 'Possible duplicates',
        icon: icons.merge,
        text: 'Records that may be the same person, to merge or dismiss.',
      },
      {
        label: 'Import',
        icon: icons.upload,
        text: 'Add or update many people from a spreadsheet.',
      },
    ],
  },
  {
    group: 'Reporting',
    items: [
      {
        label: 'Analytics',
        icon: icons.analytics,
        text: 'Headcount, movement and pay, as charts.',
      },
      {
        label: 'Scheduled reports',
        icon: icons.report,
        text: 'Reports emailed to each recipient on a schedule.',
      },
    ],
  },
];

/**
 * An area's places as a menu: groups in columns, each place with its icon in a
 * tile and one line on what it is for. `flyoutSize="lg"` gives it the room;
 * `description` describes each link rather than joining its name, so a
 * screen reader still announces "Directory, link" and reads the line after.
 */
export const DescribedMenu: Story = {
  args: { children: 'People' },
  render: () => (
    <Nav label="Areas" className="w-60">
      <NavList>
        <NavItem
          asChild
          current
          icon={<PeopleIcon />}
          flyoutSize="lg"
          flyout={
            <Nav label="People sections">
              <NavList columns={3}>
                {menu.map((g) => (
                  <NavGroup key={g.group} label={g.group}>
                    {g.items.map(({ label, icon: Icon, text }) => (
                      <NavItem
                        key={label}
                        asChild
                        level={2}
                        current={label === 'Directory'}
                        icon={<Icon />}
                        description={text}
                      >
                        <RouterLink href={`#${label.toLowerCase().replaceAll(' ', '-')}`}>
                          {label}
                        </RouterLink>
                      </NavItem>
                    ))}
                  </NavGroup>
                ))}
              </NavList>
            </Nav>
          }
        >
          <RouterLink href="#people">People</RouterLink>
        </NavItem>
      </NavList>
    </Nav>
  ),
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('a[href="#people"]')?.focus();
  },
};
