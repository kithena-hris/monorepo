import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { icons } from '../../icons';
import { List, ListItem } from '../list-item/list-item';
import { Progress } from '../progress/progress';
import { SegmentedControl, SegmentedControlItem } from '../segmented-control/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select/select';
import { Stat } from '../stat/stat';
import { Widget, WidgetGrid, WIDGET_LIMIT } from './widget';

const meta = {
  title: 'Components/Widget',
  component: Widget,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A dashboard is a `WidgetGrid` of `Widget`s.',
          '',
          'A `md` grid has two columns at most, each half the row (one under 39rem): never three widgets side by side. A widget with `span` 1 or 2 takes half the row, 3 or 4 the whole of it. A `sm` grid of figure tiles keeps columns of 13rem, as many as fit.',
          '',
          'A `List` inside a widget is its body (`flush`), not a card inside a card.',
          '',
          'A list widget shows its top `WIDGET_LIMIT` (5) rows. Its `toolbar` filters and sorts them, its `insight` says what they add up to, and its header offers See all only when there are more.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof Widget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dashboard: Story = {
  args: { title: 'To do' },
  render: () => (
    <WidgetGrid>
      <Widget
        title="To do"
        icon={<icons.inbox />}
        tone="chart-1"
        meta="3"
        action={
          <Button variant="link" size="sm">
            Open Inbox
          </Button>
        }
        flush
        span={2}
      >
        <List>
          <ListItem description="People · Onboarding" icon={<icons.list />}>
            Finish your profile
          </ListItem>
          <ListItem description="Time Off · 26–30 Oct" icon={<icons.approve />}>
            Approve Leo’s time off
          </ListItem>
        </List>
      </Widget>
      <Widget title="Vacation" icon={<icons.vacation />} tone="chart-2">
        <Stat label="Days left" value="11.5" />
      </Widget>
      <Widget title="Who is away" icon={<icons.calendar />} meta={<Badge size="sm">2</Badge>} flush>
        <List>
          <ListItem description="Back Mon 5 Oct">Hana Kim</ListItem>
          <ListItem description="Back Fri 9 Oct">Ravi Patel</ListItem>
        </List>
      </Widget>
    </WidgetGrid>
  ),
};

export const Tiles: Story = {
  args: { title: 'Tiles' },
  render: () => (
    <WidgetGrid size="sm">
      {['Vacation', 'Personal day', 'Comp time', 'Sick'].map((name) => (
        <Widget key={name} size="sm" title={name}>
          <Stat label="Left" value="11.5" unit="days" />
        </Widget>
      ))}
    </WidgetGrid>
  ),
};

const JOBS = [
  ['Sales Manager', 'Sales · Barcelona', '12 active'],
  ['Backend Engineer', 'Engineering · Remote', '8 active'],
  ['Product Designer', 'Design · Berlin', '5 active'],
  ['Account Executive', 'Sales · London', '4 active'],
  ['Data Analyst', 'Finance · Madrid', '2 active'],
  ['Office Manager', 'Operations · Barcelona', '1 active'],
] as const;

export const TopFive: Story = {
  args: { title: 'Jobs' },
  render: () => (
    <WidgetGrid>
      <Widget
        title="Jobs"
        icon={<icons.work />}
        tone="chart-2"
        meta={JOBS.length}
        action={
          <Button variant="link" size="sm">
            See all
          </Button>
        }
        toolbar={
          <>
            <SegmentedControl aria-label="Show" size="sm" defaultValue="open">
              <SegmentedControlItem value="open">Open</SegmentedControlItem>
              <SegmentedControlItem value="drafts">Drafts</SegmentedControlItem>
              <SegmentedControlItem value="all">All</SegmentedControlItem>
            </SegmentedControl>
            <Select defaultValue="newest">
              <SelectTrigger aria-label="Sort" size="sm" className="ms-auto w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="candidates">Most candidates</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        insight={
          <Progress
            label="Candidates by step"
            max={32}
            showValue
            valueLabel="32 active"
            segments={[
              { value: 14, label: '14 screening', tone: 'chart-1' },
              { value: 12, label: '12 interviewing', tone: 'chart-2' },
              { value: 6, label: '6 at offer', tone: 'chart-3' },
            ]}
          />
        }
        flush
        span={2}
      >
        <List>
          {JOBS.slice(0, WIDGET_LIMIT).map(([title, where, active]) => (
            <ListItem
              key={title}
              icon={<icons.work />}
              description={where}
              trailing={<Badge size="sm">{active}</Badge>}
              chevron
            >
              {title}
            </ListItem>
          ))}
        </List>
      </Widget>
    </WidgetGrid>
  ),
};
