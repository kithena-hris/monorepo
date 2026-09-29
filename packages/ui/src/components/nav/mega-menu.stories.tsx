import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChartColumn,
  CircleDashed,
  Download,
  FileClock,
  GitMerge,
  LayoutDashboard,
  Network,
  ScanFace,
  Settings,
  ShieldAlert,
  Upload,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Chip } from '../chip/chip';
import { Kbd } from '../kbd/kbd';
import { KeyValues } from '../key-values/key-values';
import { SearchField } from '../typed-fields/typed-fields';
import { MegaMenu } from './mega-menu';
import { Nav, NavGroup, NavItem, NavList } from './nav';

type Place = readonly [icon: ReactNode, label: string, text: string, count?: number];

const groups: readonly { label: string; places: readonly Place[] }[] = [
  {
    label: 'Workspace',
    places: [
      [
        <LayoutDashboard key="i" />,
        'Overview',
        'Your profile summary, pending tasks and reporting line.',
      ],
      [<Users key="i" />, 'Directory', 'Search, filter and view every record.'],
      [<Network key="i" />, 'Org chart', 'Who reports to whom, across the whole company.'],
      [<User key="i" />, 'My profile', 'Your personal and employment details.'],
      [<UserCheck key="i" />, 'Approvals', 'Changes awaiting review and decision.', 4],
    ],
  },
  {
    label: 'Records',
    places: [
      [
        <CircleDashed key="i" />,
        'Data completeness',
        'Records with required details outstanding.',
        88,
      ],
      [<ScanFace key="i" />, 'ID verification', 'Identifiers flagged for review.', 3],
      [<GitMerge key="i" />, 'Duplicate records', 'Potential duplicates to merge or dismiss.', 2],
      [<Upload key="i" />, 'Import', 'Create or update records in bulk from a spreadsheet.'],
      [<Download key="i" />, 'Export', 'Download data with a recorded purpose.'],
      [
        <ShieldAlert key="i" />,
        'Sensitive data access',
        'Request and audit access to unmasked values.',
      ],
    ],
  },
  {
    label: 'Insights',
    places: [
      [
        <ChartColumn key="i" />,
        'Workforce analytics',
        'Headcount, turnover and compensation trends.',
      ],
      [<FileClock key="i" />, 'Report schedules', 'Recurring reports delivered to each recipient.'],
    ],
  },
];

const href = (label: string) => `#${label.toLowerCase().replaceAll(' ', '-')}`;

function Menu({ current }: { readonly current?: string }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, places: g.places.filter((p) => p[1].toLowerCase().includes(needle)) }))
    .filter((g) => g.places.length > 0);
  return (
    <MegaMenu
      search={
        <SearchField
          size="sm"
          label="Jump to a page"
          placeholder="Jump to a page or a record"
          value={query}
          onValueChange={setQuery}
        />
      }
      recent={
        <>
          <Chip startIcon={<Avatar name="Adam Novak" size="xs" />}>Adam Novak</Chip>
          <Chip startIcon={<Upload />}>Import</Chip>
        </>
      }
      footer={
        <>
          <Settings aria-hidden />
          <span className="flex-1">
            Fields, roles and integrations live in <b className="text-fg">Settings › People</b>
          </span>
          <Kbd>G</Kbd>
          <Kbd>P</Kbd>
        </>
      }
    >
      <Nav label="People">
        <NavList columns={2}>
          {shown.map((g) => (
            <NavGroup key={g.label} label={g.label}>
              {g.places.map(([icon, label, text, count]) => (
                <NavItem
                  key={label}
                  level={2}
                  href={href(label)}
                  icon={icon}
                  current={label === current}
                  description={text}
                  badge={
                    count === undefined ? (
                      label === 'Org chart' ? (
                        <Badge size="sm" tone="accent">
                          New
                        </Badge>
                      ) : undefined
                    ) : (
                      <Badge
                        size="xs"
                        variant="solid"
                        tone={label === 'Approvals' ? 'danger' : 'warning'}
                      >
                        {count}
                        <span className="sr-only"> need action</span>
                      </Badge>
                    )
                  }
                >
                  {label}
                </NavItem>
              ))}
            </NavGroup>
          ))}
        </NavList>
      </Nav>
    </MegaMenu>
  );
}

const meta = {
  title: 'Components/Mega menu',
  component: MegaMenu,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A section’s full menu, opened by hovering or focusing a sidebar item: the content of a `NavItem` `flyout` with `flyoutSize="lg"`. Grouped destinations, each with an icon, a one-line description and a count when something needs attention.',
          '',
          'It opens on hover, on focus and →, and on a tap; ↑↓ move within a group, ←→ between groups, and ↵ opens. Counts are only for things that need action, never totals. On a phone the section’s menu is the tab itself: a grouped `List`.',
        ].join('\n'),
      },
    },
  },
  args: { children: null },
} satisfies Meta<typeof MegaMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <div className="max-w-[51.25rem] rounded-xl bg-surface-raised p-5 shadow-lg">
      <Menu />
    </div>
  ),
};

export const AnItem: Story = {
  name: 'An item',
  render: () => (
    <Nav label="Examples" className="max-w-sm">
      <NavList>
        <NavItem
          level={2}
          href="#directory"
          icon={<Users />}
          description="Search, filter and view every record."
        >
          Directory
        </NavItem>
        <NavItem
          level={2}
          href="#approvals"
          icon={<UserCheck />}
          description="Changes awaiting review and decision."
          badge={
            <Badge size="xs" variant="solid" tone="danger">
              4<span className="sr-only"> need action</span>
            </Badge>
          }
        >
          Approvals
        </NavItem>
        <NavItem
          level={2}
          href="#completeness"
          current
          icon={<CircleDashed />}
          description="Records missing required details."
          badge={
            <Badge size="xs" variant="solid" tone="warning">
              88<span className="sr-only"> need action</span>
            </Badge>
          }
        >
          Data completeness
        </NavItem>
      </NavList>
    </Nav>
  ),
};

export const InTheSidebar: Story = {
  name: 'In the sidebar',
  render: () => (
    <Nav label="Areas" className="w-60">
      <NavList>
        <NavItem
          href="#people"
          icon={<Users />}
          flyoutSize="lg"
          flyout={<Menu current="Directory" />}
        >
          People
        </NavItem>
      </NavList>
    </Nav>
  ),
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('a[href="#people"]')?.focus();
  },
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
          label: 'Opens',
          value: 'Hover, focus and →, or a tap. A click goes to the section’s first page',
        },
        { label: 'Closes', value: 'The pointer leaves, Esc, or a click outside' },
        { label: 'Keyboard', value: '↑↓ within a group, ←→ between groups, ↵ opens' },
        { label: 'Counts', value: 'Only for things that need action, never totals' },
      ]}
    />
  ),
};
