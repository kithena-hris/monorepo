import type { Meta, StoryObj } from '@storybook/react-vite';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Alert } from '../feedback/feedback';
import { Input } from '../input/input';
import { Separator } from '../separator/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table/table';
import { Reveal, staggerStyle } from './reveal';

const meta = {
  title: 'Components/Reveal',
  component: Reveal,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Something entering or leaving the page flow, without the shove.',
          '',
          '### The problem',
          '',
          'A selection bar, an inline alert, a filter panel, each appears above content and displaces it. Rendered conditionally that displacement lands in a single frame: the page jumps, and whatever the user was reading or about to click has moved. On a board where the bar appears the instant a checkbox is ticked. The jump lands under the pointer that ticked it.',
          '',
          '### Why `height` cannot solve it',
          '',
          '`height: auto` is not animatable, so the naive fix hard-codes a height: wrong the moment the content wraps to two lines, on a narrow screen, or in a language with longer words. Measuring in JS costs a layout read per render and still misses the reflow.',
          '',
          '### `grid-template-rows: 0fr → 1fr`',
          '',
          'A grid **track** is animatable, and `1fr` resolves to exactly the content height, whatever it turns out to be. The child needs `min-height: 0` and `overflow: hidden`. That is the whole technique, and the only one that animates to an unknown height without measuring.',
          '',
          '`interpolate-size: allow-keywords` will make this redundant eventually. It does not have the support to rely on yet.',
          '',
          '### `staggerStyle(index)`',
          '',
          'The companion export. When a group changes state at once: selecting a whole column, a row of chips arriving, a per-item delay turns one frame into a sweep. Step and ceiling are tokens (`--animate-stagger-step`, `--animate-stagger-max`), so every stagger in the system runs at the same speed and one change re-times all of them.',
          '',
          'It returns a style object rather than a class because the value is an index: Tailwind cannot generate a delay class for a number it has never seen, and forty hard-coded delay classes is not a design system.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    open: {
      description: 'Whether the content is shown. The component animates between the two.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    duration: {
      description: 'Milliseconds. Defaults to the system `normal` duration (200ms).',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Appearance' },
    },
    from: {
      description: 'Slides as well as collapsing. The edge it comes *from*.',
      control: 'inline-radio',
      options: ['top', 'bottom', 'none'],
      table: {
        type: { summary: "'top' | 'bottom' | 'none'" },
        defaultValue: { summary: 'top' },
        category: 'Appearance',
      },
    },
    unmountOnExit: {
      description:
        'Removes the children once collapsed. Cheaper for heavy content; costs the exit animation, since there is then nothing left to animate.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    contentClassName: {
      description: 'Class for the inner wrapper. **Padding belongs here**, not on the root.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Appearance' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    open: true,
    from: 'top',
    unmountOnExit: false,
    // Required by the props, supplied by each story's render. Declared here so
    // no story has to repeat it.
    children: null,
  },
} satisfies Meta<typeof Reveal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [open, setOpen] = useState(args.open);
    return (
      <div className="max-w-lg space-y-3">
        <Button
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
        <Reveal {...args} open={open}>
          <Alert tone="info" title="Nothing below this jumps">
            The content underneath is pushed down over the duration rather than in one frame.
          </Alert>
        </Reveal>
        <p className="text-sm text-fg-muted">
          This paragraph is what would have been displaced. Toggle repeatedly and watch it travel
          rather than teleport.
        </p>
      </div>
    );
  },
};

export const AgainstAConditionalRender: Story = {
  name: 'Against a conditional render',
  parameters: {
    docs: {
      description: {
        story:
          'The same content, twice. The left column is `{open ? <Alert/> : null}`, the paragraph beneath it teleports. The right is a `Reveal`. Toggle both and watch the text below each one.',
      },
    },
  },
  render: function ComparisonStory(args) {
    const [open, setOpen] = useState(false);

    return (
      <div className="space-y-4">
        <Button
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          Toggle both
        </Button>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
              Conditional render
            </p>
            {open ? (
              <Alert tone="warning" title="Appears in one frame">
                Everything below moves instantly.
              </Alert>
            ) : null}
            <p className="text-sm text-fg-muted">
              This paragraph is displaced with no transition at all.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Reveal</p>
            <Reveal {...args} open={open}>
              <Alert tone="success" title="Arrives over 200ms">
                Everything below travels with it.
              </Alert>
            </Reveal>
            <p className="text-sm text-fg-muted">
              This paragraph is pushed down over the same duration.
            </p>
          </div>
        </div>
      </div>
    );
  },
};

export const SelectionBar: Story = {
  name: 'A selection bar',
  parameters: {
    docs: {
      description: {
        story: [
          'The case it exists for. Tick a row: the bar grows into place and the table slides down rather than being shoved.',
          '',
          'Two details worth copying. The count is a **live region**, because a selection that changes silently cannot be audited before someone runs a bulk delete on it. And the bar keeps rendering its last count while it collapses: swapping to "0 selected" mid-exit is a frame of nonsense.',
        ].join('\n'),
      },
    },
  },
  render: function SelectionStory(args) {
    const rows = [
      { id: '1', name: 'Grace Hopper', team: 'Platform' },
      { id: '2', name: 'Ada Lovelace', team: 'Platform' },
      { id: '3', name: 'Radia Perlman', team: 'Payroll' },
      { id: '4', name: 'Barbara Liskov', team: 'Platform' },
    ];
    const [selected, setSelected] = useState<string[]>([]);

    return (
      <div className="max-w-2xl">
        <Reveal {...args} open={selected.length > 0} from="top">
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent bg-accent-subtle px-3 py-2">
            <p aria-live="polite" className="text-sm font-medium text-accent-fg">
              {selected.length} selected
            </p>
            <Separator orientation="vertical" className="h-5" />
            <Button size="sm" variant="destructive" startIcon={<Trash2 />}>
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto"
              startIcon={<X />}
              onClick={() => {
                setSelected([]);
              }}
            >
              Clear
            </Button>
          </div>
        </Reveal>

        <Table aria-label="People">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select every row"
                  checked={
                    selected.length === 0
                      ? false
                      : selected.length === rows.length
                        ? true
                        : 'indeterminate'
                  }
                  onCheckedChange={(checked) => {
                    setSelected(checked === true ? rows.map((row) => row.id) : []);
                  }}
                />
              </TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Team</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} selected={selected.includes(row.id)}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${row.name}`}
                    checked={selected.includes(row.id)}
                    onCheckedChange={(checked) => {
                      setSelected((current) =>
                        checked === true
                          ? [...current, row.id]
                          : current.filter((id) => id !== row.id),
                      );
                    }}
                  />
                </TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-fg-muted">{row.team}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  },
};

export const Stagger: Story = {
  name: 'staggerStyle',
  parameters: {
    docs: {
      description: {
        story:
          'Select all, and watch the highlight travel down the list instead of landing on every row in one frame. The delay is capped, so a list of forty finishes in 180ms rather than 1.2 seconds, without a ceiling the last item looks broken.',
      },
    },
  },
  render: function StaggerStory() {
    const people = [
      'Grace Hopper',
      'Ada Lovelace',
      'Radia Perlman',
      'Barbara Liskov',
      'Katherine Johnson',
      'Margaret Hamilton',
      'Joan Clarke',
      'Anita Borg',
    ];
    const [selected, setSelected] = useState<string[]>([]);
    const all = selected.length === people.length;

    return (
      <div className="max-w-md space-y-3">
        <Button
          onClick={() => {
            setSelected(all ? [] : people);
          }}
        >
          {all ? 'Deselect all' : 'Select all'}
        </Button>

        <ul className="space-y-2">
          {people.map((name, index) => (
            <li key={name} className="relative rounded-lg border border-border bg-surface p-3">
              <span
                aria-hidden
                style={staggerStyle(index)}
                className={`pointer-events-none absolute inset-0 rounded-lg ring-2 ring-accent ring-offset-1 ring-offset-canvas transition-opacity duration-(--animate-duration-normal) ease-standard ${
                  selected.includes(name) ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <span className="text-base text-fg">{name}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  },
};

export const InlineValidation: Story = {
  name: 'An error message',
  parameters: {
    docs: {
      description: {
        story:
          'The other everyday case. A validation message that appears under a field pushes the rest of the form down, on a long form, mid-typing. `Reveal` makes that push a movement rather than a jump, and the message keeps its `role="alert"` either way.',
      },
    },
  },
  render: function ValidationStory(args) {
    const [value, setValue] = useState('');
    const invalid = value.length > 0 && !value.includes('@');

    return (
      <div className="max-w-sm space-y-1.5">
        <label htmlFor="reveal-email" className="text-sm font-medium text-fg">
          Work email
        </label>
        <Input
          id="reveal-email"
          value={value}
          aria-invalid={invalid || undefined}
          placeholder="Type something without an @"
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <Reveal {...args} open={invalid} from="top">
          <p role="alert" className="pt-1 text-xs font-medium text-danger-fg">
            That does not look like an email address.
          </p>
        </Reveal>
        <div className="flex items-center gap-2 pt-2">
          <Badge size="sm" tone={invalid ? 'danger' : 'neutral'} dot>
            {invalid ? 'Invalid' : 'Waiting'}
          </Badge>
          <span className="text-xs text-fg-muted">
            The badge below never jumps as the message comes and goes.
          </span>
        </div>
      </div>
    );
  },
};
