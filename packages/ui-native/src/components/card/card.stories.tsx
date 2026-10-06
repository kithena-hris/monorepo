import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  MessageCircle,
  TriangleAlert,
} from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { AutoGrid, Inline, Stack } from '../layout/layout.tsx';
import { Separator } from '../separator/separator.tsx';
import { Text } from '../text/text.tsx';
import { Card, CardDescription, CardTitle } from './card.tsx';

const meta = {
  title: 'Components/Card',
  component: Card,
  parameters: designDocs('card'),
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Card>
      <CardTitle>Time off</CardTitle>
      <CardDescription>14.5 days left this year</CardDescription>
    </Card>
  ),
};

const VARIANTS = [
  ['raised', 'Raised'],
  ['outline', 'Outline'],
  ['fill', 'Fill'],
  ['elevated', 'Elevated'],
] as const;

export const Variants: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Raised by default. Outline on a surface that is already white, fill for a panel inside a panel, elevated for content that floats. A card with `onPress` is one target and deepens its shadow under a finger.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth={150} gap={3}>
      {VARIANTS.map(([variant, label]) => (
        <Card key={variant} variant={variant}>
          <Text variant="headline">{label}</Text>
          <CardDescription>For grouping</CardDescription>
        </Card>
      ))}
      <Card onPress={() => undefined} accessibilityLabel="Interactive, opens the request">
        <Text variant="headline">Interactive</Text>
        <CardDescription>Lifts when pressed</CardDescription>
      </Card>
    </AutoGrid>
  ),
};

export const Attention: Story = {
  render: () => (
    <Stack gap={2} className="gap-2.5">
      <Card className="flex-row gap-3 bg-warning-subtle shadow-none">
        <Icon icon={TriangleAlert} tone="warning" />
        <View className="flex-1">
          <Text weight="semibold">Right to work expires in 14 days</Text>
          <Text variant="subhead" tone="muted">
            Upload a new visa for Lucas Moreau before 12 Oct.
          </Text>
          <View className="mt-2.5 items-start">
            <Button variant="primary" size="sm">
              Upload
            </Button>
          </View>
        </View>
      </Card>
      <Card className="bg-accent-solid shadow-none">
        <Text variant="subhead" weight="semibold" tone="on-accent">
          Vacation left
        </Text>
        <Text
          tone="on-accent"
          weight="bold"
          tabular
          className="mt-2.5 text-[44px] leading-none tracking-[-1.76px]"
        >
          14.5{' '}
          <Text tone="on-accent" variant="title3" weight="bold">
            days
          </Text>
        </Text>
      </Card>
    </Stack>
  ),
};

function Stat({
  label,
  value,
  unit,
  delta,
  down = false,
}: {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  down?: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <Text variant="subhead" weight="medium" tone="muted">
        {label}
      </Text>
      <Text weight="bold" tabular className="text-[30px] leading-none tracking-[-0.9px]">
        {value}
        {unit ? (
          <Text variant="subhead" tone="muted">
            {' '}
            {unit}
          </Text>
        ) : null}
      </Text>
      <Inline gap={1} wrap={false}>
        <Icon icon={down ? ArrowDownRight : ArrowUpRight} size={14} tone="success" />
        <Text variant="footnote" weight="semibold" tone="success">
          {delta}
        </Text>
      </Inline>
    </Card>
  );
}

export const StatTile: Story = {
  name: 'Stat tile',
  parameters: {
    docs: {
      description: {
        story:
          'The number first, then which way it moved. The Stat component is this, with a sparkline.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth={150} gap={3}>
      <Stat label="Headcount" value="312" delta="+12 this quarter" />
      <Stat label="Attrition" value="6.1" unit="%" delta="0.8 pts lower" down />
    </AutoGrid>
  ),
};

const FACTS = [
  ['Back', '21 Oct'],
  ['Cover', 'Omar Haddad'],
  ['Manager', 'Jonas Weber'],
] as const;

export const Composed: Story = {
  render: () => (
    <Card>
      <Stack gap={3} className="gap-3.5">
        <Inline gap={3} wrap={false} align="center">
          <Avatar name="Amara Okafor" size="xl" decorative />
          <View className="flex-1">
            <Text weight="bold">Amara Okafor</Text>
            <Text variant="subhead" tone="muted">
              Product Designer · London
            </Text>
          </View>
          <Badge size="sm" dot tone="info">
            On leave
          </Badge>
        </Inline>
        <View>
          {FACTS.map(([key, value], i) => (
            <View key={key}>
              {i > 0 ? <Separator /> : null}
              <Inline justify="between" wrap={false} className="min-h-[52px] py-2.5">
                <Text variant="callout" tone="muted">
                  {key}
                </Text>
                <Text variant="callout" weight="medium">
                  {value}
                </Text>
              </Inline>
            </View>
          ))}
        </View>
        <Inline gap={2}>
          <Button size="sm" startIcon={<Icon icon={MessageCircle} />}>
            Message
          </Button>
          <Button size="sm" variant="ghost" endIcon={<Icon icon={ArrowRight} />}>
            Profile
          </Button>
        </Inline>
      </Stack>
    </Card>
  ),
};
