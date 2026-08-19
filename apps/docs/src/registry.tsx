/**
 * The documentation content, as data.
 *
 * Every page is a list of sections, and every section carries both a live
 * example and the source that produced it. They are written next to each other
 * on purpose: a docs site whose snippet is a string typed by hand beside a
 * different rendered example is a docs site that lies within a week. Here the
 * `render` is what the reader sees and the `code` is what they copy, and the
 * two are reviewed in one diff.
 *
 * The examples import from `@reach/ui` exactly as an application does. Nothing
 * in this file reaches into the design system's internals or restyles it, so
 * what renders here is what a module gets.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipProvider,
} from '@reach/ui';
import type { DocPage, NavGroup } from './doc-types';

import { CHART_PAGES, CHART_SLUGS } from './registry-charts';
import { COMPLEX_PAGES } from './registry-complex';
import { MORE_PAGES } from './registry-more';

/* -------------------------------------------------------------- components -- */

const button: DocPage = {
  slug: 'button',
  title: 'Button',
  description: 'The primary action control.',
  when: 'Exactly one primary button per view. If a screen has two, one of them is really a secondary action and the hierarchy is lying to the reader.',
  importLine: "import { Button } from '@reach/ui';",
  sections: [
    {
      id: 'variants',
      title: 'Variants',
      blurb:
        'Five weights and a link. The variant carries the hierarchy, so a destructive action never needs a colour prop of its own.',
      render: () => (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Approve</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="subtle">Filter</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="link">Learn more</Button>
        </div>
      ),
      code: `<Button variant="primary">Approve</Button>
<Button variant="secondary">Save draft</Button>
<Button variant="ghost">Cancel</Button>
<Button variant="subtle">Filter</Button>
<Button variant="destructive">Delete</Button>
<Button variant="link">Learn more</Button>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      blurb:
        'Heights come from the density tokens, so the same `md` is 36px under a mouse and 44px under a thumb. The prop does not change; the pointer does.',
      render: () => (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      ),
      code: `<Button size="sm">Small</Button>
<Button size="md">Medium</Button>
<Button size="lg">Large</Button>`,
    },
    {
      id: 'loading',
      title: 'Loading',
      blurb:
        'The label stays mounted at zero opacity while the spinner runs, so the button cannot resize mid-submit and move the target out from under the pointer.',
      render: () => (
        <div className="flex flex-wrap items-center gap-2">
          <Button loading loadingLabel="Submitting">
            Submit request
          </Button>
          <Button variant="secondary" loading>
            Loading
          </Button>
        </div>
      ),
      code: `<Button loading loadingLabel="Submitting">Submit request</Button>`,
    },
    {
      id: 'as-link',
      title: 'As a link',
      blurb:
        'A button that navigates must stay an anchor. `asChild` forwards the styling onto the child rather than wrapping it, so the element the reader activates is the one that carries the href.',
      render: () => (
        <Button asChild variant="secondary">
          <a href="#/button">Open the handbook</a>
        </Button>
      ),
      code: `<Button asChild variant="secondary">
  <a href="/handbook">Open the handbook</a>
</Button>`,
    },
  ],
  props: [
    {
      name: 'variant',
      type: "'primary' | 'secondary' | 'ghost' | 'subtle' | 'destructive' | 'link'",
      default: "'secondary'",
      description: 'Visual weight, and therefore position in the hierarchy.',
    },
    {
      name: 'size',
      type: "'sm' | 'md' | 'lg'",
      default: "'md'",
      description: 'Snaps to a control height so buttons, inputs and selects line up on one row.',
    },
    {
      name: 'loading',
      type: 'boolean',
      default: 'false',
      description: 'Shows a spinner and blocks interaction without changing the button’s size.',
    },
    {
      name: 'loadingLabel',
      type: 'string',
      default: "'Loading'",
      description: 'Announced to assistive tech while loading.',
    },
    {
      name: 'asChild',
      type: 'boolean',
      default: 'false',
      description: 'Render the child element instead of a <button>, forwarding all styling.',
    },
  ],
};

const input: DocPage = {
  slug: 'input',
  title: 'Input',
  description: 'A single-line text field, and its multi-line sibling.',
  importLine: "import { Input, Textarea } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="w-full max-w-sm">
          <Input placeholder="grace.hopper@example.com" aria-label="Work email" />
        </div>
      ),
      code: `<Input placeholder="grace.hopper@example.com" aria-label="Work email" />`,
    },
    {
      id: 'invalid',
      title: 'Invalid',
      blurb:
        'Invalid state is carried by `aria-invalid`, not by a colour prop, so the border and the announcement can never disagree.',
      render: () => (
        <div className="w-full max-w-sm">
          <Input defaultValue="not-an-email" aria-invalid aria-label="Work email" />
        </div>
      ),
      code: `<Input aria-invalid defaultValue="not-an-email" />`,
    },
    {
      id: 'textarea',
      title: 'Textarea',
      render: () => (
        <div className="w-full max-w-sm">
          <Textarea rows={3} placeholder="Reason for the request" aria-label="Reason" />
        </div>
      ),
      code: `<Textarea rows={3} placeholder="Reason for the request" />`,
    },
  ],
};

const field: DocPage = {
  slug: 'field',
  title: 'Field',
  description: 'Label, control, description and error, wired together.',
  when: 'Use this rather than a bare label. It generates the ids and the `aria-describedby` that connect a message to the control it is about.',
  importLine:
    "import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'With a description',
      render: () => (
        <div className="w-full max-w-sm">
          <Field>
            <FieldLabel>Work email</FieldLabel>
            <FieldControl>
              <Input placeholder="grace.hopper@example.com" />
            </FieldControl>
            <FieldDescription>Used for payslips and calendar invitations.</FieldDescription>
          </Field>
        </div>
      ),
      code: `<Field>
  <FieldLabel>Work email</FieldLabel>
  <FieldControl>
    <Input placeholder="grace.hopper@example.com" />
  </FieldControl>
  <FieldDescription>Used for payslips and calendar invitations.</FieldDescription>
</Field>`,
    },
    {
      id: 'required',
      title: 'Required',
      blurb:
        'Marking the field required marks the control required too. The asterisk is decoration; the attribute is the contract.',
      render: () => (
        <div className="w-full max-w-sm">
          <Field required>
            <FieldLabel>Last day of leave</FieldLabel>
            <FieldControl>
              <Input type="date" />
            </FieldControl>
          </Field>
        </div>
      ),
      code: `<Field required>
  <FieldLabel>Last day of leave</FieldLabel>
  <FieldControl>
    <Input type="date" />
  </FieldControl>
</Field>`,
    },
  ],
};

const select: DocPage = {
  slug: 'select',
  title: 'Select',
  description: 'One value from a known, closed list.',
  when: 'If the list is long enough that a reader would rather type than scroll, that is a Combobox.',
  importLine:
    "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <div className="w-full max-w-56">
          <Select defaultValue="annual">
            <SelectTrigger aria-label="Absence type">
              <SelectValue placeholder="Absence type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="annual">Annual leave</SelectItem>
              <SelectItem value="sick">Sick leave</SelectItem>
              <SelectItem value="parental">Parental leave</SelectItem>
              <SelectItem value="unpaid">Unpaid leave</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
      code: `<Select defaultValue="annual">
  <SelectTrigger aria-label="Absence type">
    <SelectValue placeholder="Absence type" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="annual">Annual leave</SelectItem>
    <SelectItem value="sick">Sick leave</SelectItem>
  </SelectContent>
</Select>`,
    },
  ],
};

const checkbox: DocPage = {
  slug: 'checkbox',
  title: 'Checkbox',
  description: 'A value that is on or off, and can be neither.',
  when: 'A checkbox submits with a form. A switch commits the moment it moves. If the setting needs a Save button, it is a checkbox.',
  importLine: "import { Checkbox } from '@reach/ui';",
  sections: [
    {
      id: 'states',
      title: 'States',
      blurb:
        'The indeterminate state is a real third value, not a styling trick: a select-all over a partly selected table reports `aria-checked="mixed"`.',
      render: () => (
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-base text-fg">
            <Checkbox defaultChecked={false} /> Unchecked
          </label>
          <label className="flex items-center gap-2 text-base text-fg">
            <Checkbox defaultChecked /> Checked
          </label>
          <label className="flex items-center gap-2 text-base text-fg">
            <Checkbox checked="indeterminate" /> Some rows
          </label>
          <label className="flex items-center gap-2 text-base text-fg-disabled">
            <Checkbox disabled /> Disabled
          </label>
        </div>
      ),
      code: `<Checkbox />
<Checkbox defaultChecked />
<Checkbox checked="indeterminate" />
<Checkbox disabled />`,
    },
  ],
};

const switchPage: DocPage = {
  slug: 'switch',
  title: 'Switch',
  description: 'Immediate on or off.',
  when: 'A switch commits the moment it moves. If the change needs confirming, it is a checkbox in a form.',
  importLine: "import { Switch } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-base text-fg">
            <Switch aria-label="Email notifications" /> Email notifications
          </label>
          <label className="flex items-center gap-2 text-base text-fg">
            <Switch defaultChecked aria-label="Weekly digest" /> Weekly digest
          </label>
        </div>
      ),
      code: `<Switch aria-label="Email notifications" />
<Switch defaultChecked aria-label="Weekly digest" />`,
    },
  ],
};

const radioGroup: DocPage = {
  slug: 'radio-group',
  title: 'Radio group',
  description: 'One value from a short list, all options visible.',
  when: 'Past about six options the list stops being scannable and becomes a Select.',
  importLine: "import { RadioGroup, RadioGroupItem } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      blurb:
        'The item owns its label, and takes an optional second line for the consequence of choosing it. A bare dot with the text alongside is unusable, so the component does not offer that shape.',
      render: () => (
        <RadioGroup defaultValue="half">
          <RadioGroupItem value="full">Full day</RadioGroupItem>
          <RadioGroupItem value="half">Half day</RadioGroupItem>
          <RadioGroupItem value="hours" description="Deducted from the daily balance in hours.">
            Specific hours
          </RadioGroupItem>
        </RadioGroup>
      ),
      code: `<RadioGroup defaultValue="half">
  <RadioGroupItem value="full">Full day</RadioGroupItem>
  <RadioGroupItem value="half">Half day</RadioGroupItem>
  <RadioGroupItem value="hours" description="Deducted in hours.">
    Specific hours
  </RadioGroupItem>
</RadioGroup>`,
    },
  ],
};

const badge: DocPage = {
  slug: 'badge',
  title: 'Badge',
  description: 'A short status, read at a glance.',
  when: 'Colour is never the only signal. Every tone here carries a word as well, because roughly one man in twelve cannot separate the success and danger washes.',
  importLine: "import { Badge } from '@reach/ui';",
  sections: [
    {
      id: 'tones',
      title: 'Tones',
      render: () => (
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Draft</Badge>
          <Badge tone="success">Approved</Badge>
          <Badge tone="warning">Pending</Badge>
          <Badge tone="danger">Rejected</Badge>
          <Badge tone="info">Syncing</Badge>
        </div>
      ),
      code: `<Badge tone="success">Approved</Badge>
<Badge tone="warning">Pending</Badge>
<Badge tone="danger">Rejected</Badge>`,
    },
  ],
};

const card: DocPage = {
  slug: 'card',
  title: 'Card',
  description: 'A bounded group of related content.',
  importLine:
    "import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Annual leave</CardTitle>
            <CardDescription>Balance as at 31 December</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums text-fg">18.5 days</p>
            <p className="mt-1 text-sm text-fg-muted">Accrued 25, taken 6.5.</p>
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="secondary">
              Request leave
            </Button>
          </CardFooter>
        </Card>
      ),
      code: `<Card>
  <CardHeader>
    <CardTitle>Annual leave</CardTitle>
    <CardDescription>Balance as at 31 December</CardDescription>
  </CardHeader>
  <CardContent>18.5 days</CardContent>
  <CardFooter>
    <Button size="sm" variant="secondary">Request leave</Button>
  </CardFooter>
</Card>`,
    },
  ],
};

const dialog: DocPage = {
  slug: 'dialog',
  title: 'Dialog',
  description: 'A short decision, or a small form, over the current context.',
  when: 'Detail opened from a list belongs in a Sheet, which keeps the list behind it. Something irreversible belongs in an AlertDialog, whose overlay does not dismiss it.',
  importLine:
    "import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Reject request</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject this request</DialogTitle>
              <DialogDescription>
                Grace will be told immediately. A reason is required and appears in the audit trail.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field required>
                <FieldLabel>Reason</FieldLabel>
                <FieldControl>
                  <Textarea rows={3} placeholder="Cover is not available that week." />
                </FieldControl>
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button variant="destructive">Reject</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ),
      code: `<Dialog>
  <DialogTrigger asChild>
    <Button variant="secondary">Reject request</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Reject this request</DialogTitle>
      <DialogDescription>A reason is required.</DialogDescription>
    </DialogHeader>
    <DialogBody>…</DialogBody>
    <DialogFooter>
      <DialogClose asChild><Button>Cancel</Button></DialogClose>
      <Button variant="destructive">Reject</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`,
    },
  ],
};

const sheet: DocPage = {
  slug: 'sheet',
  title: 'Sheet',
  description: 'An edge-anchored panel: detail without losing the list behind it.',
  when: 'A leave request opened from a queue of forty belongs here. The reviewer’s context is the queue, and a route change loses their scroll position, their filters and their place.',
  importLine:
    "import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'From the right',
      tall: true,
      render: () => (
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Open request</Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Grace Hopper</SheetTitle>
              <SheetDescription>Annual leave · 17–21 August</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-3 text-base text-fg-muted">
              <p>Five working days against a balance of 18.5.</p>
              <p>No overlapping approved leave in Platform that week.</p>
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button>Close</Button>
              </SheetClose>
              <Button variant="primary">Approve</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ),
      code: `<Sheet>
  <SheetTrigger asChild>
    <Button variant="secondary">Open request</Button>
  </SheetTrigger>
  <SheetContent side="right">
    <SheetHeader>
      <SheetTitle>Grace Hopper</SheetTitle>
      <SheetDescription>Annual leave · 17–21 August</SheetDescription>
    </SheetHeader>
    <SheetBody>…</SheetBody>
    <SheetFooter>
      <SheetClose asChild><Button>Close</Button></SheetClose>
      <Button variant="primary">Approve</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>`,
    },
  ],
};

const tabs: DocPage = {
  slug: 'tabs',
  title: 'Tabs',
  description: 'Peer views of the same subject.',
  when: 'Tabs are not navigation and not a wizard. If the panels have an order the reader must follow, that is a Stepper; if they are separate pages, use routes so the URL survives a refresh.',
  importLine: "import { Tabs, TabsContent, TabsList, TabsTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <Tabs defaultValue="overview" className="w-full max-w-md">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="leave">Leave</TabsTrigger>
            <TabsTrigger value="pay">Pay</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-base text-fg-muted">
            Principal Engineer, Platform, Madrid. Started 4 March 2021.
          </TabsContent>
          <TabsContent value="leave" className="text-base text-fg-muted">
            18.5 days remaining of a 25 day entitlement.
          </TabsContent>
          <TabsContent value="pay" className="text-base text-fg-muted">
            Paid monthly on the 26th.
          </TabsContent>
        </Tabs>
      ),
      code: `<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="leave">Leave</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">…</TabsContent>
  <TabsContent value="leave">…</TabsContent>
</Tabs>`,
    },
  ],
};

const table: DocPage = {
  slug: 'table',
  title: 'Table',
  description: 'Rows of the same shape, read in columns.',
  when: 'Figures are locked to tabular numerals, because a column of money with proportional digits cannot be scanned.',
  importLine:
    "import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Grace Hopper</TableCell>
              <TableCell>Annual</TableCell>
              <TableCell>5</TableCell>
              <TableCell>
                <Badge tone="success">Approved</Badge>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Ada Lovelace</TableCell>
              <TableCell>Sick</TableCell>
              <TableCell>2</TableCell>
              <TableCell>
                <Badge tone="warning">Pending</Badge>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Radia Perlman</TableCell>
              <TableCell>Parental</TableCell>
              <TableCell>20</TableCell>
              <TableCell>
                <Badge tone="success">Approved</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      ),
      code: `<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Person</TableHead>
      <TableHead>Days</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Grace Hopper</TableCell>
      <TableCell>5</TableCell>
    </TableRow>
  </TableBody>
</Table>`,
    },
  ],
};

const accordion: DocPage = {
  slug: 'accordion',
  title: 'Accordion',
  description: 'Sections a reader opens one at a time.',
  importLine:
    "import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <Accordion type="single" collapsible className="w-full max-w-md">
          <AccordionItem value="carry">
            <AccordionTrigger>Can I carry leave over?</AccordionTrigger>
            <AccordionContent>
              Up to five days, and they expire on 31 March. The policy is per legal entity.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="notice">
            <AccordionTrigger>How much notice is required?</AccordionTrigger>
            <AccordionContent>
              Twice the length of the absence, rounded up to the working day.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ),
      code: `<Accordion type="single" collapsible>
  <AccordionItem value="carry">
    <AccordionTrigger>Can I carry leave over?</AccordionTrigger>
    <AccordionContent>Up to five days.</AccordionContent>
  </AccordionItem>
</Accordion>`,
    },
  ],
};

const alert: DocPage = {
  slug: 'alert',
  title: 'Alert',
  description: 'A message about the page, not about a field.',
  when: 'A validation message belongs on the Field it is about. This is for something that affects the whole view.',
  importLine: "import { Alert } from '@reach/ui';",
  sections: [
    {
      id: 'tones',
      title: 'Tones',
      render: () => (
        <div className="w-full max-w-lg space-y-3">
          <Alert tone="info" title="Sync in progress">
            Workday last responded 4 minutes ago. Figures may be a few minutes behind.
          </Alert>
          <Alert tone="warning" title="Approaching the carry-over deadline">
            Five days expire on 31 March.
          </Alert>
          <Alert tone="danger" title="Payroll is locked">
            The August run closed on the 18th. Changes now land in September.
          </Alert>
        </div>
      ),
      code: `<Alert tone="warning" title="Approaching the carry-over deadline">
  Five days expire on 31 March.
</Alert>`,
    },
  ],
};

const avatar: DocPage = {
  slug: 'avatar',
  title: 'Avatar',
  description: 'A person, at a glance.',
  importLine: "import { Avatar, AvatarGroup } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Sizes and groups',
      blurb:
        'Initials are derived from the name, so a missing photograph degrades to something readable rather than to a grey circle.',
      render: () => (
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Avatar name="Grace Hopper" size="sm" />
            <Avatar name="Ada Lovelace" size="md" />
            <Avatar name="Radia Perlman" size="lg" />
          </div>
          <AvatarGroup max={3}>
            <Avatar name="Grace Hopper" />
            <Avatar name="Ada Lovelace" />
            <Avatar name="Radia Perlman" />
            <Avatar name="Joan Clarke" />
            <Avatar name="Katherine Johnson" />
          </AvatarGroup>
        </div>
      ),
      code: `<Avatar name="Grace Hopper" size="md" />

<AvatarGroup max={3}>
  <Avatar name="Grace Hopper" />
  <Avatar name="Ada Lovelace" />
  <Avatar name="Radia Perlman" />
</AvatarGroup>`,
    },
  ],
};

const tooltip: DocPage = {
  slug: 'tooltip',
  title: 'Tooltip',
  description: 'A supplementary hint.',
  when: 'Never the only place information lives. A tooltip does not appear on touch and vanishes the moment the pointer leaves, so a price, a validation message or the meaning of an icon-only control must not live here alone.',
  importLine: "import { Tooltip, TooltipProvider } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <TooltipProvider>
          <Tooltip content="Accrued to the end of the current month.">
            <Button variant="secondary">Balance</Button>
          </Tooltip>
        </TooltipProvider>
      ),
      code: `<TooltipProvider>
  <Tooltip content="Accrued to the end of the current month.">
    <Button variant="secondary">Balance</Button>
  </Tooltip>
</TooltipProvider>`,
    },
  ],
};

const progress: DocPage = {
  slug: 'progress',
  title: 'Progress',
  description: 'Work with a known end, and work without one.',
  when: 'Determinate progress only when the total is genuinely known. A bar stuck at 90% says "hung"; a sweep says "still running".',
  importLine: "import { Progress, Spinner } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Determinate and indeterminate',
      render: () => (
        <div className="w-full max-w-sm space-y-4">
          <Progress value={62} label="Import progress" />
          <Progress label="Contacting Workday" />
          <div className="flex items-center gap-2 text-base text-fg-muted">
            <Spinner size="sm" label="Loading" /> Loading
          </div>
        </div>
      ),
      code: `<Progress value={62} label="Import progress" />
<Progress label="Contacting Workday" />
<Spinner size="sm" label="Loading" />`,
    },
  ],
};

/* ------------------------------------------------------------------ index -- */

export const PAGES: readonly DocPage[] = [
  ...MORE_PAGES,
  ...COMPLEX_PAGES,
  ...CHART_PAGES,
  accordion,
  alert,
  avatar,
  badge,
  button,
  card,
  checkbox,
  dialog,
  field,
  input,
  progress,
  radioGroup,
  select,
  sheet,
  switchPage,
  table,
  tabs,
  tooltip,
];

/**
 * The sidebar. Grouped by the question a reader is answering rather than
 * alphabetically: someone laying out a form is not thinking "A comes before B",
 * they are thinking "what do I put next to this label".
 */
export const NAV: readonly NavGroup[] = [
  { title: 'Getting started', slugs: ['introduction', 'installation', 'theming'] },
  {
    title: 'Forms',
    slugs: [
      'field',
      'input',
      'typed-fields',
      'number-field',
      'password-field',
      'pin-input',
      'select',
      'combobox',
      'checkbox',
      'radio-group',
      'switch',
      'toggle',
      'slider',
      'rating',
      'tags-input',
      'date-picker',
      'calendar',
      'rich-text',
      'dropzone',
      'file-uploader',
      'image-uploader',
    ],
  },
  {
    title: 'Actions',
    slugs: [
      'button',
      'dropdown-menu',
      'context-menu',
      'popover',
      'dialog',
      'alert-dialog',
      'sheet',
      'modal-page',
      'kanban',
      'sortable',
    ],
  },
  {
    title: 'Data',
    slugs: [
      'table',
      'virtual-list',
      'stat',
      'money',
      'badge',
      'avatar',
      'progress',
      'timeline',
      'org-chart',
    ],
  },
  // Charts are their own section rather than one page. There are nine of them,
  // a reader usually arrives knowing the name of the one they want, and each
  // answers a different question about the same data.
  { title: 'Charts', slugs: [...CHART_SLUGS] },
  {
    title: 'Layout',
    slugs: [
      'layout',
      'page-layout',
      'card',
      'tabs',
      'accordion',
      'list-detail',
      'stepper',
      'separator',
      'scroll-area',
      'reveal',
    ],
  },
  { title: 'Navigation', slugs: ['breadcrumb', 'pagination'] },
  { title: 'Feedback', slugs: ['alert', 'toast', 'feedback', 'tooltip', 'clipboard', 'kbd'] },
];

export const pageBySlug = (slug: string): DocPage | undefined =>
  PAGES.find((page) => page.slug === slug);

/** Reading order for the previous/next pair, flattened from the sidebar. */
export const ORDERED_SLUGS: readonly string[] = NAV.flatMap((group) => group.slugs);

export function titleFor(slug: string): string {
  const page = pageBySlug(slug);
  if (page) return page.title;
  return (
    { introduction: 'Introduction', installation: 'Installation', theming: 'Theming' }[slug] ?? slug
  );
}

export type { DocPage, NavGroup, PropRow, Section } from './doc-types';
