import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, Home, Menu, Search, Users, Wallet } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Avatar } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';
import { Button } from '../components/button/button';
import { Card } from '../components/card/card';
import { Input } from '../components/input/input';
import { AutoGrid, Container, Inline, Stack } from '../components/layout/layout';
import { Money } from '../components/money/money';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/sheet/sheet';
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
          '**3. Viewport breakpoints.** For the page skeleton only, where the navigation lives, whether a rail is beside or below. `xs 416 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 · 3xl 1920 · 4xl 2560`.',
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

export const AppShell: Story = {
  name: 'One shell, four devices',
  parameters: {
    docs: {
      description: {
        story: [
          'The same screen at every size. Switch viewport in the toolbar:',
          '',
          '- **Phone**: bottom tab bar, padded for the home indicator; the filter row becomes a sheet; actions go full width.',
          '- **Tablet**, an icon rail appears; the grid goes to two columns; the table stops scrolling.',
          '- **Desktop**, a labelled sidebar; three or four columns; the detail rail sits beside the content.',
          '- **Television** (set platform to Television): everything scales 1.5×, controls grow to 52px, and focus gets a ring with a halo you can see across a room. Tab through it and watch the focus travel.',
          '',
          'The navigation is the only thing keyed to a breakpoint. Everything else here is intrinsic.',
        ].join('\n'),
      },
    },
  },
  render: function ShellStory() {
    const [tab, setTab] = useState('people');
    const nav = [
      { id: 'home', label: 'Overview', icon: Home },
      { id: 'people', label: 'People', icon: Users },
      { id: 'leave', label: 'Time off', icon: CalendarDays },
      { id: 'payroll', label: 'Payroll', icon: Wallet },
    ];

    return (
      <div className="flex min-h-screen bg-canvas">
        {/* Sidebar: icons from md, labels from lg. Hidden entirely on a phone,
            where the bottom bar carries navigation instead. */}
        <nav
          aria-label="Main"
          className="hidden shrink-0 border-r border-border bg-surface md:block md:w-16 lg:w-56"
        >
          <div className="flex h-14 items-center justify-center border-b border-border lg:justify-start lg:px-4">
            <span className="text-md font-semibold text-fg max-lg:hidden">Acme HR</span>
            <span className="text-md font-semibold text-fg lg:hidden">A</span>
          </div>
          <ul className="p-2">
            {nav.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                  }}
                  aria-current={tab === item.id ? 'page' : undefined}
                  className={`flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-base transition-colors lg:justify-start ${
                    tab === item.id
                      ? 'bg-accent-subtle text-accent-fg'
                      : 'text-fg-muted hover:bg-surface-hover'
                  } max-lg:justify-center`}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  <span className="max-lg:sr-only">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 pt-safe-top">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Menu"
                  className="md:hidden"
                  startIcon={<Menu />}
                />
              </SheetTrigger>
              <SheetContent side="left" size="sm">
                <SheetHeader>
                  <SheetTitle>Acme HR</SheetTitle>
                </SheetHeader>
                <SheetBody>
                  <ul className="space-y-1">
                    {nav.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setTab(item.id);
                          }}
                          className="flex min-h-tap w-full items-center gap-3 rounded-md px-3 text-base text-fg hover:bg-surface-hover"
                        >
                          <item.icon className="size-4" aria-hidden />
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </SheetBody>
              </SheetContent>
            </Sheet>

            <h1 className="text-md font-semibold text-fg">People</h1>
            <div className="ms-auto flex items-center gap-2">
              <div className="hidden sm:block sm:w-56">
                <Input
                  size="sm"
                  startAdornment={<Search />}
                  aria-label="Search people"
                  placeholder="Search"
                />
              </div>
              <Avatar size="sm" name="Margaret Hamilton" />
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
            <Stack gap={4}>
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
          </main>

          {/* Bottom tab bar: phones only, padded for the home indicator. */}
          <nav
            aria-label="Main, compact"
            className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface pb-safe-bottom md:hidden"
          >
            {nav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                }}
                aria-current={tab === item.id ? 'page' : undefined}
                className={`flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 py-2 text-2xs ${
                  tab === item.id ? 'text-accent-fg' : 'text-fg-muted'
                }`}
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
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
