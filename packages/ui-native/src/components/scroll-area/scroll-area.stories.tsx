import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Card, CardDescription } from '../card/card.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Separator } from '../separator/separator.tsx';
import { Text } from '../text/text.tsx';
import { ScrollArea } from './scroll-area.tsx';

const meta = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  parameters: designDocs('scroll-area'),
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A person in a list: what a scroll area usually holds. */
function Row({
  name,
  detail,
  avatar = 28,
  height = 'min-h-12',
  last = false,
}: {
  name: string;
  detail?: string;
  avatar?: number | false;
  height?: string;
  last?: boolean;
}): React.JSX.Element {
  return (
    <View>
      <Inline gap={3} wrap={false} className={`${height} px-4 py-2`}>
        {avatar ? <Avatar name={name} size={avatar} decorative /> : null}
        <View className="flex-1">
          <Text variant="callout" weight="semibold" numberOfLines={1}>
            {name}
          </Text>
          {detail ? (
            <Text variant="subhead" tone="muted" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </Inline>
      {last ? null : <Separator />}
    </View>
  );
}

export const Playground: Story = {
  render: () => (
    <Card padded={false} className="overflow-hidden rounded-[20px]">
      <ScrollArea className="h-[260px]" fade="surface" accessibilityLabel="Team">
        {PEOPLE.map((p, i) => (
          <Row key={p.name} name={p.name} detail={p.team} last={i === PEOPLE.length - 1} />
        ))}
      </ScrollArea>
    </Card>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Card padded={false} className="overflow-hidden rounded-[20px]">
      <ScrollArea
        orientation="horizontal"
        accessibilityLabel="People"
        contentClassName="gap-2.5 p-3"
      >
        {PEOPLE.slice(0, 8).map((p) => (
          <Stack
            key={p.name}
            gap={2}
            align="center"
            className="w-[120px] rounded-md bg-surface-sunken p-3"
          >
            <Avatar name={p.name} decorative />
            <Text variant="footnote" weight="semibold">
              {p.name.split(' ')[0] ?? p.name}
            </Text>
          </Stack>
        ))}
      </ScrollArea>
    </Card>
  ),
};

export const AlwaysVisible: Story = {
  name: 'Always visible',
  parameters: designNote('scroll-area', 'Always visible'),
  render: () => (
    <Card padded={false} className="overflow-hidden rounded-[20px]">
      <ScrollArea className="h-[220px]" type="always" accessibilityLabel="Locations">
        {PEOPLE.slice(0, 8).map((p, i) => (
          <Row
            key={p.name}
            name={p.name}
            detail={p.location}
            avatar={false}
            height="min-h-11"
            last={i === 7}
          />
        ))}
      </ScrollArea>
    </Card>
  ),
};

export const InsideAPanel: Story = {
  name: 'A fixed panel with a scrolling body',
  parameters: {
    docs: {
      description: {
        story: 'The header and the footer stay; only the body between them scrolls.',
      },
    },
  },
  render: () => (
    <Card padded={false} className="h-80 overflow-hidden rounded-[18px]">
      <View className="px-4 py-3.5">
        <Text variant="callout" weight="bold">
          Team
        </Text>
      </View>
      <Separator />
      <ScrollArea className="flex-1" accessibilityLabel="Team members">
        {PEOPLE.map((p, i) => (
          <Row key={p.name} name={p.name} height="min-h-[46px]" last={i === PEOPLE.length - 1} />
        ))}
      </ScrollArea>
      <Separator />
      <Inline justify="end" className="px-4 py-3">
        <Button variant="primary" size="sm">
          Done
        </Button>
      </Inline>
    </Card>
  ),
};

export const WhenToVirtualize: Story = {
  name: 'When to virtualize',
  render: () => (
    <Card>
      <Stack gap={3}>
        <Text weight="semibold">Over 200 rows? Virtualize.</Text>
        <CardDescription>
          A scroll area renders every row. Above about 200 rows, use VirtualList, which renders only
          the rows you can see.
        </CardDescription>
        <View>
          <Inline justify="between" wrap={false}>
            <Text variant="subhead" weight="semibold">
              Rows rendered
            </Text>
            <Text variant="subhead" tone="muted" tabular>
              24 of 20,000
            </Text>
          </Inline>
          {/* A placeholder for Progress (RMB-027), which lane B adds. */}
          <View
            accessible
            role="progressbar"
            aria-label="Rows rendered"
            aria-valuenow={8}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2 h-2 overflow-hidden rounded-full bg-surface-active"
          >
            <View className="h-full w-[8%] rounded-full bg-accent" />
          </View>
        </View>
      </Stack>
    </Card>
  ),
};
