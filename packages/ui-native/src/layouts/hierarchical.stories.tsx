import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { AppBar, LargeTitle } from '../components/app-bar/app-bar.tsx';
import { Avatar } from '../components/avatar/avatar.tsx';
import { Breadcrumb } from '../components/breadcrumb/breadcrumb.tsx';
import { Card } from '../components/card/card.tsx';
import { Skeleton } from '../components/feedback/feedback.tsx';
import { Inline, Stack } from '../components/layout/layout.tsx';
import { Text } from '../components/text/text.tsx';
import { animateTo, useMotion } from '../lib/animate.ts';
import { designDocs } from '../docs/design.ts';
import { PEOPLE } from '../docs/people.ts';
import {
  AddButton,
  PeopleList,
  Screen,
  ScreenBody,
  ScreenNote,
  ScreenTabBar,
} from '../docs/screen.tsx';
import { StandInKeyValues } from '../docs/stage.tsx';

/*
 * List and detail. A phone has room for one, so a row pushes its detail on
 * top of the list, and back (the bar's control, or a swipe from the edge)
 * returns to it. The push itself is the app's navigator's; the screens either
 * side of it are the library's.
 */

const meta = {
  title: 'Layouts/Hierarchical',
  component: AppBar,
  parameters: designDocs('hierarchical'),
} satisfies Meta<typeof AppBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const nowhere = { onPress: () => undefined };

function ListScreen({
  height,
  onOpen,
}: {
  height: number;
  onOpen?: (name: string) => void;
}): React.JSX.Element {
  return (
    <Screen height={height}>
      <AppBar trailing={<AddButton />} />
      <LargeTitle>People</LargeTitle>
      <ScreenBody>
        <PeopleList {...(onOpen ? { onOpen } : {})} />
      </ScreenBody>
      <ScreenTabBar />
    </Screen>
  );
}

function Detail({ name }: { name: string }): React.JSX.Element {
  const person = PEOPLE.find((p) => p.name === name) ?? PEOPLE[0];
  return (
    <ScreenBody className="gap-4">
      <Inline gap={4} className="items-center">
        <Avatar name={person.name} size={56} decorative />
        <Text variant="title3" weight="bold" accessibilityRole="header">
          {person.name}
        </Text>
      </Inline>
      <Card className="py-2.5">
        <StandInKeyValues
          pairs={[
            ['Team', person.team],
            ['Manager', 'Jonas Weber'],
          ]}
        />
      </Card>
    </ScreenBody>
  );
}

export const Playground: Story = {
  render: () => (
    <Stack className="gap-2.5">
      <ListScreen height={420} />
      <Screen height={420}>
        <AppBar back={{ label: 'People', ...nowhere }} trailing={<AddButton />} />
        <Detail name="Priya Shah" />
      </Screen>
    </Stack>
  ),
};

/**
 * A detail screen sliding in over the list from the trailing edge, on the
 * sheet's spring (a cross-fade under reduced motion), and back out.
 */
function Pushed({ open, children }: { open: boolean; children: ReactNode }): React.JSX.Element {
  const { sheet } = useMotion();
  const [width, setWidth] = useState(390);
  const offset = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    offset.value = animateTo(open ? 0 : 1, open ? sheet.enter : sheet.exit);
  }, [open, offset, sheet]);
  const slide = sheet.slide;
  const style = useAnimatedStyle(
    () =>
      slide ? { transform: [{ translateX: offset.value * width }] } : { opacity: 1 - offset.value },
    [slide, width],
  );
  return (
    <View
      pointerEvents={open ? 'auto' : 'none'}
      className="absolute inset-0"
      onLayout={(e) => {
        setWidth(e.nativeEvent.layout.width);
      }}
    >
      {/* The motion on a bare Animated.View, the classes inside it (RMB-001). */}
      <Animated.View style={[{ flex: 1 }, style]}>
        <View className="flex-1 bg-canvas">{children}</View>
      </Animated.View>
    </View>
  );
}

function PushDemo(): React.JSX.Element {
  // Opened on the detail, as the design draws it: back returns to the list.
  const [opened, setOpened] = useState<string | null>('Priya Shah');
  const [shown, setShown] = useState('Priya Shah');
  return (
    <Stack className="gap-2.5">
      <ScreenNote>
        Tapping a row pushes the detail in from the right. Back returns to the list.
      </ScreenNote>
      <Screen height={300}>
        {/* Under the pushed screen: hidden from a reader, and (on the web) out of the tab order. */}
        <View
          className="flex-1"
          aria-hidden={opened !== null}
          {...((opened ? { inert: true } : {}) as object)}
        >
          <AppBar trailing={<AddButton />} />
          <LargeTitle>People</LargeTitle>
          <ScreenBody>
            <PeopleList
              count={3}
              onOpen={(name) => {
                setShown(name);
                setOpened(name);
              }}
            />
          </ScreenBody>
        </View>
        <Pushed open={opened !== null}>
          <AppBar
            title={shown}
            back={{
              label: 'People',
              onPress: () => {
                setOpened(null);
              },
            }}
          />
          <ScreenBody>
            <Skeleton className="h-[120px] rounded-[16px]" />
          </ScreenBody>
        </Pushed>
      </Screen>
    </Stack>
  );
}

export const ThePushAtMd: Story = {
  name: 'The push, at md',
  render: () => <PushDemo />,
};

export const ThreeLevelsDeep: Story = {
  name: 'Three levels deep',
  render: () => (
    <Screen>
      <AppBar
        title="Priya Shah"
        back={{ label: 'Engineering', ...nowhere }}
        trailing={<AddButton />}
      />
      <ScreenBody>
        <Breadcrumb
          items={[
            { label: 'People', ...nowhere },
            { label: 'Engineering', ...nowhere },
            { label: 'Priya Shah' },
          ]}
        />
        <Skeleton className="h-[200px] rounded-[16px]" />
      </ScreenBody>
    </Screen>
  ),
};
