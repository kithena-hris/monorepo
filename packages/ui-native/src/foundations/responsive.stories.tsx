import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { ChevronRight } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { View } from 'react-native-css/components';

import { Avatar } from '../components/avatar/avatar.tsx';
import { Badge } from '../components/badge/badge.tsx';
import { Card } from '../components/card/card.tsx';
import { Icon } from '../components/icon/icon.tsx';
import { Inline, Stack } from '../components/layout/layout.tsx';
import { Separator } from '../components/separator/separator.tsx';
import { Text } from '../components/text/text.tsx';
import { designDocs, designNote } from '../docs/design.ts';
import { PEOPLE, STATUS_TONE } from '../docs/people.ts';

const meta = {
  title: 'Foundations/Responsive',
  parameters: designDocs('responsive'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A table row as a phone shows it: a card with the first column as its title. */
function RowCard({ children, first }: { children: ReactNode; first: boolean }): React.JSX.Element {
  return (
    <View>
      {first ? null : <Separator />}
      <Inline gap={3} wrap={false} align="start" className="px-4 py-3">
        <View className="flex-1 gap-1">{children}</View>
        <Icon icon={ChevronRight} size={16} tone="subtle" />
      </Inline>
    </View>
  );
}

const BREAKPOINTS = [
  ['< 640', '4', '16', 'Tab bar. Tables become lists. Sheets from the bottom.'],
  ['640–1023', '8', '24', 'Rail with icons. Dialogs become centred.'],
  ['1024–1439', '12', '32', 'Full sidebar. List and detail side by side.'],
  ['≥ 1440', '12', 'auto', 'Content stops at 1280 and centres.'],
] as const;

function Pair({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <Inline gap={2} wrap={false} align="start">
      <Text variant="subhead" tone="muted">
        {label}
      </Text>
      <Text variant="subhead" className="flex-1">
        {children}
      </Text>
    </Inline>
  );
}

export const WhatChangesWhere: Story = {
  name: 'What changes, and where',
  render: () => (
    <Card padded={false}>
      {BREAKPOINTS.map(([width, columns, margin, what], i) => (
        <RowCard key={width} first={i === 0}>
          <Text variant="headline" weight="bold">
            {width}
          </Text>
          <Inline gap={4}>
            <Pair label="Columns">{columns}</Pair>
            <Pair label="Margin">{margin}</Pair>
          </Inline>
          <Pair label="What changes">{what}</Pair>
        </RowCard>
      ))}
    </Card>
  ),
};

export const TableOrList: Story = {
  name: 'A table on a phone',
  parameters: designNote('responsive', 'A table on a phone'),
  render: () => (
    <Card padded={false}>
      {PEOPLE.slice(0, 6).map((p, i) => (
        <RowCard key={p.name} first={i === 0}>
          <Inline gap={3} wrap={false}>
            <Avatar name={p.name} size="lg" decorative />
            <View className="flex-1">
              <Text variant="callout" weight="semibold" numberOfLines={1}>
                {p.name}
              </Text>
              <Text variant="subhead" tone="muted" numberOfLines={1}>
                {p.role}
              </Text>
            </View>
          </Inline>
          <Inline gap={3}>
            <Text variant="subhead" tone="muted">
              {p.team}
            </Text>
            <Text variant="subhead" tone="muted">
              {p.location}
            </Text>
            <Badge size="sm" dot tone={STATUS_TONE[p.status]}>
              {p.status}
            </Badge>
          </Inline>
        </RowCard>
      ))}
    </Card>
  ),
};

/**
 * Draws a device at its own size and scales it to the width it was given:
 * a laptop is wider than a phone, and the picture should still fit on one.
 */
function Fit({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}): React.JSX.Element {
  const [room, setRoom] = useState(0);
  const scale = room > 0 ? Math.min(1, room / width) : 0;
  return (
    <View
      className="self-stretch items-center"
      onLayout={(event: LayoutChangeEvent) => {
        setRoom(event.nativeEvent.layout.width);
      }}
    >
      <View style={{ width: width * scale, height: height * scale }}>
        {scale > 0 ? (
          <View
            style={{ width, height, transform: [{ scale }], transformOrigin: 'top left' }}
            className="absolute top-0 left-0"
          >
            {children}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* The device sizes the design draws, in its points: width, height, screen radius. */
const DEVICES = {
  phone: [150, 300, 24],
  tablet: [260, 340, 20],
  laptop: [380, 250, 10],
  desktop: [480, 290, 8],
  tv: [520, 292, 6],
} as const;

function Device({
  kind,
  children,
}: {
  kind: keyof typeof DEVICES;
  children: ReactNode;
}): React.JSX.Element {
  const [width, height, radius] = DEVICES[kind];
  return (
    <Stack gap={2} align="center" className="self-stretch">
      <Fit width={width} height={height}>
        {/* The bezel is the design's own literal, oklch(16% 0 0): a device is dark in both themes. */}
        <View
          aria-hidden
          className="size-full bg-[#121212] p-1.5 shadow-md"
          style={{ borderRadius: radius + 6 }}
        >
          <View className="flex-1 overflow-hidden bg-canvas" style={{ borderRadius: radius }}>
            {children}
          </View>
        </View>
      </Fit>
      <Text variant="caption" tone="muted" className="capitalize">
        {kind}
      </Text>
    </Stack>
  );
}

const bars = (n: number, className: string): ReactNode[] =>
  Array.from({ length: n }, (_, i) => <View key={i} className={`bg-surface ${className}`} />);

export const Devices: Story = {
  name: 'One shell, four devices',
  parameters: {
    docs: {
      description: {
        story:
          'Tab bar, rail, sidebar, centred column: the shell changes at each breakpoint and the components inside it do not. Drawn to scale, then shrunk to fit a phone.',
      },
    },
  },
  render: () => (
    <Stack gap={5}>
      <Device kind="phone">
        <View className="px-2.5 pt-5">
          <Text variant="callout" weight="bold">
            People
          </Text>
          <View className="mt-2 gap-1">{bars(6, 'h-[26px] rounded-xs')}</View>
        </View>
        <View className="absolute right-2 bottom-2 left-2 h-[26px] rounded-full border border-glass-line bg-glass" />
      </Device>
      <Device kind="tablet">
        <View className="flex-1 flex-row">
          <View className="w-9 border-r border-border bg-surface" />
          <View className="flex-1 flex-row flex-wrap content-start gap-1.5 p-3">
            {bars(8, 'h-[34px] w-[47%] rounded-xs')}
          </View>
        </View>
      </Device>
      <Device kind="laptop">
        <View className="flex-1 flex-row">
          <View className="w-[70px] border-r border-border bg-surface" />
          <View className="flex-1 gap-1 p-2.5">{bars(8, 'h-[18px] rounded-[4px]')}</View>
          <View className="w-[90px] border-l border-border bg-surface" />
        </View>
      </Device>
      <Device kind="desktop">
        <View className="flex-1 flex-row">
          <View className="w-20 border-r border-border bg-surface" />
          <View className="flex-1 items-center p-3">
            <View className="w-[260px] gap-1">{bars(10, 'h-[18px] rounded-[4px]')}</View>
          </View>
        </View>
      </Device>
    </Stack>
  ),
};

const TILES = [
  ['Team offsite', 'bg-chart-2'],
  ['Payday', 'bg-chart-3'],
  ['Benefits', 'bg-chart-4'],
  ['Training', 'bg-chart-5'],
] as const;

export const TenFootUI: Story = {
  name: 'Television',
  parameters: designNote('responsive', 'Television'),
  render: () => (
    <Stack gap={3}>
      <Device kind="tv">
        <View className="flex-1 gap-3 px-[22px] py-[18px]">
          <Text variant="headline" weight="bold">
            Good evening, Priya
          </Text>
          <View className="flex-row gap-3">
            {TILES.map(([name, fill], i) => (
              <View
                key={name}
                className={`h-[120px] w-[100px] justify-end rounded-[14px] p-2.5 ${fill} ${i === 0 ? 'border-[3px] border-fg-on-accent shadow-lg' : ''}`}
                style={i === 0 ? { transform: [{ scale: 1.08 }] } : undefined}
              >
                {/* Black on every chart colour clears contrast in both themes; white does not. */}
                <Text variant="caption" weight="bold" className="text-black">
                  {name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </Device>
      <Text variant="subhead" tone="muted">
        Focus grows the card and adds a white ring. Nothing depends on hover.
      </Text>
    </Stack>
  ),
};
