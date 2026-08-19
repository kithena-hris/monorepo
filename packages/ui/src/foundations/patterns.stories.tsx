import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ArrowDownUp,
  CalendarDays,
  Check,
  Download,
  Filter,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { Avatar, AvatarGroup } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';
import { Button } from '../components/button/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/card/card';
import { BarChart, DonutChart, Sparkline, TrendChart } from '../components/chart/chart';
import { Checkbox } from '../components/checkbox/checkbox';
import { Combobox } from '../components/combobox/combobox';
import { DatePicker } from '../components/date-picker/date-picker';
import type { DateRange, IsoDate } from '../components/calendar/calendar';
import { Alert, EmptyState, Skeleton } from '../components/feedback/feedback';
import { Input } from '../components/input/input';
import { AutoGrid, Container, Inline, Stack } from '../components/layout/layout';
import { Money } from '../components/money/money';
import { Pagination } from '../components/pagination/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover/popover';
import { Reveal } from '../components/reveal/reveal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select/select';
import { Separator } from '../components/separator/separator';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/sheet/sheet';
import { Slider } from '../components/slider/slider';
import { Stat } from '../components/stat/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type SortDirection,
} from '../components/table/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/tabs/tabs';
import { ToggleGroup, ToggleGroupItem } from '../components/toggle/toggle';
import { useToast } from '../components/toast/toast';
import { useInView } from '../lib/use-in-view';

const meta = {
  title: 'Foundations/Patterns',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'The parts assembled into working screens, which is the only place a design system can actually be judged.',
          '',
          'Everything on this page is **functional**: the filters filter, the sort sorts, the selection drives a bulk action, the infinite list fetches, the charts are drawn from the same rows the table shows. A pattern page of static screenshots proves nothing, the interesting failures are all in the interactions.',
          '',
          'Every element comes from `@reach/ui`, and none of it knows what an employee is. Note what the system does **not** provide: no page shell, no navigation, no data fetching, no filter state machine. A module owns its own screens; the system owns the vocabulary they are written in.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/* Fixture                                                                     */
/* -------------------------------------------------------------------------- */

interface Person {
  id: number;
  name: string;
  role: string;
  team: string;
  location: string;
  /** Minor units, as a string. Money is never a float, not even in a fixture. */
  salaryMinor: string;
  status: 'Active' | 'On leave' | 'Offboarding';
  startDate: IsoDate;
  leaveTaken: number;
}

const firstNames = [
  'Grace',
  'Ada',
  'Radia',
  'Barbara',
  'Katherine',
  'Margaret',
  'Joan',
  'Anita',
  'Karen',
  'Frances',
];
const lastNames = [
  'Hopper',
  'Lovelace',
  'Perlman',
  'Liskov',
  'Johnson',
  'Hamilton',
  'Clarke',
  'Borg',
  'Spärck Jones',
  'Allen',
];
const roles = [
  'Principal Engineer',
  'Staff Engineer',
  'Engineering Manager',
  'Data Analyst',
  'Payroll Specialist',
  'Recruiter',
];
const teams = ['Platform', 'Payroll', 'People Ops', 'Support', 'Finance'];
const locations = ['Madrid', 'Berlin', 'Dublin', 'Lisbon', 'Remote. Spain'];
const statuses: Person['status'][] = ['Active', 'Active', 'Active', 'On leave', 'Offboarding'];

/**
 * A deterministic generator. `Math.random()` in a story means the visual
 * regression run diffs against a different table every time.
 */
function makePeople(count: number): Person[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `${firstNames[i % firstNames.length] ?? 'Grace'} ${lastNames[(i * 7) % lastNames.length] ?? 'Hopper'}`,
    role: roles[(i * 3) % roles.length] ?? 'Staff Engineer',
    team: teams[i % teams.length] ?? 'Platform',
    location: locations[(i * 2) % locations.length] ?? 'Madrid',
    salaryMinor: String(4_200_000 + ((i * 137_000) % 11_000_000)),
    status: statuses[i % statuses.length] ?? 'Active',
    startDate: `20${String(19 + (i % 7)).padStart(2, '0')}-${String((i % 12) + 1).padStart(2, '0')}-0${String((i % 9) + 1)}`,
    leaveTaken: (i * 3) % 26,
  }));
}

const directory = makePeople(240);

const statusTone = { Active: 'success', 'On leave': 'warning', Offboarding: 'neutral' } as const;

const currency = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/* -------------------------------------------------------------------------- */
/* 1. A directory that actually filters                                        */
/* -------------------------------------------------------------------------- */

export const PeopleDirectory: Story = {
  name: 'People directory',
  parameters: {
    docs: {
      description: {
        story: [
          'A working directory: type in the search, toggle a status, sort a column, select rows, page through the result. Everything updates the same derived list.',
          '',
          'Three details worth stealing:',
          '',
          '- **The result count is a live region.** A filter that silently changes a table is invisible to a screen-reader user; `aria-live="polite"` on the count makes "24 of 240" audible.',
          '- **Sorting is announced through `aria-sort` on the `<th>`,** not through an arrow glyph. The glyph is for the eye; the attribute is the fact.',
          '- **Selection survives filtering.** Rows selected then filtered out stay selected, and the bulk bar says so: silently dropping them is how someone emails 12 people instead of 40.',
        ].join('\n'),
      },
    },
  },
  render: function DirectoryStory() {
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<string[]>([]);
    const [team, setTeam] = useState<string | readonly string[] | null>(null);
    const [sort, setSort] = useState<{
      key: keyof Person;
      direction: Exclude<SortDirection, null>;
    }>({
      key: 'name',
      direction: 'ascending',
    });
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [page, setPage] = useState(1);
    const pageSize = 8;
    const { toast } = useToast();

    const filtered = useMemo(() => {
      const needle = query.trim().toLowerCase();
      const teamFilter: readonly string[] =
        team == null ? [] : typeof team === 'string' ? [team] : team;

      const rows = directory.filter((person) => {
        if (
          needle &&
          !`${person.name} ${person.role} ${person.location}`.toLowerCase().includes(needle)
        ) {
          return false;
        }
        if (status.length > 0 && !status.includes(person.status)) return false;
        if (teamFilter.length > 0 && !teamFilter.includes(person.team)) return false;
        return true;
      });

      const factor = sort.direction === 'ascending' ? 1 : -1;
      return rows.toSorted((a, b) => {
        const left = a[sort.key];
        const right = b[sort.key];
        // Salary is a minor-unit string; comparing it as text would put
        // €9,000 above €10,000. Numeric columns compare numerically.
        if (sort.key === 'salaryMinor' || sort.key === 'leaveTaken') {
          return (Number(left) - Number(right)) * factor;
        }
        return String(left).localeCompare(String(right)) * factor;
      });
    }, [query, status, team, sort]);

    // Any change to the filter can shorten the list past the current page.
    useEffect(() => {
      setPage(1);
    }, [query, status, team]);

    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
    const allOnPageSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
    const hiddenSelected = [...selected].filter((id) => !filtered.some((p) => p.id === id)).length;

    const toggle = (id: number): void => {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const sortBy = (key: keyof Person) => (direction: Exclude<SortDirection, null>) => {
      setSort({ key, direction });
    };

    const activeFilters = status.length + (Array.isArray(team) ? team.length : team ? 1 : 0);

    return (
      <div className="min-h-screen bg-canvas p-4 sm:p-6">
        <Container size="xl">
          <Stack gap={5}>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-fg">People</h1>
                <p aria-live="polite" className="mt-1 text-sm text-fg-muted">
                  <span className="tabular-nums">{filtered.length}</span> of{' '}
                  <span className="tabular-nums">{directory.length}</span> employees
                  {activeFilters > 0 ? ` · ${String(activeFilters)} filters` : ''}
                </p>
              </div>
              <Inline gap={2} collapseBelow="xs">
                <Button startIcon={<Download />}>Export</Button>
                <Button variant="primary" startIcon={<Plus />}>
                  Add employee
                </Button>
              </Inline>
            </header>

            <AutoGrid minItemWidth="13rem" gap={3}>
              <Stat
                label="Headcount"
                value={String(directory.length)}
                delta="+18"
                deltaLabel="this quarter"
                direction="up"
                sentiment="positive"
                chart={
                  <Sparkline
                    label="Headcount, last 7 months"
                    data={[
                      { label: 'Feb', value: 202 },
                      { label: 'Mar', value: 209 },
                      { label: 'Apr', value: 214 },
                      { label: 'May', value: 221 },
                      { label: 'Jun', value: 229 },
                      { label: 'Jul', value: 236 },
                      { label: 'Aug', value: 240 },
                    ]}
                  />
                }
              />
              <Stat
                label="Monthly payroll"
                value={
                  <Money
                    minorUnits={
                      String(
                        directory.reduce((sum, p) => sum + Number(p.salaryMinor), 0) / 12,
                      ).split('.')[0] ?? '0'
                    }
                    currency="EUR"
                    locale="en-IE"
                  />
                }
                delta="+2.1%"
                deltaLabel="vs July"
                direction="up"
                sentiment="neutral"
              />
              <Stat
                label="On leave"
                value={String(directory.filter((p) => p.status === 'On leave').length)}
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
                chart={
                  <AvatarGroup max={4} total={7}>
                    <Avatar size="xs" name="Grace Hopper" />
                    <Avatar size="xs" name="Ada Lovelace" />
                    <Avatar size="xs" name="Radia Perlman" />
                    <Avatar size="xs" name="Barbara Liskov" />
                  </AvatarGroup>
                }
              />
            </AutoGrid>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Directory</CardTitle>
                  <CardDescription>Effective as of 9 August 2026.</CardDescription>
                </div>
                <div className="w-full sm:w-64">
                  <Input
                    size="sm"
                    startAdornment={<Search />}
                    placeholder="Search name, role or location"
                    aria-label="Search people"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    endAdornment={
                      query ? (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={() => {
                            setQuery('');
                          }}
                          className="rounded-xs text-fg-subtle hover:text-fg"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      ) : null
                    }
                  />
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <Inline gap={2} className="justify-between">
                  <Inline gap={2}>
                    <ToggleGroup
                      type="multiple"
                      value={status}
                      onValueChange={setStatus}
                      aria-label="Filter by status"
                    >
                      <ToggleGroupItem value="Active" size="sm">
                        Active
                      </ToggleGroupItem>
                      <ToggleGroupItem value="On leave" size="sm">
                        On leave
                      </ToggleGroupItem>
                      <ToggleGroupItem value="Offboarding" size="sm">
                        Offboarding
                      </ToggleGroupItem>
                    </ToggleGroup>

                    <div className="w-44">
                      <Combobox
                        size="sm"
                        multiple
                        clearable
                        label="Team"
                        placeholder="Any team"
                        searchPlaceholder="Search teams"
                        value={team}
                        onChange={setTeam}
                        options={teams.map((name) => ({
                          value: name,
                          label: name,
                          description: `${String(directory.filter((p) => p.team === name).length)} people`,
                        }))}
                      />
                    </div>
                  </Inline>

                  {activeFilters > 0 || query ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      startIcon={<X />}
                      onClick={() => {
                        setQuery('');
                        setStatus([]);
                        setTeam(null);
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </Inline>

                {/* `Reveal`, so the table below is pushed down over 200ms
                    rather than in the frame a checkbox was ticked. */}
                <Reveal open={selected.size > 0} from="top">
                  <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-accent bg-accent-subtle px-3 py-2">
                    <span aria-live="polite" className="text-sm font-medium text-accent-fg">
                      {selected.size} selected
                      {hiddenSelected > 0
                        ? ` (${String(hiddenSelected)} hidden by the current filter)`
                        : ''}
                    </span>
                    <div className="ms-auto flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          toast({
                            title: `Export queued for ${String(selected.size)} employees`,
                            description: 'You will get an email when the file is ready.',
                            tone: 'info',
                          });
                        }}
                      >
                        Export selected
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelected(new Set());
                        }}
                      >
                        Clear selection
                      </Button>
                    </div>
                  </div>
                </Reveal>

                {visible.length === 0 ? (
                  <EmptyState
                    icon={<Search />}
                    title="No one matches those filters"
                    description="Try a shorter search, or clear one of the filters above."
                    action={
                      <Button
                        onClick={() => {
                          setQuery('');
                          setStatus([]);
                          setTeam(null);
                        }}
                      >
                        Clear all filters
                      </Button>
                    }
                  />
                ) : (
                  <Table aria-label="People directory">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            aria-label="Select all rows on this page"
                            checked={allOnPageSelected}
                            onCheckedChange={(checked) => {
                              setSelected((current) => {
                                const next = new Set(current);
                                for (const person of visible) {
                                  if (checked) next.add(person.id);
                                  else next.delete(person.id);
                                }
                                return next;
                              });
                            }}
                          />
                        </TableHead>
                        <TableHead
                          sortable
                          sortDirection={sort.key === 'name' ? sort.direction : null}
                          onSort={sortBy('name')}
                        >
                          Employee
                        </TableHead>
                        <TableHead
                          sortable
                          sortDirection={sort.key === 'team' ? sort.direction : null}
                          onSort={sortBy('team')}
                        >
                          Team
                        </TableHead>
                        <TableHead className="max-md:hidden">Location</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead
                          numeric
                          sortable
                          sortDirection={sort.key === 'salaryMinor' ? sort.direction : null}
                          onSort={sortBy('salaryMinor')}
                        >
                          Base salary
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((person) => (
                        <TableRow key={person.id} selected={selected.has(person.id)}>
                          <TableCell>
                            <Checkbox
                              aria-label={`Select ${person.name}`}
                              checked={selected.has(person.id)}
                              onCheckedChange={() => {
                                toggle(person.id);
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar size="sm" name={person.name} />
                              <div className="min-w-0">
                                <p className="truncate font-medium">{person.name}</p>
                                <p className="truncate text-xs text-fg-muted">{person.role}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-fg-muted">{person.team}</TableCell>
                          <TableCell className="text-fg-muted max-md:hidden">
                            {person.location}
                          </TableCell>
                          <TableCell>
                            <Badge dot tone={statusTone[person.status]} size="sm">
                              {person.status}
                            </Badge>
                          </TableCell>
                          <TableCell numeric>
                            <Money minorUnits={person.salaryMinor} currency="EUR" locale="en-IE" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>

              <Separator />
              <div className="px-5 py-3">
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  onPageChange={setPage}
                  totalItems={filtered.length}
                  pageSize={pageSize}
                />
              </div>
            </Card>
          </Stack>
        </Container>
      </div>
    );
  },
};

/* -------------------------------------------------------------------------- */
/* 2. Advanced filters                                                         */
/* -------------------------------------------------------------------------- */

interface FilterRule {
  id: number;
  field: 'team' | 'location' | 'status' | 'salary' | 'startDate' | 'leaveTaken';
  operator: string;
  value: string | number | DateRange | null;
}

const fieldConfig = {
  team: { label: 'Team', operators: ['is', 'is not'], kind: 'enum', options: teams },
  location: { label: 'Location', operators: ['is', 'is not'], kind: 'enum', options: locations },
  status: {
    label: 'Status',
    operators: ['is', 'is not'],
    kind: 'enum',
    options: ['Active', 'On leave', 'Offboarding'],
  },
  salary: { label: 'Base salary', operators: ['at least', 'at most'], kind: 'money', options: [] },
  startDate: { label: 'Start date', operators: ['between'], kind: 'daterange', options: [] },
  leaveTaken: {
    label: 'Leave taken',
    operators: ['at least', 'at most'],
    kind: 'number',
    options: [],
  },
} as const;

/**
 * The range out of a rule's value, when the rule is a date-range rule.
 *
 * `FilterRule['value']` spans every field's value type, so reading a range out
 * of it needs a narrowing step. `typeof === 'object'` plus a null check leaves
 * exactly `DateRange`, which is a check the runtime performs rather than a
 * claim the compiler is told to accept.
 */
function dateRangeOf(value: FilterRule['value']): DateRange | null {
  return typeof value === 'object' && value !== null ? value : null;
}

/** A type predicate over the config table, so `Select`'s plain string narrows. */
function isFilterField(value: string): value is FilterRule['field'] {
  return value in fieldConfig;
}

function matches(person: Person, rule: FilterRule): boolean {
  switch (rule.field) {
    case 'team':
    case 'location':
    case 'status': {
      const actual = person[rule.field];
      return rule.operator === 'is' ? actual === rule.value : actual !== rule.value;
    }
    case 'salary': {
      const threshold = Number(rule.value) * 100;
      return rule.operator === 'at least'
        ? Number(person.salaryMinor) >= threshold
        : Number(person.salaryMinor) <= threshold;
    }
    case 'leaveTaken': {
      const threshold = Number(rule.value);
      return rule.operator === 'at least'
        ? person.leaveTaken >= threshold
        : person.leaveTaken <= threshold;
    }
    case 'startDate': {
      const range = dateRangeOf(rule.value);
      if (!range?.start || !range.end) return true;
      // String comparison is correct and total for ISO dates, which is most of
      // the reason this system keeps calendar dates as strings.
      return person.startDate >= range.start && person.startDate <= range.end;
    }
  }
}

export const AdvancedFilters: Story = {
  name: 'Advanced filters',
  parameters: {
    docs: {
      description: {
        story: [
          'A filter builder, working. Add a rule, change its field, watch the operators and the value control change with it, and see the count update.',
          '',
          '**Why a builder rather than a row of dropdowns.** Once a screen needs "base salary at least €80,000 **and** started before 2022 **and** team is not Support", a fixed filter bar either grows to twenty controls or stops being able to express the question. The builder is the honest shape for that, and it is also the shape that serialises into a saved view and into a URL.',
          '',
          '**The details that make it usable.** The value control is chosen by the field\'s *kind*, an enum gets a combobox, money gets a slider plus a number, a date gets a range picker, because a text box for "team" is how you get `Platfrom` in the filter. Each rule is removable, the whole set is clearable, and the applied set is echoed as chips outside the popover, since a popover hides its own state.',
        ].join('\n'),
      },
    },
  },
  render: function AdvancedFiltersStory() {
    const [rules, setRules] = useState<FilterRule[]>([
      { id: 1, field: 'team', operator: 'is', value: 'Platform' },
      { id: 2, field: 'salary', operator: 'at least', value: 60000 },
    ]);
    const [nextId, setNextId] = useState(3);
    const [open, setOpen] = useState(false);

    const results = useMemo(
      () => directory.filter((person) => rules.every((rule) => matches(person, rule))),
      [rules],
    );

    const update = (id: number, patch: Partial<FilterRule>): void => {
      setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
    };

    const defaultValueFor = (field: FilterRule['field']): FilterRule['value'] => {
      const config = fieldConfig[field];
      if (config.kind === 'enum') return config.options[0] ?? null;
      if (config.kind === 'money') return 60000;
      if (config.kind === 'number') return 10;
      return { start: null, end: null };
    };

    const describe = (rule: FilterRule): string => {
      const config = fieldConfig[rule.field];
      if (config.kind === 'money')
        return `${config.label} ${rule.operator} ${currency.format(Number(rule.value))}`;
      if (config.kind === 'daterange') {
        const range = dateRangeOf(rule.value);
        return range?.start && range.end
          ? `${config.label} between ${range.start} and ${range.end}`
          : `${config.label}: any`;
      }
      // `rule.value` is a union that includes an object, so it is narrowed
      // rather than stringified. `String({})` is `[object Object]`.
      return `${config.label} ${rule.operator} ${typeof rule.value === 'object' ? '' : String(rule.value)}`;
    };

    return (
      <div className="min-h-screen bg-canvas p-4 sm:p-6">
        <Container size="lg">
          <Stack gap={5}>
            <header>
              <h1 className="text-2xl font-semibold text-fg">Segment builder</h1>
              <p aria-live="polite" className="mt-1 text-sm text-fg-muted">
                <span className="font-medium tabular-nums text-fg">{results.length}</span> of{' '}
                {directory.length} employees match {rules.length}{' '}
                {rules.length === 1 ? 'rule' : 'rules'}
              </p>
            </header>

            <Inline gap={2}>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button startIcon={<SlidersHorizontal />}>
                    Filters {rules.length > 0 ? `(${String(rules.length)})` : ''}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(34rem,calc(100vw-1.5rem))]">
                  <Stack gap={3}>
                    {rules.length === 0 ? (
                      <p className="py-2 text-sm text-fg-muted">
                        No rules yet. Every employee matches.
                      </p>
                    ) : null}

                    {rules.map((rule, index) => {
                      const config = fieldConfig[rule.field];
                      return (
                        <div
                          key={rule.id}
                          className="space-y-2 rounded-md border border-border p-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-10 shrink-0 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                              {index === 0 ? 'Where' : 'And'}
                            </span>

                            <Select
                              value={rule.field}
                              onValueChange={(field) => {
                                if (!isFilterField(field)) return;
                                const next = field;
                                update(rule.id, {
                                  field: next,
                                  operator: fieldConfig[next].operators[0],
                                  value: defaultValueFor(next),
                                });
                              }}
                            >
                              <SelectTrigger size="sm" className="w-32" aria-label="Field">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(fieldConfig).map(([key, value]) => (
                                  <SelectItem key={key} value={key}>
                                    {value.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Select
                              value={rule.operator}
                              onValueChange={(operator) => {
                                update(rule.id, { operator });
                              }}
                            >
                              <SelectTrigger size="sm" className="w-28" aria-label="Operator">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {config.operators.map((operator) => (
                                  <SelectItem key={operator} value={operator}>
                                    {operator}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Remove the ${config.label} rule`}
                              className="ms-auto"
                              startIcon={<Trash2 />}
                              onClick={() => {
                                setRules((current) => current.filter((r) => r.id !== rule.id));
                              }}
                            />
                          </div>

                          <div className="ps-12">
                            {config.kind === 'enum' ? (
                              <Select
                                // Narrowed, not stringified: the union
                                // includes a DateRange, and this branch only
                                // ever runs for the enum kinds.
                                value={typeof rule.value === 'object' ? '' : String(rule.value)}
                                onValueChange={(value) => {
                                  update(rule.id, { value });
                                }}
                              >
                                <SelectTrigger size="sm" aria-label={`${config.label} value`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {config.options.map((option) => (
                                    <SelectItem key={option} value={option}>
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : null}

                            {config.kind === 'money' ? (
                              <div className="flex items-center gap-3">
                                <Slider
                                  label="Base salary"
                                  min={20000}
                                  max={200000}
                                  step={2500}
                                  value={[Number(rule.value)]}
                                  onValueChange={([value]) => {
                                    update(rule.id, { value: value ?? 0 });
                                  }}
                                />
                                <span className="w-20 shrink-0 text-right text-sm tabular-nums text-fg">
                                  {currency.format(Number(rule.value))}
                                </span>
                              </div>
                            ) : null}

                            {config.kind === 'number' ? (
                              <Input
                                size="sm"
                                type="number"
                                aria-label="Days of leave"
                                value={Number(rule.value)}
                                onChange={(event) => {
                                  update(rule.id, { value: Number(event.target.value) });
                                }}
                                className="w-28"
                              />
                            ) : null}

                            {config.kind === 'daterange' ? (
                              <DatePicker
                                mode="range"
                                size="sm"
                                label="Start date range"
                                placeholder="Any date"
                                today="2026-08-09"
                                // Only the `daterange` kind reaches this
                                // branch, but the rule's value type is the
                                // union of every kind, so it is narrowed here.
                                value={
                                  typeof rule.value === 'object'
                                    ? rule.value
                                    : { start: null, end: null }
                                }
                                onChange={(value) => {
                                  update(rule.id, { value });
                                }}
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    <Inline gap={2} className="justify-between">
                      <Button
                        size="sm"
                        variant="ghost"
                        startIcon={<Plus />}
                        onClick={() => {
                          setRules((current) => [
                            ...current,
                            { id: nextId, field: 'status', operator: 'is', value: 'Active' },
                          ]);
                          setNextId((id) => id + 1);
                        }}
                      >
                        Add rule
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRules([]);
                        }}
                        disabled={rules.length === 0}
                      >
                        Clear all
                      </Button>
                    </Inline>
                  </Stack>
                </PopoverContent>
              </Popover>

              {/* The popover hides its own state, so the applied set is echoed
                  outside it. Each chip is removable where it is visible. */}
              {rules.map((rule) => (
                <span
                  key={rule.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 ps-3 pe-1.5 text-sm text-fg-muted"
                >
                  {describe(rule)}
                  <button
                    type="button"
                    aria-label={`Remove ${describe(rule)}`}
                    onClick={() => {
                      setRules((current) => current.filter((r) => r.id !== rule.id));
                    }}
                    className="grid size-5 place-items-center rounded-full hover:bg-surface-hover hover:text-fg"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </Inline>

            {results.length === 0 ? (
              <Alert tone="warning" title="No employees match this segment">
                Every rule is applied with AND. Remove a rule, or loosen the salary threshold.
              </Alert>
            ) : (
              <Table
                aria-label="Matching employees"
                containerClassName="max-h-[28rem]"
                stickyHeader
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="max-sm:hidden">Started</TableHead>
                    <TableHead numeric>Leave taken</TableHead>
                    <TableHead numeric>Base salary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.slice(0, 40).map((person) => (
                    <TableRow key={person.id}>
                      <TableCell className="font-medium">{person.name}</TableCell>
                      <TableCell className="text-fg-muted">{person.team}</TableCell>
                      <TableCell className="text-fg-muted max-sm:hidden">
                        <time dateTime={person.startDate}>{person.startDate}</time>
                      </TableCell>
                      <TableCell numeric>{person.leaveTaken} d</TableCell>
                      <TableCell numeric>
                        <Money minorUnits={person.salaryMinor} currency="EUR" locale="en-IE" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Stack>
        </Container>
      </div>
    );
  },
};

/* -------------------------------------------------------------------------- */
/* 3. Infinite list                                                            */
/* -------------------------------------------------------------------------- */

const PAGE_SIZE = 25;

export const InfiniteTable: Story = {
  name: 'Infinite scrolling table',
  parameters: {
    docs: {
      description: {
        story: [
          'Keyset pagination with an intersection sentinel. Scroll the table and pages load 400px before you reach the bottom.',
          '',
          '**Why keyset and not offset here.** An audit log is ordered by time and still growing. `OFFSET 200` over a table taking writes shows duplicates and skips rows as pages move, and it degrades to a sequential scan. A cursor, "give me 25 rows after id 200": is stable under concurrent writes and stays O(limit). Offset pagination is still right for the directory above, where the user has filtered down to a few hundred rows and wants to jump to page 12.',
          '',
          '**Why `IntersectionObserver` and not a scroll handler.** A scroll listener fires on the main thread for every frame of a flick on a phone, and the arithmetic it does. `scrollTop + clientHeight >= scrollHeight - n`: is wrong the moment the list is inside a container rather than the window. This one is inside a container.',
          '',
          '**The parts people leave out.** Skeleton rows of the *same height* as real rows, so the scroll position does not jump when they are replaced. An explicit "Load more" button behind the sentinel, because an infinite list with no manual control is unusable from a keyboard. A live region announcing each load. And a real end state, so the list terminates rather than spinning forever.',
        ].join('\n'),
      },
    },
  },
  render: function InfiniteStory() {
    const [rows, setRows] = useState<Person[]>(() => directory.slice(0, PAGE_SIZE));
    const [loading, setLoading] = useState(false);
    const done = rows.length >= directory.length;

    // 400px of lead time: the next page is already arriving while the sentinel
    // is still a screen away, which is what makes the list feel bottomless.
    const [sentinelRef, inView] = useInView<HTMLDivElement>({
      rootMargin: '400px',
      enabled: !done && !loading,
    });

    const loadMore = useCallback(() => {
      if (loading || done) return;
      setLoading(true);
      // Stand-in for the fetch. A real one would send the last row's id as the
      // cursor rather than an offset.
      setTimeout(() => {
        setRows((current) => directory.slice(0, current.length + PAGE_SIZE));
        setLoading(false);
      }, 700);
    }, [loading, done]);

    useEffect(() => {
      if (inView) loadMore();
    }, [inView, loadMore]);

    return (
      <div className="min-h-screen bg-canvas p-4 sm:p-6">
        <Container size="lg">
          <Stack gap={4}>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-fg">Audit log</h1>
                <p className="mt-1 text-sm text-fg-muted">
                  Newest first. Loaded in pages of {PAGE_SIZE} as you scroll.
                </p>
              </div>
              <Badge tone="info" size="sm">
                Keyset pagination
              </Badge>
            </header>

            <Card className="overflow-hidden">
              <Table aria-label="Audit log" stickyHeader bare containerClassName="max-h-[32rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead sticky>Employee</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead className="max-sm:hidden">Recorded</TableHead>
                    <TableHead numeric>Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell sticky>
                        <div className="flex items-center gap-2.5">
                          <Avatar size="sm" name={person.name} />
                          <span className="truncate font-medium">{person.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        Base salary set to{' '}
                        <Money minorUnits={person.salaryMinor} currency="EUR" locale="en-IE" />
                      </TableCell>
                      <TableCell className="text-fg-muted max-sm:hidden">
                        <time dateTime={person.startDate}>{person.startDate} 09:14</time>
                      </TableCell>
                      <TableCell numeric>
                        <time dateTime={person.startDate}>{person.startDate}</time>
                      </TableCell>
                    </TableRow>
                  ))}

                  {loading
                    ? Array.from({ length: 4 }, (_, i) => (
                        <TableRow key={`skeleton-${String(i)}`}>
                          {/* Same row height as a real row, so replacing these
                              does not move the scroll position under the user. */}
                          <TableCell sticky>
                            <div className="flex items-center gap-2.5">
                              <Skeleton className="size-7 rounded-full" />
                              <Skeleton className="h-4 w-32" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-48" />
                          </TableCell>
                          <TableCell className="max-sm:hidden">
                            <Skeleton className="h-4 w-28" />
                          </TableCell>
                          <TableCell numeric>
                            <Skeleton className="ms-auto h-4 w-20" />
                          </TableCell>
                        </TableRow>
                      ))
                    : null}
                </TableBody>
              </Table>

              <div ref={sentinelRef} aria-hidden className="h-px" />

              <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3">
                <p aria-live="polite" className="text-sm text-fg-muted">
                  {loading
                    ? 'Loading more…'
                    : done
                      ? `All ${String(directory.length)} entries loaded`
                      : `${String(rows.length)} of ${String(directory.length)} entries`}
                </p>
                {!done ? (
                  // The keyboard escape hatch. An infinite list with only a
                  // scroll sentinel cannot be advanced without a mouse.
                  <Button size="sm" onClick={loadMore} disabled={loading} loading={loading}>
                    Load more
                  </Button>
                ) : null}
              </div>
            </Card>
          </Stack>
        </Container>
      </div>
    );
  },
};

/* -------------------------------------------------------------------------- */
/* 4. Analytics                                                                */
/* -------------------------------------------------------------------------- */

export const AnalyticsDashboard: Story = {
  name: 'Analytics dashboard',
  parameters: {
    docs: {
      description: {
        story: [
          'Charts driven by the same 240 rows the tables use, with a working period switch and a drill-down: click a bar and the table below filters to that team.',
          '',
          'Two things a dashboard has to get right and usually does not:',
          '',
          '- **Every chart renders its numbers twice**: once as SVG, once as a `<table>` in the accessibility tree. Turn on a screen reader and the data is all there.',
          '- **Direction is not sentiment.** Attrition up is red even though the arrow points up. The tiles take those as separate props precisely so a resignation spike cannot be painted green by an inferred colour.',
        ].join('\n'),
      },
    },
  },
  render: function DashboardStory() {
    const [period, setPeriod] = useState('quarter');
    const [drill, setDrill] = useState<string | null>(null);

    const byTeam = useMemo(
      () =>
        teams.map((team) => ({
          label: team,
          value: directory.filter((person) => person.team === team).length,
        })),
      [],
    );

    const byStatus = useMemo(
      () =>
        (
          [
            ['Active', 'success'],
            ['On leave', 'warning'],
            ['Offboarding', 'neutral'],
          ] as const
        ).map(([status, tone]) => ({
          label: status,
          value: directory.filter((person) => person.status === status).length,
          tone,
        })),
      [],
    );

    const headcount = [
      { label: 'Feb', value: 202 },
      { label: 'Mar', value: 209 },
      { label: 'Apr', value: 214 },
      { label: 'May', value: 221 },
      { label: 'Jun', value: 229 },
      { label: 'Jul', value: 236 },
      { label: 'Aug', value: 240 },
    ];
    const leavers = [
      { label: 'Feb', value: 4 },
      { label: 'Mar', value: 3 },
      { label: 'Apr', value: 6 },
      { label: 'May', value: 2 },
      { label: 'Jun', value: 5 },
      { label: 'Jul', value: 3 },
      { label: 'Aug', value: 2 },
    ];

    const drilled = drill ? directory.filter((person) => person.team === drill) : [];

    return (
      <div className="min-h-screen bg-canvas p-4 sm:p-6">
        <Container size="xl">
          <Stack gap={5}>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-fg">Workforce</h1>
                <p className="mt-1 text-sm text-fg-muted">240 employees across 5 teams.</p>
              </div>
              <Inline gap={2}>
                <ToggleGroup
                  type="single"
                  value={period}
                  onValueChange={(next) => {
                    if (next) setPeriod(next);
                  }}
                  aria-label="Period"
                >
                  <ToggleGroupItem value="month" size="sm">
                    Month
                  </ToggleGroupItem>
                  <ToggleGroupItem value="quarter" size="sm">
                    Quarter
                  </ToggleGroupItem>
                  <ToggleGroupItem value="year" size="sm">
                    Year
                  </ToggleGroupItem>
                </ToggleGroup>
                <Button startIcon={<CalendarDays />}>Custom range</Button>
              </Inline>
            </header>

            <AutoGrid minItemWidth="14rem" gap={4}>
              <Stat
                label="Headcount"
                value="240"
                delta="+18.8%"
                deltaLabel="vs February"
                direction="up"
                sentiment="positive"
                chart={<Sparkline label="Headcount by month" data={headcount} />}
              />
              <Stat
                label="Voluntary attrition"
                value="8.4%"
                delta="+1.2pp"
                deltaLabel="vs last quarter"
                direction="up"
                sentiment="negative"
                chart={<Sparkline label="Leavers by month" data={leavers} tone="danger" />}
              />
              <Stat
                label="Average base salary"
                value={<Money minorUnits="7241500" currency="EUR" locale="en-IE" />}
                delta="+€1,340"
                deltaLabel="vs last quarter"
                direction="up"
                sentiment="neutral"
              />
              <Stat
                label="Average leave taken"
                value="12.4 d"
                delta="−1.1 d"
                deltaLabel="vs last year"
                direction="down"
                sentiment="negative"
              />
            </AutoGrid>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Headcount and leavers</CardTitle>
                    <CardDescription>February to August 2026.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <TrendChart
                    label="Headcount and leavers, February to August 2026"
                    height={220}
                    series={[
                      { label: 'Headcount', data: headcount, tone: 'accent' },
                      { label: 'Leavers', data: leavers, tone: 'danger' },
                    ]}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>By status</CardTitle>
                </CardHeader>
                <CardContent>
                  <DonutChart
                    label="Employees by status"
                    size={140}
                    data={byStatus}
                    center={
                      <div>
                        <p className="text-xl font-semibold tabular-nums text-fg">240</p>
                        <p className="text-2xs text-fg-subtle">people</p>
                      </div>
                    }
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Headcount by team</CardTitle>
                  <CardDescription>Select a bar to see who is in it.</CardDescription>
                </div>
                {drill ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    startIcon={<X />}
                    onClick={() => {
                      setDrill(null);
                    }}
                  >
                    Clear selection
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <BarChart
                  label="Headcount by team"
                  data={byTeam}
                  height={180}
                  showValues
                  // `exactOptionalPropertyTypes` is on, so the prop is omitted
                  // rather than passed as undefined when nothing is selected.
                  {...(drill ? { selectedIndex: teams.indexOf(drill) } : {})}
                  onSelect={(point) => {
                    setDrill((current) => (current === point.label ? null : point.label));
                  }}
                />

                {drill ? (
                  <div className="space-y-2">
                    <p aria-live="polite" className="text-sm text-fg-muted">
                      <span className="font-medium text-fg">{drill}</span>,{' '}
                      <span className="tabular-nums">{drilled.length}</span> people
                    </p>
                    <Table aria-label={`${drill} team`} containerClassName="max-h-64" stickyHeader>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead className="max-sm:hidden">Location</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead numeric>Base salary</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drilled.slice(0, 25).map((person) => (
                          <TableRow key={person.id}>
                            <TableCell className="font-medium">{person.name}</TableCell>
                            <TableCell className="text-fg-muted max-sm:hidden">
                              {person.location}
                            </TableCell>
                            <TableCell>
                              <Badge tone={statusTone[person.status]} size="sm" dot>
                                {person.status}
                              </Badge>
                            </TableCell>
                            <TableCell numeric>
                              <Money
                                minorUnits={person.salaryMinor}
                                currency="EUR"
                                locale="en-IE"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </div>
    );
  },
};

/* -------------------------------------------------------------------------- */
/* 5. Approval queue                                                           */
/* -------------------------------------------------------------------------- */

interface LeaveRequest {
  id: number;
  name: string;
  kind: 'Annual leave' | 'Sick leave' | 'Parental leave' | 'Unpaid leave';
  days: number;
  from: IsoDate;
  balanceAfter: number;
  decided?: 'approved' | 'rejected';
}

export const ApprovalQueue: Story = {
  name: 'Approval queue',
  parameters: {
    docs: {
      description: {
        story: [
          'A review flow end to end: filter the queue, open a request in a sheet, approve or reject, get a toast with an undo, and watch the row update behind the panel.',
          '',
          "The sheet is the point. A reviewer's context is the queue, their filters, their scroll position, their place in a list of forty. A route change loses all three, and a centred modal covers the row they were comparing against.",
          '',
          'Note the empty state once everything is decided: it says what happened and offers the way back, rather than rendering an empty table with a header and no rows.',
        ].join('\n'),
      },
    },
  },
  render: function QueueStory(): JSX.Element {
    const initial: LeaveRequest[] = [
      {
        id: 1,
        name: 'Grace Hopper',
        kind: 'Annual leave',
        days: 3,
        from: '2026-09-14',
        balanceAfter: 12,
      },
      {
        id: 2,
        name: 'Ada Lovelace',
        kind: 'Parental leave',
        days: 20,
        from: '2026-10-01',
        balanceAfter: 18,
      },
      {
        id: 3,
        name: 'Katherine Johnson',
        kind: 'Unpaid leave',
        days: 10,
        from: '2026-10-01',
        balanceAfter: 4,
      },
      {
        id: 4,
        name: 'Radia Perlman',
        kind: 'Sick leave',
        days: 2,
        from: '2026-08-11',
        balanceAfter: 9,
      },
      {
        id: 5,
        name: 'Barbara Liskov',
        kind: 'Annual leave',
        days: 5,
        from: '2026-12-22',
        balanceAfter: 1,
      },
    ];

    const [requests, setRequests] = useState(initial);
    const [kind, setKind] = useState<string[]>([]);
    const { toast } = useToast();

    const pending = requests.filter((request) => !request.decided);
    const visible = kind.length === 0 ? pending : pending.filter((r) => kind.includes(r.kind));

    const decide = (request: LeaveRequest, decision: 'approved' | 'rejected'): void => {
      setRequests((current) =>
        current.map((r) => (r.id === request.id ? { ...r, decided: decision } : r)),
      );
      toast({
        tone: decision === 'approved' ? 'success' : 'neutral',
        title: `${request.name}'s request ${decision}`,
        description: `${request.kind}, ${String(request.days)} days from ${request.from}.`,
        action: {
          label: 'Undo',
          onClick: () => {
            setRequests((current) =>
              // Rebuilt without the key rather than set to `undefined`: with
              // `exactOptionalPropertyTypes`, "absent" and "present but
              // undefined" are different types, and only the first is valid here.
              current.map((r) => {
                if (r.id !== request.id) return r;
                const { id, name, kind: leaveKind, days, from, balanceAfter } = r;
                return { id, name, kind: leaveKind, days, from, balanceAfter };
              }),
            );
          },
        },
      });
    };

    return (
      <div className="min-h-screen bg-canvas p-4 sm:p-6">
        <Container size="md">
          <Stack gap={4}>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-fg">Approvals</h1>
                <p aria-live="polite" className="mt-1 text-sm text-fg-muted">
                  <span className="tabular-nums">{pending.length}</span> waiting on you
                </p>
              </div>
              <ToggleGroup
                type="multiple"
                value={kind}
                onValueChange={setKind}
                aria-label="Filter by leave type"
              >
                <ToggleGroupItem value="Annual leave" size="sm">
                  Annual
                </ToggleGroupItem>
                <ToggleGroupItem value="Sick leave" size="sm">
                  Sick
                </ToggleGroupItem>
                <ToggleGroupItem value="Unpaid leave" size="sm">
                  Unpaid
                </ToggleGroupItem>
              </ToggleGroup>
            </header>

            <Tabs defaultValue="pending">
              <TabsList>
                <TabsTrigger value="pending">
                  Pending
                  <Badge tone="warning" size="sm">
                    {pending.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="decided">
                  Decided
                  <Badge size="sm">{requests.length - pending.length}</Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending">
                {visible.length === 0 ? (
                  <EmptyState
                    icon={<Check />}
                    title={
                      pending.length === 0
                        ? 'Nothing left to review'
                        : 'Nothing matches that filter'
                    }
                    description={
                      pending.length === 0
                        ? 'Every request has been decided. New ones appear here as they are submitted.'
                        : 'Clear the leave-type filter to see the rest of the queue.'
                    }
                    action={
                      kind.length > 0 ? (
                        <Button
                          onClick={() => {
                            setKind([]);
                          }}
                        >
                          Clear filter
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border bg-surface">
                    {visible.map((request) => (
                      <div key={request.id} className="flex items-center gap-3 p-3">
                        <Avatar size="sm" name={request.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-medium text-fg">{request.name}</p>
                          <p className="truncate text-sm text-fg-muted">
                            {request.kind} · {request.days} days from{' '}
                            <time dateTime={request.from}>{request.from}</time>
                          </p>
                        </div>

                        <Sheet>
                          <SheetTrigger asChild>
                            <Button size="sm">Review</Button>
                          </SheetTrigger>
                          <SheetContent size="lg">
                            <SheetHeader>
                              <SheetTitle>{request.name}</SheetTitle>
                            </SheetHeader>
                            <SheetBody>
                              <Stack gap={5}>
                                <dl className="grid grid-cols-2 gap-4 text-base">
                                  <div>
                                    <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                                      Type
                                    </dt>
                                    <dd className="mt-1 text-fg">{request.kind}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                                      Duration
                                    </dt>
                                    <dd className="mt-1 tabular-nums text-fg">
                                      {request.days} days
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                                      Balance after
                                    </dt>
                                    <dd className="mt-1 tabular-nums text-fg">
                                      {request.balanceAfter} days
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                                      Payroll impact
                                    </dt>
                                    <dd className="mt-1 text-fg">
                                      {request.kind === 'Unpaid leave' ? (
                                        <Money minorUnits="-142000" currency="EUR" locale="en-IE" />
                                      ) : (
                                        'None'
                                      )}
                                    </dd>
                                  </div>
                                </dl>

                                {request.balanceAfter <= 2 ? (
                                  <Alert tone="warning" title="Low balance after approval">
                                    {request.name} will have {request.balanceAfter} days left for
                                    the rest of the year.
                                  </Alert>
                                ) : null}
                              </Stack>
                            </SheetBody>
                            <SheetFooter>
                              <Button
                                variant="destructive"
                                onClick={() => {
                                  decide(request, 'rejected');
                                }}
                              >
                                Reject
                              </Button>
                              <Button
                                variant="primary"
                                onClick={() => {
                                  decide(request, 'approved');
                                }}
                              >
                                Approve
                              </Button>
                            </SheetFooter>
                          </SheetContent>
                        </Sheet>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="decided">
                {requests.filter((r) => r.decided).length === 0 ? (
                  <p className="py-8 text-center text-sm text-fg-muted">Nothing decided yet.</p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border bg-surface">
                    {requests
                      .filter((request) => request.decided)
                      .map((request) => (
                        <div key={request.id} className="flex items-center gap-3 p-3">
                          <Avatar size="sm" name={request.name} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base text-fg">{request.name}</p>
                            <p className="truncate text-sm text-fg-muted">{request.kind}</p>
                          </div>
                          <Badge
                            tone={request.decided === 'approved' ? 'success' : 'danger'}
                            size="sm"
                            dot
                          >
                            {request.decided === 'approved' ? 'Approved' : 'Rejected'}
                          </Badge>
                        </div>
                      ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </Stack>
        </Container>
      </div>
    );
  },
};

/* -------------------------------------------------------------------------- */
/* 6. Loading and failure                                                      */
/* -------------------------------------------------------------------------- */

export const LoadingAndFailure: Story = {
  name: 'Loading, empty and failure',
  parameters: {
    docs: {
      description: {
        story: [
          'The three states every screen has and most design systems skip. Press the buttons to move between them.',
          '',
          '- **Loading**: skeletons shaped like the content they replace, at the same heights, so nothing moves when the data lands. A spinner in the middle of an empty page tells the user nothing about what is coming.',
          '- **Empty**: says what would be here, and offers the action that would create it. "No data" is not an empty state.',
          '- **Failure**: says what failed, what still worked, and what to do. It is an `Alert` on the page rather than a toast, because a failure the user must act on cannot be allowed to expire after five seconds.',
        ].join('\n'),
      },
    },
  },
  render: function StatesStory() {
    const [state, setState] = useState<'loading' | 'empty' | 'failed' | 'loaded'>('loading');

    return (
      <div className="min-h-screen bg-canvas p-4 sm:p-6">
        <Container size="md">
          <Stack gap={4}>
            <Inline gap={2}>
              {(['loading', 'empty', 'failed', 'loaded'] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={state === value ? 'subtle' : 'secondary'}
                  onClick={() => {
                    setState(value);
                  }}
                >
                  {value}
                </Button>
              ))}
            </Inline>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Payroll register. August 2026</CardTitle>
                  <CardDescription>912 employees, 4 legal entities.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {state === 'loading' ? (
                  <div role="status" aria-label="Loading payroll register" className="space-y-3">
                    {Array.from({ length: 5 }, (_, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="size-8 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                        <Skeleton className="h-4 w-24" />
                      </div>
                    ))}
                  </div>
                ) : null}

                {state === 'empty' ? (
                  <EmptyState
                    icon={<Filter />}
                    title="No payments in this period"
                    description="The August run has not been started. Payments appear here once it has been calculated."
                    action={<Button variant="primary">Start the August run</Button>}
                  />
                ) : null}

                {state === 'failed' ? (
                  <Stack gap={4}>
                    <Alert tone="danger" title="Payroll failed for 4 of 912 employees">
                      <p>
                        Grace Hopper, Ada Lovelace, Joan Clarke and Katherine Johnson have no valid
                        IBAN on file. The other 908 payments were calculated and are ready to
                        submit.
                      </p>
                      <Inline gap={2} className="mt-3">
                        <Button size="sm">Review the four records</Button>
                        <Button size="sm" variant="ghost" startIcon={<ArrowDownUp />}>
                          Retry those four
                        </Button>
                      </Inline>
                    </Alert>
                    <p className="text-sm text-fg-muted">
                      The rest of the register is shown below and can still be submitted.
                    </p>
                  </Stack>
                ) : null}

                {state === 'loaded' ? (
                  <Table aria-label="Payroll register">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="max-sm:hidden">Entity</TableHead>
                        <TableHead numeric>Gross</TableHead>
                        <TableHead numeric>Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {directory.slice(0, 5).map((person) => (
                        <TableRow key={person.id}>
                          <TableCell className="font-medium">{person.name}</TableCell>
                          <TableCell className="text-fg-muted max-sm:hidden">
                            Acme Iberia SL
                          </TableCell>
                          <TableCell numeric>
                            <Money
                              minorUnits={String(Math.round(Number(person.salaryMinor) / 12))}
                              currency="EUR"
                              locale="en-IE"
                            />
                          </TableCell>
                          <TableCell numeric>
                            <Money
                              minorUnits={String(
                                Math.round((Number(person.salaryMinor) / 12) * 0.69),
                              )}
                              currency="EUR"
                              locale="en-IE"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </CardContent>
            </Card>

            {state === 'loading' ? (
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Calculating 912 payments…
              </p>
            ) : null}
          </Stack>
        </Container>
      </div>
    );
  },
};
