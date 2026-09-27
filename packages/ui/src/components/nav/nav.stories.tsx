import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { icons } from '../../icons/index';
import { Nav, NavGroup, NavItem, NavList } from './nav';

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
