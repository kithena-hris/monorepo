import type { Meta, StoryObj } from '@storybook/react-vite';
import { Mail, Plus, Sparkles } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { Chip, ChipGroup, ChipGroupItem, ChipRow } from './chip';

const meta = {
  title: 'Components/Chip',
  component: Chip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Compact, tappable choices. Filter chips narrow results, input chips hold values, and suggestion chips offer a next step. For a status, use a `Badge`.',
          '',
          '| Kind | Build it with | Semantics |',
          '| --- | --- | --- |',
          '| Filter | `ChipGroup type="multiple"`, or one `Chip selected` | Toggle buttons (`aria-pressed`), with a tick when on |',
          '| Choice | `ChipGroup type="single"` | A radio group; arrow keys move the choice |',
          '| Input | `Chip onRemove` | A value, and a remove button named after it |',
          '| Suggestion | `Chip variant="dashed"` | A plain button: it acts, it holds nothing |',
          '',
          'Under a finger a chip grows to 36px and its hit area to the 44px floor, and a `scroll` group becomes one row that scrolls from edge to edge.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    selected: {
      description:
        'Filter-chip state. Present, the chip is a toggle button with `aria-pressed` and a tick when on.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    variant: {
      description: '`dashed` for a suggestion or an "Add filter" chip: an offer, not a value.',
      control: 'inline-radio',
      options: ['filled', 'dashed'],
      table: {
        type: { summary: "'filled' | 'dashed'" },
        defaultValue: { summary: 'filled' },
        category: 'Appearance',
      },
    },
    invalid: {
      description: 'An input chip whose value failed validation, such as a half-typed email.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    field: {
      description: 'The filter this chip holds, shown muted before the value.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    onRemove: {
      description: 'Makes this an input chip with a trailing remove button.',
      control: false,
      table: { type: { summary: '() => void' }, category: 'Events' },
    },
    children: {
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
  },
  args: { children: 'Engineering' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [on, setOn] = useState(true);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Chip {...args} selected={false} />
        <Chip
          {...args}
          selected={on}
          onClick={() => {
            setOn(!on);
          }}
        />
      </div>
    );
  },
};

const teams = ['All', 'Engineering', 'Design', 'Sales', 'Support', 'Remote'];

export const FilterChips: Story = {
  name: 'Filter chips',
  parameters: {
    docs: {
      description: {
        story:
          'More than one can be on at a time. The tick shows the state, so it doesn’t rely on colour alone.',
      },
    },
  },
  render: () => (
    <ChipGroup type="multiple" defaultValue={['All', 'Engineering']} aria-label="Teams">
      {teams.map((team) => (
        <ChipGroupItem key={team} value={team}>
          {team}
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const ChoiceChips: Story = {
  name: 'Choice chips',
  parameters: {
    docs: { description: { story: 'Exactly one is on, like a radio group.' } },
  },
  render: () => (
    <ChipGroup type="single" defaultValue="Full-time" aria-label="Contract type">
      {['Full-time', 'Part-time', 'Contractor', 'Intern'].map((kind) => (
        <ChipGroupItem key={kind} value={kind}>
          {kind}
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const ViewChips: Story = {
  name: 'View chips',
  parameters: {
    docs: {
      description: {
        story:
          'A row of saved views over a list: one at a time, the chosen one inverted, each with its count where there is one.',
      },
    },
  },
  render: () => (
    <ChipGroup type="single" defaultValue="Everyone" aria-label="Views">
      {(
        [
          ['Everyone', 412],
          ['My team', 9],
          ['New joiners', 14],
          ['Leaving', 3],
          ['Incomplete', 88],
        ] as const
      ).map(([view, count]) => (
        <ChipGroupItem key={view} value={view} variant="view">
          {view}
          <span className="font-medium tabular-nums">{count}</span>
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const InputChips: Story = {
  name: 'Input chips',
  parameters: {
    docs: {
      description: {
        story:
          'Values somebody picked or typed. Each remove button is named after its value, so a screen reader hears "Remove Priya Shah" rather than four identical "Remove" buttons.',
      },
    },
  },
  render: function InputChipsStory() {
    const [values, setValues] = useState(['Priya Shah', 'Jonas Weber']);
    const remove = (name: string) => () => {
      setValues(values.filter((value) => value !== name));
    };
    return (
      <div className="flex flex-wrap items-center gap-2">
        {values.map((name) => (
          <Chip
            key={name}
            startIcon={<Avatar name={name} size="xs" className="touch:size-6" />}
            onRemove={remove(name)}
          >
            {name}
          </Chip>
        ))}
        <Chip startIcon={<Mail aria-hidden="true" />} onRemove={() => undefined}>
          design@reach.co
        </Chip>
        <Chip invalid onRemove={() => undefined} removeLabel="Remove jonas@, not a valid email">
          jonas@
        </Chip>
      </div>
    );
  },
};

export const SuggestionChips: Story = {
  name: 'Suggestion chips',
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {['Request time off', 'Show my payslip', 'Who is out today?'].map((label) => (
        <Chip key={label} variant="dashed" startIcon={<Sparkles aria-hidden="true" />}>
          {label}
        </Chip>
      ))}
    </div>
  ),
};

export const KeyAndValue: Story = {
  name: 'Key and value',
  parameters: {
    docs: {
      description: {
        story:
          'An applied filter reads as one phrase, the field muted and the value in full. The remove button takes the filter off.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip selected field="Team" onRemove={() => undefined}>
        Engineering
      </Chip>
      <Chip selected field="Location" onRemove={() => undefined}>
        Berlin, London
      </Chip>
      <Chip selected field="Start" onRemove={() => undefined}>
        After 1 Jan 2024
      </Chip>
      <Chip variant="dashed" startIcon={<Plus aria-hidden="true" />}>
        Add filter
      </Chip>
    </div>
  ),
};

export const Overflow: Story = {
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'At a desk, `ChipRow max={3}` shows three chips and folds the rest into "+4 more", which unfolds them in place. On a phone the same row shows every chip in one line that scrolls from edge to edge. `ChipGroup scroll` does the same for filter and choice chips.',
      },
    },
  },
  render: function OverflowStory() {
    const [applied, setApplied] = useState([
      'Engineering',
      'Design',
      'Sales',
      'Support',
      'Finance',
      'People',
      'Legal',
    ]);
    return (
      <ChipRow max={3} aria-label="Applied filters">
        {applied.map((team) => (
          <Chip
            key={team}
            selected
            onRemove={() => {
              setApplied((current) => current.filter((entry) => entry !== team));
            }}
          >
            {team}
          </Chip>
        ))}
      </ChipRow>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip disabled>Contractor</Chip>
      <Chip disabled selected>
        Engineering
      </Chip>
    </div>
  ),
};

export const ChipBadgeOrButton: Story = {
  name: 'Chip, badge or button?',
  parameters: { layout: 'padded' },
  render: () => (
    <div className="@container">
      <div className="grid gap-2.5 @xl:grid-cols-3">
        <Card className="flex flex-col items-start gap-2 p-4">
          <Chip selected>Berlin</Chip>
          <p className="font-semibold">Chip</p>
          <p className="text-sm text-fg-muted">You can tap it. It picks or holds a value.</p>
        </Card>
        <Card className="flex flex-col items-start gap-2 p-4">
          <Badge tone="success" dot>
            Active
          </Badge>
          <p className="font-semibold">Badge</p>
          <p className="text-sm text-fg-muted">You can’t tap it. It shows a status.</p>
        </Card>
        <Card className="flex flex-col items-start gap-2 p-4">
          <Button variant="primary" size="sm">
            Save
          </Button>
          <p className="font-semibold">Button</p>
          <p className="text-sm text-fg-muted">It does something once.</p>
        </Card>
      </div>
    </div>
  ),
};

/**
 * Copies every `:hover` and `:focus-visible` rule in the page's stylesheets as
 * a `[data-hover]` / `[data-focus]` rule, so a story can hold a chip in that
 * state and axe checks its contrast there: no pointer reaches a test, and a
 * synthetic `mouseenter` never matches `:hover`. A copy stays inside its
 * `@media (hover: hover)`, so under a finger, where nothing hovers, nothing is
 * forced either.
 */
function forcePseudoStates(): void {
  // The pseudo-class, not the same letters escaped in a class name (`.hover\:bg-x`).
  const forced: readonly (readonly [RegExp, string])[] = [
    [/(?<!\\):hover\b/g, '[data-hover]'],
    [/(?<!\\):focus-visible\b/g, '[data-focus]'],
  ];
  const walk = (holder: CSSStyleSheet | CSSGroupingRule | CSSStyleRule): void => {
    const rules = holder.cssRules;
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const rule = rules[i];
      if (rule === undefined) continue;
      if ('cssRules' in rule) walk(rule as CSSGroupingRule | CSSStyleRule);
      if (!(rule instanceof CSSStyleRule)) continue;
      const selector = forced.reduce((s, [from, to]) => s.replace(from, to), rule.selectorText);
      if (selector === rule.selectorText) continue;
      holder.insertRule(selector + rule.cssText.slice(rule.selectorText.length), i + 1);
    }
  };
  for (const sheet of document.styleSheets) {
    if (seenSheets.has(sheet)) continue;
    seenSheets.add(sheet);
    try {
      walk(sheet);
    } catch {
      // Another origin's stylesheet: not readable, and nothing of this system's.
    }
  }
}

/** Sheets already copied; a sheet Vite replaces is a new one, and copied again. */
const seenSheets = new WeakSet<CSSStyleSheet>();

type Forced = Readonly<Record<`data-${string}`, string>>;

/** One chip at rest, hovered, focused, and hovered while focused. */
function States({ chip }: { readonly chip: (state: Forced) => JSX.Element }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip({})}
      {chip({ 'data-hover': '' })}
      {chip({ 'data-focus': '' })}
      {chip({ 'data-hover': '', 'data-focus': '' })}
    </div>
  );
}

function EveryChip(): JSX.Element {
  return (
    <div className="flex flex-col gap-3 bg-canvas p-4 text-fg">
      <States chip={(s) => <Chip {...s}>Filled</Chip>} />
      <States
        chip={(s) => (
          <Chip selected {...s}>
            Selected
          </Chip>
        )}
      />
      <States
        chip={(s) => (
          <Chip field="Team" {...s}>
            Engineering
          </Chip>
        )}
      />
      <States
        chip={(s) => (
          <Chip field="Team" selected {...s}>
            Engineering
          </Chip>
        )}
      />
      <States
        chip={(s) => (
          <Chip variant="dashed" startIcon={<Plus aria-hidden="true" />} {...s}>
            Add filter
          </Chip>
        )}
      />
      <States
        chip={(s) => (
          <Chip invalid {...s}>
            sam@
          </Chip>
        )}
      />
      <States
        chip={(s) => (
          <Chip field="Team" selected onRemove={() => undefined} {...s}>
            Engineering
          </Chip>
        )}
      />
      <States
        chip={(s) => (
          <Chip variant="dashed" onRemove={() => undefined} {...s}>
            “in Berlin”
          </Chip>
        )}
      />
      <ChipGroup type="multiple" defaultValue={['on', 'on-hover', 'on-focus']} aria-label="Filters">
        <ChipGroupItem value="off">Off</ChipGroupItem>
        <ChipGroupItem value="off-hover" data-hover="">
          Off
        </ChipGroupItem>
        <ChipGroupItem value="on">On</ChipGroupItem>
        <ChipGroupItem value="on-hover" data-hover="">
          On
        </ChipGroupItem>
        <ChipGroupItem value="on-focus" data-hover="" data-focus="">
          On
        </ChipGroupItem>
      </ChipGroup>
      {(
        [
          ['at rest', {}],
          ['hovered', { 'data-hover': '' }],
          ['hovered and focused', { 'data-hover': '', 'data-focus': '' }],
        ] as const
      ).map(([name, state]) => (
        <ChipGroup key={name} type="single" value="on" aria-label={`Views, chosen ${name}`}>
          <ChipGroupItem value="off" variant="view">
            Everyone <span className="font-medium tabular-nums">48</span>
          </ChipGroupItem>
          <ChipGroupItem value="off-hover" variant="view" data-hover="">
            Starting soon
          </ChipGroupItem>
          <ChipGroupItem value="on" variant="view" {...state}>
            Incomplete <span className="font-medium tabular-nums">3</span>
          </ChipGroupItem>
        </ChipGroup>
      ))}
    </div>
  );
}

/**
 * Every chip, at rest, hovered, focused and both, selected and not, in light
 * and in dark: each held in its state, so axe checks the contrast of every one.
 */
export const HoverAndFocus: Story = {
  name: 'Hover and focus, every variant',
  parameters: { layout: 'padded' },
  render: function HoverAndFocusStory() {
    forcePseudoStates();
    return (
      <div className="grid gap-4">
        <EveryChip />
        <div className="dark">
          <EveryChip />
        </div>
      </div>
    );
  },
};
