import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Ban,
  Bell,
  CalendarX,
  FilePlus2,
  Flag,
  Layers,
  LogOut,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useState } from 'react';

import { setShortcutKeys } from '../../lib/shortcut-keys';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { HorizontalBarChart } from '../chart/chart';
import { Chip, ChipRow } from '../chip/chip';
import { IconList, IconListItem } from '../icon-list/icon-list';
import { KeyValues } from '../key-values/key-values';
import { RadioCard, RadioGroup } from '../radio-group/radio-group';
import { ScrollPosition } from '../scroll-position/scroll-position';
import { SearchField } from '../typed-fields/typed-fields';
import { AssistantCard, AssistantLabel } from './assistant';

// The app binds the key and names it; a story has to say which key it is.
setShortcutKeys({ keys: { 'page.search': ['/'] }, characterKeys: true });

const meta = {
  title: 'Components/AI patterns',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'How the assistant shows up outside its panel. It does the work, shows its reasoning, and always leaves the final say to a person.',
          '',
          '| Piece | Build it with |',
          '| --- | --- |',
          '| Smart search bar | `SearchField variant="prompt"`, with `loading` and `shortcut` |',
          '| Understood as | `ChipRow` with an `AssistantLabel` as its `label`, removable `Chip`s, `variant="dashed"` for a part not used, and a link `Button` as its `action` |',
          '| AI card | `AssistantCard`: the `Card variant="assistant"` edge, the mark, a title, an `action` and a `note` |',
          '| AI badge | `Badge tone="assistant"` |',
          '| Why it is flagged, or a plan | `IconList`, `divided` for a plan |',
          '| Comparison bars | `HorizontalBarChart` with `sorted={false}` and `toneOf` |',
          '| Choice with impact | `RadioCard` with `badge` and `impact` |',
          '| Where you are in a long list | `ScrollPosition` |',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SmartSearchBar: Story = {
  render: function Render() {
    const [idle, setIdle] = useState('');
    const [typed, setTyped] = useState('engineers in Madrid');
    const [asking, setAsking] = useState('people leaving soon');
    const placeholder = 'Ask in plain English, like “engineers in Madrid who joined this year”';
    return (
      <div className="flex max-w-215 flex-col gap-2.5">
        <SearchField
          variant="prompt"
          label="Ask"
          placeholder={placeholder}
          shortcut="page.search"
          value={idle}
          onValueChange={setIdle}
        />
        <SearchField
          variant="prompt"
          label="Ask"
          placeholder={placeholder}
          shortcut="page.search"
          value={typed}
          onValueChange={setTyped}
        />
        <SearchField
          variant="prompt"
          label="Ask"
          placeholder={placeholder}
          loading
          value={asking}
          onValueChange={setAsking}
        />
      </div>
    );
  },
};

const understood = [
  ['Team', 'Engineering'],
  ['Location', 'Madrid'],
  ['Start', '2026'],
  ['Missing', 'Bank account'],
] as const;

export const UnderstoodAs: Story = {
  render: function Render() {
    const [chips, setChips] = useState<readonly (readonly [string, string])[]>(understood);
    const [unused, setUnused] = useState(true);
    return (
      <ChipRow
        label={<AssistantLabel>Understood as</AssistantLabel>}
        action={
          <Button variant="link" size="sm">
            Edit as filters
          </Button>
        }
      >
        {chips.map(([field, value]) => (
          <Chip
            key={field}
            field={field}
            selected
            onRemove={() => {
              setChips(chips.filter(([f]) => f !== field));
            }}
          >
            {value}
          </Chip>
        ))}
        {unused ? (
          <Chip
            variant="dashed"
            removeLabel="Remove “who are good at Go”, which was not used"
            onRemove={() => {
              setUnused(false);
            }}
          >
            “who are good at Go”<span className="sr-only">, not used</span>
          </Chip>
        ) : null}
      </ChipRow>
    );
  },
};

export const AICard: Story = {
  name: 'AI card',
  render: () => (
    <div className="flex max-w-140 flex-col gap-4">
      <AssistantCard
        title="Here’s what I’d create"
        action={
          <Badge tone="assistant" size="sm">
            AI
          </Badge>
        }
        note="A short note on where it came from."
      >
        <p className="text-sm text-fg-muted">
          Content written or built by AI sits in this card, with its own edge.
        </p>
      </AssistantCard>
      <AssistantCard
        title="What does “leaving soon” mean here?"
        note="Pick one and it is remembered for next time."
      >
        <div className="flex flex-wrap gap-2">
          <Chip startIcon={<LogOut aria-hidden />}>Have given notice · 3</Chip>
          <Chip startIcon={<CalendarX aria-hidden />}>Contract ends in 90 days · 5</Chip>
          <Chip>Both · 8</Chip>
        </div>
      </AssistantCard>
    </div>
  ),
};

export const AIBadge: Story = {
  name: 'AI badge',
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="assistant" size="sm">
        AI
      </Badge>
      <Badge tone="assistant" size="sm">
        Suggested
      </Badge>
      <Badge tone="assistant" size="sm">
        Written 08:00
      </Badge>
      <Badge tone="assistant" size="sm">
        From import
      </Badge>
      <Badge tone="assistant" variant="solid" size="sm">
        AI
      </Badge>
    </div>
  ),
};

export const WhyItsFlagged: Story = {
  name: 'Why it’s flagged',
  render: () => (
    <Card padded className="flex max-w-140 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold">Tom Fischer</span>
        <Badge tone="warning" size="sm">
          <Flag aria-hidden />
          Unusual
        </Badge>
      </div>
      <IconList>
        <IconListItem
          icon={<TrendingUp aria-hidden />}
          tone="warning"
          description="Sales median is 4%"
        >
          A 38% raise
        </IconListItem>
        <IconListItem
          icon={<Layers aria-hidden />}
          tone="warning"
          description="Band tops out at €78k"
        >
          Above the band
        </IconListItem>
      </IconList>
    </Card>
  ),
};

export const ComparisonBars: Story = {
  render: () => (
    <Card variant="fill" padded className="max-w-140">
      <HorizontalBarChart
        label="This raise against the team’s raises this year"
        sorted={false}
        data={[
          { label: 'This change', value: 38 },
          { label: 'Team median', value: 4 },
          { label: 'Largest', value: 12 },
        ]}
        format={(value) => `${String(value)}%`}
        toneOf={(point) => (point.label === 'This change' ? 'warning' : 'neutral')}
      />
    </Card>
  ),
};

export const APlan: Story = {
  name: 'A plan, before it runs',
  render: () => (
    <AssistantCard
      className="max-w-170"
      title="Here’s everything that will happen"
      note="Written from your choices. Nothing has happened yet."
    >
      <IconList divided>
        <IconListItem
          icon={<FilePlus2 aria-hidden />}
          tone="accent"
          description="Published as version 8."
          action={
            <Button variant="ghost" size="xs">
              Open draft
            </Button>
          }
        >
          Create 3 fields
        </IconListItem>
        <IconListItem
          icon={<Users aria-hidden />}
          tone="success"
          description="31 rows are unchanged."
          action={
            <Button variant="ghost" size="xs">
              See rows
            </Button>
          }
        >
          Create 298 records and update 71
        </IconListItem>
        <IconListItem icon={<Bell aria-hidden />} tone="info" description="Optional for them.">
          Ask 14 people for a value
        </IconListItem>
        <IconListItem icon={<Ban aria-hidden />} description="Its values aren’t kept.">
          Leave out one column
        </IconListItem>
      </IconList>
    </AssistantCard>
  ),
};

export const ChoiceWithImpact: Story = {
  render: function Render() {
    const [value, setValue] = useState('ask');
    return (
      <RadioGroup
        value={value}
        onValueChange={setValue}
        aria-label="People with no value"
        className="max-w-120"
      >
        <RadioCard
          value="ask"
          description="Optional for them."
          impact="14 tasks"
          badge={
            <Badge tone="assistant" size="sm">
              Suggested
            </Badge>
          }
        >
          Ask the 14 people
        </RadioCard>
        <RadioCard value="required" description="They show as incomplete." impact="14 incomplete">
          Required for everyone
        </RadioCard>
        <RadioCard value="new" description="Nobody asked today." impact="No tasks">
          Only new joiners
        </RadioCard>
      </RadioGroup>
    );
  },
};

export const WhereYouAre: Story = {
  name: 'Where you are in a long list',
  render: () => (
    <ScrollPosition
      className="w-fit"
      onBackToTop={() => {
        /* the list scrolls to its first row */
      }}
    >
      150 of 388
    </ScrollPosition>
  ),
};

export const TheRules: Story = {
  render: () => (
    <Card padded className="max-w-200">
      <KeyValues
        layout="aligned"
        labelWidth="9rem"
        items={[
          {
            label: 'Show the work',
            value: 'Every AI result becomes something you can see and edit: chips, fields, a plan',
          },
          { label: 'Ask, don’t guess', value: 'If a question has two readings, offer both' },
          { label: 'Never decide', value: 'AI flags, drafts and suggests. A person approves' },
          {
            label: 'Same permissions',
            value: 'AI only sees and shares what the person using it could',
          },
          {
            label: 'Never touched',
            value:
              'Special-category data, performance judgements, and anything not stored as a field',
          },
        ]}
      />
    </Card>
  ),
};
