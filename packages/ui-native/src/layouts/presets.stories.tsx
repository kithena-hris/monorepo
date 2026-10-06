import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Ellipsis, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native-css/components';

import { AppBar, LargeTitle, useAppBarScroll } from '../components/app-bar/app-bar.tsx';
import { Avatar } from '../components/avatar/avatar.tsx';
import { Banner } from '../components/banner/banner.tsx';
import { Button } from '../components/button/button.tsx';
import { Card } from '../components/card/card.tsx';
import { type DateRange } from '../components/calendar/calendar.tsx';
import { ChipGroup, ChipGroupItem } from '../components/chip/chip.tsx';
import { DatePicker } from '../components/date-picker/date-picker.tsx';
import { Field, FieldLabel } from '../components/field/field.tsx';
import { Icon } from '../components/icon/icon.tsx';
import { Inline, Stack } from '../components/layout/layout.tsx';
import { OrgChart, type OrgNode } from '../components/org-chart/org-chart.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select/select.tsx';
import { Text } from '../components/text/text.tsx';
import { designDocs, designNote } from '../docs/design.ts';
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
 * The shell every phone screen follows, composed from the library: the top
 * bar (`AppBar`), the large title (`LargeTitle`), the content, and the
 * floating `TabBar`. The device's status bar is the Storybook's chrome around
 * the story. On Android the bars follow Android: a back arrow with no label,
 * the title at the start, the tab bar's pill behind the icon.
 */

const meta = {
  title: 'Layouts/Presets',
  component: AppBar,
  parameters: designDocs('layout-presets'),
} satisfies Meta<typeof AppBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const back = (label: string): { label: string; onPress: () => void } => ({
  label,
  onPress: () => undefined,
});

/**
 * A top-level screen whose large title collapses into the bar as the content
 * scrolls under it, and whose tab bar stays.
 */
function TabScreen({
  title,
  trailing = <AddButton />,
  above,
  toolbar,
  tab,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  /** Across the top, above the bar: a banner. */
  above?: ReactNode;
  /** Under the large title: a row of filters. */
  toolbar?: ReactNode;
  tab?: string;
  children: ReactNode;
}): React.JSX.Element {
  // The large title is about 44 tall: once it has gone, the bar takes the title.
  const { scrolled, onScroll } = useAppBarScroll(44);
  return (
    <Screen>
      {above}
      <AppBar scrolled={scrolled} trailing={trailing} {...(scrolled ? { title } : {})} />
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        stickyHeaderIndices={toolbar ? [1] : []}
      >
        <LargeTitle>{title}</LargeTitle>
        {toolbar ? <View className="bg-canvas px-4 pb-3">{toolbar}</View> : null}
        <ScreenBody>{children}</ScreenBody>
      </ScrollView>
      <ScreenTabBar {...(tab ? { initial: tab } : {})} />
    </Screen>
  );
}

export const Playground: Story = {
  render: () => (
    <TabScreen title="People">
      <PeopleList />
    </TabScreen>
  ),
};

/** A figure on the home screen: what it is, then the number and its unit. */
function Figure({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}): React.JSX.Element {
  return (
    <Card>
      <Text tone="muted">{label}</Text>
      <Inline gap={1} className="items-baseline">
        <Text variant="title1" weight="bold" tabular>
          {value}
        </Text>
        <Text variant="callout" weight="semibold" tone="muted">
          {unit}
        </Text>
      </Inline>
    </Card>
  );
}

export const Stacked: Story = {
  render: () => (
    <TabScreen title="Home" tab="home" trailing={<Avatar name="Priya Shah" size="md" />}>
      <Figure label="Vacation left" value="14.5" unit="days" />
      <Figure label="Next payday" value="2" unit="days" />
    </TabScreen>
  ),
};

export const SidebarAndAside: Story = {
  name: 'Sidebar and aside',
  parameters: designNote('layout-presets', 'Sidebar and aside'),
  render: () => (
    <Screen>
      <AppBar
        back={back('People')}
        trailing={
          <Button
            size="xs"
            variant="secondary"
            startIcon={<Icon icon={Ellipsis} />}
            accessibilityLabel="More"
          />
        }
      />
      <ScreenBody className="gap-4">
        <Inline gap={4} className="items-center">
          <Avatar name="Priya Shah" size="2xl" decorative />
          <Stack className="gap-0.5">
            <Text variant="title2" weight="bold" accessibilityRole="header">
              Priya Shah
            </Text>
            <Text variant="subhead" tone="muted">
              Senior Engineer
            </Text>
          </Stack>
        </Inline>
        <Card className="py-2.5">
          <StandInKeyValues
            pairs={[
              ['Team', 'Engineering'],
              ['Manager', 'Jonas Weber'],
              ['Location', 'Berlin'],
            ]}
          />
        </Card>
      </ScreenBody>
    </Screen>
  ),
};

export const WithABanner: Story = {
  name: 'With a banner',
  render: () => (
    <TabScreen title="Payroll" above={<Banner tone="warning" title="Payroll closes tomorrow" />}>
      <PeopleList />
    </TabScreen>
  ),
};

function TeamFilter(): React.JSX.Element {
  const [team, setTeam] = useState('all');
  return (
    <ChipGroup type="single" value={team} onValueChange={setTeam} accessibilityLabel="Teams" scroll>
      <ChipGroupItem value="all" variant="view">
        All
      </ChipGroupItem>
      <ChipGroupItem value="engineering" variant="view">
        Engineering
      </ChipGroupItem>
      <ChipGroupItem value="design" variant="view">
        Design
      </ChipGroupItem>
      <ChipGroupItem value="sales" variant="view">
        Sales
      </ChipGroupItem>
    </ChipGroup>
  );
}

export const WithAStickyToolbar: Story = {
  name: 'With a sticky toolbar',
  render: () => (
    <TabScreen title="People" toolbar={<TeamFilter />}>
      <PeopleList />
    </TabScreen>
  ),
};

function NewRequest(): React.JSX.Element {
  const [range, setRange] = useState<DateRange | null>({ start: '2026-10-14', end: '2026-10-18' });
  return (
    <Screen>
      {(host) => (
        <>
          <AppBar
            title="New request"
            leading={
              <Button
                size="xs"
                variant="secondary"
                startIcon={<Icon icon={X} />}
                accessibilityLabel="Close"
              />
            }
          />
          <ScreenBody className="pb-4">
            <Field>
              <FieldLabel>Leave type</FieldLabel>
              <Select defaultValue="vacation">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent portalHost={host}>
                  <SelectItem value="vacation">Vacation</SelectItem>
                  <SelectItem value="sick">Sick leave</SelectItem>
                  <SelectItem value="parental">Parental leave</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Dates</FieldLabel>
              <DatePicker
                mode="range"
                label="Dates"
                locale="en-GB"
                format={{ day: 'numeric', month: 'short' }}
                value={range}
                onChange={setRange}
                portalHost={host}
              />
            </Field>
            <View className="h-[120px]" />
            <Button variant="primary" fullWidth>
              Send request
            </Button>
          </ScreenBody>
        </>
      )}
    </Screen>
  );
}

export const Focused: Story = {
  render: () => <NewRequest />,
};

const TEAM: OrgNode[] = [
  { id: 'nora', name: 'Nora Becker', title: 'Head of People' },
  { id: 'sofia', name: 'Sofia Lindqvist', title: 'Recruiter', parentId: 'nora' },
  { id: 'jonas', name: 'Jonas Weber', title: 'Eng Manager', parentId: 'nora' },
  { id: 'priya', name: 'Priya Shah', title: 'Engineer', parentId: 'jonas' },
];

export const Canvas: Story = {
  render: () => (
    <Screen>
      <AppBar title="Org chart" back={back('People')} trailing={<AddButton />} />
      <ScreenBody className="flex-1 pb-4">
        <OrgChart label="Reporting lines" nodes={TEAM} />
      </ScreenBody>
    </Screen>
  ),
};

/** One numbered part of the header, outlined. */
function Part({ children }: { children: string }): React.JSX.Element {
  return (
    <View className="rounded-[12px] border-[1.5px] border-dashed border-accent p-2.5">
      <ScreenNote>{children}</ScreenNote>
    </View>
  );
}

export const PageHeaderAnatomy: Story = {
  name: 'PageHeader anatomy',
  render: () => (
    <TabScreen title="People">
      <Part>1 Top bar: back or close, title when scrolled, one action</Part>
      <Part>2 Large title: shrinks into the bar on scroll</Part>
      <Part>3 Search or filters: optional, sticky</Part>
    </TabScreen>
  ),
};

export const CollapsingTheRails: Story = {
  name: 'Collapsing the rails',
  render: () => (
    <Screen>
      <AppBar scrolled title="People" trailing={<AddButton />} />
      <ScrollView>
        <ScreenBody className="pt-2">
          <ScreenNote>
            Scrolled: the large title has collapsed into the top bar, and the tab bar stays.
          </ScreenNote>
          <PeopleList count={6} />
        </ScreenBody>
      </ScrollView>
      <ScreenTabBar />
    </Screen>
  ),
};

export const ThreeLevelsOfNavigation: Story = {
  name: 'Three levels of navigation',
  render: () => (
    <Stack className="gap-2.5">
      <Screen height={360}>
        <AppBar trailing={<AddButton />} />
        <LargeTitle>People</LargeTitle>
        <ScreenBody>
          <ScreenNote>Level 1 · Tab</ScreenNote>
        </ScreenBody>
        <ScreenTabBar />
      </Screen>
      <Screen height={360}>
        <AppBar title="Engineering" back={back('People')} trailing={<AddButton />} />
        <ScreenBody>
          <ScreenNote>Level 2 · Pushed list</ScreenNote>
        </ScreenBody>
        <ScreenTabBar />
      </Screen>
      <Screen height={360}>
        <AppBar title="Priya" back={back('Engineering')} trailing={<AddButton />} />
        <ScreenBody>
          <ScreenNote>Level 3 · Detail, tab bar hidden</ScreenNote>
        </ScreenBody>
      </Screen>
    </Stack>
  ),
};
