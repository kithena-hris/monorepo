import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Mail, Plus, Sparkles } from 'lucide-react-native';
import { useState } from 'react';

import { designDocs, designNote } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Chip, ChipGroup, ChipGroupItem } from './chip.tsx';

const meta = {
  title: 'Components/Chip',
  component: Chip,
  parameters: designDocs('chip'),
  args: { children: 'Engineering' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [on, setOn] = useState(true);
    return (
      <Inline gap={2}>
        <Chip {...args} selected={false} />
        <Chip
          {...args}
          selected={on}
          onPress={() => {
            setOn(!on);
          }}
        />
      </Inline>
    );
  },
};

export const FilterChips: Story = {
  name: 'Filter chips',
  parameters: designNote('chip', 'Filter chips'),
  render: () => (
    <ChipGroup type="multiple" defaultValue={['All', 'Engineering']} accessibilityLabel="Teams">
      {['All', 'Engineering', 'Design', 'Sales', 'Support', 'Remote'].map((team) => (
        <ChipGroupItem key={team} value={team}>
          {team}
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const ChoiceChips: Story = {
  name: 'Choice chips',
  parameters: designNote('chip', 'Choice chips'),
  render: () => (
    <ChipGroup type="single" defaultValue="Full-time" accessibilityLabel="Contract type">
      {['Full-time', 'Part-time', 'Contractor', 'Intern'].map((kind) => (
        <ChipGroupItem key={kind} value={kind}>
          {kind}
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const InputChips: Story = {
  name: 'Input chips',
  render: function InputChipsStory() {
    const [values, setValues] = useState(['Priya Shah', 'Jonas Weber']);
    return (
      <Inline gap={2}>
        {values.map((name) => (
          <Chip
            key={name}
            startIcon={<Avatar name={name} size={24} decorative />}
            onRemove={() => {
              setValues(values.filter((value) => value !== name));
            }}
          >
            {name}
          </Chip>
        ))}
        <Chip icon={Mail} onRemove={() => undefined}>
          design@reach.co
        </Chip>
        <Chip invalid onRemove={() => undefined} removeLabel="Remove jonas@, not a valid email">
          jonas@
        </Chip>
      </Inline>
    );
  },
};

export const SuggestionChips: Story = {
  name: 'Suggestion chips',
  render: () => (
    <Inline gap={2}>
      {['Request time off', 'Show my payslip', 'Who is out today?'].map((label) => (
        <Chip key={label} variant="dashed" icon={Sparkles}>
          {label}
        </Chip>
      ))}
    </Inline>
  ),
};

export const KeyAndValue: Story = {
  name: 'Key and value',
  render: () => (
    <Inline gap={2}>
      <Chip selected field="Team" onRemove={() => undefined}>
        Engineering
      </Chip>
      <Chip selected field="Location" onRemove={() => undefined}>
        Berlin, London
      </Chip>
      <Chip selected field="Start" onRemove={() => undefined}>
        After 1 Jan 2024
      </Chip>
      <Chip variant="dashed" icon={Plus}>
        Add filter
      </Chip>
    </Inline>
  ),
};

export const Overflow: Story = {
  render: () => (
    <Stack gap={2} className="gap-2.5">
      <ChipGroup type="single" defaultValue="Engineering" accessibilityLabel="Teams" scroll>
        {['All', 'Engineering', 'Design', 'Sales', 'Support', 'Finance', 'People'].map((team) => (
          <ChipGroupItem key={team} value={team}>
            {team}
          </ChipGroupItem>
        ))}
      </ChipGroup>
      <Text variant="subhead" tone="muted">
        On a phone, chips scroll sideways in a single row from edge to edge.
      </Text>
    </Stack>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Inline gap={2}>
      <Chip disabled>Contractor</Chip>
      <Chip disabled selected>
        Engineering
      </Chip>
    </Inline>
  ),
};

function Which({
  example,
  title,
  description,
}: {
  example: React.ReactNode;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <Card className="items-start gap-2 p-3.5">
      {example}
      <Text weight="semibold">{title}</Text>
      <Text variant="subhead" tone="muted">
        {description}
      </Text>
    </Card>
  );
}

export const ChipBadgeOrButton: Story = {
  name: 'Chip, badge or button?',
  render: () => (
    <Stack gap={2} className="gap-2.5">
      <Which
        example={<Chip selected>Berlin</Chip>}
        title="Chip"
        description="You can tap it. It picks or holds a value."
      />
      <Which
        example={
          <Badge tone="success" dot>
            Active
          </Badge>
        }
        title="Badge"
        description="You can’t tap it. It shows a status."
      />
      <Which
        example={
          <Button variant="primary" size="sm">
            Save
          </Button>
        }
        title="Button"
        description="It does something once."
      />
    </Stack>
  ),
};
