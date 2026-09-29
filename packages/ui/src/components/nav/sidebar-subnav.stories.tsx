import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX, ReactNode } from 'react';

import { icons } from '../../icons';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbMenu,
  BreadcrumbSeparator,
} from '../breadcrumb/breadcrumb';
import { Skeleton } from '../feedback/feedback';
import { Kbd } from '../kbd/kbd';
import { KeyValues } from '../key-values/key-values';
import { List, ListItem } from '../list-item/list-item';
import { PageHeader, PageLayout, RailContext } from '../page-layout/page-layout';
import { MegaMenu } from './mega-menu';
import { Nav, NavItem, NavList, TertiaryNav } from './nav';

/** An area's six places: icon, name, what it holds, the phone's shorter line, a count. */
const places: readonly {
  readonly icon: ReactNode;
  readonly label: string;
  readonly description: string;
  readonly summary: string;
  readonly count?: number;
}[] = [
  {
    icon: <icons.overview />,
    label: 'Overview',
    description: 'Summary, your tasks, and what needs HR',
    summary: 'Your tasks and what needs HR',
  },
  {
    icon: <icons.people />,
    label: 'Directory',
    description: 'Everyone as a list, as cards, or as an org chart',
    summary: 'List, cards or org chart',
  },
  {
    icon: <icons.approve />,
    label: 'Approvals',
    description: 'Changes waiting for a decision',
    summary: '4 waiting for you',
    count: 4,
  },
  {
    icon: <icons.health />,
    label: 'Data health',
    description: 'Gaps, ID checks, duplicates and access requests',
    summary: 'Gaps, ID checks, duplicates',
    count: 6,
  },
  {
    icon: <icons.transfer />,
    label: 'Import & export',
    description: 'Move people data in and out, with one history',
    summary: 'Move data in and out',
  },
  {
    icon: <icons.analytics />,
    label: 'Insights',
    description: 'Analytics, with scheduled reports built in',
    summary: 'Analytics and reports',
  },
];

const href = (label: string) => `#${label.toLowerCase().replaceAll(' ', '-')}`;

/** Only what needs action: approvals are urgent, the rest a warning. */
function Count({ label, n }: { readonly label: string; readonly n: number }): JSX.Element {
  return (
    <Badge size="xs" variant="solid" tone={label === 'Approvals' ? 'danger' : 'warning'}>
      {n}
      <span className="sr-only"> need action</span>
    </Badge>
  );
}

/** The area's pages under its item, along the rule. */
function Pages({ current }: { readonly current: string }): JSX.Element {
  return (
    <NavList variant="ruled" aria-label="People pages">
      {places.map((p) => (
        <NavItem
          key={p.label}
          level={2}
          href={href(p.label)}
          current={p.label === current}
          {...(p.count === undefined ? {} : { badge: <Count label={p.label} n={p.count} /> })}
        >
          {p.label}
        </NavItem>
      ))}
    </NavList>
  );
}

/** The same places, as the collapsed rail's flyout. */
function Flyout({ current }: { readonly current?: string }): JSX.Element {
  return (
    <MegaMenu
      size="compact"
      title="People"
      shortcut={
        <>
          <Kbd>G</Kbd>
          <Kbd>P</Kbd>
        </>
      }
      footer={
        <>
          <icons.settings aria-hidden />
          <span>
            Fields and roles are in <b className="text-fg">Settings › People</b>
          </span>
        </>
      }
    >
      <Nav label="People">
        <NavList>
          {places.map((p) => (
            <NavItem
              key={p.label}
              level={2}
              href={href(p.label)}
              icon={p.icon}
              current={p.label === current}
              description={p.description}
              {...(p.count === undefined ? {} : { badge: <Count label={p.label} n={p.count} /> })}
            >
              {p.label}
            </NavItem>
          ))}
        </NavList>
      </Nav>
    </MegaMenu>
  );
}

/** A phone's People tab: the same places as 72pt rows you push from. */
function PlacesAsRows(): JSX.Element {
  return (
    <List aria-label="People pages">
      {places.map((p) => (
        <ListItem
          key={p.label}
          asChild
          chevron
          icon={p.icon}
          description={p.summary}
          {...(p.count === undefined ? {} : { trailing: <Count label={p.label} n={p.count} /> })}
        >
          <a href={href(p.label)}>{p.label}</a>
        </ListItem>
      ))}
    </List>
  );
}

/** At a desk one thing, under a finger another: the design draws both. */
function DeskOrPhone({
  desk,
  phone,
}: {
  readonly desk: ReactNode;
  readonly phone: ReactNode;
}): JSX.Element {
  return (
    <>
      <div className="touch:hidden">{desk}</div>
      <div className="hidden touch:block">{phone}</div>
    </>
  );
}

const panel = 'rounded-[1.125rem] bg-surface shadow-sm';

const meta: Meta = {
  title: 'Components/Sidebar sub-navigation',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A section’s pages, listed under the section in the sidebar: `NavItem` with a `subnav` of a `NavList variant="ruled"`, shown while `expanded`. Seven items at most; related tools become tabs on an umbrella page, and views of the same data a segmented control.',
          '',
          'Collapsed to a rail, the same pages are the item’s flyout (`flyoutSize="compact"` holding a compact `MegaMenu`); expanded, they are inline and nothing opens on hover. On a phone there is no rail: the area’s tab is the list, one 72pt row a page, with a line on what it holds.',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const ExpandedUnderItsParent: Story = {
  name: 'Expanded under its parent',
  render: () => (
    <DeskOrPhone
      desk={
        <Nav label="Areas" className={`w-62 p-3 ${panel}`}>
          <NavList>
            <NavItem href="#home" icon={<icons.home />}>
              Home
            </NavItem>
            <NavItem
              href="#people"
              icon={<icons.people />}
              current
              expanded
              subnav={<Pages current="Data health" />}
            >
              People
            </NavItem>
            <NavItem href="#settings" icon={<icons.settings />}>
              Settings
            </NavItem>
          </NavList>
        </Nav>
      }
      phone={<PlacesAsRows />}
    />
  ),
};

export const CollapsedRailWithAFlyout: Story = {
  name: 'Collapsed rail with a flyout',
  render: () => (
    <DeskOrPhone
      desk={
        <div className="flex items-start gap-2.5">
          {/* The rail as it stands, and the flyout its People item opens beside it. */}
          <RailContext value={{ collapsed: true }}>
            <Nav label="Areas" className={`w-16 p-2.5 ${panel}`}>
              <NavList>
                <NavItem href="#home" icon={<icons.home />}>
                  Home
                </NavItem>
                <NavItem href="#people" icon={<icons.people />} current>
                  People
                </NavItem>
                <NavItem href="#settings" icon={<icons.settings />}>
                  Settings
                </NavItem>
              </NavList>
            </Nav>
          </RailContext>
          <div className="w-85 max-w-full rounded-[1.375rem] bg-surface-raised p-2.5 shadow-xl">
            <Flyout current="Overview" />
          </div>
        </div>
      }
      phone={
        <p className="text-base text-fg-muted">
          On a phone there’s no rail. The People tab is the list.
        </p>
      }
    />
  ),
};

export const AnUmbrellaPage: Story = {
  name: 'An umbrella page',
  render: () => {
    const tabs = [
      { id: 'completeness', label: 'Completeness', count: 88 },
      { id: 'id-checks', label: 'ID checks', count: 3 },
      { id: 'duplicates', label: 'Duplicates', count: 2 },
      { id: 'access-requests', label: 'Access requests', shortLabel: 'Access', count: 1 },
    ].map((t) => ({ ...t, href: `#${t.id}` }));
    return (
      <PageHeader
        breadcrumb={
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
                    {
                      label: 'People',
                      items: places.map((p) => ({
                        href: href(p.label),
                        label: p.label,
                        icon: p.icon,
                        current: p.label === 'Data health',
                      })),
                    },
                    {
                      label: 'In Data health',
                      items: tabs.map((t) => ({
                        href: t.href,
                        label: t.label,
                        current: t.id === 'completeness',
                      })),
                    },
                  ]}
                />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbMenu
                  label="Completeness"
                  menuLabel="Data health tabs"
                  groups={[
                    {
                      label: 'Data health',
                      items: tabs.map((t) => ({
                        href: t.href,
                        label: t.label,
                        current: t.id === 'completeness',
                      })),
                    },
                  ]}
                />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Data health"
        tabs={
          <TertiaryNav
            label="Data health tabs"
            orientation="horizontal"
            variant="line"
            current="page"
            touchLayout="pills"
            activeId="completeness"
            items={tabs}
          />
        }
      />
    );
  },
  parameters: { layout: 'padded' },
};

export const CollapseAndExpand: Story = {
  name: 'Collapse and expand',
  render: () => (
    <DeskOrPhone
      desk={
        <div className="overflow-hidden rounded-lg border border-border">
          <PageLayout
            preset="sidebar"
            className="h-90 min-h-0"
            sidebarCollapse={{ mode: 'rail', defaultCollapsed: false }}
            sidebarHeader={
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name="Acme" size="md" shape="rounded" />
                <span
                  data-rail-label=""
                  className="truncate text-sm font-semibold group-data-[collapsed]/sidebar:hidden"
                >
                  Acme
                </span>
              </span>
            }
            sidebar={
              <Nav
                label="Areas"
                className="w-62 px-3.5 pt-2 group-data-[collapsed]/sidebar:w-auto group-data-[collapsed]/sidebar:p-2"
              >
                <NavList>
                  <NavItem href="#home" icon={<icons.home />}>
                    Home
                  </NavItem>
                  <NavItem
                    href="#people"
                    icon={<icons.people />}
                    current
                    expanded
                    subnav={<Pages current="Directory" />}
                    flyoutSize="compact"
                    flyout={<Flyout current="Directory" />}
                  >
                    People
                  </NavItem>
                </NavList>
              </Nav>
            }
            contentClassName="p-6"
          >
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          </PageLayout>
        </div>
      }
      phone={
        <p className="text-base text-fg-muted">
          Phones use the tab bar, so there’s nothing to collapse. On iPad the sidebar button sits at
          the top left of the navigation bar, as in the system apps.
        </p>
      }
    />
  ),
};

export const TheRules: Story = {
  name: 'The rules',
  render: () => (
    <KeyValues
      layout="aligned"
      labelWidth="8rem"
      className="max-w-2xl"
      items={[
        {
          label: 'How many',
          value: 'Seven items at most. Past that, group related tools under one umbrella item',
        },
        {
          label: 'Umbrella page',
          value: 'Its tools become tabs, each with its own count and its own URL',
        },
        {
          label: 'Views',
          value:
            'Different ways of seeing the same data (list, cards, chart) go in a segmented control, not the menu',
        },
        {
          label: 'Counts',
          value: 'On the item, the total that needs action. On each tab, its own count',
        },
      ]}
    />
  ),
};
