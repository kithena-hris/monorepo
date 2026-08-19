import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Badge } from '../components/badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { TimelineChart, type TimelineRow } from '../components/chart/timeline-chart';
import { ContextMenuItem } from '../components/context-menu/context-menu';
import { ToggleGroup, ToggleGroupItem } from '../components/toggle/toggle';
import { leaveCover, onboarding, today } from './fixtures';

const meta = {
  title: 'Charts/Timeline',
  component: TimelineChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A schedule against a date axis, a Gantt chart, for the things an HRIS schedules: onboarding plans, leave cover, assignments, probation and notice periods.',
          '',
          '### Dates are dates, not instants',
          '',
          "Every date is an ISO `YYYY-MM-DD` string, parsed as UTC, and all the arithmetic runs on integer day numbers. A hire date is a calendar date: parse `'2026-03-02'` with `new Date()` in Denver and you get the 1st of March, so the same plan starts a day early in one office and on time in another. That is a bug nobody reproduces, because it depends on where the reporter is sitting.",
          '',
          '### It never reads the clock',
          '',
          'The `today` marker is a **prop**. A chart that calls `new Date()` renders a different picture every day, which makes a visual diff meaningless and a story impossible to write prose about, the same reason domain code takes an injected `Clock` rather than reading the system time.',
          '',
          '### Bars, milestones and progress',
          '',
          'Three shapes, and the **Shapes** story below draws all of them for real rather than describing them:',
          '',
          '| Shape | When | Prop |',
          '| --- | --- | --- |',
          '| **Bar** | Something that runs from one day to another. | `start` **and** `end`, both inclusive |',
          '| **Diamond** | Something that happens *on* a day, an offer accepted, a last day, a review due. | `start` only |',
          '| **Fill** | How far through a bar is. | `progress`, `0` to `1` |',
          '',
          'A milestone is not a one-day bar. Drawing it as one would invent a duration and, at a monthly zoom, make it a sliver indistinguishable from a rounding error.',
          '',
          'The progress fill is a stronger *tint* of the bar rather than the solid colour, and the bar is a tint rather than `opacity`. Opacity applies to the whole subtree, so a bar dimmed that way takes its own label down with it, and the label has to stay readable across the join between filled and unfilled.',
          '',
          '### Overlapping items stack; they never intersect',
          '',
          'Two things happening to one person at once is the normal case, not the exception, a handover running past a last day, cover overlapping the leave it covers. So a lane splits into as many sub-lanes as it takes and **gets taller**. `rowHeight` is the height of one sub-lane, not of a row.',
          '',
          'Drawing overlaps on top of each other would hide one of them completely, and hiding a conflict is the exact opposite of what a schedule is opened for. The packing is greedy first-fit over items sorted by start date, the minimum number of sub-lanes, and it runs over the whole series rather than the visible window, so bars do not hop rows as you zoom.',
          '',
          '### Rescheduling',
          '',
          'With `editable`, a bar drags along the axis, resizes by either end, and drops onto another lane. It snaps to **whole days**, a schedule has no sub-day resolution, and a bar landing on "the 3rd and a bit" has dates that cannot be written down.',
          '',
          '| Gesture | Does |',
          '| --- | --- |',
          '| Drag a bar sideways | Reschedule, keeping its length |',
          '| Drag a bar onto another lane | Reassign it |',
          '| Drag either end | Change the start or the end date |',
          '| `Shift` + `←` `→` | Move by a day |',
          '| `Shift` + `Alt` + `←` `→` | Change the end date |',
          '| `Shift` + `↑` `↓` | Move to the lane above or below |',
          '',
          'A milestone moves but never resizes: it has no duration to change.',
          '',
          'The drag writes transforms **straight onto the element** rather than going through state. Twenty frames a second of React would re-render every bar in the chart for each frame of a single gesture; state changes once, on release.',
          '',
          '**A drop lands whether or not you wire anything up.** The chart keeps the new position itself and hands it over as an event, because requiring `onItemMove` before a bar will move makes the gesture feel broken in every screen that has not got round to it yet. Pass a new `rows` array back and the internal copy is discarded, your data is always the authority. It is just not the only copy. In a real system that callback is an effective-dated event rather than an update in place.',
          '',
          'Two callbacks, deliberately. `onItemMove` fires when something actually changed; **`onDrop` fires on every release** with an `applied` flag, the event you want when working out why a drag appeared to do nothing: refused by `canMove`, locked, or simply dropped where it started.',
          '',
          '`editable` is an affordance, not a permission. It decides which handles exist and nothing else, so whatever writes the new dates has to authorise the change itself.',
          '',
          '### Lanes have edges, and empty ones say so',
          '',
          "`separator` draws a rule between lanes (`line`, the default), a wash behind alternate ones (`banded`), or `both`. It earns its keep where it is least obvious: a lane whose items collide splits into sub-lanes and stands several bars tall, and without a boundary nothing tells you whether the bar below belongs to this person or the next one. **`banded` is the one that groups a lane's own sub-lanes together**, a line between lanes cannot do that.",
          '',
          'A lane with nothing in it draws a dashed placeholder rather than leaving a blank strip. "Nobody is scheduled" and "the bars failed to render" want very different reactions from whoever is looking, and a gap says both. A lane whose items are all outside the current window says *that* instead, because it is a different fact, and it appears and disappears as you zoom.',
          '',
          'The accessibility table is built from the lanes rather than the items for the same reason: an empty lane is a row that says it is empty, not a lane that vanishes from the only version a screen reader gets.',
          '',
          '### Zoom, drag and right-click',
          '',
          'The same interaction surface as every other chart here: `zoomable` gives you the buttons **and** drag-to-select across the plot, and right-click offers zoom, reset and copy as CSV. A zoom windows the *axis*, never the lanes, a schedule with half its people missing is a different chart, and a much more misleading one.',
          '',
          'A bar the window cuts through keeps a square edge on that side. A rounded end reads as "it finishes here", which would be a lie.',
          '',
          '### It is a table underneath',
          '',
          'A row of rectangles is unreadable to a screen reader however many labels it carries, so every bar is written out with its dates in a real `<table>`. Bars are focusable and carry the same sentence, because a tooltip that only opens on hover opens for only half the people reading.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    rows: {
      description: 'Lanes, in display order. Each carries its own items.',
      control: 'object',
      table: { type: { summary: 'readonly TimelineRow[]' }, category: 'Data' },
    },
    label: {
      description: 'Names the chart for the table caption and the right-click menu.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Data' },
    },
    unit: {
      description: 'Axis granularity, and the unit a zoom step works in.',
      control: 'inline-radio',
      options: ['day', 'week', 'month'],
      table: {
        type: { summary: "'day' | 'week' | 'month'" },
        defaultValue: { summary: "'week'" },
        category: 'Axis',
      },
    },
    today: {
      description: 'ISO date for the "now" line. Passed in, the chart never reads the clock.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'Axis' },
    },
    separator: {
      description: 'Rules between lanes, a wash behind alternate ones, or both.',
      control: 'inline-radio',
      options: ['none', 'line', 'banded', 'both'],
      table: {
        type: { summary: "'none' | 'line' | 'banded' | 'both'" },
        defaultValue: { summary: "'line'" },
        category: 'Appearance',
      },
    },
    emptyRow: {
      description: 'Shown in a lane with no items at all.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Appearance' },
    },
    emptyWindow: {
      description: 'Shown in a lane whose items are all outside the visible window.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Appearance' },
    },
    zoomable: {
      description: 'Zoom buttons plus drag-to-zoom across the plot.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Interaction' },
    },
    editable: {
      description: 'Drag to reschedule, drag the ends to resize, drop on another lane.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Rescheduling' },
    },
    onItemMove: {
      description: 'Apply the reschedule to your own data. Nothing moves without it.',
      control: false,
      table: { type: { summary: '(move: TimelineMove) => void' }, category: 'Rescheduling' },
    },
    canMove: {
      description: 'Veto a particular item, or a particular destination lane.',
      control: false,
      table: {
        type: { summary: '(item, from: TimelineRow, to: TimelineRow) => boolean' },
        category: 'Rescheduling',
      },
    },
    onDraggingChange: {
      control: false,
      table: {
        type: { summary: '(item: TimelineEntry | null) => void' },
        category: 'Rescheduling',
      },
    },
    onDrop: {
      description: 'Every release, changed or not. `applied` says which.',
      control: false,
      table: {
        type: { summary: '(move: TimelineMove, applied: boolean) => void' },
        category: 'Rescheduling',
      },
    },
    onSelect: {
      description: 'Makes every bar and milestone a real button.',
      control: false,
      table: {
        type: { summary: '(item: TimelineEntry, row: TimelineRow) => void' },
        category: 'Interaction',
      },
    },
    selectedId: {
      control: false,
      table: { type: { summary: 'string' }, category: 'Interaction' },
    },
    rowHeight: {
      control: { type: 'range', min: 28, max: 72, step: 4 },
      table: { type: { summary: 'number' }, category: 'Appearance' },
    },
    labelWidth: {
      control: { type: 'range', min: 80, max: 280, step: 4 },
      table: { type: { summary: 'number' }, category: 'Appearance' },
    },
    formatTick: {
      control: false,
      table: {
        type: { summary: '(iso: IsoDate, unit: TimelineUnit) => string' },
        category: 'Data',
      },
    },
    formatDate: {
      control: false,
      table: { type: { summary: '(iso: IsoDate) => string' }, category: 'Data' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Onboarding plan, Q1 2026',
    rows: onboarding,
    unit: 'week',
    today,
    // Spies, so the **Actions** panel shows what each callback is handed and
    // when. It is the fastest answer to the only question most people have
    // about a chart's API.
    onSelect: fn().mockName('onSelect(item, row)'),
    onWindowChange: fn().mockName('onWindowChange({ start, end })'),
    onItemMove: fn().mockName('onItemMove({ id, fromRow, toRow, from, to, mode })'),
    onDraggingChange: fn().mockName('onDraggingChange(item | null)'),
    onDrop: fn().mockName('onDrop(move, applied)'),
  },
} satisfies Meta<typeof TimelineChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { editable: true },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding</CardTitle>
        <Badge size="sm" tone="info">
          4 in flight
        </Badge>
      </CardHeader>
      <CardContent>
        <TimelineChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Shapes: Story = {
  name: 'Shapes',
  args: {
    label: 'Every shape the chart draws',
    unit: 'day',
    rowHeight: 36,
    today: '2026-03-11',
    rows: [
      {
        label: 'Bar',
        meta: 'start + end',
        items: [{ id: 's1', label: 'Orientation', start: '2026-03-03', end: '2026-03-12' }],
      },
      {
        label: 'Milestone',
        meta: 'start only',
        items: [
          { id: 's2', label: 'Offer accepted', start: '2026-03-03', tone: 'info' },
          { id: 's3', label: 'First day', start: '2026-03-09', tone: 'success' },
          { id: 's4', label: 'Probation review', start: '2026-03-16', tone: 'warning' },
        ],
      },
      {
        label: 'Progress',
        meta: '0 · 0.35 · 1',
        items: [
          {
            id: 's5',
            label: 'Not started',
            start: '2026-03-02',
            end: '2026-03-06',
            progress: 0,
          },
          {
            id: 's6',
            label: 'A third done',
            start: '2026-03-09',
            end: '2026-03-13',
            progress: 0.35,
          },
          {
            id: 's7',
            label: 'Complete',
            start: '2026-03-16',
            end: '2026-03-20',
            progress: 1,
            tone: 'success',
          },
        ],
      },
      {
        label: 'Tones',
        meta: 'accent · info · success · warning · danger',
        items: [
          { id: 's8', label: 'Accent', start: '2026-03-02', end: '2026-03-04', tone: 'accent' },
          { id: 's9', label: 'Info', start: '2026-03-05', end: '2026-03-07', tone: 'info' },
          { id: 's10', label: 'Success', start: '2026-03-08', end: '2026-03-10', tone: 'success' },
          { id: 's11', label: 'Warning', start: '2026-03-11', end: '2026-03-13', tone: 'warning' },
          { id: 's12', label: 'Danger', start: '2026-03-14', end: '2026-03-16', tone: 'danger' },
        ],
      },
      {
        label: 'Today',
        meta: 'the "now" line',
        items: [{ id: 's13', label: 'Spans today', start: '2026-03-04', end: '2026-03-18' }],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: [
          'The shapes, drawn rather than described. Each lane isolates one thing:',
          '',
          '- **Bar**. `start` and `end`, both inclusive, so a bar from the 3rd to the 12th covers ten days and ends *at the end of* the 12th.',
          '- **Milestone**. `start` with no `end`. A diamond centred on the day, at any zoom, because a milestone has no duration to shrink.',
          '- **Progress**. `0`, `0.35` and `1` of the same-length bar. Zero is a bar with no fill rather than no bar: "not started" and "not scheduled" must not look the same.',
          '- **Tones**, the five tones a schedule uses. Colour is never the only signal; every bar carries its label, and the table below carries every date.',
          '- **Today**, the red line, drawn from the `today` prop and never from the clock.',
          '',
          'Hover or focus any of them for the readout, right-click for the menu.',
        ].join('\n'),
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Shapes</CardTitle>
        <Badge size="sm">Bar · Diamond · Fill</Badge>
      </CardHeader>
      <CardContent>
        <TimelineChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Granularity: Story = {
  name: 'Day, week, month',
  parameters: {
    docs: {
      description: {
        story:
          'One dataset, three axes. The unit changes the tick spacing and what a zoom step means, not the data: a bar covering six weeks is the same six weeks whichever ruler is held up against it. Days for a fortnight of onboarding, weeks for a quarter, months for a year of assignments.',
      },
    },
  },
  render: function GranularityStory(args) {
    const [unit, setUnit] = useState<'day' | 'week' | 'month'>('week');

    return (
      <Card>
        <CardHeader>
          <CardTitle>Onboarding</CardTitle>
          <ToggleGroup
            type="single"
            value={unit}
            onValueChange={(next) => {
              if (next === 'day' || next === 'week' || next === 'month') setUnit(next);
            }}
            aria-label="Axis granularity"
          >
            <ToggleGroupItem value="day" size="sm">
              Day
            </ToggleGroupItem>
            <ToggleGroupItem value="week" size="sm">
              Week
            </ToggleGroupItem>
            <ToggleGroupItem value="month" size="sm">
              Month
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <TimelineChart {...args} unit={unit} />
        </CardContent>
      </Card>
    );
  },
};

export const Interactive: Story = {
  name: 'Zoom, drag and select',
  args: { zoomable: true },
  parameters: {
    docs: {
      description: {
        story: [
          'Drag across the plot to zoom into the range you dragged; use the buttons for the same thing without a pointer; right-click for zoom, reset and copy as CSV.',
          '',
          'Click a bar to select it. Nothing happens under 6px of drag, so a click on a bar is still a click on a bar, and the click that follows a real drag is swallowed: releasing over a bar zooms rather than zooming *and* selecting.',
          '',
          'Zoom in far enough and watch the edges: bars the window cuts through go square on the cut side, and bars entirely outside it stop being drawn. They stay in the table below either way.',
        ].join('\n'),
      },
    },
  },
  render: function InteractiveStory(args) {
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Onboarding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <TimelineChart
            {...args}
            {...(selected === null ? {} : { selectedId: selected })}
            onSelect={(item, row) => {
              setSelected(item.id);
              args.onSelect?.(item, row);
            }}
            menuItems={
              <ContextMenuItem
                onSelect={() => {
                  setSelected(null);
                }}
              >
                Clear selection
              </ContextMenuItem>
            }
          />
          <p aria-live="polite" className="min-h-5 text-sm text-fg-muted">
            {selected === null ? 'Nothing selected.' : `Selected: ${selected}`}
          </p>
        </CardContent>
      </Card>
    );
  },
};

export const Cover: Story = {
  name: 'Leave cover',
  args: {
    label: 'Leave by team, Q1 2026',
    rows: leaveCover,
    unit: 'month',
    zoomable: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'The same component asking a different question: who is away, and when do two absences overlap. Lanes are teams rather than people, which is the level at which cover is actually a problem, two payroll specialists off in the same fortnight is the thing to see, and the Payroll lane splits in two to show it rather than drawing one absence over the other.',
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Leave cover</CardTitle>
        <Badge size="sm" tone="warning">
          Overlap in Payroll
        </Badge>
      </CardHeader>
      <CardContent>
        <TimelineChart {...args} rowHeight={44} />
      </CardContent>
    </Card>
  ),
};

export const Empty: Story = {
  name: 'Nothing scheduled',
  args: { rows: [] },
  parameters: {
    docs: {
      description: {
        story:
          'An axis with no dates on it has no domain, so there is nothing to draw and no honest way to fake one. The empty state says so in a sentence rather than rendering a blank grid that looks like a chart still loading.',
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding</CardTitle>
      </CardHeader>
      <CardContent>
        <TimelineChart {...args} empty="No one is onboarding this quarter." />
      </CardContent>
    </Card>
  ),
};

export const Overlaps: Story = {
  name: 'When items collide',
  args: {
    label: 'Cover for one team, March 2026',
    unit: 'day',
    rowHeight: 32,
    rows: [
      {
        label: 'Support rota',
        meta: 'Everything at once',
        items: [
          { id: 'a', label: 'K. Johnson: annual', start: '2026-03-02', end: '2026-03-13' },
          {
            id: 'b',
            label: 'M. Hamilton: annual',
            start: '2026-03-09',
            end: '2026-03-20',
            tone: 'warning',
          },
          {
            id: 'c',
            label: 'A. Borg: sick',
            start: '2026-03-11',
            end: '2026-03-16',
            tone: 'danger',
          },
          { id: 'd', label: 'Handover', start: '2026-03-16', end: '2026-03-27', tone: 'info' },
          { id: 'e', label: 'Cover ends', start: '2026-03-20', tone: 'danger' },
          { id: 'f', label: 'J. Bartik: annual', start: '2026-03-23', end: '2026-03-31' },
        ],
      },
      {
        label: 'Platform rota',
        meta: 'Nothing overlaps',
        items: [
          { id: 'g', label: 'G. Hopper: annual', start: '2026-03-02', end: '2026-03-06' },
          { id: 'h', label: 'R. Perlman: annual', start: '2026-03-09', end: '2026-03-13' },
          { id: 'i', label: 'B. Liskov: annual', start: '2026-03-16', end: '2026-03-20' },
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Six items in one lane, four of them overlapping. The lane splits into three sub-lanes, the minimum that fits, and grows to `rowHeight x 3`. The lane below needs one sub-lane and stays one high, so a chart does not pay for a conflict it does not have.',
          '',
          'Adjacency is not collision: *A. Borg: sick* ends on the 16th and *Handover* starts on the 16th, so they really do overlap and are split. Move either by one day and they pack onto the same line, because `end` is inclusive and a bar ending on the 13th sits happily beside one starting on the 14th.',
          '',
          'The milestone counts too. *Cover ends* on the 20th falls inside two bars and takes the first line free.',
        ].join('\n'),
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>March cover</CardTitle>
        <Badge size="sm" tone="warning">
          3 deep
        </Badge>
      </CardHeader>
      <CardContent>
        <TimelineChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Rescheduling: Story = {
  name: 'Drag to reschedule',
  args: { editable: true, zoomable: true, unit: 'week' },
  parameters: {
    docs: {
      description: {
        story: [
          'Pick up a bar and move it. Sideways reschedules it, keeping its length; onto another lane reassigns it; the ends resize it. Everything snaps to whole days, and the dates in the panel are the ones `onItemMove` handed back.',
          '',
          'Two rules are enforced on the way through, both visible here:',
          '',
          '- **Dana Whitfield’s "Last day" is `locked`**. It cannot be dragged, resized or dropped elsewhere. Use it for the rows a plan is not allowed to touch.',
          '- **`canMove` refuses anything landing on a lane in its notice period.** A veto the data model would otherwise allow.',
          '',
          'A resize can never take an end past its own start: a bar that finishes before it begins is not a shorter bar. It is a broken record.',
          '',
          'Without a pointer, focus a bar and use `Shift` with the arrows. `Alt` as well to change the end date. The result is announced in a live region, because a gesture whose outcome only exists in pixels is one nobody using a screen reader can steer.',
        ].join('\n'),
      },
    },
  },
  render: function ReschedulingStory(args) {
    const [plan, setPlan] = useState<TimelineRow[]>(onboarding);
    const [log, setLog] = useState<string[]>([]);

    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Onboarding plan</CardTitle>
            <Badge size="sm" tone="info">
              Editable
            </Badge>
          </CardHeader>
          <CardContent>
            <TimelineChart
              {...args}
              rows={plan}
              canMove={(_item, _from, to) => !to.label.includes('Whitfield')}
              onItemMove={(move) => {
                args.onItemMove?.(move);
                setPlan((current) =>
                  current.map((row) => {
                    const without = row.items.filter((item) => item.id !== move.id);
                    if (row.label === move.toRow) {
                      const moving = current
                        .flatMap((entry) => entry.items)
                        .find((item) => item.id === move.id);
                      if (!moving) return row;
                      return {
                        ...row,
                        items: [
                          ...without,
                          {
                            ...moving,
                            start: move.to.start,
                            ...(move.to.end === undefined ? {} : { end: move.to.end }),
                          },
                        ],
                      };
                    }
                    return { ...row, items: without };
                  }),
                );
                setLog((current) =>
                  [
                    `${move.id}: ${move.to.start}${move.to.end === undefined ? '' : ` – ${move.to.end}`} (${move.toRow})`,
                    ...current,
                  ].slice(0, 6),
                );
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Changes</CardTitle>
          </CardHeader>
          <CardContent>
            <ol aria-live="polite" className="space-y-1 text-sm text-fg-muted">
              {log.length === 0 ? <li>Nothing rescheduled yet.</li> : null}
              {log.map((entry, index) => (
                <li key={`${entry}-${String(index)}`}>{entry}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  },
};

export const Separators: Story = {
  name: 'Telling lanes apart',
  args: {
    label: 'Cover for one team, March 2026',
    unit: 'day',
    rowHeight: 30,
    separator: 'both',
    zoomable: true,
    rows: [
      {
        label: 'Support rota',
        meta: 'Three deep',
        items: [
          { id: 'x1', label: 'K. Johnson: annual', start: '2026-03-02', end: '2026-03-13' },
          {
            id: 'x2',
            label: 'M. Hamilton: annual',
            start: '2026-03-09',
            end: '2026-03-20',
            tone: 'warning',
          },
          {
            id: 'x3',
            label: 'A. Borg: sick',
            start: '2026-03-11',
            end: '2026-03-16',
            tone: 'danger',
          },
        ],
      },
      {
        label: 'Platform rota',
        meta: 'Two deep',
        items: [
          { id: 'x4', label: 'G. Hopper: annual', start: '2026-03-03', end: '2026-03-10' },
          { id: 'x5', label: 'R. Perlman: annual', start: '2026-03-06', end: '2026-03-17' },
        ],
      },
      { label: 'Payroll rota', meta: 'Nobody away', items: [] },
      {
        label: 'Finance rota',
        meta: 'All in April',
        items: [{ id: 'x6', label: 'A. Easley: annual', start: '2026-04-06', end: '2026-04-17' }],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Four lanes, two of which are several bars tall. Switch `separator` in the controls and watch the third bar in the Support rota: with `none` there is nothing to say whether it belongs to Support or to Platform.',
          '',
          '| Value | Draws |',
          '| --- | --- |',
          '| `none` | Nothing. |',
          '| `line` | A rule between lanes. Enough while lanes are one bar tall. |',
          '| `banded` | A wash behind alternate lanes. **The one for colliding items**, it groups a lane’s sub-lanes into a single block. |',
          '| `both` | Rules and bands. |',
          '',
          'The band is translucent, so the date gridlines still read through it. An opaque band would have to choose between showing the grid and showing the grouping.',
          '',
          'The last two lanes cover the empty cases. **Payroll rota** has no items at all and says so straight away. **Finance rota** has one, in April: zoom into the first half of March and that lane starts reporting *"Nothing in this range"* instead. They are deliberately different sentences: one is a rota nobody is on, the other is a rota you are looking at through the wrong window, and only one of them is a scheduling problem.',
        ].join('\n'),
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>March cover</CardTitle>
        <Badge size="sm" tone="warning">
          Overlaps
        </Badge>
      </CardHeader>
      <CardContent>
        <TimelineChart {...args} />
      </CardContent>
    </Card>
  ),
};
