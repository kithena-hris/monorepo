import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, House, Search, Users, Wallet } from 'lucide-react';
import type { JSX } from 'react';

import { Avatar } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';
import { Button } from '../components/button/button';
import { Card } from '../components/card/card';
import { Input } from '../components/input/input';
import { AutoGrid, Container, Inline, Stack } from '../components/layout/layout';
import { Money } from '../components/money/money';
import { Nav, NavItem, NavList } from '../components/nav/nav';
import { PageHeader, PageLayout } from '../components/page-layout/page-layout';
import { Stat } from '../components/stat/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/table/table';
import { breakpointQuery, useBreakpoint, useCoarsePointer } from '../lib/use-media-query';

const meta = {
  title: 'Foundations/Responsive',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'How this system behaves from a 375px iPhone to a 4K television.',
          '',
          '### The device matrix',
          '',
          'Use the **viewport** toolbar to switch between iPhone SE, iPhone 15 Pro and Pro Max, iPad mini and Pro in both orientations, laptop, desktop and 1080p/4K television. Use the **platform** toolbar to declare a TV, and the **density** toolbar for compact or spacious rows.',
          '',
          '### Four mechanisms, in the order you should reach for them',
          '',
          '**1. Intrinsic sizing, no query at all.** `AutoGrid` reflows on `minmax(min(w, 100%), 1fr)`; `Inline` wraps; text truncates. Most responsive behaviour needs nothing else, and this layer works in a sidebar as well as in a window.',
          '',
          '**2. Container queries.** A `Stat` tile is `@container`, so it steps its type down in a narrow column while the viewport is unchanged. This is what a breakpoint cannot express.',
          '',
          '**3. Container queries for the skeleton too.** Where the navigation lives, whether a rail is beside or below, is decided by the width `PageLayout` was given (`@3xl/page`, 48rem), not by the window. A shell inside a 390px phone preview on a 2560px monitor is a phone shell. Viewport breakpoints (`xs 416 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 · 3xl 1920 · 4xl 2560`) remain for the rare page that genuinely is the window.',
          '',
          '**4. Input and platform.** `touch:` asks whether the pointer is coarse; `tv:` asks what the app declared. Neither is a width. An iPad Pro in landscape is 1366px wide and is still a finger.',
          '',
          '### Density is a property of the pointer',
          '',
          'A `size="md"` control is 36px under a mouse and 44px under a thumb, because `@media (pointer: coarse)` re-points the density tokens, not because a screen somewhere passed a different prop. On a declared television the same token goes to 52px and the root font scales 1.5×, which moves the entire type scale, every control height and every gap together.',
          '',
          '### Safe areas',
          '',
          '`pb-safe-bottom` on a sticky action bar is the difference between a working submit button and one under the iPhone home indicator. In landscape the insets are horizontal instead, which is why `Container` pads with `max(1rem, env(safe-area-inset-left))`.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const people = [
  ['Grace Hopper', 'Principal Engineer', 'Platform', 'Madrid', '1420000', 'Active'],
  ['Ada Lovelace', 'Staff Engineer', 'Platform', 'Berlin', '1285000', 'On leave'],
  ['Radia Perlman', 'Engineering Manager', 'Payroll', 'Dublin', '1360000', 'Active'],
  ['Barbara Liskov', 'Distinguished Engineer', 'Platform', 'Madrid', '1580000', 'Active'],
  ['Katherine Johnson', 'Data Analyst', 'People Ops', 'Lisbon', '890000', 'Offboarding'],
] as const;

const tone = { Active: 'success', 'On leave': 'warning', Offboarding: 'neutral' } as const;

export const WhatChangesWhere: Story = {
  name: 'What changes, and where',
  parameters: {
    docs: {
      description: {
        story:
          'A live readout. Resize the canvas, or switch viewport and platform in the toolbar, and watch which questions change answers. Note that pointer type and viewport width are independent: an iPad Pro landscape is wider than a laptop and is still a finger.',
      },
    },
  },
  render: function ProbeStory() {
    const coarse = useCoarsePointer();
    // Called one by one rather than in a loop: hook order has to be static,
    // and a `.map` over a list, even a constant one: is the shape that stops
    // being static the first time someone makes the list a prop.
    const breakpoints = [
      { name: 'xs', query: breakpointQuery.xs, active: useBreakpoint('xs') },
      { name: 'sm', query: breakpointQuery.sm, active: useBreakpoint('sm') },
      { name: 'md', query: breakpointQuery.md, active: useBreakpoint('md') },
      { name: 'lg', query: breakpointQuery.lg, active: useBreakpoint('lg') },
      { name: 'xl', query: breakpointQuery.xl, active: useBreakpoint('xl') },
      { name: '2xl', query: breakpointQuery['2xl'], active: useBreakpoint('2xl') },
      { name: '3xl', query: breakpointQuery['3xl'], active: useBreakpoint('3xl') },
    ];

    return (
      <div className="min-h-screen bg-canvas p-6">
        <Container size="md">
          <Stack gap={4}>
            <Card padded>
              <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                Pointer
              </p>
              <p className="mt-1 text-md text-fg">
                {coarse ? 'Coarse: controls are on the 44px floor' : 'Fine: controls are compact'}
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                From <code className="font-mono text-xs">@media (pointer: coarse)</code>, which is
                the question that actually determines hit area.
              </p>
            </Card>

            <Card padded>
              <p className="mb-3 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                Breakpoints
              </p>
              <div className="space-y-1.5">
                {breakpoints.map((bp) => (
                  <div key={bp.name} className="flex items-center gap-3">
                    <Badge tone={bp.active ? 'success' : 'neutral'} size="sm" dot>
                      {bp.name}
                    </Badge>
                    <code className="font-mono text-2xs text-fg-subtle">{bp.query}</code>
                  </div>
                ))}
              </div>
            </Card>

            <Card padded>
              <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                Control heights, live
              </p>
              <Inline gap={2} className="mt-3">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
              </Inline>
              <p className="mt-2 text-sm text-fg-muted">
                These are density tokens, not per-component constants. Switch the platform toolbar
                to Television and every one of them grows together, along with the type.
              </p>
            </Card>
          </Stack>
        </Container>
      </div>
    );
  },
};

export const TableOrList: Story = {
  name: 'A table on a phone',
  parameters: {
    docs: {
      description: {
        story: [
          'Two honest answers to the same problem, and one dishonest one.',
          '',
          '**Scroll (top).** The table stays a table: header association, column order and the ability to compare two rows all survive. The identity column is pinned, so the numbers never become anonymous. This is the default, and it is the right default for anything anyone will compare.',
          '',
          '**A list (bottom).** For a directory read one person at a time, a list is genuinely better, so render a list, with list semantics. What this system will not do is transform a `<table>` into cards with CSS, which produces markup that claims to be tabular and behaves like a stack.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <div className="min-h-screen space-y-8 bg-canvas p-4">
      <section className="space-y-2">
        <h3 className="text-md font-semibold text-fg">Scrolling table, pinned identity column</h3>
        <p className="max-w-2xl text-sm text-fg-muted">
          Narrow the canvas below 640px and drag the table sideways, the name column stays put. The
          container is focusable, so it can also be scrolled from the keyboard.
        </p>
        <Table aria-label="People, scrolling" stickyHeader containerClassName="max-h-72">
          <TableHeader>
            <TableRow>
              <TableHead sticky>Employee</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead numeric>Base salary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map(([name, role, team, location, salary, status]) => (
              <TableRow key={name}>
                <TableCell sticky className="font-medium">
                  {name}
                </TableCell>
                <TableCell className="text-fg-muted">{role}</TableCell>
                <TableCell className="text-fg-muted">{team}</TableCell>
                <TableCell className="text-fg-muted">{location}</TableCell>
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
      </section>

      <section className="space-y-2">
        <h3 className="text-md font-semibold text-fg">The same data as a list</h3>
        <p className="max-w-2xl text-sm text-fg-muted">
          A real <code className="font-mono text-xs">&lt;ul&gt;</code>, not a table pretending. Each
          row is one target, comfortably over 44px.
        </p>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {people.map(([name, role, team, location, salary, status]) => (
            <li key={name} className="flex min-h-tap items-center gap-3 p-3">
              <Avatar size="sm" name={name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-fg">{name}</p>
                <p className="truncate text-sm text-fg-muted">
                  {role} · {team} · {location}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base tabular-nums text-fg">
                  <Money minorUnits={salary} currency="EUR" locale="en-IE" />
                </p>
                <Badge tone={tone[status]} size="sm" dot className="mt-0.5">
                  {status}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  ),
};

/*
 * The device matrix, drawn. Each frame holds the shell at that device's
 * shape: a phone gets the large title and the floating tab bar, a tablet an
 * icon rail and two columns, a laptop the sidebar and a detail rail, a desk the
 * sidebar with the content stopped at a measure and centred. Illustrations, so
 * they are `aria-hidden` and built from plain blocks.
 */
const devices = [
  { kind: 'Phone', w: 150, h: 300, r: 24, shape: 'phone' },
  { kind: 'Tablet', w: 260, h: 340, r: 20, shape: 'tablet' },
  { kind: 'Laptop', w: 380, h: 250, r: 10, shape: 'laptop' },
  { kind: 'Desktop', w: 480, h: 290, r: 8, shape: 'desktop' },
] as const;

type DeviceShape = (typeof devices)[number]['shape'];

function Rail({ width }: { width: string }): JSX.Element {
  return <span className={`shrink-0 border-e border-border bg-surface ${width}`} />;
}

function MiniShell({ shape }: { shape: DeviceShape }): JSX.Element {
  if (shape === 'phone') {
    return (
      <div className="relative size-full bg-canvas px-2.5 pt-5">
        <span className="block h-3 w-1/2 rounded-xs bg-surface-active" />
        <div className="mt-2 flex flex-col gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-6 rounded-xs bg-surface" />
          ))}
        </div>
        <span className="absolute inset-x-2 bottom-2 h-6 rounded-full border border-glass-line bg-glass shadow-sm" />
      </div>
    );
  }
  if (shape === 'tablet') {
    return (
      <div className="flex size-full bg-canvas">
        <Rail width="w-9" />
        <div className="grid flex-1 grid-cols-2 content-start gap-1.5 p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-8 rounded-xs bg-surface" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex size-full bg-canvas">
      <Rail width={shape === 'laptop' ? 'w-17' : 'w-20'} />
      <div className={`flex flex-1 p-2.5 ${shape === 'desktop' ? 'justify-center' : ''}`}>
        <div className={`flex flex-col gap-1 ${shape === 'desktop' ? 'w-64' : 'w-full'}`}>
          {Array.from({ length: shape === 'desktop' ? 10 : 8 }, (_, i) => (
            <span key={i} className="h-4 rounded-xs bg-surface" />
          ))}
        </div>
      </div>
      {shape === 'laptop' ? (
        <span className="w-22 shrink-0 border-s border-border bg-surface" />
      ) : null}
    </div>
  );
}

export const Devices: Story = {
  name: 'One shell, four devices',
  parameters: {
    docs: {
      description: {
        story:
          'One shell at four shapes. The phone drops the rail for a floating tab bar and sets the title large; the tablet keeps the rail as icons and goes to two columns; the laptop labels the sidebar and puts the detail beside the list; the desk stops the content at a measure and centres it. The live version of the same shell is the next story.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-end justify-center gap-5 bg-canvas p-6">
      {devices.map((device) => (
        <figure key={device.kind} className="flex max-w-full flex-col items-center gap-2.5">
          <div
            aria-hidden
            className="max-w-full bg-invert p-1.5 shadow-md"
            style={{ width: device.w, height: device.h, borderRadius: device.r + 6 }}
          >
            <div className="size-full overflow-hidden" style={{ borderRadius: device.r }}>
              <MiniShell shape={device.shape} />
            </div>
          </div>
          <figcaption className="text-xs font-semibold text-fg-muted">{device.kind}</figcaption>
        </figure>
      ))}
    </div>
  ),
};

const shellNav = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'people', label: 'People', icon: Users },
  { id: 'leave', label: 'Time off', icon: CalendarDays },
  { id: 'payroll', label: 'Payroll', icon: Wallet },
];

export const AppShell: Story = {
  name: 'The same shell, live',
  parameters: {
    docs: {
      description: {
        story: [
          'The same screen at every size, built from `PageLayout` and `Nav` rather than drawn by hand. Compare the desk copy with the phone beside it:',
          '',
          '- **Phone**: the top bar is glass, the title is set large under it, and the navigation is a glass tab bar floating over the content, clear of the home indicator.',
          '- **Tablet**: the sidebar appears once the layout itself is 48rem wide, a container width, so a phone preview on a wide monitor still gets the phone.',
          '- **Desktop**: a labelled sidebar; the stats reflow to four across on their own.',
          '- **Television** (set platform to Television): everything scales 1.5×, controls grow to 52px, and focus gets a ring with a halo you can see across a room.',
          '',
          'Nothing here asks the window how wide it is.',
        ].join('\n'),
      },
    },
  },
  render: function ShellStory() {
    return (
      <PageLayout
        preset="sidebar"
        header={
          <div className="flex h-14 items-center gap-3 px-4 touch:h-12 touch:px-3">
            <span className="font-display text-md font-bold tracking-tight text-fg @max-3xl/page:hidden">
              Acme HR
            </span>
            <div className="ms-auto flex items-center gap-2">
              <div className="hidden @2xl/page:block @2xl/page:w-56">
                <Input
                  size="sm"
                  startAdornment={<Search />}
                  aria-label="Search people"
                  placeholder="Search"
                />
              </div>
              <Avatar size="sm" name="Margaret Hamilton" />
            </div>
          </div>
        }
        sidebar={
          <Nav label="Main" className="w-56 p-2">
            <NavList>
              {shellNav.map((item) => (
                <NavItem key={item.id} href="#" icon={<item.icon />} current={item.id === 'people'}>
                  {item.label}
                </NavItem>
              ))}
            </NavList>
          </Nav>
        }
        bottomBar={
          <nav aria-label="Main, compact" className="flex">
            {shellNav.map((item) => (
              <a
                key={item.id}
                href="#"
                aria-current={item.id === 'people' ? 'page' : undefined}
                className={`flex min-h-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-2xs font-semibold touch:min-h-tap ${
                  item.id === 'people' ? 'bg-accent-subtle text-accent-fg' : 'text-fg-muted'
                }`}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </a>
            ))}
          </nav>
        }
        bottomBarVariant="floating"
        bottomBarClassName="@3xl/page:hidden"
        contentClassName="p-6 touch:p-4"
      >
        <Stack gap={4}>
          <PageHeader title="People" description="912 people across 14 countries." />
          <AutoGrid minItemWidth="13rem" gap={3}>
            <Stat
              label="Headcount"
              value="912"
              delta="+18"
              deltaLabel="this quarter"
              direction="up"
              sentiment="positive"
            />
            <Stat
              label="Monthly payroll"
              value={<Money minorUnits="98345000" currency="EUR" locale="en-IE" />}
              delta="+2.1%"
              deltaLabel="vs July"
              direction="up"
              sentiment="neutral"
            />
            <Stat
              label="Pending approvals"
              value="7"
              delta="+3"
              deltaLabel="since Monday"
              direction="up"
              sentiment="negative"
            />
            <Stat
              label="On leave today"
              value="23"
              delta="flat"
              deltaLabel="vs yesterday"
              direction="flat"
            />
          </AutoGrid>

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
              {people.map(([name, role, team, , salary, status]) => (
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
        </Stack>
      </PageLayout>
    );
  },
};

export const TenFootUI: Story = {
  name: 'Television',
  parameters: {
    docs: {
      description: {
        story: [
          'Set **platform → Television** in the toolbar and **viewport → TV 1080p**, then press Tab.',
          '',
          'Three things change, and only three:',
          '',
          '1. The root font scales 1.5×, which moves the whole rem-based system: type, control heights, gaps, in one step.',
          '2. Controls grow to a 52px minimum, because the pointer is a focus ring and not a cursor.',
          '3. Focus gets a 4px ring plus a halo, and it applies to `:focus` rather than `:focus-visible`, a remote produces no pointer events, so every focus is a keyboard focus.',
          '',
          'This is an attribute the app declares, not a media query. `1920px wide` describes a desk monitor as often as a television, and no media feature separates them reliably.',
        ].join('\n'),
      },
    },
  },
  render: function TvStory(): JSX.Element {
    return (
      <div className="min-h-screen bg-canvas p-8">
        <Container size="xl">
          <Stack gap={6}>
            <div>
              <h2 className="text-2xl font-semibold text-fg">Today at Acme</h2>
              <p className="mt-1 text-fg-muted">
                23 people are away · 7 approvals waiting · payroll closes in 4 days
              </p>
            </div>

            <AutoGrid minItemWidth="18rem" gap={6}>
              <Stat
                label="Headcount"
                value="912"
                delta="+18"
                deltaLabel="this quarter"
                direction="up"
                sentiment="positive"
              />
              <Stat
                label="On leave today"
                value="23"
                delta="+4"
                deltaLabel="vs yesterday"
                direction="up"
                sentiment="neutral"
              />
              <Stat
                label="Pending approvals"
                value="7"
                delta="+3"
                deltaLabel="since Monday"
                direction="up"
                sentiment="negative"
              />
            </AutoGrid>

            <Card padded>
              <p className="mb-4 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                Tab through these
              </p>
              <Inline gap={3}>
                <Button variant="primary">Approve all</Button>
                <Button>Review queue</Button>
                <Button variant="ghost">Dismiss</Button>
              </Inline>
            </Card>
          </Stack>
        </Container>
      </div>
    );
  },
};
