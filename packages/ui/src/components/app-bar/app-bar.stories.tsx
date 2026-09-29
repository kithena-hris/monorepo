import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Archive,
  Bell,
  Calendar,
  Download,
  Ellipsis,
  House,
  MessageCircle,
  Plus,
  Sparkles,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';

import { ReachMark } from '../../brand/reach-logo';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Skeleton } from '../feedback/feedback';
import { Kbd } from '../kbd/kbd';
import { SearchField } from '../typed-fields/typed-fields';
import { AppBar, AppBarBack, NavRail, TabBar, TabBarItem } from './app-bar';

const meta: Meta = {
  title: 'Components/App bars',
  component: AppBar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'The bars above and below the content: the global header and the selection toolbar at a desk; on a phone, a large title that collapses as you scroll, and a floating tab bar for the top-level sections.',
          '',
          'The top bar is `sticky` to whatever scrolls. With `largeTitle`, the title sits under the bar until it scrolls beneath it, and at that moment the bar turns to glass and shows the title small. The swap is measured from where the title is, so it works in a window, a panel or a sheet alike.',
          '',
          '`TabBar` is the bottom bar on a phone and on a narrow web window; `NavRail` is the same destinations down the side of a tablet. Both take `TabBarItem`s. Page headers are `PageHeader`, and the collapsed sidebar is `PageLayout`’s.',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const people = [
  'Amara Okafor',
  'Jonas Weber',
  'Priya Shah',
  'Omar Haddad',
  'Yuki Tanaka',
  'Nora Becker',
  'Lucas Martin',
  'Sofia Rossi',
];

/** Something to scroll: a list of people, as the design uses. */
function People(): JSX.Element {
  return (
    <ul className="flex flex-col px-4">
      {[...people, ...people].map((name, index) => (
        <li
          key={index}
          className="flex min-h-12 items-center gap-3 border-b border-border py-2 last:border-0"
        >
          <Avatar name={name} />
          <span className="text-base font-medium text-fg">{name}</span>
        </li>
      ))}
    </ul>
  );
}

/** A framed scroll container, standing in for the screen. */
function Screen({
  children,
  height = 'h-80',
  startScrolled = false,
}: {
  children: ReactNode;
  height?: string;
  startScrolled?: boolean;
}): JSX.Element {
  return (
    <div
      tabIndex={0}
      aria-label="Screen"
      role="region"
      ref={(el) => {
        if (el && startScrolled) el.scrollTop = 120;
      }}
      className={`${height} overflow-y-auto rounded-lg border border-border bg-canvas touch:rounded-xl`}
    >
      {children}
    </div>
  );
}

export const GlobalHeader: Story = {
  render: () => (
    <div className="overflow-hidden rounded-md border border-border">
      <AppBar
        leading={
          <>
            <ReachMark className="size-6" />
            <span className="font-display text-base font-bold text-fg">Reach</span>
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              startIcon={<Sparkles aria-hidden />}
              aria-label="Assistant"
            />
            <span className="relative inline-flex">
              <Button
                variant="ghost"
                size="sm"
                startIcon={<Bell aria-hidden />}
                aria-label="Notifications, 2 unread"
              />
              {/* The count is in the button's name; the badge only shows it. */}
              <Badge
                variant="solid"
                tone="danger"
                size="xs"
                aria-hidden
                className="pointer-events-none absolute -top-0.5 -right-0.5 ring-2 ring-surface"
              >
                2
              </Badge>
            </span>
            <Avatar name="Priya Shah" />
          </>
        }
      >
        <div className="ms-3 flex w-full max-w-80 items-center gap-2 touch:ms-0 touch:max-w-none">
          <SearchField size="sm" value="" onValueChange={() => undefined} placeholder="Search" />
          <Kbd className="shrink-0 touch:hidden">⌘K</Kbd>
        </div>
      </AppBar>
    </div>
  ),
};

/** Scroll the screen: the title slides under the bar, and the bar takes it and turns to glass. */
export const LargeTitle: Story = {
  render: () => (
    <Screen height="h-100">
      <AppBar
        largeTitle
        title="People"
        actions={
          <Button
            size="sm"
            startIcon={<Plus aria-hidden />}
            aria-label="Add person"
            className="rounded-control"
          />
        }
      />
      <People />
    </Screen>
  ),
};

export const CompactWithBack: Story = {
  render: () => (
    <Screen height="h-60">
      <AppBar
        title="Priya Shah"
        leading={<AppBarBack>People</AppBarBack>}
        actions={
          <Button
            variant="ghost"
            size="sm"
            startIcon={<Ellipsis aria-hidden />}
            aria-label="More"
          />
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
      </div>
    </Screen>
  ),
};

export const WithSearch: Story = {
  render: function Render() {
    const [query, setQuery] = useState('');
    return (
      <Screen height="h-100">
        <AppBar largeTitle title="People">
          <SearchField
            size="sm"
            value={query}
            onValueChange={setQuery}
            placeholder="Search 312 people"
            label="Search people"
          />
        </AppBar>
        <People />
      </Screen>
    );
  },
};

/** A mode the reader leaves deliberately: Cancel on a phone, the close button at a desk. */
export const SelectionMode: Story = {
  render: () => (
    <div className="overflow-hidden rounded-md touch:rounded-xl">
      <AppBar
        tone="selection"
        title="3 selected"
        leading={
          <>
            <Checkbox checked="indeterminate" aria-label="Select all" className="touch:hidden" />
            <Button variant="link" className="hidden touch:inline-flex">
              Cancel
            </Button>
          </>
        }
        actions={
          <>
            <Button variant="link" size="sm" className="touch:hidden">
              Select all 312
            </Button>
            <Button size="sm" startIcon={<MessageCircle aria-hidden />} className="touch:hidden">
              Message
            </Button>
            <Button size="sm" startIcon={<Download aria-hidden />} className="touch:hidden">
              Export
            </Button>
            <Button
              size="sm"
              variant="destructive"
              startIcon={<Archive aria-hidden />}
              className="touch:hidden"
            >
              Archive
            </Button>
            <Button
              variant="ghost"
              size="sm"
              startIcon={<X aria-hidden />}
              aria-label="Clear selection"
              className="touch:hidden"
            />
            <Button variant="link" className="hidden font-semibold touch:inline-flex">
              All
            </Button>
          </>
        }
      />
    </div>
  ),
};

/** Once content scrolls under it, the bar turns to glass. This one starts scrolled. */
export const GlassOnScroll: Story = {
  render: () => (
    <Screen height="h-60" startScrolled>
      <AppBar title="People" />
      <People />
    </Screen>
  ),
};

const sections = [
  { icon: <House />, label: 'Home' },
  { icon: <Users />, label: 'People' },
  { icon: <Calendar />, label: 'Time off' },
  { icon: <Wallet />, label: 'Pay' },
  { icon: <User />, label: 'Me' },
];

export const TabBarStory: Story = {
  name: 'Tab bar',
  render: () => (
    <div className="rounded-lg bg-surface-sunken px-2 py-5">
      <TabBar label="Main" className="mx-auto max-w-97.5">
        {sections.map((section) => (
          <TabBarItem
            key={section.label}
            href={`#${section.label.toLowerCase()}`}
            icon={section.icon}
            label={section.label}
            current={section.label === 'People'}
          />
        ))}
      </TabBar>
    </div>
  ),
};

export const TabBarWithBadges: Story = {
  render: () => (
    <div className="rounded-lg bg-surface-sunken px-2 py-5">
      <TabBar label="Main" className="mx-auto max-w-97.5">
        {sections.map((section) => (
          <TabBarItem
            key={section.label}
            href={`#${section.label.toLowerCase()}`}
            icon={section.icon}
            label={section.label}
            current={section.label === 'Home'}
            {...(section.label === 'Time off'
              ? { count: 3 }
              : section.label === 'Pay'
                ? { count: 1 }
                : {})}
          />
        ))}
      </TabBar>
    </div>
  ),
};

/** For a tablet, or a laptop too narrow for the sidebar. */
export const NavigationRail: Story = {
  render: () => (
    <div className="flex h-80 overflow-hidden rounded-lg border border-border">
      <NavRail
        label="Main"
        header={
          <>
            <ReachMark className="size-7" title="Reach" />
            <Button
              variant="subtle"
              startIcon={<Plus aria-hidden />}
              aria-label="New"
              className="rounded-control"
            />
          </>
        }
      >
        {sections.slice(0, 4).map((section) => (
          <TabBarItem
            key={section.label}
            href={`#${section.label.toLowerCase()}`}
            icon={section.icon}
            label={section.label}
            current={section.label === 'People'}
          />
        ))}
      </NavRail>
      <div className="flex flex-1 flex-col gap-2.5 bg-canvas p-5">
        <Skeleton className="h-4.5 w-2/5" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  ),
};
