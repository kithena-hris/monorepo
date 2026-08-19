import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronRight, Folder, Search, Users } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Avatar } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/breadcrumb/breadcrumb';
import { Button } from '../components/button/button';
import { EmptyState } from '../components/feedback/feedback';
import { Input } from '../components/input/input';
import { Stack } from '../components/layout/layout';
import { ListDetail } from '../components/list-detail/list-detail';
import { Money } from '../components/money/money';
import { PageHeader, PageLayout, PageSection } from '../components/page-layout/page-layout';
import { Separator } from '../components/separator/separator';
import { Timeline, TimelineItem } from '../components/timeline/timeline';

const meta = {
  title: 'Layouts/Hierarchical',
  component: ListDetail,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'A list, and the thing you picked from it, at every width.',
          '',
          '### One component, two interaction models',
          '',
          'Because the device forces them to differ:',
          '',
          '- **Wide.** Both panes are visible. Selecting a row changes the right pane; the list keeps its scroll position and its filters. Nothing navigates.',
          '- **Narrow.** There is only room for one, so the detail *replaces* the list and a back control returns to it. This is a push, and it has to behave like one.',
          '',
          'Resize the canvas across 1024px, or switch the viewport toolbar between a desktop and an iPhone, to see the same component do both.',
          '',
          '### The two parts that are usually wrong',
          '',
          '**Focus.** On the narrow path the content is replaced without a route change, so nothing tells assistive tech the page changed. Focus is moved to the detail pane on open and back to the list on close, the behaviour a real navigation would have given for free. Without it, a screen-reader user taps a row and hears nothing at all. Try it: narrow the canvas, then use Tab and Enter only.',
          '',
          '**The hidden pane.** It stays *mounted*, so scroll position, virtualisation state and any in-flight edit survive going back. That is the entire reason to use this instead of two routes. But mounted-and-hidden is still reachable by Tab and by a screen reader unless it is marked `inert`, and `inert` must apply **only** below the split. Setting it whenever something is selected makes a perfectly visible list unfocusable on a desktop, which is the bug most hand-rolled versions ship.',
          '',
          '### When not to use it',
          '',
          'If the detail deserves a URL that someone will paste into Slack, it deserves a route. This layout is for a queue you work through, not for a record you link to.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    list: {
      description: 'The list pane. Owns its own scrolling.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    detail: {
      description: 'The detail pane. `null` falls back to `emptyDetail` at wide sizes.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    emptyDetail: {
      description: 'Shown at wide sizes when nothing is selected. Say what picking a row will do.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Slots' },
    },
    selected: {
      description:
        'Whether something is selected. Drives the narrow-screen push and the focus move.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    onBack: {
      description: 'Called by the back control. **Required** for the narrow path to be escapable.',
      control: false,
      table: { type: { summary: '() => void' }, category: 'State' },
    },
    backLabel: {
      description:
        'Text on the back control. Name the destination, "Back to requests", not "Back".',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Back to the list' },
        category: 'Content',
      },
    },
    listWidth: {
      description: 'Width of the list pane at wide sizes.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: '22rem' },
        category: 'Appearance',
      },
    },
    splitFrom: {
      description: 'The width at which both panes fit. Below it, the layout pushes.',
      control: 'inline-radio',
      options: ['md', 'lg', 'xl'],
      table: {
        type: { summary: "'md' | 'lg' | 'xl'" },
        defaultValue: { summary: 'lg' },
        category: 'Appearance',
      },
    },
    listLabel: {
      description: 'Accessible name for the list region.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'List' },
        category: 'Accessibility',
      },
    },
    detailLabel: {
      description:
        'Accessible name for the detail region. This is what focus lands on after a push.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Details' },
        category: 'Accessibility',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    selected: false,
    listWidth: '22rem',
    splitFrom: 'lg',
    backLabel: 'Back to requests',
    listLabel: 'Approval queue',
    detailLabel: 'Request details',
    list: null,
  },
} satisfies Meta<typeof ListDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

interface Request {
  id: string;
  name: string;
  kind: string;
  days: number;
  from: string;
  balanceAfter: number;
  impactMinor?: string;
}

const requests: Request[] = [
  {
    id: 'r1',
    name: 'Grace Hopper',
    kind: 'Annual leave',
    days: 3,
    from: '2026-09-14',
    balanceAfter: 12,
  },
  {
    id: 'r2',
    name: 'Ada Lovelace',
    kind: 'Parental leave',
    days: 20,
    from: '2026-10-01',
    balanceAfter: 18,
  },
  {
    id: 'r3',
    name: 'Katherine Johnson',
    kind: 'Unpaid leave',
    days: 10,
    from: '2026-10-01',
    balanceAfter: 4,
    impactMinor: '-142000',
  },
  {
    id: 'r4',
    name: 'Radia Perlman',
    kind: 'Sick leave',
    days: 2,
    from: '2026-08-11',
    balanceAfter: 9,
  },
  {
    id: 'r5',
    name: 'Barbara Liskov',
    kind: 'Annual leave',
    days: 5,
    from: '2026-12-22',
    balanceAfter: 1,
  },
  {
    id: 'r6',
    name: 'Margaret Hamilton',
    kind: 'Annual leave',
    days: 1,
    from: '2026-08-28',
    balanceAfter: 16,
  },
];

function RequestList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const visible = requests.filter((request) =>
    `${request.name} ${request.kind}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <Input
          size="sm"
          startAdornment={<Search />}
          aria-label="Search requests"
          placeholder="Search requests"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>
      {visible.length === 0 ? (
        <p className="p-6 text-center text-sm text-fg-muted">Nothing matches “{query}”.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {visible.map((request) => (
            <li key={request.id}>
              <button
                type="button"
                // `aria-current` and not `aria-selected`: this is a list of
                // navigation targets, not a listbox of values.
                aria-current={selectedId === request.id ? 'true' : undefined}
                onClick={() => {
                  onSelect(request.id);
                }}
                className={`flex min-h-tap w-full items-center gap-3 p-3 text-left transition-colors duration-(--animate-duration-fast) ${
                  selectedId === request.id ? 'bg-accent-subtle' : 'hover:bg-surface-hover'
                }`}
              >
                <Avatar size="sm" name={request.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-fg">{request.name}</p>
                  <p className="truncate text-sm text-fg-muted">
                    {request.kind} · {request.days}d
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle lg:hidden" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestDetail({ request }: { request: Request }): JSX.Element {
  return (
    <div className="p-4 sm:p-6">
      <Stack gap={5}>
        <PageHeader
          size="md"
          title={request.name}
          description={`${request.kind} · ${String(request.days)} days from ${request.from}`}
          meta={
            <Badge tone="warning" size="sm" dot>
              Pending
            </Badge>
          }
          actions={
            <>
              <Button variant="destructive">Reject</Button>
              <Button variant="primary">Approve</Button>
            </>
          }
        />

        <PageSection surface title="Impact">
          <dl className="grid grid-cols-2 gap-4 text-base">
            <div>
              <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                Balance after
              </dt>
              <dd className="mt-1 tabular-nums text-fg">{request.balanceAfter} days</dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                Payroll
              </dt>
              <dd className="mt-1 text-fg">
                {request.impactMinor ? (
                  <Money minorUnits={request.impactMinor} currency="EUR" locale="en-IE" />
                ) : (
                  'No change'
                )}
              </dd>
            </div>
          </dl>
        </PageSection>

        <PageSection title="History">
          <Timeline>
            <TimelineItem title="Submitted" timestamp="7 Aug, 11:02" tone="accent" />
            <TimelineItem title="Manager approved" timestamp="7 Aug, 16:20" tone="success" />
            <TimelineItem title="Awaiting your review" tone="warning" last />
          </Timeline>
        </PageSection>
      </Stack>
    </div>
  );
}

const renderQueue: NonNullable<Story['render']> = function QueueListDetail(args) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = requests.find((request) => request.id === selectedId) ?? null;

  return (
    <PageLayout preset="stacked" header={<Header title="Approvals" />} contentClassName="min-h-0">
      <ListDetail
        {...args}
        selected={Boolean(selected)}
        onBack={() => {
          setSelectedId(null);
        }}
        className="h-[calc(100dvh-3.5rem)]"
        list={<RequestList selectedId={selectedId} onSelect={setSelectedId} />}
        detail={selected ? <RequestDetail request={selected} /> : null}
        emptyDetail={
          <div className="grid h-full place-items-center p-8">
            <EmptyState
              icon={<Users />}
              title="Pick a request"
              description="Its impact on the balance and on payroll appears here."
            />
          </div>
        }
      />
    </PageLayout>
  );
};

export const Playground: Story = { render: renderQueue };

function Header({ title }: { title: string }): JSX.Element {
  return (
    <div className="flex h-14 items-center gap-3 px-4">
      <span className="text-md font-semibold text-fg">{title}</span>
      <Badge tone="warning" size="sm" className="ms-auto">
        {requests.length} pending
      </Badge>
    </div>
  );
}

export const NarrowFirst: Story = {
  name: 'The push, at md',
  args: { splitFrom: 'xl' },
  parameters: {
    docs: {
      description: {
        story:
          'The same component with the split pushed out to `xl`, so the push behaviour is visible at ordinary canvas widths. Select a row: the list is replaced, a back control appears, and focus moves into the detail region. Go back and focus returns to the list: including its scroll position and the search text, because the pane was hidden, not unmounted.',
      },
    },
  },
  render: renderQueue,
};

export const ThreeLevels: Story = {
  name: 'Three levels deep',
  parameters: {
    docs: {
      description: {
        story: [
          'Hierarchy beyond two panes: department → team → person. Each level is a list until the last, and the breadcrumb, not the back button: is what makes an arbitrary depth navigable.',
          '',
          'The rule that keeps this usable: **only the last level is a detail.** Three side-by-side lists on a laptop are three 240px columns nobody can read. Above two levels, collapse the ancestors into the breadcrumb and show one list plus one detail.',
        ].join('\n'),
      },
    },
  },
  render: function ThreeLevelStory(args) {
    /*
     * Annotated rather than `as const`.
     *
     * `as const` gave each department a *different* literal key set, so
     * `tree[department]` was a union of two unrelated object types and indexing
     * it by a team name could not typecheck, which is what the three casts here
     * were for. One uniform shape describes the fixture just as accurately and
     * indexes cleanly. The literal department names are no loss: nothing needs
     * autocomplete over the contents of a story fixture.
     */
    const tree: Record<string, Record<string, readonly string[]>> = {
      Engineering: {
        Platform: ['Grace Hopper', 'Ada Lovelace', 'Barbara Liskov'],
        Payroll: ['Radia Perlman', 'Joan Clarke'],
      },
      'People Ops': {
        Recruiting: ['Margaret Hamilton'],
        Operations: ['Katherine Johnson'],
      },
    };

    type Department = string;

    const [department, setDepartment] = useState<Department | null>(null);
    const [team, setTeam] = useState<string | null>(null);
    const [person, setPerson] = useState<string | null>(null);

    const teams = department ? Object.keys(tree[department] ?? {}) : [];
    const members: readonly string[] = department && team ? (tree[department]?.[team] ?? []) : [];

    return (
      <PageLayout
        preset="stacked"
        header={
          <div className="flex h-14 items-center px-4">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setDepartment(null);
                      setTeam(null);
                      setPerson(null);
                    }}
                  >
                    Organisation
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {department ? (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      {team ? (
                        <BreadcrumbLink
                          href="#"
                          onClick={(event) => {
                            event.preventDefault();
                            setTeam(null);
                            setPerson(null);
                          }}
                        >
                          {department}
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{department}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </>
                ) : null}
                {team ? (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{team}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        }
        contentClassName="min-h-0"
      >
        <ListDetail
          {...args}
          className="h-[calc(100dvh-3.5rem)]"
          listLabel={team ? `${team} members` : department ? `${department} teams` : 'Departments'}
          detailLabel="Person"
          selected={Boolean(person)}
          onBack={() => {
            setPerson(null);
          }}
          backLabel="Back to the team"
          list={
            <ul className="divide-y divide-border">
              {!department
                ? Object.keys(tree).map((name) => (
                    <li key={name}>
                      <LevelRow
                        icon={<Folder />}
                        label={name}
                        hint={`${String(Object.keys(tree[name] ?? {}).length)} teams`}
                        onClick={() => {
                          setDepartment(name);
                        }}
                      />
                    </li>
                  ))
                : !team
                  ? teams.map((name) => (
                      <li key={name}>
                        <LevelRow
                          icon={<Users />}
                          label={name}
                          hint={`${String(tree[department]?.[name]?.length ?? 0)} people`}
                          onClick={() => {
                            setTeam(name);
                          }}
                        />
                      </li>
                    ))
                  : members.map((name) => (
                      <li key={name}>
                        <LevelRow
                          avatar={name}
                          label={name}
                          selected={person === name}
                          onClick={() => {
                            setPerson(name);
                          }}
                        />
                      </li>
                    ))}
            </ul>
          }
          detail={
            person ? (
              <div className="p-6">
                <Stack gap={4}>
                  <div className="flex items-center gap-3">
                    <Avatar name={person} size="lg" />
                    <div>
                      <h2 className="text-lg font-semibold text-fg">{person}</h2>
                      <p className="text-sm text-fg-muted">
                        {team} · {department}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <p className="text-sm text-fg-muted">
                    Three levels in, and the way back is the breadcrumb rather than three nested
                    back buttons.
                  </p>
                </Stack>
              </div>
            ) : null
          }
          emptyDetail={
            <div className="grid h-full place-items-center p-8">
              <EmptyState
                icon={<Users />}
                title={team ? 'Pick a person' : 'Drill down'}
                description={
                  team
                    ? 'Their record appears here.'
                    : 'Choose a department, then a team. Only the last level gets a detail pane.'
                }
              />
            </div>
          }
        />
      </PageLayout>
    );
  },
};

function LevelRow({
  icon,
  avatar,
  label,
  hint,
  selected = false,
  onClick,
}: {
  icon?: JSX.Element;
  avatar?: string;
  label: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={`flex min-h-tap w-full items-center gap-3 p-3 text-left transition-colors duration-(--animate-duration-fast) ${
        selected ? 'bg-accent-subtle' : 'hover:bg-surface-hover'
      }`}
    >
      {avatar ? (
        <Avatar size="sm" name={avatar} />
      ) : (
        <span className="text-fg-subtle [&_svg]:size-4">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-base text-fg">{label}</span>
      {hint ? <span className="shrink-0 text-xs text-fg-muted">{hint}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
    </button>
  );
}
