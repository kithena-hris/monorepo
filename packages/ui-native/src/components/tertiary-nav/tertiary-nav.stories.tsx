import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { ChevronDown, ChevronsUpDown } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Stage, StandInKeyValues, settled } from '../../docs/stage.tsx';
import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  ActionSheetTrigger,
} from '../action-sheet/action-sheet.tsx';
import { AppBar } from '../app-bar/app-bar.tsx';
import { Button } from '../button/button.tsx';
import { Skeleton } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { List, ListItem } from '../list-item/list-item.tsx';
import { Tabs, TabsList, TabsTrigger } from '../tabs/tabs.tsx';
import { Text } from '../text/text.tsx';
import { TableOfContents } from './tertiary-nav.tsx';

const meta = {
  title: 'Components/Tertiary navigation',
  component: TableOfContents,
  parameters: designDocs('tertiary-nav'),
} satisfies Meta<typeof TableOfContents>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;
const SECTIONS = ['Personal', 'Employment', 'Pay', 'Time off', 'Documents'];

export const Playground: Story = {
  args: { items: [], value: '', onValueChange: noop },
  render: function PlaygroundStory() {
    const [section, setSection] = useState('Employment');
    return (
      <View className="h-[560px] overflow-hidden rounded-[28px] border border-border bg-canvas">
        <AppBar title="Priya Shah" back={{ label: 'People', onPress: noop }} />
        <View className="gap-3.5 px-4 pt-2">
          <Tabs value={section} onValueChange={setSection}>
            <TabsList variant="pill" accessibilityLabel="Sections">
              {SECTIONS.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <View className="rounded-[22px] bg-surface p-3.5 shadow-sm">
            <StandInKeyValues
              pairs={[
                ['Team', 'Engineering'],
                ['Manager', 'Jonas Weber'],
                ['Contract', 'Permanent'],
                ['Hours', '40 per week'],
              ]}
            />
          </View>
        </View>
      </View>
    );
  },
};

export const UnderPrimaryTabs: Story = {
  name: 'Under primary tabs',
  parameters: designNote('tertiary-nav', 'Under primary tabs'),
  args: { items: [], value: '', onValueChange: noop },
  render: function UnderStory() {
    const [area, setArea] = useState('time-off');
    const [view, setView] = useState('requests');
    return (
      <View className="gap-3">
        <Tabs value={area} onValueChange={setArea}>
          <TabsList accessibilityLabel="Area">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="time-off">Time off</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={view} onValueChange={setView}>
          <TabsList variant="pill" accessibilityLabel="View">
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="policy">Policy</TabsTrigger>
          </TabsList>
        </Tabs>
        <Skeleton className="h-20 rounded-[14px]" />
      </View>
    );
  },
};

const CONTENTS = [
  { id: 'overview', label: 'Overview' },
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'how', label: 'How to request' },
  { id: 'planned', label: 'Planned leave', level: 2 as const },
  { id: 'emergencies', label: 'Emergencies', level: 2 as const },
  { id: 'carry-over', label: 'Carry-over' },
  { id: 'faq', label: 'FAQ' },
];

export const AsATableOfContents: Story = {
  name: 'As a table of contents',
  parameters: designNote('tertiary-nav', 'As a table of contents'),
  args: { items: [], value: '', onValueChange: noop },
  render: function ContentsStory() {
    const [section, setSection] = useState('how');
    return (
      <View className="gap-3">
        <Button endIcon={<Icon icon={ChevronDown} />} fullWidth>
          On this page
        </Button>
        <TableOfContents items={CONTENTS} value={section} onValueChange={setSection} />
      </View>
    );
  },
};

const STATUS = {
  success: ['bg-success', 'Done'],
  warning: ['bg-warning', 'Needs attention'],
  danger: ['bg-danger', 'Missing'],
} as const;

export const WithCountsAndStatus: Story = {
  name: 'With counts and status',
  args: { items: [], value: '', onValueChange: noop },
  render: () => (
    <List>
      {(
        [
          ['Personal', 'success'],
          ['Right to work', 'warning'],
          ['Bank details', 'danger'],
          ['Documents', null, 12],
          ['Equipment', null, 3],
        ] as const
      ).map(([label, status, count]) => (
        <ListItem
          key={label}
          chevron
          onPress={noop}
          accessibilityLabel={
            status ? `${label}, ${STATUS[status][1]}` : `${label}, ${String(count)}`
          }
          trailing={
            status ? (
              <View className={`size-2 rounded-full ${STATUS[status][0]}`} />
            ) : (
              <Text variant="subhead" tone="muted">
                {String(count)}
              </Text>
            )
          }
        >
          {label}
        </ListItem>
      ))}
    </List>
  ),
};

export const CollapsedIntoAMenu: Story = {
  name: 'Collapsed into a menu',
  play: settled,
  args: { items: [], value: '', onValueChange: noop },
  render: function MenuStory() {
    const [section, setSection] = useState('Employment');
    return (
      <ActionSheet defaultOpen>
        <Stage
          height={460}
          trigger={
            <ActionSheetTrigger>
              <Button endIcon={<Icon icon={ChevronsUpDown} />} fullWidth>
                {section}
              </Button>
            </ActionSheetTrigger>
          }
        >
          {(host) => (
            <ActionSheetContent portalHost={host} label="Sections">
              {SECTIONS.map((name) => (
                <ActionSheetItem
                  key={name}
                  selected={name === section}
                  onSelect={() => {
                    setSection(name);
                  }}
                >
                  {name}
                </ActionSheetItem>
              ))}
            </ActionSheetContent>
          )}
        </Stage>
      </ActionSheet>
    );
  },
};
