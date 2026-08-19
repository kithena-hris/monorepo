/**
 * The rest of the catalogue.
 *
 * Split from `registry.tsx` only because one file holding sixty components is a
 * file nobody reviews. The shape is identical and the two are concatenated in
 * `PAGES`; there is no distinction between a component documented here and one
 * documented there.
 *
 * Controlled components are demonstrated with real state. Reach deliberately
 * gives `Combobox`, `PinInput`, `TagsInput` and friends no internal value, so an
 * example that passed a constant would be showing a control that cannot be
 * typed into, which is worse than no example.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  AutoGrid,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Calendar,
  Combobox,
  Container,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  CopyButton,
  CopyField,
  CurrencyField,
  DatePicker,
  Dropzone,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  EmptyState,
  Inline,
  Kbd,
  ListDetail,
  Money,
  NumberField,
  Pagination,
  PasswordField,
  PhoneField,
  PinInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Rating,
  Reveal,
  ScrollArea,
  SearchField,
  Separator,
  Skeleton,
  Slider,
  Split,
  Stack,
  Stat,
  Stepper,
  TagsInput,
  Timeline,
  TimelineItem,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  VirtualList,
  type ComboboxOption,
  type IsoDate,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { DocPage } from './doc-types';

/* ------------------------------------------------------------- navigation -- */

const breadcrumb: DocPage = {
  slug: 'breadcrumb',
  title: 'Breadcrumb',
  description: 'Where this page sits, and the way back up.',
  when: 'Only where the hierarchy is real. A breadcrumb on a flat app invents a structure that does not exist and readers learn to ignore it.',
  importLine:
    "import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      blurb:
        'The last crumb is a `BreadcrumbPage`, not a link. Linking the page you are already on is the commonest breadcrumb bug and it costs a screen-reader user a wasted navigation.',
      render: () => (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#/breadcrumb">People</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#/breadcrumb">Platform</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Grace Hopper</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      ),
      code: `<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="/people">People</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Grace Hopper</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>`,
    },
  ],
};

const pagination: DocPage = {
  slug: 'pagination',
  title: 'Pagination',
  description: 'Moving through a result set a page at a time.',
  importLine: "import { Pagination } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function PaginationDemo(): JSX.Element {
        const [page, setPage] = useState(3);
        return <Pagination page={page} pageCount={12} onPageChange={setPage} />;
      },
      code: `const [page, setPage] = useState(1);

<Pagination page={page} pageCount={12} onPageChange={setPage} />`,
    },
  ],
};

const dropdownMenu: DocPage = {
  slug: 'dropdown-menu',
  title: 'Dropdown menu',
  description: 'Actions on a thing, gathered behind one control.',
  when: 'A menu holds commands. If the reader is choosing a value rather than running a command, that is a Select.',
  importLine:
    "import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Leave request</DropdownMenuLabel>
            <DropdownMenuItem>
              Approve
              <DropdownMenuShortcut>⌘↵</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>Ask for cover</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>Reject</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      code: `<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="secondary">Actions</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuLabel>Leave request</DropdownMenuLabel>
    <DropdownMenuItem>Approve<DropdownMenuShortcut>⌘↵</DropdownMenuShortcut></DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem destructive>Reject</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>`,
    },
  ],
};

const contextMenu: DocPage = {
  slug: 'context-menu',
  title: 'Context menu',
  description: 'The same commands, on right-click.',
  when: 'Never the only route to an action. A context menu is invisible on touch and to anyone who does not right-click, so every command here needs a reachable twin.',
  importLine:
    "import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <ContextMenu>
          <ContextMenuTrigger className="grid h-24 w-64 place-items-center rounded-md border border-dashed border-border-strong text-sm text-fg-muted">
            Right-click this row
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Open</ContextMenuItem>
            <ContextMenuItem>Duplicate</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem destructive>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ),
      code: `<ContextMenu>
  <ContextMenuTrigger>Right-click this row</ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem>Open</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem destructive>Delete</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>`,
    },
  ],
};

const popover: DocPage = {
  slug: 'popover',
  title: 'Popover',
  description: 'A small surface anchored to what opened it.',
  when: 'A popover can hold controls; a tooltip cannot. If the reader needs to click something inside it, it is this.',
  importLine: "import { Popover, PopoverContent, PopoverTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Filter</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <p className="text-sm font-medium text-fg">Filter by team</p>
            <p className="mt-1 text-sm text-fg-muted">
              The panel grows from the trigger, so the reader keeps track of where it came from.
            </p>
          </PopoverContent>
        </Popover>
      ),
      code: `<Popover>
  <PopoverTrigger asChild>
    <Button variant="secondary">Filter</Button>
  </PopoverTrigger>
  <PopoverContent className="w-64">…</PopoverContent>
</Popover>`,
    },
  ],
};

const alertDialog: DocPage = {
  slug: 'alert-dialog',
  title: 'Alert dialog',
  description: 'Confirming something irreversible.',
  when: 'The overlay does not dismiss this one. A destructive confirmation that closes on a stray click is a confirmation that did not happen.',
  importLine:
    "import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogTitle, AlertDialogTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Offboard</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Offboard Grace Hopper?</AlertDialogTitle>
            <AlertDialogDescription>
              Access is revoked immediately and the final payslip is scheduled. This cannot be
              undone from here.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep active</AlertDialogCancel>
              <AlertDialogAction>Offboard</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
      code: `<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Offboard</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogTitle>Offboard Grace Hopper?</AlertDialogTitle>
    <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
    <AlertDialogFooter>
      <AlertDialogCancel>Keep active</AlertDialogCancel>
      <AlertDialogAction>Offboard</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>`,
    },
  ],
};

/* ------------------------------------------------------------------ forms -- */

const combobox: DocPage = {
  slug: 'combobox',
  title: 'Combobox',
  description: 'A value from a list long enough to want typing.',
  when: 'Past roughly twenty options a Select stops being scannable. This filters as you type.',
  importLine: "import { Combobox } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: function ComboboxDemo(): JSX.Element {
        const options: ComboboxOption[] = [
          { value: 'platform', label: 'Platform' },
          { value: 'payroll', label: 'Payroll' },
          { value: 'people-ops', label: 'People Ops' },
          { value: 'recruiting', label: 'Recruiting' },
          { value: 'finance', label: 'Finance' },
        ];
        const [value, setValue] = useState<string | readonly string[] | null>('payroll');
        return (
          <div className="w-full max-w-56">
            <Combobox options={options} value={value} onChange={setValue} label="Team" />
          </div>
        );
      },
      code: `const [value, setValue] = useState<string | null>(null);

<Combobox options={teams} value={value} onChange={setValue} label="Team" />`,
    },
  ],
};

const datePicker: DocPage = {
  slug: 'date-picker',
  title: 'Date picker',
  description: 'A calendar date, or a period.',
  when: 'Hire dates and leave are calendar dates, not instants. Someone hired on the 1st in Barcelona was not hired on the 31st in Los Angeles.',
  importLine: "import { DatePicker } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Single date',
      tall: true,
      render: function DatePickerDemo(): JSX.Element {
        const [value, setValue] = useState<IsoDate | null>('2026-09-14');
        return (
          <div className="w-full max-w-56">
            <DatePicker
              mode="single"
              value={value}
              onChange={setValue}
              label="First day of leave"
            />
          </div>
        );
      },
      code: `const [value, setValue] = useState<IsoDate | null>(null);

<DatePicker mode="single" value={value} onChange={setValue} label="First day of leave" />`,
    },
  ],
};

const calendar: DocPage = {
  slug: 'calendar',
  title: 'Calendar',
  description: 'The grid itself, for when the month matters.',
  when: 'Today is injected rather than read from the clock, so a screenshot test does not change every midnight.',
  importLine: "import { Calendar } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: function CalendarDemo(): JSX.Element {
        const [selected, setSelected] = useState<IsoDate | null>('2026-08-17');
        return (
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            today="2026-08-12"
            month="2026-08-01"
            label="Leave date"
          />
        );
      },
      code: `const [selected, setSelected] = useState<IsoDate | null>(null);

<Calendar mode="single" selected={selected} onSelect={setSelected} label="Leave date" />`,
    },
  ],
};

const numberField: DocPage = {
  slug: 'number-field',
  title: 'Number field',
  description: 'A quantity, with steppers.',
  when: 'Clamping happens on blur, not on keystroke: clamping as someone types makes it impossible to enter 12 when the minimum is 2.',
  importLine: "import { NumberField } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function NumberFieldDemo(): JSX.Element {
        const [value, setValue] = useState<number | null>(5);
        return (
          <div className="w-full max-w-48">
            <NumberField value={value} onChange={setValue} label="Working days" min={0} max={25} />
          </div>
        );
      },
      code: `const [value, setValue] = useState<number | null>(5);

<NumberField value={value} onChange={setValue} label="Working days" min={0} max={25} />`,
    },
  ],
};

const pinInput: DocPage = {
  slug: 'pin-input',
  title: 'PIN input',
  description: 'A short code, one box per character.',
  importLine: "import { PinInput } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function PinDemo(): JSX.Element {
        const [value, setValue] = useState('12');
        return <PinInput value={value} onChange={setValue} label="Verification code" length={6} />;
      },
      code: `const [value, setValue] = useState('');

<PinInput value={value} onChange={setValue} label="Verification code" length={6} />`,
    },
  ],
};

const tagsInput: DocPage = {
  slug: 'tags-input',
  title: 'Tags input',
  description: 'A set of short values, entered one at a time.',
  importLine: "import { TagsInput } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function TagsDemo(): JSX.Element {
        const [value, setValue] = useState<readonly string[]>(['platform', 'payroll']);
        return (
          <div className="w-full max-w-sm">
            <TagsInput value={value} onChange={setValue} label="Teams to notify" />
          </div>
        );
      },
      code: `const [value, setValue] = useState<readonly string[]>([]);

<TagsInput value={value} onChange={setValue} label="Teams to notify" />`,
    },
  ],
};

const passwordField: DocPage = {
  slug: 'password-field',
  title: 'Password field',
  description: 'A password, with a strength meter and requirements.',
  when: '`autoComplete` is required, not optional. A new-password field that autofills the current one is a field nobody can complete.',
  importLine: "import { PasswordField } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function PasswordDemo(): JSX.Element {
        const [value, setValue] = useState('correct horse');
        return (
          <div className="w-full max-w-sm">
            <PasswordField
              value={value}
              onChange={setValue}
              label="New password"
              autoComplete="new-password"
              showStrength
            />
          </div>
        );
      },
      code: `const [value, setValue] = useState('');

<PasswordField
  value={value}
  onChange={setValue}
  label="New password"
  autoComplete="new-password"
  showStrength
/>`,
    },
  ],
};

const typedFields: DocPage = {
  slug: 'typed-fields',
  title: 'Typed fields',
  description: 'Search, currency and telephone, each with the rules its type needs.',
  when: 'A currency field is not an input with a symbol glued on. It holds minor units, so the value never passes through a float.',
  importLine: "import { CurrencyField, PhoneField, SearchField } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'The three',
      render: function TypedDemo(): JSX.Element {
        const [search, setSearch] = useState('');
        // Minor units, as a string. Never a number: `Number()` loses cents at
        // the fifteenth digit and payroll does not tolerate rounding.
        const [amount, setAmount] = useState('4500000');
        const [phone, setPhone] = useState('600 000 000');
        return (
          <div className="w-full max-w-sm space-y-4">
            <SearchField value={search} onValueChange={setSearch} label="Search people" />
            <CurrencyField
              value={amount}
              onValueChange={setAmount}
              aria-label="Base salary"
              currency="EUR"
            />
            <PhoneField value={phone} onValueChange={setPhone} label="Mobile" />
          </div>
        );
      },
      code: `<SearchField value={search} onValueChange={setSearch} label="Search people" />
{/* Minor units as a string: '4500000' is €45,000.00. */}
<CurrencyField value={amount} onValueChange={setAmount} currency="EUR" aria-label="Base salary" />
<PhoneField value={phone} onValueChange={setPhone} label="Mobile" />`,
    },
  ],
};

const slider: DocPage = {
  slug: 'slider',
  title: 'Slider',
  description: 'A value in a range, chosen by dragging.',
  when: 'Only where the exact number does not matter. If it does, that is a Number field.',
  importLine: "import { Slider } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="w-full max-w-sm">
          <Slider label="Full-time equivalent" defaultValue={[80]} min={0} max={100} step={5} />
        </div>
      ),
      code: `<Slider label="Full-time equivalent" defaultValue={[80]} min={0} max={100} step={5} />`,
    },
  ],
};

const rating: DocPage = {
  slug: 'rating',
  title: 'Rating',
  description: 'A score on a small fixed scale.',
  importLine: "import { Rating } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function RatingDemo(): JSX.Element {
        const [value, setValue] = useState(4);
        return (
          <div className="space-y-3">
            <Rating label="Performance" value={value} onChange={setValue} showValue />
            <Rating label="Onboarding experience" value={4} max={5} />
          </div>
        );
      },
      code: `const [value, setValue] = useState(4);

<Rating label="Performance" value={value} onChange={setValue} showValue />`,
    },
  ],
};

const toggle: DocPage = {
  slug: 'toggle',
  title: 'Toggle',
  description: 'A control that stays pressed, alone or in a group.',
  importLine: "import { Toggle, ToggleGroup, ToggleGroupItem } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Single and grouped',
      render: () => (
        <div className="flex flex-wrap items-center gap-6">
          <Toggle aria-label="Show only my team">My team</Toggle>
          <ToggleGroup type="single" defaultValue="month" aria-label="Range">
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
            <ToggleGroupItem value="quarter">Quarter</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ),
      code: `<Toggle aria-label="Show only my team">My team</Toggle>

<ToggleGroup type="single" defaultValue="month" aria-label="Range">
  <ToggleGroupItem value="week">Week</ToggleGroupItem>
  <ToggleGroupItem value="month">Month</ToggleGroupItem>
</ToggleGroup>`,
    },
  ],
};

/* ------------------------------------------------------------------- data -- */

const stat: DocPage = {
  slug: 'stat',
  title: 'Stat',
  description: 'One figure, with its label and its movement.',
  when: 'The delta needs a direction word as well as a colour, because up is not always good: rising absence is not an improvement.',
  importLine: "import { Stat } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="grid w-full max-w-lg gap-3 sm:grid-cols-3">
          <Stat label="Headcount" value="1,284" delta="+24" direction="up" sentiment="positive" />
          <Stat label="Open requests" value="37" delta="−8" direction="down" sentiment="positive" />
          <Stat label="Average tenure" value="3.4 yrs" />
        </div>
      ),
      code: `{/* Direction is the arrow; sentiment is whether that is good news.
    Falling open requests point down and are positive. */}
<Stat label="Open requests" value="37" delta="−8" direction="down" sentiment="positive" />`,
    },
  ],
};

const money: DocPage = {
  slug: 'money',
  title: 'Money',
  description: 'An amount, formatted exactly.',
  when: 'Minor units in, exact string formatting out. `Number()` loses cents at the fifteenth digit and payroll does not tolerate rounding.',
  importLine: "import { Money } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="space-y-1 text-lg text-fg">
          <p>
            <Money minorUnits="4500000" currency="EUR" />
          </p>
          <p>
            <Money minorUnits="-125050" currency="GBP" signColored />
          </p>
          <p>
            <Money minorUnits="98765432109876" currency="JPY" />
          </p>
        </div>
      ),
      code: `<Money minorUnits="4500000" currency="EUR" />
<Money minorUnits="-125050" currency="GBP" signColored />`,
    },
  ],
};

const timeline: DocPage = {
  slug: 'timeline',
  title: 'Timeline',
  description: 'What happened, and when it took effect.',
  when: 'Two dates, not one. A promotion entered on the 15th and effective on the 1st needs both, or payroll cannot compute the retroactive delta.',
  importLine: "import { Timeline, TimelineItem } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <Timeline className="w-full max-w-md">
          <TimelineItem
            title="Promotion to Principal Engineer"
            timestamp="Recorded 15 March"
            effectiveFrom="Effective 1 March"
            tone="success"
          />
          <TimelineItem title="Moved to Platform" timestamp="Recorded 4 January" tone="accent" />
          <TimelineItem title="Hired" timestamp="Recorded 4 March 2021" last />
        </Timeline>
      ),
      code: `<Timeline>
  <TimelineItem
    title="Promotion to Principal Engineer"
    timestamp="Recorded 15 March"
    effectiveFrom="Effective 1 March"
    tone="success"
  />
  <TimelineItem title="Hired" timestamp="Recorded 4 March 2021" last />
</Timeline>`,
    },
  ],
};

const virtualList: DocPage = {
  slug: 'virtual-list',
  title: 'Virtual list',
  description: 'Thousands of rows, a couple of dozen mounted.',
  when: 'Not for a settings panel. Virtualisation costs you find-in-page and simple printing, so it earns its place only when the list is genuinely long.',
  importLine: "import { VirtualList } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: function VirtualDemo(): JSX.Element {
        const people = Array.from({ length: 2000 }, (_, index) => ({
          id: `P-${String(index)}`,
          name: `Employee ${String(index + 1)}`,
        }));
        return (
          <VirtualList
            items={people}
            label="Everyone"
            itemKey={(person) => person.id}
            estimateItemHeight={40}
            className="h-56 w-full max-w-sm rounded-md border border-border"
            renderItem={(person) => (
              <div className="border-b border-border px-3 py-2 text-sm text-fg">{person.name}</div>
            )}
          />
        );
      },
      code: `<VirtualList
  items={people}
  label="Everyone"
  itemKey={(person) => person.id}
  estimateItemHeight={40}
  renderItem={(person) => <Row person={person} />}
/>`,
    },
  ],
};

/* --------------------------------------------------------------- feedback -- */

const feedback: DocPage = {
  slug: 'feedback',
  title: 'Skeleton and empty state',
  description: 'What a screen shows before it has anything, and when it has nothing.',
  when: 'An empty state that only says “No results” wastes the one moment the reader is asking what to do next. Give it an action.',
  importLine: "import { EmptyState, Skeleton } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Loading and empty',
      tall: true,
      render: () => (
        <div className="grid w-full gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <EmptyState
            title="No requests to review"
            description="Everything in your queue has been decided."
            action={<Button size="sm">View decided</Button>}
          />
        </div>
      ),
      code: `<Skeleton className="h-4 w-2/3" />

<EmptyState
  title="No requests to review"
  description="Everything in your queue has been decided."
  action={<Button size="sm">View decided</Button>}
/>`,
    },
  ],
};

const clipboard: DocPage = {
  slug: 'clipboard',
  title: 'Clipboard',
  description: 'Copying a value, and saying so.',
  when: 'The clipboard API is absent on an insecure origin, which is the commonest way this fails on an internal tool. Both components degrade rather than throw.',
  importLine: "import { CopyButton, CopyField } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Button and field',
      render: () => (
        <div className="w-full max-w-sm space-y-4">
          <CopyButton value="EMP-10482" label="Copy employee number">
            Copy employee number
          </CopyButton>
          <CopyField value="https://kithena.example/people/EMP-10482" label="Share link" />
        </div>
      ),
      code: `<CopyButton value="EMP-10482">Copy employee number</CopyButton>

<CopyField value={shareUrl} label="Share link" />`,
    },
  ],
};

const kbd: DocPage = {
  slug: 'kbd',
  title: 'Kbd',
  description: 'A key, printed the way the platform prints it.',
  when: 'A shortcut shown as ⌘B and bound to Ctrl+B is a shortcut that looks broken on a Mac. `keyName="mod"` resolves per platform.',
  importLine: "import { Kbd } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      blurb:
        '`keyName` replaces the children with the platform glyph, so a combination is two keys side by side rather than one `Kbd` holding both. A single `<Kbd keyName="mod">K</Kbd>` renders a lone ⌘ and drops the K.',
      render: () => (
        <div className="flex flex-wrap items-center gap-4 text-sm text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-0.5">
              <Kbd keyName="mod" />
              <Kbd>K</Kbd>
            </span>
            Search
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-0.5">
              <Kbd keyName="shift" />
              <Kbd>?</Kbd>
            </span>
            Shortcuts
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keyName="esc" />
            Close
          </span>
        </div>
      ),
      code: `{/* Two keys, because \`keyName\` replaces the children. */}
<Kbd keyName="mod" />
<Kbd>K</Kbd>

<Kbd keyName="esc" />`,
    },
  ],
};

const spinnerPage: DocPage = {
  slug: 'reveal',
  title: 'Reveal',
  description: 'Content that expands in place.',
  when: 'Height is animated from a measured value, because `auto` is not animatable and a collapse that jumps is worse than one that does not animate at all.',
  importLine: "import { Reveal } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function RevealDemo(): JSX.Element {
        const [open, setOpen] = useState(false);
        return (
          <div className="w-full max-w-sm space-y-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              {open ? 'Hide payroll detail' : 'Show payroll detail'}
            </Button>
            <Reveal open={open}>
              <div className="rounded-md border border-border bg-surface p-3 text-sm text-fg-muted">
                Paid monthly on the 26th. Next run closes on the 18th.
              </div>
            </Reveal>
          </div>
        );
      },
      code: `const [open, setOpen] = useState(false);

<Reveal open={open}>
  <PayrollDetail />
</Reveal>`,
    },
  ],
};

const separator: DocPage = {
  slug: 'separator',
  title: 'Separator',
  description: 'A rule between groups.',
  when: 'Decorative by default, so a screen reader does not announce a line that carries no meaning.',
  importLine: "import { Separator } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="w-full max-w-sm text-sm text-fg-muted">
          <p>Personal details</p>
          <Separator className="my-3" />
          <p>Employment</p>
          <div className="mt-3 flex h-8 items-center gap-3">
            <span>Draft</span>
            <Separator orientation="vertical" />
            <span>Auto-saved</span>
          </div>
        </div>
      ),
      code: `<Separator />
<Separator orientation="vertical" />`,
    },
  ],
};

const scrollArea: DocPage = {
  slug: 'scroll-area',
  title: 'Scroll area',
  description: 'A scrolling region with a bar you can see.',
  when: 'For a settings panel or a menu. For twenty thousand rows, use a Virtual list.',
  importLine: "import { ScrollArea } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <ScrollArea className="h-40 w-full max-w-sm rounded-md border border-border">
          <div className="p-3">
            {Array.from({ length: 24 }, (_, index) => (
              <p key={index} className="border-b border-border py-1.5 text-sm text-fg">
                Employee {index + 1}
              </p>
            ))}
          </div>
        </ScrollArea>
      ),
      code: `<ScrollArea className="h-40 rounded-md border border-border">
  <div className="p-3">…</div>
</ScrollArea>`,
    },
  ],
};

/* ----------------------------------------------------------------- layout -- */

const layout: DocPage = {
  slug: 'layout',
  title: 'Layout',
  description: 'Stack, Inline, Split, AutoGrid and Container.',
  when: 'Five primitives instead of a hundred one-off flex utilities. Gaps come from one scale, so two screens built by two people still line up.',
  importLine: "import { AutoGrid, Container, Inline, Split, Stack } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'The primitives',
      tall: true,
      render: () => (
        <Container className="w-full">
          <Stack gap={4}>
            <Inline gap={2}>
              <Button size="sm">One</Button>
              <Button size="sm" variant="secondary">
                Two
              </Button>
              <Button size="sm" variant="ghost">
                Three
              </Button>
            </Inline>
            <Split
              aside={
                <Button size="sm" variant="secondary">
                  Action
                </Button>
              }
            >
              <span className="text-sm text-fg">Split holds a main pane and an aside</span>
            </Split>
            <AutoGrid minItemWidth="8rem" gap={3}>
              {['Platform', 'Payroll', 'People Ops', 'Finance'].map((team) => (
                <div
                  key={team}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
                >
                  {team}
                </div>
              ))}
            </AutoGrid>
          </Stack>
        </Container>
      ),
      code: `<Stack gap={4}>
  <Inline gap={2}>…</Inline>
  <Split>…</Split>
  <AutoGrid minItemWidth="8rem" gap={3}>…</AutoGrid>
</Stack>`,
    },
  ],
};

const listDetail: DocPage = {
  slug: 'list-detail',
  title: 'List detail',
  description: 'A list, and the thing you picked from it.',
  when: 'One component, two interaction models. Wide, both panes are visible and nothing navigates. Narrow, the detail replaces the list and a back control returns to it, which is a push and has to behave like one.',
  importLine: "import { ListDetail } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: function ListDetailDemo(): JSX.Element {
        const [selected, setSelected] = useState<string | null>('Grace Hopper');
        const people = ['Grace Hopper', 'Ada Lovelace', 'Radia Perlman'];
        return (
          <ListDetail
            className="w-full rounded-md border border-border"
            selected={selected !== null}
            onBack={() => {
              setSelected(null);
            }}
            list={
              <ul className="p-2">
                {people.map((person) => (
                  <li key={person}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(person);
                      }}
                      aria-current={selected === person ? 'true' : undefined}
                      className="w-full rounded-sm px-2 py-1.5 text-start text-sm text-fg-muted hover:bg-surface-hover aria-[current]:bg-surface-hover aria-[current]:text-fg"
                    >
                      {person}
                    </button>
                  </li>
                ))}
              </ul>
            }
            detail={
              selected ? (
                <div className="p-4">
                  <p className="font-medium text-fg">{selected}</p>
                  <p className="mt-1 text-sm text-fg-muted">Principal Engineer · Platform</p>
                </div>
              ) : null
            }
            emptyDetail={
              <div className="grid h-full place-items-center p-6 text-sm text-fg-subtle">
                Pick someone from the list.
              </div>
            }
          />
        );
      },
      code: `<ListDetail
  selected={selected !== null}
  onBack={() => setSelected(null)}
  list={<PeopleList onPick={setSelected} />}
  detail={selected ? <PersonDetail id={selected} /> : null}
  emptyDetail={<p>Pick someone from the list.</p>}
/>`,
    },
  ],
};

const stepper: DocPage = {
  slug: 'stepper',
  title: 'Stepper',
  description: 'A sequence the reader has to follow in order.',
  when: 'If the panels have no required order, they are Tabs.',
  importLine: "import { Stepper } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <Stepper
          label="Onboarding"
          current={1}
          steps={[
            { id: 'details', label: 'Personal details' },
            { id: 'contract', label: 'Contract', description: 'Signed and countersigned' },
            { id: 'payroll', label: 'Payroll' },
          ]}
        />
      ),
      code: `<Stepper
  label="Onboarding"
  current={1}
  steps={[
    { id: 'details', label: 'Personal details' },
    { id: 'contract', label: 'Contract' },
    { id: 'payroll', label: 'Payroll' },
  ]}
/>`,
    },
  ],
};

const dropzone: DocPage = {
  slug: 'dropzone',
  title: 'Dropzone',
  description: 'A target for dropped files, and a button for everyone else.',
  when: 'Drag and drop is never the only route. A dropzone with no file picker is unusable by keyboard.',
  importLine: "import { Dropzone } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: function DropzoneDemo(): JSX.Element {
        const [count, setCount] = useState(0);
        return (
          <div className="w-full max-w-sm space-y-2">
            <Dropzone
              label="Contract PDF"
              onFiles={(files) => {
                setCount(files.length);
              }}
            />
            {count > 0 ? <p className="text-sm text-fg-muted">{count} file(s) accepted.</p> : null}
          </div>
        );
      },
      code: `<Dropzone label="Contract PDF" onFiles={(files) => upload(files)} />`,
    },
  ],
};

/* ------------------------------------------------------------------ index -- */

export const MORE_PAGES: readonly DocPage[] = [
  alertDialog,
  breadcrumb,
  calendar,
  clipboard,
  combobox,
  contextMenu,
  datePicker,
  dropdownMenu,
  dropzone,
  feedback,
  kbd,
  layout,
  listDetail,
  money,
  numberField,
  pagination,
  passwordField,
  pinInput,
  popover,
  rating,
  scrollArea,
  separator,
  slider,
  spinnerPage,
  stat,
  stepper,
  tagsInput,
  timeline,
  toggle,
  typedFields,
  virtualList,
];
