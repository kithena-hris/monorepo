import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { Nav, NavGroup, NavItem, NavList } from './nav';

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
