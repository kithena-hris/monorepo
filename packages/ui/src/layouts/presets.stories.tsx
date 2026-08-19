import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, CalendarDays, Home, Menu, Search, Settings, Users, Wallet } from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';

import { Avatar } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';
import { Button } from '../components/button/button';
import { Alert } from '../components/feedback/feedback';
import { Input } from '../components/input/input';
import { AutoGrid, Container, Stack } from '../components/layout/layout';
import { Money } from '../components/money/money';
import { Nav, NavGroup, NavItem, NavList, TertiaryNav } from '../components/nav/nav';
import {
  PageHeader,
  PageLayout,
  PageSection,
  Toolbar,
} from '../components/page-layout/page-layout';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/sheet/sheet';
import { Stat } from '../components/stat/stat';
import { Tabs, TabsList, TabsTrigger } from '../components/tabs/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/table/table';

const meta = {
  title: 'Layouts/Presets',
  component: PageLayout,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'Page skeletons, as named slots.',
          '',
          'Every screen in an HRIS is one of about five shapes. Written by hand, each of those five gets re-derived per module with slightly different sticky behaviour, slightly different scroll containers, and a different answer to "where does the safe-area padding go", and the product stops feeling like one product. This is the one place those answers live.',
          '',
          '### Why the slots are props',
          '',
          'A slot that is a prop is type-checked, cannot be nested in the wrong place, and cannot be silently dropped when someone wraps it in a fragment. The alternative: matching children by `displayName`: fails silently in exactly those three cases.',
          '',
          '### What the layout guarantees',
          '',
          '- **Exactly one scroll container**, `main`. A page with two scrollbars is a page where nobody can find the bottom.',
          '- **`header` and `bottomBar` are sticky** and do not scroll away.',
          '- **Safe-area insets** applied per edge: `pt-safe-top` on the header, `pb-safe-bottom` on the bottom bar, horizontal insets on the rails for a landscape phone.',
          '- **Landmarks.** One `<header>`, one `<nav>`, one `<main>`, one `<aside>`, one `<footer>`, so a screen-reader user can jump between them. This is the part that is easiest to get wrong by hand and the part nobody notices is missing.',
          '',
          '### The presets',
          '',
          '| Preset | Shape | For |',
          '| --- | --- | --- |',
          '| `stacked` | Header over content | Settings, a wizard, a record page |',
          '| `sidebar` | Navigation beside content | The default application shell |',
          '| `sidebar-aside` | Navigation, content, detail rail | A workspace with persistent context |',
          '| `focused` | Content only | Onboarding, a signature flow |',
          '| `canvas` | Content owns its own scrolling | A Kanban board, a calendar, a chart |',
          '',
          'Below `md` the sidebar is hidden: pair it with `bottomBar` or a `Sheet`, as the shell story does.',
          '',
          '### Collapsing',
          '',
          'Both rails can be put away. `sidebarCollapse` and `asideCollapse` are discriminated unions, controlled or uncontrolled:',
          '',
          '| `mode` | What is left |',
          '| --- | --- |',
          '| `rail` | The icons. Right for primary navigation, every destination stays reachable and stays in the same order, so the muscle memory survives. |',
          '| `hidden` | Nothing, plus a control pinned to the layout edge to bring it back. Right for a detail rail, where half-visible content is worse than none. |',
          '| `none` | Fixed. |',
          '',
          'The toggle carries `aria-expanded` and `aria-controls`, and its accessible name says which rail and which direction, "Hide navigation", never "Toggle". A `hidden` rail is also `inert` while away; a `rail` one is not, because it still holds every destination in plain sight.',
          '',
          '**⌘B / Ctrl+B** toggles the sidebar. The modifier follows the platform, and the binding reads `event.key` rather than `event.code` so a Dvorak or AZERTY layout gets the letter it is looking at.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    preset: {
      description: 'The shape. Chooses the grid, not the content.',
      control: 'inline-radio',
      options: ['stacked', 'sidebar', 'sidebar-aside', 'focused', 'canvas'],
      table: {
        type: { summary: "'stacked' | 'sidebar' | 'sidebar-aside' | 'focused' | 'canvas'" },
        defaultValue: { summary: 'stacked' },
        category: 'Shape',
      },
    },
    header: {
      description:
        "Sticky top bar. Rendered as the page's `<header>` landmark, with the top safe-area inset.",
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    banner: {
      description: 'Full-width strip under the header: an outage notice, an impersonation warning.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    sidebar: {
      description:
        'Primary navigation. Rendered as `<nav aria-label="Main">` with its own scroll container; hidden below `md`.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    aside: {
      description:
        'Secondary rail. Rendered as `<aside>`; hidden below `xl`, and only in `sidebar-aside`.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    footer: {
      description: 'Status strip in the page flow. Rendered as `<footer>`.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    bottomBar: {
      description:
        'Fixed bottom bar: mobile tabs, a sticky form action row. Padded for the home indicator.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    contentClassName: {
      description:
        'Classes for the scrolling `<main>`. **Page padding belongs here**, not on the root.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Appearance' },
    },
    contentLabel: {
      description:
        'Accessible name for `<main>`, for a page with more than one region worth naming.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    sidebarCollapse: {
      description:
        'Whether the sidebar can be put away, and what is left when it is. `{ mode: "rail" }` keeps the icons, `{ mode: "hidden" }` keeps nothing, `{ mode: "none" }` is fixed. Controlled with `collapsed` + `onCollapsedChange`, or uncontrolled with `defaultCollapsed`.',
      control: 'object',
      table: {
        type: {
          summary:
            "{ mode: 'none' } | { mode: 'rail' | 'hidden'; collapsed?; defaultCollapsed?; onCollapsedChange? }",
        },
        defaultValue: { summary: "{ mode: 'none' }" },
        category: 'Collapsing',
      },
    },
    asideCollapse: {
      description: 'The same, for the detail rail. `hidden` is usually right here.',
      control: 'object',
      table: {
        type: { summary: 'PageRailCollapse' },
        defaultValue: { summary: "{ mode: 'none' }" },
        category: 'Collapsing',
      },
    },
    sidebarShortcut: {
      description:
        'Letter bound with the platform modifier. `null` disables it. `b` is what every editor and issue tracker has settled on, which is the only reason to prefer it.',
      control: 'text',
      table: {
        type: { summary: 'string | null' },
        defaultValue: { summary: 'b' },
        category: 'Collapsing',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    preset: 'sidebar',
    sidebarCollapse: { mode: 'rail', defaultCollapsed: false },
    asideCollapse: { mode: 'hidden', defaultCollapsed: false },
  },
} satisfies Meta<typeof PageLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

const nav = [
  { id: 'home', label: 'Overview', icon: Home },
  { id: 'people', label: 'People', icon: Users },
  { id: 'leave', label: 'Time off', icon: CalendarDays, badge: '7' },
  { id: 'payroll', label: 'Payroll', icon: Wallet },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const people = [
  ['Grace Hopper', 'Principal Engineer', 'Platform', '1420000', 'Active'],
  ['Ada Lovelace', 'Staff Engineer', 'Platform', '1285000', 'On leave'],
  ['Radia Perlman', 'Engineering Manager', 'Payroll', '1360000', 'Active'],
  ['Barbara Liskov', 'Distinguished Engineer', 'Platform', '1580000', 'Active'],
] as const;

const tone = { Active: 'success', 'On leave': 'warning' } as const;

/**
 * Primary and secondary navigation, from the system's `Nav`. Inside a
 * collapsed `PageLayout` sidebar every item renders as an icon with a tooltip
 * without this component being told. It reads the state from context.
 */
function AppNav({ current = 'people' }: { current?: string }): JSX.Element {
  return (
    <Nav label="Main" className="p-2 lg:w-56">
      <NavList>
        {nav.map((item) => (
          <NavItem
            key={item.id}
            href="#"
            icon={<item.icon />}
            current={item.id === current}
            badge={
              item.badge ? (
                <Badge size="sm" tone="warning">
                  {item.badge}
                </Badge>
              ) : undefined
            }
          >
            {item.label}
          </NavItem>
        ))}

        {/* Secondary: the sections of the area you are already in. Collapsible,
            because a sidebar that lists every section of every area is a
            sidebar nobody reads. */}
        <NavGroup label="People" collapsible defaultOpen icon={<Users />}>
          <NavItem href="#" level={2} current>
            Directory
          </NavItem>
          <NavItem href="#" level={2}>
            Org chart
          </NavItem>
          <NavItem href="#" level={2}>
            Imports
          </NavItem>
          <NavItem href="#" level={2} badge={<Badge size="sm">3</Badge>}>
            Duplicates
          </NavItem>
        </NavGroup>

        <NavGroup label="Administration">
          <NavItem href="#" level={2}>
            Legal entities
          </NavItem>
          <NavItem href="#" level={2}>
            Permissions
          </NavItem>
        </NavGroup>
      </NavList>
    </Nav>
  );
}

function AppBar({ title = 'People' }: { title?: string }): JSX.Element {
  return (
    <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Open navigation"
            className="md:hidden"
            startIcon={<Menu />}
          />
        </SheetTrigger>
        <SheetContent side="left" size="sm">
          <SheetHeader>
            <SheetTitle>Acme HR</SheetTitle>
          </SheetHeader>
          <SheetBody className="px-0">
            <AppNav />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <span className="text-md font-semibold text-fg max-md:hidden">Acme HR</span>
      <span className="text-md font-semibold text-fg md:hidden">{title}</span>

      <div className="ms-auto flex items-center gap-2">
        <div className="hidden sm:block sm:w-56">
          <Input size="sm" startAdornment={<Search />} aria-label="Search" placeholder="Search" />
        </div>
        <Button size="sm" variant="ghost" aria-label="Notifications" startIcon={<Bell />} />
        <Avatar size="sm" name="Margaret Hamilton" />
      </div>
    </div>
  );
}

function DirectoryTable(): JSX.Element {
  return (
    <Table aria-label="People">
      <TableHeader>
        <TableRow>
          <TableHead sticky>Employee</TableHead>
          <TableHead>Team</TableHead>
          <TableHead>Status</TableHead>
          <TableHead numeric>Base salary</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {people.map(([name, role, team, salary, status]) => (
          <TableRow key={name} interactive>
            <TableCell sticky>
              <div className="flex items-center gap-2.5">
                <Avatar size="sm" name={name} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{name}</p>
                  <p className="truncate text-xs text-fg-muted">{role}</p>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-fg-muted">{team}</TableCell>
            <TableCell>
              <Badge tone={tone[status]} size="sm" dot>
                {status}
              </Badge>
            </TableCell>
            <TableCell numeric>
              <Money minorUnits={salary} currency="EUR" locale="en-IE" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MobileTabs(): JSX.Element {
  return (
    <nav aria-label="Main, compact" className="flex md:hidden">
      {nav.slice(0, 4).map((item) => (
        <a
          key={item.id}
          href="#"
          aria-current={item.id === 'people' ? 'page' : undefined}
          className={`flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 py-2 text-2xs ${
            item.id === 'people' ? 'text-accent-fg' : 'text-fg-muted'
          }`}
        >
          <item.icon className="size-5" aria-hidden />
          {item.label}
        </a>
      ))}
    </nav>
  );
}

const renderShell: NonNullable<Story['render']> = (args) => (
  <PageLayout
    {...args}
    header={<AppBar />}
    sidebar={<AppNav />}
    aside={
      <div className="w-72 space-y-3 p-4">
        <h2 className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Waiting on you
        </h2>
        {['Grace Hopper', 'Ada Lovelace', 'Katherine Johnson'].map((name) => (
          <div key={name} className="rounded-md border border-border p-3">
            <p className="text-base text-fg">{name}</p>
            <p className="text-sm text-fg-muted">Annual leave · 3 days</p>
          </div>
        ))}
      </div>
    }
    bottomBar={<MobileTabs />}
    contentClassName="p-4 sm:p-6"
  >
    <Stack gap={5}>
      <PageHeader
        title="People"
        description="912 active employees across 14 countries."
        meta={
          <Badge tone="success" size="sm" dot>
            Synced
          </Badge>
        }
        actions={
          <>
            <Button>Export</Button>
            <Button variant="primary">Add employee</Button>
          </>
        }
        tabs={
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="leave">On leave</TabsTrigger>
              <TabsTrigger value="offboarding">Offboarding</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <DirectoryTable />
    </Stack>
  </PageLayout>
);

export const Playground: Story = { render: renderShell };

export const Stacked: Story = {
  args: { preset: 'stacked' },
  parameters: {
    docs: {
      description: {
        story:
          'Header over content, no navigation rail. The right shape for a settings page or a record page reached from somewhere else, the back path is the breadcrumb, not a sidebar.',
      },
    },
  },
  render: (args) => (
    <PageLayout {...args} header={<AppBar title="Settings" />} contentClassName="p-4 sm:p-6">
      <Container size="md">
        <Stack gap={5}>
          <PageHeader
            title="Leave settings"
            description="Applies to every employee in Acme Iberia SL."
          />
          <PageSection
            surface
            title="Approvals"
            description="Who has to say yes, and when."
            actions={<Button size="sm">Reset</Button>}
          >
            <p className="text-sm text-fg-muted">
              Requests over 5 days need a second approval from People Ops.
            </p>
          </PageSection>
          <PageSection surface title="Accrual" description="How entitlement is earned.">
            <p className="text-sm text-fg-muted">
              1.92 days per month, accrued monthly in arrears, capped at 30.
            </p>
          </PageSection>
        </Stack>
      </Container>
    </PageLayout>
  ),
};

export const SidebarAndAside: Story = {
  name: 'Sidebar and aside',
  args: { preset: 'sidebar-aside' },
  parameters: {
    docs: {
      description: {
        story:
          'Three panes at desk sizes. The aside disappears below `xl` rather than squeezing the content, a 200px detail rail is not a detail rail. Watch the two rails drop out as the canvas narrows: `xl` first, then `md`.',
      },
    },
  },
  render: renderShell,
};

export const WithBanner: Story = {
  name: 'With a banner',
  args: { preset: 'sidebar' },
  parameters: {
    docs: {
      description: {
        story:
          'The banner slot sits under the header and scrolls with nothing. It is part of the page chrome. Reserve it for something true of the whole session: an impersonation warning, a read-only maintenance window, an expiring trial. Not for a form error.',
      },
    },
  },
  render: (args) => (
    <PageLayout
      {...args}
      header={<AppBar />}
      sidebar={<AppNav />}
      banner={
        <Alert
          tone="warning"
          title="You are viewing this as Grace Hopper"
          className="rounded-none border-x-0 border-t-0"
          action={<Button size="sm">Stop impersonating</Button>}
        >
          Every action you take is recorded against your own account, not hers.
        </Alert>
      }
      contentClassName="p-4 sm:p-6"
    >
      <Stack gap={5}>
        <PageHeader title="People" description="912 active employees." />
        <DirectoryTable />
      </Stack>
    </PageLayout>
  ),
};

export const WithToolbar: Story = {
  name: 'With a sticky toolbar',
  args: { preset: 'sidebar' },
  parameters: {
    docs: {
      description: {
        story: [
          'The toolbar sticks under the header while a long table scrolls, so the filters never leave.',
          '',
          '`role="toolbar"` is deliberately **not** set on it. That role implies one tab stop with arrow-key navigation between items: right for a formatting toolbar of icon buttons, wrong here, because a search field inside a roving-tabindex toolbar swallows the arrow keys the user needs for text.',
        ].join('\n'),
      },
    },
  },
  render: (args) => (
    <PageLayout {...args} header={<AppBar />} sidebar={<AppNav />} contentClassName="p-4 sm:p-6">
      <Stack gap={4}>
        <PageHeader title="People" description="912 active employees." />
        <Toolbar
          sticky
          search={
            <Input
              size="sm"
              startAdornment={<Search />}
              aria-label="Search people"
              placeholder="Search people"
            />
          }
          filters={
            <>
              <Button size="sm">Team</Button>
              <Button size="sm">Location</Button>
              <Button size="sm">Status</Button>
            </>
          }
          actions={
            <Button size="sm" variant="primary">
              Add
            </Button>
          }
        />
        <Stack gap={4}>
          {Array.from({ length: 6 }, (_, i) => (
            <DirectoryTable key={i} />
          ))}
        </Stack>
      </Stack>
    </PageLayout>
  ),
};

export const Focused: Story = {
  args: { preset: 'focused' },
  parameters: {
    docs: {
      description: {
        story:
          'No navigation at all, and a sticky action bar at the bottom. This is the shape for a flow the user must finish or abandon deliberately: onboarding, a signature, a termination checklist. Removing the navigation is the design: a half-completed termination is worse than an abandoned one.',
      },
    },
  },
  render: (args) => (
    <PageLayout
      {...args}
      header={
        <div className="flex h-14 items-center justify-between px-4">
          <span className="text-md font-semibold text-fg">Onboarding. Grace Hopper</span>
          <span className="text-sm text-fg-muted">Step 2 of 5</span>
        </div>
      }
      bottomBar={
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Button>Back</Button>
          <Button variant="primary">Continue</Button>
        </div>
      }
      contentClassName="p-4 sm:p-6"
    >
      <Container size="sm">
        <Stack gap={5}>
          <PageHeader
            size="md"
            title="Contract details"
            description="These become the employment record on the start date."
          />
          <AutoGrid minItemWidth="14rem" gap={4}>
            <Stat label="Start date" value="1 Sep 2026" />
            <Stat label="Contract" value="Permanent" />
            <Stat label="Entity" value="Acme Iberia SL" />
          </AutoGrid>
        </Stack>
      </Container>
    </PageLayout>
  ),
};

export const Canvas: Story = {
  args: { preset: 'canvas' },
  parameters: {
    docs: {
      description: {
        story:
          'The content owns its own scrolling, a board, a calendar, a chart. `main` does not scroll here, which is exactly what a horizontally scrolling board needs: two nested scroll containers on the same axis is how a flick ends up moving the wrong thing.',
      },
    },
  },
  render: function CanvasStory(args): JSX.Element {
    const [columns] = useState(['Applied', 'Phone screen', 'Onsite', 'Offer', 'Hired']);
    return (
      <PageLayout
        {...args}
        header={<AppBar title="Pipeline" />}
        sidebar={<AppNav current="people" />}
        contentClassName="flex flex-col"
      >
        <div className="shrink-0 p-4 pb-2">
          <PageHeader size="md" title="Hiring pipeline" description="8 candidates in flight." />
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
          {columns.map((column) => (
            <section
              key={column}
              aria-label={column}
              className="flex w-64 shrink-0 flex-col rounded-lg bg-surface-sunken p-3"
            >
              <h3 className="text-sm font-semibold text-fg">{column}</h3>
              <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
                {Array.from({ length: 3 }, (_, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-surface p-3 text-sm text-fg"
                  >
                    Candidate {i + 1}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </PageLayout>
    );
  },
};

function Note({ children }: { children: ReactNode }): JSX.Element {
  return <p className="text-sm text-fg-muted">{children}</p>;
}

export const PageHeaderAnatomy: Story = {
  name: 'PageHeader anatomy',
  args: { preset: 'stacked' },
  parameters: {
    docs: {
      description: {
        story:
          "`title` renders the page's `<h1>` and `PageSection` renders `<h2>`, so the document outline is a real outline. A page with no `h1`, or with three, is the most common heading-structure failure, and the `h1` is the first thing a screen-reader user lands on.",
      },
    },
  },
  render: (args) => (
    <PageLayout {...args} header={<AppBar title="Grace Hopper" />} contentClassName="p-4 sm:p-6">
      <Container size="md">
        <Stack gap={6}>
          <PageHeader
            title="Grace Hopper"
            description="Principal Engineer · Platform · Madrid · Started 4 March 2024"
            meta={
              <>
                <Badge tone="success" size="sm" dot>
                  Active
                </Badge>
                <Badge size="sm">Employee</Badge>
              </>
            }
            actions={
              <>
                <Button>Message</Button>
                <Button variant="primary">Edit</Button>
              </>
            }
          />
          <PageSection surface title="Employment" description="Effective 1 September 2026.">
            <Note>Staff Engineer, Platform. Full time, 40 hours.</Note>
          </PageSection>
          <PageSection surface title="Compensation" description="Next review 1 January 2027.">
            <Note>
              Base <Money minorUnits="14200000" currency="EUR" locale="en-IE" /> · bonus target 15%.
            </Note>
          </PageSection>
        </Stack>
      </Container>
    </PageLayout>
  ),
};

export const Collapsing: Story = {
  name: 'Collapsing the rails',
  args: {
    preset: 'sidebar-aside',
    sidebarCollapse: { mode: 'rail', defaultCollapsed: false },
    asideCollapse: { mode: 'hidden', defaultCollapsed: false },
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Hover the layout and both toggles fade in, one at the top of each rail. Or press **⌘B / Ctrl+B** for the sidebar.',
          '',
          'The two modes differ on purpose. The sidebar collapses to a **rail**: every destination is still there, in the same order, as an icon with a tooltip and a screen-reader label. Nothing is `inert`, because nothing is hidden. The aside collapses to **nothing**, a half-width detail panel is worse than none, and its reopen control is pinned to the layout edge, since a control inside a zero-width panel goes with it.',
          '',
          'The navigation does not know any of this. `Nav` reads the collapsed state from context, so a screen composes it once and it behaves in both states.',
          '',
          'Watch the width rather than the fade: it animates on the `normal` duration and the panel is `overflow-x-hidden` throughout, without which the labels spill across the content for the length of the transition.',
        ].join('\n'),
      },
    },
  },
  render: function CollapsingStory(args) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [asideCollapsed, setAsideCollapsed] = useState(false);

    return (
      <PageLayout
        {...args}
        sidebarCollapse={{
          mode: 'rail',
          collapsed: sidebarCollapsed,
          onCollapsedChange: setSidebarCollapsed,
        }}
        asideCollapse={{
          mode: 'hidden',
          collapsed: asideCollapsed,
          onCollapsedChange: setAsideCollapsed,
        }}
        header={<AppBar />}
        sidebar={<AppNav />}
        aside={
          <div className="w-72 space-y-3 p-4">
            <h2 className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
              Waiting on you
            </h2>
            {['Grace Hopper', 'Ada Lovelace', 'Katherine Johnson'].map((name) => (
              <div key={name} className="rounded-md border border-border p-3">
                <p className="text-base text-fg">{name}</p>
                <p className="text-sm text-fg-muted">Annual leave · 3 days</p>
              </div>
            ))}
          </div>
        }
        contentClassName="p-4 sm:p-6"
      >
        <Stack gap={5}>
          <PageHeader
            title="People"
            description="Both rails are controlled here, so the state can be persisted."
            actions={
              <>
                <Button
                  onClick={() => {
                    setSidebarCollapsed((current) => !current);
                  }}
                >
                  {sidebarCollapsed ? 'Show' : 'Hide'} navigation
                </Button>
                <Button
                  onClick={() => {
                    setAsideCollapsed((current) => !current);
                  }}
                >
                  {asideCollapsed ? 'Show' : 'Hide'} details
                </Button>
              </>
            }
          />
          <p aria-live="polite" className="text-sm text-fg-muted">
            Navigation {sidebarCollapsed ? 'collapsed to a rail' : 'expanded'} · details{' '}
            {asideCollapsed ? 'hidden' : 'visible'}
          </p>
          <DirectoryTable />
        </Stack>
      </PageLayout>
    );
  },
};

export const ThreeLevels: Story = {
  name: 'Three levels of navigation',
  args: { preset: 'sidebar-aside', sidebarCollapse: { mode: 'rail' } },
  parameters: {
    docs: {
      description: {
        story: [
          'The distinction is not decorative.',
          '',
          '| Level | What it lists | Where |',
          '| --- | --- | --- |',
          '| **Primary** | Top-level areas: People, Time off, Payroll | The sidebar |',
          '| **Secondary** | Sections of the current area: Directory, Org chart, Imports | Grouped under the area, collapsible |',
          '| **Tertiary** | Places *within this page*: the parts of the record on screen | The aside |',
          '',
          'A tertiary item does **not** navigate, it moves within the page. So it is an `<a href="#section">`, which keeps middle-click, "copy link" and the back button working, and it carries `aria-current="location"` rather than `"page"`: the page has not changed, the reader\'s position in it has. A screen reader says "current location", which is exactly the difference the reader needs.',
          '',
          'Which section is active stays with the caller, an `IntersectionObserver` over the headings, here a click. Putting a scroll listener inside the component would make every consumer pay for one.',
          '',
          'Collapse the sidebar and note what survives: primary items become icons, the secondary group becomes a rule, and the tertiary rail is untouched because it was never in the sidebar to begin with.',
        ].join('\n'),
      },
    },
  },
  render: function ThreeLevelStory(args) {
    const sections = [
      { id: 'employment', label: 'Employment' },
      { id: 'compensation', label: 'Compensation' },
      { id: 'tax', label: 'Tax and social security' },
      { id: 'bank', label: 'Bank details' },
      { id: 'documents', label: 'Documents', badge: <Badge size="sm">4</Badge> },
      { id: 'history', label: 'History' },
    ];
    const [active, setActive] = useState('compensation');

    return (
      <PageLayout
        {...args}
        header={<AppBar title="Grace Hopper" />}
        sidebar={<AppNav />}
        aside={
          <div className="w-64 p-4">
            <h2 className="mb-3 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
              On this page
            </h2>
            <TertiaryNav
              label="Sections of this record"
              items={sections}
              activeId={active}
              onSelect={setActive}
            />
          </div>
        }
        contentClassName="p-4 sm:p-6"
      >
        <Stack gap={5}>
          <PageHeader
            title="Grace Hopper"
            description="Principal Engineer · Platform · Madrid"
            meta={
              <Badge tone="success" size="sm" dot>
                Active
              </Badge>
            }
          />

          {/* The same tertiary nav, horizontally, for the width where the aside
              does not exist. One component, two orientations, not two
              components that drift apart. */}
          <div className="xl:hidden">
            <TertiaryNav
              label="Sections of this record"
              orientation="horizontal"
              items={sections}
              activeId={active}
              onSelect={setActive}
            />
          </div>

          {sections.map((section) => (
            <PageSection
              key={section.id}
              id={section.id}
              surface
              title={section.label}
              className={section.id === active ? 'ring-2 ring-accent' : undefined}
            >
              <p className="text-sm text-fg-muted">
                The {section.label.toLowerCase()} section of this record.
              </p>
            </PageSection>
          ))}
        </Stack>
      </PageLayout>
    );
  },
};
