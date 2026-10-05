import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check, RotateCcw } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useCssElement } from 'react-native-css';
import { View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Badge } from '../components/badge/badge.tsx';
import { Button } from '../components/button/button.tsx';
import { Card } from '../components/card/card.tsx';
import { Icon } from '../components/icon/icon.tsx';
import { AutoGrid, Inline, Stack } from '../components/layout/layout.tsx';
import { Separator } from '../components/separator/separator.tsx';
import { Spinner } from '../components/spinner/spinner.tsx';
import { Text } from '../components/text/text.tsx';
import { designDocs } from '../docs/design.ts';
import { animateTo } from '../lib/animate.ts';
import {
  durations,
  easings,
  gentleSpring,
  physics,
  PRESS_SCALE,
  type Bezier,
  type Transition,
} from '../lib/motion.ts';

const meta = {
  title: 'Foundations/Motion',
  parameters: designDocs('motion'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The track's dot is 20 across, inset 4 at each end. */
const DOT = 20;
const INSET = 4;

/**
 * A dot crossing a track on a transition, from rest, when the story is replayed.
 * Nothing moves on first render: a comparison is only a comparison when the
 * runners start together, which is what "Play" does.
 */
function Track({
  label,
  value,
  transition,
  run,
}: {
  label: string;
  value: string;
  transition: Transition;
  run: number;
}): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (run === 0 || width === 0) return;
    x.value = 0;
    x.value = animateTo(width - DOT - INSET * 2, transition);
  }, [run, width, transition, x]);
  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    top: INSET,
    left: INSET,
    transform: [{ translateX: x.value }],
  }));
  return (
    <Stack gap={1} className="gap-1.5">
      <Inline justify="between" wrap={false}>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
        <Text variant="caption" tone="muted" mono>
          {value}
        </Text>
      </Inline>
      <View
        className="h-7 rounded-full bg-surface-sunken"
        onLayout={(event: LayoutChangeEvent) => {
          setWidth(event.nativeEvent.layout.width);
        }}
      >
        {/* The movement on a bare Animated.View, the classes inside it (RMB-001). */}
        <Animated.View style={style}>
          <View className="size-5 rounded-full bg-accent" />
        </Animated.View>
      </View>
    </Stack>
  );
}

function Replay({ children }: { children: (run: number) => ReactNode }): React.JSX.Element {
  const [run, setRun] = useState(0);
  return (
    <Stack gap={3} className="gap-3.5">
      {children(run)}
      <Button
        variant="ghost"
        size="sm"
        startIcon={<Icon icon={RotateCcw} />}
        className="self-start"
        onPress={() => {
          setRun((n) => n + 1);
        }}
      >
        Play
      </Button>
    </Stack>
  );
}

const timing = (duration: number, easing: Bezier = easings.standard): Transition => ({
  type: 'timing',
  duration,
  easing,
});

const DURATIONS = Object.entries(durations) as [keyof typeof durations, number][];

export const Durations: Story = {
  name: 'Duration, side by side',
  parameters: {
    docs: {
      description: {
        story:
          'The four durations Reach ships, the same on the web: `instant` reads as a state change, `fast` as a response, `normal` as a movement, `slow` as something travelling a distance. The design drew 120 to 480; the phone runs on what the web ships, so the two never move at different speeds.',
      },
    },
  },
  render: () => (
    <Replay>
      {(run) =>
        DURATIONS.map(([name, ms]) => (
          <Track
            key={name}
            label={`${name[0]?.toUpperCase() ?? ''}${name.slice(1)} · ${String(ms)}`}
            value={`${String(ms)}ms`}
            transition={timing(ms)}
            run={run}
          />
        ))
      }
    </Replay>
  ),
};

/*
 * The counter-example: a spring with the damping a menu should never have.
 * Not a token, deliberately: it exists only to be raced and rejected.
 */
const BOUNCY = physics({ damping: 0.4, response: 0.35 });

export const Springs: Story = {
  name: 'Springs, raced',
  render: () => (
    <Stack gap={3}>
      <Replay>
        {(run) => [
          <Track
            key="gentle"
            label="Gentle spring · sheets"
            value="spring"
            transition={physics(gentleSpring)}
            run={run}
          />,
          <Track
            key="standard"
            label="Standard · everything else"
            value={`${String(durations.slow)}ms`}
            transition={timing(durations.slow)}
            run={run}
          />,
          <Track
            key="bouncy"
            label="Bouncy · never use"
            value="spring"
            transition={BOUNCY}
            run={run}
          />,
        ]}
      </Replay>
      <Text variant="subhead" tone="muted">
        Reach uses one gentle spring for things you can throw, like sheets and cards. Nothing else
        bounces past its target.
      </Text>
    </Stack>
  ),
};

const curveMapping = {
  className: { target: 'style', nativeStyleMapping: { color: 'color' } },
} as const;

/** A cubic-bézier drawn in its unit square, 0 at the bottom left. */
function Curve({ name, points }: { name: string; points: Bezier }): React.JSX.Element {
  const [x1, y1, x2, y2] = points;
  const drawing = useCssElement(
    Svg,
    {
      width: 120,
      height: 120,
      viewBox: '0 0 100 100',
      className: 'text-accent',
      children: (
        <Path
          d={`M0 100 C${String(x1 * 100)} ${String(100 - y1 * 100)} ${String(x2 * 100)} ${String(100 - y2 * 100)} 100 0`}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ),
    },
    curveMapping,
  );
  return (
    <Stack gap={2} align="center">
      <View aria-hidden className="size-[120px] rounded-sm bg-surface-sunken">
        {drawing}
      </View>
      <Text variant="caption" weight="semibold">
        {name}
      </Text>
    </Stack>
  );
}

export const Easings: Story = {
  name: 'Easing, raced',
  parameters: {
    docs: {
      description: {
        story:
          'Standard for change in place, the entrance curve for something arriving (fast, then settling), the exit curve for something leaving (slow, then gone).',
      },
    },
  },
  render: () => (
    <Inline gap={5} justify="around">
      <Curve name="Standard" points={easings.standard} />
      <Curve name="Enter" points={easings.entrance} />
      <Curve name="Exit" points={easings.exit} />
    </Inline>
  ),
};

function Frame({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <Stack gap={2} align="center">
      <View
        aria-hidden
        className="size-24 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken"
      >
        {children}
      </View>
      <Text variant="caption" tone="muted" className="text-center">
        {label}
      </Text>
    </Stack>
  );
}

export const Entrances: Story = {
  name: 'Entrances and exits',
  render: () => (
    <Inline gap={4} justify="around">
      <Frame label="Fade and rise 8px">
        <View
          className="h-10 w-14 rounded-sm bg-surface opacity-50 shadow-md"
          style={{ transform: [{ translateY: 8 }] }}
        />
      </Frame>
      <Frame label="Scale from 96%">
        <View
          className="h-10 w-14 rounded-sm bg-surface opacity-60 shadow-md"
          style={{ transform: [{ scale: 0.96 }] }}
        />
      </Frame>
      <Frame label="Sheet from the edge">
        <View
          className="absolute bottom-0 h-[60px] w-14 rounded-t-sm bg-surface shadow-md"
          style={{ transform: [{ translateY: 20 }] }}
        />
      </Frame>
      <Frame label="Exit is faster than entry">
        <Text variant="title3" weight="bold">
          ⅔
        </Text>
      </Frame>
    </Inline>
  ),
};

function State({ note, children }: { note: string; children: ReactNode }): React.JSX.Element {
  return (
    <Stack gap={3} align="center">
      <View className="h-[52px] items-center justify-center">{children}</View>
      <Text variant="subhead" tone="muted" className="text-center">
        {note}
      </Text>
    </Stack>
  );
}

export const StateTransitions: Story = {
  name: 'State, not just entrance',
  parameters: {
    docs: {
      description: {
        story:
          'Each control is drawn mid-change. The switch and the checkbox here are pictures, hidden from a screen reader; the controls themselves are Forms’.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth={150} gap={6}>
      <State note={`Scale ${String(PRESS_SCALE)} on press`}>
        <View style={{ transform: [{ scale: PRESS_SCALE }] }}>
          <Button variant="primary">Pressed</Button>
        </View>
      </State>
      <State note={`Knob slides ${String(durations.normal)}ms`}>
        <View
          aria-hidden
          className="h-8 w-[52px] justify-center rounded-full bg-success-solid px-0.5"
        >
          <View className="size-7 self-end rounded-full bg-fg-on-accent shadow-sm" />
        </View>
      </State>
      <State note="Tick draws in">
        <View
          aria-hidden
          className="size-[22px] items-center justify-center rounded-xs bg-accent-solid"
        >
          <Icon icon={Check} size={14} tone="on-accent" />
        </View>
      </State>
      <State note="Counts roll">
        <Badge tone="danger" variant="solid">
          3
        </Badge>
      </State>
    </AutoGrid>
  ),
};

export const LoadingMotion: Story = {
  name: 'Loading',
  parameters: {
    docs: {
      description: {
        story:
          'A spinner for a short wait on one thing, a skeleton where content will be, a bar when the length is unknown. The skeleton and the bar are drawn here; Feedback and Progress own them.',
      },
    },
  },
  render: () => (
    <Inline gap={6} className="gap-7">
      <Spinner size={24} />
      <View aria-hidden className="gap-2">
        <View className="h-3 w-[180px] rounded-xs bg-surface-sunken" />
        <View className="h-3 w-[120px] rounded-xs bg-surface-sunken" />
      </View>
      <View aria-hidden className="h-2 w-[180px] overflow-hidden rounded-full bg-surface-active">
        <View className="h-full w-[40%] rounded-full bg-accent" />
      </View>
    </Inline>
  ),
};

const REDUCED = [
  ['Slides and sheets', 'Cross-fade instead'],
  ['Scale on press', 'Colour change only'],
  ['Skeleton shimmer', 'Static fill'],
  ['Spinners', 'Keep, they are meaning'],
  ['Auto-playing charts', 'Draw instantly'],
] as const;

export const ReducedMotion: Story = {
  name: 'Under reduced motion',
  parameters: {
    docs: {
      description: {
        story:
          'Reduced motion is about travel, not change. `motionPresets(true)` makes each of these swaps, and `ReachProvider` takes the system setting unless an app says otherwise.',
      },
    },
  },
  render: () => (
    <Card padded={false} className="px-4 py-1">
      {REDUCED.map(([what, becomes], i) => (
        <View key={what}>
          {i > 0 ? <Separator /> : null}
          <Inline justify="between" wrap={false} className="min-h-[52px] gap-4 py-2.5">
            <Text variant="callout" tone="muted">
              {what}
            </Text>
            <Text variant="callout" weight="medium" className="flex-1 text-right">
              {becomes}
            </Text>
          </Inline>
        </View>
      ))}
    </Card>
  ),
};
